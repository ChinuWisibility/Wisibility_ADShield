import Application from "../../models/application/Application.js";
import {
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
  ensureReconciliationIndexes,
} from "../../utils/applicationDynamicCollections.js";
import {
  getReconciliationModels,
  bulkInsertChunked,
} from "../../utils/reconciliationCollections.js";
import {
  canonicalizeIncomingUsers,
  applyCanonicalUsers,
} from "../application/applicationUserIngestService.js";
import { compareAccountMaps } from "./deltaComparisonService.js";
import {
  loadSnapshotMap,
  loadLiveUsersAccountMap,
  persistRunSnapshot,
} from "./snapshotService.js";
import {
  applicationIdInClause,
  normalizePrimaryKeyValue,
} from "../application/applicationUserIngestService.js";
import {
  buildAccountMap,
  buildEntitlementCatalog,
} from "./reconciliationAccountUtils.js";
import { buildRunSummary } from "./reconciliationSummaryService.js";
import {
  isHashReconciliationEnabled,
  partitionAccountsBySyncState,
  loadSnapshotSubsetMap,
  upsertIdentitySyncStateBatch,
  resolveStableSyncKey,
  reclassifyHashPartitionForLiveUserRepair,
  loadLiveUserIdsBySyncKey,
} from "../sync/accountHashService.js";
import { persistPartialRunSnapshot } from "./snapshotRetentionService.js";
import { createExclusiveSpanTimer } from "../../utils/exclusiveSpanTimer.js";
export { generateRunId } from "./generateRunId.js";
import { generateRunId } from "./generateRunId.js";

/**
 * @param {object} application Mongoose Application document
 * @param {object[]} rawUserDocs
 * @param {{
 *   source: string,
 *   uploadedFileName?: string,
 *   uploadedBy?: import('mongoose').Types.ObjectId,
 *   strictPkResolution?: boolean,
 *   initialSkippedMissingPk?: number,
 *   userMappingsForPk?: object[],
 * }} meta
 */
export async function runReconciliation(application, rawUserDocs, meta = {}) {
  const runId = generateRunId();
  const startedAt = new Date();
  const stageTimings = {};
  const exclusiveTimer = createExclusiveSpanTimer("runReconciliation");
  const x = (name, fn) => exclusiveTimer.span(name, fn);
  const stage = (name, t0) => {
    stageTimings[name] = Date.now() - t0;
    return Date.now();
  };
  let t = Date.now();
  let tenantOid = toTenantObjectId(application.tenantId);
  if (!tenantOid && application._id) {
    const row = await x("Application.findById", () =>
      Application.findById(application._id).select("tenantId reconciliationConfig").lean(),
    );
    tenantOid = toTenantObjectId(row?.tenantId);
    if (row?.reconciliationConfig && !application.reconciliationConfig) {
      application.reconciliationConfig = row.reconciliationConfig;
    }
  }
  if (!tenantOid) {
    throw new Error("Application has no valid tenantId for reconciliation");
  }

  const tenantSlug = await resolveTenantSlugFromTenantId(tenantOid, {
    exclusiveTimer,
  });
  if (!tenantSlug) {
    throw new Error("Could not resolve tenant slug for reconciliation");
  }

  await ensureReconciliationIndexes(application.name, tenantSlug, {
    exclusiveTimer,
  });
  const models = await x("getReconciliationModels", async () =>
    getReconciliationModels(application.name, tenantSlug),
  );
  const appId = application._id;
  const reconConfig = application.reconciliationConfig || {};

  const previousRun = await x("Runs.findOne.previousCompleted", () =>
    models.Runs.findOne({
      applicationId: applicationIdInClause(appId),
      status: "COMPLETED",
    })
      .sort({ reconciliationDate: -1 })
      .select("runId")
      .lean(),
  );

  const previousRunId = previousRun?.runId ?? null;

  await x("Runs.create", () =>
    models.Runs.create({
      runId,
      tenantId: tenantOid,
      applicationId: appId,
      reconciliationDate: startedAt,
      source: meta.source || "unknown",
      uploadedFileName: meta.uploadedFileName ?? null,
      uploadedBy: meta.uploadedBy ?? null,
      previousRunId,
      status: "PROCESSING",
      startedAt,
    }),
  );

  const finalizeExclusiveSpans = () => {
    const snap = exclusiveTimer.snapshot();
    stageTimings.exclusiveSpans = snap.spans;
    stageTimings.exclusiveTotalMs = snap.totalMs;
    stageTimings.exclusiveAccountedMs = snap.accountedMs;
    stageTimings.exclusiveUnaccountedMs = snap.unaccountedMs;
    return snap;
  };

  const persistExclusiveSpans = async (snap) => {
    await models.Runs.updateOne(
      { runId },
      {
        $set: {
          exclusiveSpans: snap.spans,
          stageTimings,
        },
      },
    );
  };

  try {
    // Duplicate PK rows: first occurrence wins for live users, snapshot, and delta.
    // Extra rows are stored in application_user_duplicates (see syncApplicationUserDuplicateSidecar).
    const payload = await canonicalizeIncomingUsers(application, rawUserDocs, {
      source: meta.source,
      strictPkResolution: meta.strictPkResolution,
      initialSkippedMissingPk: meta.initialSkippedMissingPk,
      userMappingsForPk: meta.userMappingsForPk,
    });
    t = stage("canonicalizeMs", t);

    const { map: currentMap, pkField } = buildAccountMap(
      payload.canonicalDocs,
      payload.userMappings,
      application.csvImportMapping,
    );
    t = stage("buildAccountMapMs", t);

    const hashEnabled = isHashReconciliationEnabled(meta);
    let hashPartition = null;
    if (hashEnabled) {
      hashPartition = await partitionAccountsBySyncState(appId, currentMap, pkField, {
        exclusiveTimer,
      });
      stageTimings.existingSyncStateCount = hashPartition.existingStateCount;
      if (hashPartition.timings) {
        stageTimings.hashGenerateMs = hashPartition.timings.hashGenerateMs;
        stageTimings.hashCompareMs = hashPartition.timings.hashCompareMs;
      }
    }
    t = stage("hashPartitionMs", t);

    let useHashFastPath =
      hashEnabled &&
      hashPartition &&
      hashPartition.changedKeys.length === 0 &&
      hashPartition.newKeys.length === 0 &&
      hashPartition.removedKeys.length === 0;

    const { getDynamicUserModel } = await import("../../models/application/Users.js");
    const UsersModel = getDynamicUserModel(application.name, tenantSlug);
    const appIdClause = applicationIdInClause(appId);

    if (useHashFastPath) {
      const liveCount = await x("hashFastPath.countDocuments.live", () =>
        UsersModel.countDocuments({ applicationId: appIdClause }),
      );
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
          const foundCount = await x("hashFastPath.countDocuments.unchangedIds", () =>
            UsersModel.countDocuments({
              _id: { $in: unchangedUserIds },
              applicationId: appIdClause,
            }),
          );
          if (foundCount !== unchangedUserIds.length) {
            liveUsersValid = false;
            stageTimings.hashFastPathSkipped = "stale_sync_state_user_ids";
          }
        }
      } else if (liveCount !== expectedCount) {
        liveUsersValid = false;
        stageTimings.hashFastPathSkipped = "live_user_count_mismatch";
        stageTimings.liveUserCount = liveCount;
        stageTimings.expectedUserCount = expectedCount;
      }

      if (!liveUsersValid) {
        useHashFastPath = false;
        if (hashPartition.existingStateCount > 0) {
          const liveUsers = await x("hashFastPath.Users.find.repairPks", () =>
            UsersModel.find({ applicationId: appIdClause }).select(pkField).lean(),
          );
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

    if (useHashFastPath) {
      const liveCount = await x("hashFastPath.countDocuments.final", () =>
        UsersModel.countDocuments({ applicationId: appIdClause }),
      );
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
      // Fill gaps only if sync state is missing userId references.
      if (liveUserIdsBySyncKey.size < hashPartition.unchangedKeys.length) {
        const scanned = await loadLiveUserIdsBySyncKey(UsersModel, appId, pkField, {
          exclusiveTimer,
        });
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
        exclusiveTimer,
      });

      stageTimings.totalReconciliationMs = Date.now() - startedAt.getTime();

      await x("Runs.updateOne.completedFastPath", () =>
        models.Runs.updateOne(
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
        ),
      );
      const exclusiveSnap = finalizeExclusiveSpans();
      await persistExclusiveSpans(exclusiveSnap);

      const unchangedUserIds = hashPartition.unchangedKeys
        .map(
          (k) =>
            liveUserIdsBySyncKey.get(k) ||
            hashPartition.stateByKey.get(k)?.userId,
        )
        .filter(Boolean);

      let canonicalUserDocs = [];
      if (meta.loadCanonicalDocs !== false && unchangedUserIds.length) {
        canonicalUserDocs = await x("hashFastPath.Users.find.canonicalDocs", () =>
          UsersModel.find({
            _id: { $in: unchangedUserIds },
            applicationId: appIdClause,
          }).lean(),
        );
      }

      return {
        runId,
        previousRunId,
        summary: runSummary,
        reconciliation: runSummary,
        canonicalUserDocs,
        hashOptimized: true,
        stageTimings,
        exclusiveSpans: exclusiveSnap.spans,
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

    const stagingDocs = [];
    if (!hashEnabled) {
      for (const [identityKey, entry] of currentMap) {
        stagingDocs.push({
          runId,
          identityKey,
          applicationId: appId,
          attributes: entry.attributes,
          entitlements: [...entry.entitlements],
          stagedAt: startedAt,
        });
      }
      await x("persistStaging.bulkInsertChunked", () =>
        bulkInsertChunked(models.Staging, stagingDocs),
      );
    }
    t = stage("stagingInsertMs", t);

    let previousMap = new Map();
    const keysNeedingBaseline = hashEnabled
      ? [...hashPartition.changedPkKeys, ...hashPartition.newPkKeys]
      : null;

    if (hashEnabled && keysNeedingBaseline.length === 0 && hashPartition.removedKeys.length) {
      previousMap = new Map();
    } else if (hashEnabled && keysNeedingBaseline.length) {
      previousMap = previousRunId
        ? await loadSnapshotSubsetMap(
            models.Snapshot,
            appId,
            previousRunId,
            hashPartition.changedPkKeys,
            { exclusiveTimer },
          )
        : new Map();
    } else if (previousRunId) {
      previousMap = await loadSnapshotMap(models.Snapshot, appId, previousRunId, {
        exclusiveTimer,
      });
    }
    t = stage("baselineLoadMs", t);

    if (!hashEnabled && previousMap.size === 0) {
      previousMap = await x("loadLiveUsersAccountMap.baseline", () =>
        loadLiveUsersAccountMap(
          application,
          tenantSlug,
          payload.userMappings,
          application.csvImportMapping,
        ),
      );
    }

    const currentEntitlements = buildEntitlementCatalog(currentMap);
    const previousEntitlements = buildEntitlementCatalog(previousMap);
    if (
      !hashEnabled &&
      previousEntitlements.size === 0 &&
      currentEntitlements.size > 0
    ) {
      const liveMap = await x("loadLiveUsersAccountMap.entitlementBaseline", () =>
        loadLiveUsersAccountMap(
          application,
          tenantSlug,
          payload.userMappings,
          application.csvImportMapping,
        ),
      );
      const liveEntitlements = buildEntitlementCatalog(liveMap);
      if (liveEntitlements.size > 0) {
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
    t = stage("deltaCompareMs", t);

    // Sync-state removedKeys are identity sync keys (guid:/pk:), not user PKs — never pass them to user deletion.
    const effectiveRemovedKeys = removedKeys;

    const snapshotDate = new Date();
    if (hashEnabled) {
      const snapshotKeys = [...hashPartition.changedPkKeys, ...hashPartition.newPkKeys];
      await persistPartialRunSnapshot({
        SnapshotModel: models.Snapshot,
        runId,
        applicationId: appId,
        tenantId: tenantOid,
        identityKeys: snapshotKeys,
        currentMap,
        snapshotDate,
        exclusiveTimer,
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
        exclusiveTimer,
      });
    }
    t = stage("snapshotPersistMs", t);

    const deltaDocs = userDeltas.map((d) => ({
      ...d,
      runId,
      applicationId: appId,
      tenantId: tenantOid,
    }));
    await x("persistDelta.bulkInsertChunked", () =>
      bulkInsertChunked(models.Delta, deltaDocs),
    );

    const entDeltaDocs = entitlementDeltas.map((d) => ({
      ...d,
      runId,
      applicationId: appId,
      tenantId: tenantOid,
    }));
    await x("persistEntitlementDelta.bulkInsertChunked", () =>
      bulkInsertChunked(models.EntitlementDelta, entDeltaDocs),
    );
    t = stage("deltaPersistMs", t);

    const removedHandling = reconConfig.removedUserHandling || "REMOVED_USER";
    const inactiveValues = reconConfig.inactiveStatusValues || ["inactive", "disabled", "terminated"];

    const applyPkKeys = hashEnabled
      ? new Set([...hashPartition.newPkKeys, ...hashPartition.changedPkKeys])
      : null;

    const docsToApply = hashEnabled
      ? payload.canonicalDocs.filter((doc) =>
          applyPkKeys.has(normalizePrimaryKeyValue(doc[pkField])),
        )
      : payload.canonicalDocs;

    const applyPayload = hashEnabled
      ? { ...payload, canonicalDocs: docsToApply }
      : payload;

    const { summary: ingestSummary, canonicalUserDocs, userIdByIdentityKey } =
      await applyCanonicalUsers(application, tenantSlug, applyPayload, {
        runId,
        removedKeys:
          removedHandling === "REMOVED_USER" ? effectiveRemovedKeys : [],
        removedUserIds:
          hashEnabled && removedHandling === "REMOVED_USER"
            ? hashPartition.removedUserIds
            : [],
        removedUserHandling: removedHandling,
        inactiveStatusValue: inactiveValues[0] || "inactive",
        replaceAll: false,
        source: meta.source,
        skipFullReRead: hashEnabled || meta.skipFullReRead === true,
        loadCanonicalDocs: meta.loadCanonicalDocs !== false,
        skipDedupeScan: hashEnabled || meta.skipDedupeScan === true,
        pkField,
        useSyncIdentityKeys: hashEnabled,
        exclusiveTimer,
        unchangedUserIds: hashEnabled
          ? hashPartition.unchangedKeys
              .map((k) => hashPartition.stateByKey.get(k)?.userId)
              .filter(Boolean)
          : [],
      });
    t = stage("userUpsertMs", t);

    if (hashEnabled) {
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

      // Only scan live users when applied/state maps are missing IDs for upserted keys.
      const needIds = [...hashPartition.newKeys, ...hashPartition.changedKeys].filter(
        (k) => !mergedUserIds.get(k),
      );
      if (needIds.length) {
        const liveUserIdsBySyncKey = await loadLiveUserIdsBySyncKey(
          UsersModel,
          appId,
          pkField,
          { exclusiveTimer },
        );
        for (const [syncKey, uid] of liveUserIdsBySyncKey) {
          if (syncKey && uid && !mergedUserIds.has(syncKey)) {
            mergedUserIds.set(syncKey, uid);
          }
        }
      }

      const syncStateT0 = Date.now();
      const fullUpsertKeys = [
        ...hashPartition.newKeys,
        ...hashPartition.changedKeys,
      ];
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
        syncKeysToFullUpsert: fullUpsertKeys,
        syncKeysToTouch: hashPartition.unchangedKeys,
        exclusiveTimer,
      });
      stageTimings.syncStatePersistMs = Date.now() - syncStateT0;
      stageTimings.syncStatePersisted = syncStateResult?.persisted;
      stageTimings.syncStateAttempted = syncStateResult?.attempted;
      stageTimings.syncStateTouched = syncStateResult?.touched;
    }

    stageTimings.finalReadMs = stageTimings.userUpsertMs;
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

    await x("Runs.updateOne.completed", () =>
      models.Runs.updateOne(
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
      ),
    );
    const exclusiveSnap = finalizeExclusiveSpans();
    await persistExclusiveSpans(exclusiveSnap);

    if (!hashEnabled) {
      await x("Staging.deleteMany", () =>
        models.Staging.deleteMany({ applicationId: appId, runId }),
      );
    }

    return {
      runId,
      previousRunId,
      summary: runSummary,
      reconciliation: runSummary,
      canonicalUserDocs,
      hashOptimized: Boolean(hashEnabled),
      stageTimings,
      exclusiveSpans: exclusiveSnap.spans,
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
  } catch (err) {
    try {
      finalizeExclusiveSpans();
    } catch {
      /* ignore */
    }
    await models.Runs.updateOne(
      { runId },
      {
        $set: {
          status: "FAILED",
          errorMessage: err?.message || String(err),
          completedAt: new Date(),
          stageTimings,
        },
      },
    );
    throw err;
  }
}
