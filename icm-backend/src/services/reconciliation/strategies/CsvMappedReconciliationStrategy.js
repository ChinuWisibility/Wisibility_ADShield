import mongoose from "mongoose";
import Application from "../../../models/application/Application.js";
import ApplicationUserDuplicate from "../../../models/application/ApplicationUserDuplicate.js";
import { getDynamicUserModel } from "../../../models/application/Users.js";
import {
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
  ensureReconciliationIndexes,
} from "../../../utils/applicationDynamicCollections.js";
import { getReconciliationModels } from "../../../utils/reconciliationCollections.js";
import {
  canonicalizeIncomingUsers,
  applicationIdInClause,
  normalizePrimaryKeyValue,
  ensureManagedUserPkUniqueIndex,
  syncApplicationUserDuplicateSidecar,
} from "../../application/applicationUserIngestService.js";
import { compareAccountMaps } from "../deltaComparisonService.js";
import {
  buildAccountMap,
  buildEntitlementCatalog,
} from "../reconciliationAccountUtils.js";
import { buildRunSummary } from "../reconciliationSummaryService.js";
import { generateRunId } from "../generateRunId.js";
import {
  isHashReconciliationEnabled,
  partitionAccountsBySyncState,
  loadSnapshotSubsetMap,
  upsertIdentitySyncStateBatch,
  resolveStableSyncKey,
  reclassifyHashPartitionForLiveUserRepair,
  loadLiveUserIdsBySyncKey,
  HASH_ALGORITHM_VERSION,
} from "../../sync/accountHashService.js";
import { loadSnapshotMap, loadLiveUsersAccountMap, persistRunSnapshot } from "../snapshotService.js";
import IdentitySyncState from "../../../models/sync/IdentitySyncState.js";
import {
  csvBulkWriteChunked,
  csvInsertManyChunked,
  runExecutionGraph,
  CSV_BULK_DEFAULTS,
} from "../../csvImport/bulkWritePool.js";
import { runStrategyLifecycle } from "./IReconciliationStrategy.js";

const MANAGED_PK_INDEX_PREFIX = "uniq_app_users_pk_";

/** Adopt native driver for CSV strategy bulk ingest (measured ≥15% vs Mongoose on remote Mongo). */
const USE_NATIVE =
  process.env.CSV_IMPORT_USE_NATIVE_DRIVER !== "0" &&
  process.env.CSV_IMPORT_USE_NATIVE_DRIVER !== "false";

/**
 * Optimized Map & import reconciliation strategy.
 * Produces the same collections as runReconciliation for source=csv_mapped,
 * with strategy-owned DAG, pre-assigned ObjectIds, and CSV-tuned bulk writes.
 */
export class CsvMappedReconciliationStrategy {
  async prepare(ctx) {
    const { application, rawUserDocs, meta = {}, engineTimings = {} } = ctx;
    const stageTimings = { ...engineTimings };
    const startedAt = new Date();
    const runId = generateRunId();
    let t = Date.now();
    const mark = (name) => {
      stageTimings[name] = Date.now() - t;
      t = Date.now();
    };

    let tenantOid = toTenantObjectId(application.tenantId);
    if (!tenantOid && application._id) {
      const row = await Application.findById(application._id)
        .select("tenantId reconciliationConfig")
        .lean();
      tenantOid = toTenantObjectId(row?.tenantId);
      if (row?.reconciliationConfig && !application.reconciliationConfig) {
        application.reconciliationConfig = row.reconciliationConfig;
      }
    }
    if (!tenantOid) {
      throw new Error("Application has no valid tenantId for reconciliation");
    }

    const tenantSlug = await resolveTenantSlugFromTenantId(tenantOid);
    if (!tenantSlug) {
      throw new Error("Could not resolve tenant slug for reconciliation");
    }

    // Indexes should already exist; ensure is idempotent (not recreated every upload hot path beyond check).
    await ensureReconciliationIndexes(application.name, tenantSlug);

    const models = getReconciliationModels(application.name, tenantSlug);
    const appId = application._id;
    const reconConfig = application.reconciliationConfig || {};

    const previousRun = await models.Runs.findOne({
      applicationId: applicationIdInClause(appId),
      status: "COMPLETED",
    })
      .sort({ reconciliationDate: -1 })
      .select("runId")
      .lean();
    const previousRunId = previousRun?.runId ?? null;

    await models.Runs.create({
      runId,
      tenantId: tenantOid,
      applicationId: appId,
      reconciliationDate: startedAt,
      source: meta.source || "csv_mapped",
      uploadedFileName: meta.uploadedFileName ?? null,
      uploadedBy: meta.uploadedBy ?? null,
      previousRunId,
      status: "PROCESSING",
      startedAt,
    });

    const payload = await canonicalizeIncomingUsers(application, rawUserDocs, {
      source: meta.source || "csv_mapped",
      strictPkResolution: meta.strictPkResolution,
      initialSkippedMissingPk: meta.initialSkippedMissingPk,
      userMappingsForPk: meta.userMappingsForPk,
    });
    mark("canonicalizeMs");

    const { map: currentMap, pkField } = buildAccountMap(
      payload.canonicalDocs,
      payload.userMappings,
      application.csvImportMapping,
    );
    mark("buildAccountMapMs");

    const hashMeta = { ...meta, source: meta.source || "csv_mapped" };
    const hashEnabled = isHashReconciliationEnabled(hashMeta);
    let hashPartition = null;
    if (hashEnabled) {
      hashPartition = await partitionAccountsBySyncState(appId, currentMap, pkField);
      stageTimings.existingSyncStateCount = hashPartition.existingStateCount;
      if (hashPartition.timings) {
        stageTimings.hashGenerateMs = hashPartition.timings.hashGenerateMs;
        stageTimings.hashCompareMs = hashPartition.timings.hashCompareMs;
      }
    }
    mark("hashPartitionMs");

    const UsersModel = getDynamicUserModel(application.name, tenantSlug);
    const appIdClause = applicationIdInClause(appId);
    const liveCount = await UsersModel.countDocuments({ applicationId: appIdClause });
    const isBaselineImport =
      liveCount === 0 && !previousRunId && (hashPartition?.existingStateCount || 0) === 0;

    let useHashFastPath =
      hashEnabled &&
      hashPartition &&
      hashPartition.changedKeys.length === 0 &&
      hashPartition.newKeys.length === 0 &&
      hashPartition.removedKeys.length === 0;

    if (useHashFastPath) {
      const expectedCount = currentMap.size;
      let liveUsersValid = liveCount === expectedCount && expectedCount > 0;
      if (liveUsersValid && hashPartition.unchangedKeys.length) {
        const unchangedUserIds = hashPartition.unchangedKeys
          .map((k) => hashPartition.stateByKey.get(k)?.userId)
          .filter(Boolean);
        if (unchangedUserIds.length !== hashPartition.unchangedKeys.length) {
          liveUsersValid = false;
          stageTimings.hashFastPathSkipped = "sync_state_missing_user_ids";
        } else if (unchangedUserIds.length) {
          const foundCount = await UsersModel.countDocuments({
            _id: { $in: unchangedUserIds },
            applicationId: appIdClause,
          });
          if (foundCount !== unchangedUserIds.length) {
            liveUsersValid = false;
            stageTimings.hashFastPathSkipped = "stale_sync_state_user_ids";
          }
        }
      } else if (liveCount !== expectedCount) {
        liveUsersValid = false;
        stageTimings.hashFastPathSkipped = "live_user_count_mismatch";
      }
      if (!liveUsersValid) {
        useHashFastPath = false;
        if (hashPartition.existingStateCount > 0) {
          const liveUsers = await UsersModel.find({ applicationId: appIdClause })
            .select(pkField)
            .lean();
          const livePkSet = new Set(
            liveUsers
              .map((u) => normalizePrimaryKeyValue(u[pkField]))
              .filter(Boolean),
          );
          reclassifyHashPartitionForLiveUserRepair(
            hashPartition,
            currentMap,
            pkField,
            livePkSet,
          );
        } else {
          stageTimings.hashFastPathSkipped = "first_sync_no_prior_state";
        }
      }
    }

    // Pre-assign ObjectIds for NEW docs; reuse sync-state userIds for CHANGED (avoid post-write find).
    const userIdByIdentityKey = new Map();
    const applyPkKeys = hashEnabled
      ? new Set([...hashPartition.newPkKeys, ...hashPartition.changedPkKeys])
      : null;

    const docsToApply = hashEnabled
      ? payload.canonicalDocs.filter((doc) =>
          applyPkKeys.has(normalizePrimaryKeyValue(doc[pkField])),
        )
      : payload.canonicalDocs;

    const newPkSet = hashEnabled
      ? new Set(hashPartition.newPkKeys.map((k) => normalizePrimaryKeyValue(k)))
      : null;

    const preparedDocs = docsToApply.map((doc) => {
      const withId = { ...doc };
      const pkNorm = normalizePrimaryKeyValue(doc[pkField]);
      const syncKey =
        hashEnabled && hashPartition.syncKeyByPkKey?.get(pkNorm)
          ? hashPartition.syncKeyByPkKey.get(pkNorm)
          : hashEnabled
            ? resolveStableSyncKey({ rawDoc: doc, displayPk: doc[pkField] }, pkField)
            : null;

      if (hashEnabled && syncKey) {
        const existingUid = hashPartition.stateByKey.get(syncKey)?.userId;
        if (existingUid && (!newPkSet || !newPkSet.has(pkNorm))) {
          withId._id = existingUid;
          return withId;
        }
      }
      if (!withId._id) withId._id = new mongoose.Types.ObjectId();
      return withId;
    });

    return {
      application,
      meta: hashMeta,
      rawUserDocs,
      runId,
      previousRunId,
      startedAt,
      tenantOid,
      tenantSlug,
      models,
      appId,
      reconConfig,
      payload,
      currentMap,
      pkField,
      hashEnabled,
      hashPartition,
      UsersModel,
      appIdClause,
      liveCount,
      isBaselineImport,
      useHashFastPath,
      preparedDocs,
      userIdByIdentityKey,
      stageTimings,
      bulkOpts: {
        chunkSize: CSV_BULK_DEFAULTS.chunkSize,
        concurrency: CSV_BULK_DEFAULTS.concurrency,
        useNative: USE_NATIVE,
      },
    };
  }

  buildExecutionGraph(ctx) {
    if (ctx.useHashFastPath) {
      return {
        mode: "hashFastPath",
        nodes: new Map([
          [
            "fastPath",
            {
              deps: [],
              run: () => this._executeHashFastPath(ctx),
            },
          ],
        ]),
      };
    }

    return {
      mode: "fullApply",
      nodes: new Map([
        [
          "buildProjections",
          {
            deps: [],
            run: () => this._buildProjections(ctx),
          },
        ],
        [
          "persistStageSnapshotDelta",
          {
            deps: ["buildProjections"],
            run: () => this._persistStageSnapshotDelta(ctx),
          },
        ],
        [
          "persistUsers",
          {
            deps: ["buildProjections"],
            run: () => this._persistUsers(ctx),
          },
        ],
        [
          "persistSyncState",
          {
            deps: ["persistUsers", "persistStageSnapshotDelta"],
            run: () => this._persistSyncState(ctx),
          },
        ],
        [
          "completeRun",
          {
            deps: ["persistSyncState"],
            run: () => this._completeRun(ctx),
          },
        ],
      ]),
    };
  }

  async execute(graph, ctx) {
    try {
      if (graph.mode === "hashFastPath") {
        const result = await graph.nodes.get("fastPath").run();
        return { mode: "hashFastPath", result };
      }
      const results = await runExecutionGraph(graph.nodes);
      return {
        mode: "fullApply",
        result: results.get("completeRun"),
        graphResults: results,
      };
    } catch (err) {
      await ctx.models.Runs.updateOne(
        { runId: ctx.runId },
        {
          $set: {
            status: "FAILED",
            errorMessage: err?.message || String(err),
            completedAt: new Date(),
          },
        },
      );
      throw err;
    }
  }

  async verify(ctx, executed) {
    const summary = executed?.result;
    if (!summary) {
      throw new Error("CsvMappedReconciliationStrategy.verify: missing result");
    }
    const liveRows = await ctx.UsersModel.countDocuments({
      applicationId: ctx.appIdClause,
    });
    if (typeof summary.liveRows === "number" && summary.liveRows !== liveRows) {
      // Align with actual count (countDocuments is source of truth).
      summary.liveRows = liveRows;
      summary.totalUsers = liveRows;
    }
    return { ok: true, liveRows };
  }

  async finalize(ctx, executed) {
    const result = executed.result;
    result.stageTimings = {
      ...ctx.stageTimings,
      ...(result.stageTimings || {}),
      totalReconciliationMs:
        result.stageTimings?.totalReconciliationMs ??
        Date.now() - ctx.startedAt.getTime(),
      csvStrategy: true,
      csvBulkChunkSize: ctx.bulkOpts.chunkSize,
      csvBulkConcurrency: ctx.bulkOpts.concurrency,
      csvUseNativeDriver: ctx.bulkOpts.useNative,
      isBaselineImport: ctx.isBaselineImport,
    };
    return result;
  }

  async _executeHashFastPath(ctx) {
    const {
      hashPartition,
      UsersModel,
      appIdClause,
      currentMap,
      pkField,
      appId,
      tenantOid,
      runId,
      models,
      payload,
      meta,
      previousRunId,
      stageTimings,
    } = ctx;
    const t0 = Date.now();
    const liveCount = await UsersModel.countDocuments({ applicationId: appIdClause });
    const completedAt = new Date();
    const runSummary = buildRunSummary(
      {
        newUsers: 0,
        updatedUsers: 0,
        removedUsers: 0,
        newEntitlements: 0,
        removedEntitlements: 0,
        totalUsers: liveCount,
        activeUsers: liveCount,
        inactiveUsers: 0,
      },
      {
        ...payload.ingestMeta,
        liveRows: liveCount,
        source: meta.source,
        skippedUnchanged: hashPartition.unchangedKeys.length,
        hashOptimized: true,
        hashNewUsers: 0,
        hashChangedUsers: 0,
        hashRemovedUsers: 0,
      },
    );

    const liveUserIdsBySyncKey = new Map();
    for (const k of hashPartition.unchangedKeys) {
      const uid = hashPartition.stateByKey.get(k)?.userId;
      if (uid) liveUserIdsBySyncKey.set(k, uid);
    }
    if (liveUserIdsBySyncKey.size < hashPartition.unchangedKeys.length) {
      const scanned = await loadLiveUserIdsBySyncKey(UsersModel, appId, pkField);
      for (const [k, uid] of scanned) {
        if (!liveUserIdsBySyncKey.has(k)) liveUserIdsBySyncKey.set(k, uid);
      }
    }
    const fastPathUserIds = new Map(
      hashPartition.unchangedKeys.map((k) => [
        k,
        liveUserIdsBySyncKey.get(k) ||
          hashPartition.stateByKey.get(k)?.userId ||
          null,
      ]),
    );

    await upsertIdentitySyncStateBatch({
      applicationId: appId,
      tenantId: tenantOid,
      runId,
      currentMap,
      hashByKey: hashPartition.hashByKey,
      membershipHashByKey: hashPartition.membershipHashByKey,
      objectGuidByKey: hashPartition.objectGuidByKey,
      userIdByIdentityKey: fastPathUserIds,
      removedKeys: [],
      pkField,
      syncKeysToTouch: hashPartition.unchangedKeys,
    });

    await models.Runs.updateOne(
      { runId },
      {
        $set: {
          ...runSummary,
          status: "COMPLETED",
          completedAt,
          reconciliationDate: completedAt,
          hashOptimized: true,
          unchangedAccounts: hashPartition.unchangedKeys.length,
        },
      },
    );

    stageTimings.hashFastPathMs = Date.now() - t0;

    return {
      runId,
      previousRunId,
      summary: runSummary,
      reconciliation: runSummary,
      canonicalUserDocs: [],
      hashOptimized: true,
      stageTimings,
      syncDelta: {
        unchangedKeys: hashPartition.unchangedKeys,
        changedKeys: hashPartition.changedKeys,
        newKeys: hashPartition.newKeys,
        unchangedPkKeys: hashPartition.unchangedPkKeys,
        changedPkKeys: hashPartition.changedPkKeys,
        newPkKeys: hashPartition.newPkKeys,
        removedKeys: hashPartition.removedKeys,
        membershipChangedKeys: hashPartition.membershipChangedKeys,
        removedUserIds: [],
      },
    };
  }

  async _buildProjections(ctx) {
    const t0 = Date.now();
    const {
      hashEnabled,
      hashPartition,
      previousRunId,
      models,
      appId,
      currentMap,
      payload,
      application,
      tenantSlug,
      reconConfig,
      runId,
      tenantOid,
      startedAt,
    } = ctx;

    // Staging: hash path skips staging (same as legacy orchestrator).
    ctx.stagingDocs = [];
    if (!hashEnabled) {
      for (const [identityKey, entry] of currentMap) {
        ctx.stagingDocs.push({
          runId,
          identityKey,
          applicationId: appId,
          attributes: entry.attributes,
          entitlements: [...entry.entitlements],
          stagedAt: startedAt,
        });
      }
    }

    let previousMap = new Map();
    if (hashEnabled) {
      const keysNeedingBaseline = [
        ...hashPartition.changedPkKeys,
        ...hashPartition.newPkKeys,
      ];
      if (keysNeedingBaseline.length === 0 && hashPartition.removedKeys.length) {
        previousMap = new Map();
      } else if (keysNeedingBaseline.length) {
        previousMap = previousRunId
          ? await loadSnapshotSubsetMap(
              models.Snapshot,
              appId,
              previousRunId,
              hashPartition.changedPkKeys,
            )
          : new Map();
      }
    } else if (previousRunId) {
      previousMap = await loadSnapshotMap(models.Snapshot, appId, previousRunId);
    }

    if (!hashEnabled && previousMap.size === 0) {
      previousMap = await loadLiveUsersAccountMap(
        application,
        tenantSlug,
        payload.userMappings,
        application.csvImportMapping,
      );
    }

    const currentEntitlements = buildEntitlementCatalog(currentMap);
    const previousEntitlements = buildEntitlementCatalog(previousMap);
    if (
      !hashEnabled &&
      previousEntitlements.size === 0 &&
      currentEntitlements.size > 0
    ) {
      const liveMap = await loadLiveUsersAccountMap(
        application,
        tenantSlug,
        payload.userMappings,
        application.csvImportMapping,
      );
      if (buildEntitlementCatalog(liveMap).size > 0) {
        previousMap = liveMap;
      }
    }

    const compareCurrentMap = hashEnabled
      ? new Map(
          [...hashPartition.changedPkKeys, ...hashPartition.newPkKeys]
            .filter((k) => currentMap.has(k))
            .map((k) => [k, currentMap.get(k)]),
        )
      : currentMap;

    const { userDeltas, entitlementDeltas, removedKeys, summary: deltaSummary } =
      compareAccountMaps({
        currentMap: compareCurrentMap,
        previousMap,
        userMappings: payload.userMappings,
        reconciliationConfig: reconConfig,
      });

    ctx.previousMap = previousMap;
    ctx.userDeltas = userDeltas;
    ctx.entitlementDeltas = entitlementDeltas;
    ctx.removedKeys = removedKeys;
    ctx.deltaSummary = deltaSummary;
    ctx.snapshotDate = new Date();

    ctx.snapshotIdentityKeys = hashEnabled
      ? [...hashPartition.changedPkKeys, ...hashPartition.newPkKeys]
      : null;

    ctx.deltaDocs = userDeltas.map((d) => ({
      ...d,
      runId,
      applicationId: appId,
      tenantId: tenantOid,
    }));
    ctx.entDeltaDocs = entitlementDeltas.map((d) => ({
      ...d,
      runId,
      applicationId: appId,
      tenantId: tenantOid,
    }));

    ctx.stageTimings.buildProjectionsMs = Date.now() - t0;
    return { ok: true };
  }

  async _persistStageSnapshotDelta(ctx) {
    const t0 = Date.now();
    const {
      hashEnabled,
      models,
      stagingDocs,
      snapshotIdentityKeys,
      currentMap,
      runId,
      appId,
      tenantOid,
      snapshotDate,
      payload,
      application,
      deltaDocs,
      entDeltaDocs,
      bulkOpts,
    } = ctx;

    const tasks = [];

    if (!hashEnabled && stagingDocs.length) {
      tasks.push(
        csvInsertManyChunked(models.Staging, stagingDocs, {
          ...bulkOpts,
          useNative: false,
        }).then((n) => {
          ctx.stageTimings.stagingInsertMs = Date.now() - t0;
          return n;
        }),
      );
    } else {
      ctx.stageTimings.stagingInsertMs = 0;
    }

    tasks.push(
      (async () => {
        const s0 = Date.now();
        if (hashEnabled) {
          const snapDocs = [];
          for (const identityKey of snapshotIdentityKeys || []) {
            const entry = currentMap.get(identityKey);
            if (!entry) continue;
            snapDocs.push({
              runId,
              identityKey,
              applicationId: appId,
              tenantId: tenantOid,
              snapshotDate,
              attributes: entry.attributes,
              entitlements: [...entry.entitlements],
            });
          }
          // Snapshot/Delta stay on Mongoose insertMany for identical casting vs legacy path.
          await csvInsertManyChunked(models.Snapshot, snapDocs, {
            ...bulkOpts,
            useNative: false,
          });
        } else {
          await persistRunSnapshot({
            SnapshotModel: models.Snapshot,
            runId,
            applicationId: appId,
            tenantId: tenantOid,
            canonicalDocs: payload.canonicalDocs,
            userMappings: payload.userMappings,
            csvImportMapping: application.csvImportMapping,
            snapshotDate,
          });
        }
        ctx.stageTimings.snapshotPersistMs = Date.now() - s0;
      })(),
    );

    tasks.push(
      (async () => {
        const d0 = Date.now();
        await Promise.all([
          csvInsertManyChunked(models.Delta, deltaDocs, {
            ...bulkOpts,
            useNative: false,
          }),
          csvInsertManyChunked(models.EntitlementDelta, entDeltaDocs, {
            ...bulkOpts,
            useNative: false,
          }),
        ]);
        ctx.stageTimings.deltaPersistMs = Date.now() - d0;
      })(),
    );

    await Promise.all(tasks);
    ctx.stageTimings.stageSnapshotDeltaMs = Date.now() - t0;
    return { ok: true };
  }

  async _persistUsers(ctx) {
    const t0 = Date.now();
    const {
      application,
      tenantOid,
      preparedDocs,
      payload,
      pkField,
      UsersModel,
      appId,
      appIdClause,
      runId,
      reconConfig,
      hashEnabled,
      hashPartition,
      removedKeys,
      isBaselineImport,
      meta,
      bulkOpts,
      userIdByIdentityKey,
    } = ctx;

    const removedHandling = reconConfig.removedUserHandling || "REMOVED_USER";
    const inactiveValues =
      reconConfig.inactiveStatusValues || ["inactive", "disabled", "terminated"];
    const reconTime = new Date();

    // Seed identity map from pre-assigned ids (sync keys when hash enabled).
    for (const doc of preparedDocs) {
      const entry = {
        rawDoc: doc,
        displayPk: doc[pkField],
      };
      const mapKey = hashEnabled
        ? resolveStableSyncKey(entry, pkField)
        : normalizePrimaryKeyValue(doc[pkField]);
      if (mapKey) userIdByIdentityKey.set(mapKey, doc._id);
      const pkNorm = normalizePrimaryKeyValue(doc[pkField]);
      if (pkNorm) userIdByIdentityKey.set(pkNorm, doc._id);
    }

    if (isBaselineImport && preparedDocs.length) {
      // Create PK unique index on empty collection before bulk insert (avoids mid-ingest index build).
      try {
        await ensureManagedUserPkUniqueIndex(UsersModel.collection, pkField);
      } catch {
        /* continue; verified again below */
      }
      const insertDocs = preparedDocs.map((doc) => ({
        ...doc,
        tenantId: tenantOid,
        applicationId: appId,
        lastReconRunId: runId,
        updatedAt: reconTime,
        createdAt: reconTime,
      }));
      await csvInsertManyChunked(UsersModel, insertDocs, bulkOpts);
    } else if (preparedDocs.length) {
      const ops = preparedDocs.map((doc) => {
        const update = {
          ...doc,
          tenantId: tenantOid,
          applicationId: appId,
          lastReconRunId: runId,
          updatedAt: reconTime,
        };
        // Keep _id on insert via $setOnInsert
        const { _id, ...rest } = update;
        return {
          updateOne: {
            filter: { applicationId: appId, [pkField]: doc[pkField] },
            update: {
              $set: rest,
              $setOnInsert: { _id },
            },
            upsert: true,
          },
        };
      });
      await csvBulkWriteChunked(UsersModel, ops, bulkOpts);
    }

    await syncApplicationUserDuplicateSidecar(
      application._id,
      payload.duplicateGroupPayloads,
      { replaceAll: false },
    );

    const removedNormSet = new Set(
      (removedKeys || []).map((k) => normalizePrimaryKeyValue(k)),
    );
    const removedIdSet = new Set(
      (hashEnabled ? hashPartition?.removedUserIds || [] : [])
        .map((id) => String(id || "").trim())
        .filter(Boolean),
    );

    if (removedIdSet.size > 0 && removedHandling === "REMOVED_USER") {
      const idsToDelete = [...removedIdSet].filter((id) =>
        mongoose.Types.ObjectId.isValid(id),
      );
      if (idsToDelete.length) {
        await UsersModel.deleteMany({
          _id: { $in: idsToDelete },
          applicationId: appIdClause,
        });
      }
    } else if (removedNormSet.size > 0 && removedIdSet.size === 0) {
      if (removedHandling === "MARK_INACTIVE") {
        const candidates = await UsersModel.find({ applicationId: appIdClause })
          .select(`_id ${pkField}`)
          .lean();
        const markById = [];
        for (const u of candidates) {
          const norm = normalizePrimaryKeyValue(u[pkField]);
          if (!removedNormSet.has(norm)) continue;
          markById.push({
            updateOne: {
              filter: { _id: u._id },
              update: {
                $set: {
                  status: inactiveValues[0] || "inactive",
                  lastReconRunId: runId,
                  updatedAt: reconTime,
                },
              },
            },
          });
        }
        await csvBulkWriteChunked(UsersModel, markById, bulkOpts);
      } else {
        const candidates = await UsersModel.find({ applicationId: appIdClause })
          .select(`_id ${pkField}`)
          .lean();
        const idsToDelete = [];
        for (const u of candidates) {
          const norm = normalizePrimaryKeyValue(u[pkField]);
          if (removedNormSet.has(norm)) idsToDelete.push(u._id);
        }
        if (idsToDelete.length) {
          await UsersModel.deleteMany({ _id: { $in: idsToDelete } });
        }
      }
    }

    // Ensure PK unique index exists once — skip recreate when already present.
    try {
      const indexes = await UsersModel.collection.indexes();
      const hasManaged = (indexes || []).some(
        (idx) => idx?.name && String(idx.name).startsWith(MANAGED_PK_INDEX_PREFIX),
      );
      if (!hasManaged) {
        await ensureManagedUserPkUniqueIndex(UsersModel.collection, pkField);
      }
    } catch (e) {
      const msg = e?.message || String(e);
      if (
        e?.code === 11000 ||
        e?.code === 11001 ||
        msg.includes("E11000") ||
        msg.includes("dup key")
      ) {
        throw new Error(msg);
      }
      throw e;
    }

    const liveRows = await UsersModel.countDocuments({ applicationId: appIdClause });
    application.totalUsers = liveRows;
    application.lastUpload = reconTime;
    await application.save();

    ctx.ingestSummary = {
      ...payload.ingestMeta,
      liveRows,
      source: meta.source || "csv_mapped",
    };
    ctx.stageTimings.userUpsertMs = Date.now() - t0;
    return { liveRows };
  }

  async _persistSyncState(ctx) {
    if (!ctx.hashEnabled) {
      ctx.stageTimings.syncStatePersistMs = 0;
      return { ok: true };
    }
    const t0 = Date.now();
    const {
      hashPartition,
      userIdByIdentityKey,
      appId,
      tenantOid,
      runId,
      currentMap,
      pkField,
      UsersModel,
      isBaselineImport,
      bulkOpts,
    } = ctx;

    const mergedUserIds = new Map(userIdByIdentityKey || []);
    for (const syncKey of hashPartition.unchangedKeys) {
      const uid =
        mergedUserIds.get(syncKey) ||
        hashPartition.stateByKey.get(syncKey)?.userId;
      if (uid) mergedUserIds.set(syncKey, uid);
    }
    for (const [pkKey, syncKey] of hashPartition.syncKeyByPkKey || []) {
      const uid =
        mergedUserIds.get(syncKey) ||
        mergedUserIds.get(pkKey) ||
        userIdByIdentityKey?.get(syncKey) ||
        userIdByIdentityKey?.get(pkKey);
      if (syncKey && uid) mergedUserIds.set(syncKey, uid);
    }

    const needIds = [...hashPartition.newKeys, ...hashPartition.changedKeys].filter(
      (k) => !mergedUserIds.get(k),
    );
    if (needIds.length) {
      const liveUserIdsBySyncKey = await loadLiveUserIdsBySyncKey(
        UsersModel,
        appId,
        pkField,
      );
      for (const [syncKey, uid] of liveUserIdsBySyncKey) {
        if (syncKey && uid && !mergedUserIds.has(syncKey)) {
          mergedUserIds.set(syncKey, uid);
        }
      }
    }

    // Baseline: insertMany is semantically equivalent to upsert of all-new keys, much faster remotely.
    if (isBaselineImport && hashPartition.newKeys.length === currentMap.size) {
      const seenAt = new Date();
      const appOid = mongoose.Types.ObjectId.isValid(String(appId))
        ? new mongoose.Types.ObjectId(String(appId))
        : appId;
      const docs = [];
      for (const [, entry] of currentMap) {
        const syncKey = resolveStableSyncKey(entry, pkField);
        const accountHash = hashPartition.hashByKey.get(syncKey);
        if (!syncKey || !accountHash) continue;
        docs.push({
          tenantId: tenantOid,
          applicationId: appOid,
          identityKey: syncKey,
          accountHash,
          membershipHash: hashPartition.membershipHashByKey.get(syncKey) || "",
          objectGuid: hashPartition.objectGuidByKey.get(syncKey) || "",
          userId: mergedUserIds.get(syncKey) || null,
          hashVersion: HASH_ALGORITHM_VERSION,
          lastSeenAt: seenAt,
          lastSyncRunId: runId,
        });
      }
      const inserted = await csvInsertManyChunked(IdentitySyncState, docs, bulkOpts);
      ctx.stageTimings.syncStatePersistMs = Date.now() - t0;
      ctx.stageTimings.syncStatePersisted = inserted;
      ctx.stageTimings.syncStateBaselineInsert = true;
      return { persisted: inserted, attempted: docs.length };
    }

    const syncStateResult = await upsertIdentitySyncStateBatch({
      applicationId: appId,
      tenantId: tenantOid,
      runId,
      currentMap,
      hashByKey: hashPartition.hashByKey,
      membershipHashByKey: hashPartition.membershipHashByKey,
      objectGuidByKey: hashPartition.objectGuidByKey,
      userIdByIdentityKey: mergedUserIds,
      removedKeys: [
        ...hashPartition.removedKeys,
        ...(hashPartition.migratedSyncKeys || []),
      ],
      pkField,
      syncKeysToFullUpsert: [
        ...hashPartition.newKeys,
        ...hashPartition.changedKeys,
      ],
      syncKeysToTouch: hashPartition.unchangedKeys,
    });

    ctx.stageTimings.syncStatePersistMs = Date.now() - t0;
    ctx.stageTimings.syncStatePersisted = syncStateResult?.persisted;
    return syncStateResult;
  }

  async _completeRun(ctx) {
    const {
      hashEnabled,
      hashPartition,
      deltaSummary,
      ingestSummary,
      models,
      runId,
      previousRunId,
      startedAt,
      stageTimings,
      appId,
    } = ctx;

    stageTimings.totalReconciliationMs = Date.now() - startedAt.getTime();

    const runSummary = buildRunSummary(deltaSummary, {
      ...ingestSummary,
      ...(hashEnabled
        ? {
            skippedUnchanged: hashPartition.unchangedKeys.length,
            hashOptimized: true,
            hashNewUsers: hashPartition.newKeys.length,
            hashChangedUsers: hashPartition.changedKeys.length,
            hashRemovedUsers: hashPartition.removedKeys.length,
          }
        : {}),
    });
    const completedAt = new Date();

    await models.Runs.updateOne(
      { runId },
      {
        $set: {
          ...runSummary,
          status: "COMPLETED",
          completedAt,
          reconciliationDate: completedAt,
          ...(hashEnabled
            ? {
                hashOptimized: true,
                skippedUnchanged: hashPartition.unchangedKeys.length,
                unchangedAccounts: hashPartition.unchangedKeys.length,
                changedAccounts: hashPartition.changedKeys.length,
                newAccounts: hashPartition.newKeys.length,
                removedAccounts: hashPartition.removedKeys.length,
              }
            : {}),
        },
      },
    );

    // Staging cleanup is non-critical for hash path (no staging). For non-hash, delete after response-safe.
    if (!hashEnabled) {
      // Keep synchronous to match legacy behavior (staging must not linger incorrectly).
      await models.Staging.deleteMany({ applicationId: appId, runId });
    }

    return {
      runId,
      previousRunId,
      summary: runSummary,
      reconciliation: runSummary,
      canonicalUserDocs: [],
      hashOptimized: Boolean(hashEnabled),
      stageTimings,
      syncDelta: hashEnabled
        ? {
            unchangedKeys: hashPartition.unchangedKeys,
            changedKeys: hashPartition.changedKeys,
            newKeys: hashPartition.newKeys,
            unchangedPkKeys: hashPartition.unchangedPkKeys,
            changedPkKeys: hashPartition.changedPkKeys,
            newPkKeys: hashPartition.newPkKeys,
            removedKeys: hashPartition.removedKeys,
            membershipChangedKeys: hashPartition.membershipChangedKeys,
            removedUserIds: hashPartition.removedUserIds,
          }
        : null,
    };
  }
}

/**
 * Entry used by uploadApplicationUsersCsvMapped.
 */
export async function runCsvMappedReconciliation(
  application,
  rawUserDocs,
  meta = {},
  engineTimings = {},
) {
  const strategy = new CsvMappedReconciliationStrategy();
  return runStrategyLifecycle(strategy, {
    application,
    rawUserDocs,
    meta: {
      ...meta,
      source: meta.source || "csv_mapped",
      loadCanonicalDocs: false,
      skipFullReRead: true,
      skipDedupeScan: true,
    },
    engineTimings,
  });
}
