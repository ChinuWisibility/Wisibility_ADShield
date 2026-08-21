import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import ApplicationUserDuplicate from "../models/application/ApplicationUserDuplicate.js";
import { getDynamicUserModel } from "../models/application/Users.js";
import {
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from "../utils/applicationDynamicCollections.js";
import {
  getPrimaryKeyValueFromAccountDoc,
} from "../utils/identityProfileMappingUtils.js";
import { resolveStableSyncKey } from "./sync/accountHashService.js";

const MANAGED_PK_INDEX_PREFIX = "uniq_app_users_pk_";

/** Match legacy rows where applicationId was stored as ObjectId or string. */
export function applicationIdInClause(applicationId) {
  const oid = mongoose.Types.ObjectId.isValid(String(applicationId))
    ? new mongoose.Types.ObjectId(String(applicationId))
    : applicationId;
  const str = String(oid);
  return { $in: [oid, str] };
}

/** Normalize PK for grouping / duplicate detection (case-insensitive, trimmed). */
export function normalizePrimaryKeyValue(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

export function getPrimaryKeyMappingOrThrow(userMappings) {
  const pk = (userMappings || []).find((m) => m.isPrimaryKey);
  const sf = pk ? String(pk.standardField || "").trim() : "";
  if (!sf) {
    throw new Error(
      "Application user schema has no primary key. Mark exactly one userMappings row as isPrimaryKey in Application schema.",
    );
  }
  return { standardField: sf, mapping: pk };
}

function snapshotPlainDoc(doc) {
  if (!doc || typeof doc !== "object") return {};
  try {
    return JSON.parse(JSON.stringify(doc));
  } catch {
    return { ...doc };
  }
}

/**
 * @param {import('mongoose').Collection} collection
 * @param {string} pkField
 */
export async function ensureManagedUserPkUniqueIndex(collection, pkField) {
  const safe = String(pkField || "").replace(/[^a-zA-Z0-9_]/g, "_");
  const indexName = `${MANAGED_PK_INDEX_PREFIX}${safe}`;
  const key = { applicationId: 1, [pkField]: 1 };
  await collection
    .createIndex(key, {
      unique: true,
      sparse: true,
      name: indexName,
      background: true,
    })
    .catch(async (e) => {
      if (String(e?.message || e).includes("already exists")) return;
      if (String(e?.codeName || e?.code) === "IndexOptionsConflict") {
        await collection.dropIndex(indexName).catch(() => {});
        await collection.createIndex(key, {
          unique: true,
          sparse: true,
          name: indexName,
          background: true,
        });
        return;
      }
      throw e;
    });
}

/**
 * Drops prior managed PK unique indexes (when PK field changes or before rebuild).
 * @param {import('mongoose').Collection} collection
 */
export async function dropManagedUserPkIndexes(collection) {
  let indexes;
  try {
    indexes = await collection.indexes();
  } catch {
    return;
  }
  for (const idx of indexes) {
    const n = idx.name;
    if (n && String(n).startsWith(MANAGED_PK_INDEX_PREFIX)) {
      await collection.dropIndex(n).catch(() => {});
    }
  }
}

/**
 * @param {mongoose.Types.ObjectId|string} applicationId
 * @returns {Promise<Set<string>>}
 */
export async function loadDuplicatePrimaryKeyNormalizedSet(applicationId) {
  const rows = await ApplicationUserDuplicate.distinct("primaryKeyNormalized", {
    applicationId: applicationIdInClause(applicationId),
  });
  return new Set((rows || []).map((r) => normalizePrimaryKeyValue(r)));
}

/**
 * Remove extra live rows that share the same normalized PK (safety net before unique index).
 */
async function dedupeLiveUsersByNormalizedPkField(UsersModel, applicationId, pkField) {
  const filter = { applicationId: applicationIdInClause(applicationId) };
  const cursor = UsersModel.find(filter).sort({ createdAt: 1, _id: 1 }).lean().cursor();
  const seenNorm = new Set();
  const idsToDelete = [];
  for await (const doc of cursor) {
    const norm = normalizePrimaryKeyValue(doc[pkField]);
    if (!norm) continue;
    if (seenNorm.has(norm)) {
      idsToDelete.push(doc._id);
    } else {
      seenNorm.add(norm);
    }
  }
  if (idsToDelete.length > 0) {
    await UsersModel.deleteMany({ _id: { $in: idsToDelete } });
  }
}

/**
 * Group incoming rows by PK; produce canonical docs + duplicate sidecar payloads.
 */
export async function canonicalizeIncomingUsers(application, rawUserDocs, options = {}) {
  const source = String(options.source || "unknown");
  const strictPkResolution = Boolean(options.strictPkResolution);
  let skippedMissingPk = Number(options.initialSkippedMissingPk) || 0;

  const userMappings =
    (Array.isArray(options.userMappingsForPk) && options.userMappingsForPk.length
      ? options.userMappingsForPk
      : application.userMappings) || [];
  const { standardField: pkField } = getPrimaryKeyMappingOrThrow(userMappings);
  let tenantOid = toTenantObjectId(application.tenantId);
  if (!tenantOid && application._id) {
    const row = await Application.findById(application._id).select("tenantId").lean();
    tenantOid = toTenantObjectId(row?.tenantId);
  }
  if (!tenantOid) {
    throw new Error("tenantId required for ingest");
  }
  const tenantId = tenantOid;

  const strictFailures = [];
  const orderedWithPk = [];

  for (const doc of rawUserDocs || []) {
    const pkVal = getPrimaryKeyValueFromAccountDoc(doc, userMappings);
    const norm = normalizePrimaryKeyValue(pkVal);
    if (!norm) {
      skippedMissingPk += 1;
      if (strictPkResolution) strictFailures.push(doc);
      continue;
    }
    orderedWithPk.push({
      doc,
      pkVal: String(pkVal).trim(),
      norm,
    });
  }

  if (strictPkResolution && strictFailures.length > 0) {
    throw new Error(
      `Connector sync: ${strictFailures.length} user document(s) are missing the configured primary key field "${pkField}" (cannot resolve from synced shape). Fix userMappings / connector field mapping.`,
    );
  }

  const groupOrder = [];
  const byNorm = new Map();
  for (const row of orderedWithPk) {
    if (!byNorm.has(row.norm)) {
      byNorm.set(row.norm, []);
      groupOrder.push(row.norm);
    }
    byNorm.get(row.norm).push(row);
  }

  const canonicalDocs = [];
  const duplicateGroupPayloads = [];
  let duplicateRows = 0;
  let duplicateGroups = 0;

  for (const norm of groupOrder) {
    const g = byNorm.get(norm);
    const first = g[0];
    const canonical = { ...first.doc };
    canonical[pkField] = first.pkVal;
    canonical.tenantId = tenantId;
    if (!canonical.applicationId) {
      canonical.applicationId = application._id;
    }
    canonicalDocs.push(canonical);
    if (g.length > 1) {
      duplicateGroups += 1;
      duplicateRows += g.length - 1;
      duplicateGroupPayloads.push({
        tenantId,
        applicationId: application._id,
        primaryKeyField: pkField,
        primaryKeyValue: first.pkVal,
        primaryKeyNormalized: norm,
        canonicalization: "first_row_wins",
        canonicalRow: snapshotPlainDoc(first.doc),
        rows: g.slice(1).map((x) => snapshotPlainDoc(x.doc)),
        duplicateCount: g.length - 1,
        observedAt: new Date(),
        source,
      });
    }
  }

  return {
    canonicalDocs,
    duplicateGroupPayloads,
    pkField,
    tenantId,
    userMappings,
    ingestMeta: {
      primaryKeyField: pkField,
      duplicateGroups,
      duplicateRows,
      skippedMissingPk,
      canonicalization: "first_row_wins",
    },
  };
}

const BULK_CHUNK = 1000;

/**
 * Refresh duplicate PK sidecar without wiping unrelated groups (reconciliation-safe).
 * Live users always use first-row-wins canonical rows; extras land here only.
 *
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {object[]} duplicateGroupPayloads
 * @param {{ replaceAll?: boolean }} options
 */
export async function syncApplicationUserDuplicateSidecar(
  applicationId,
  duplicateGroupPayloads,
  options = {},
) {
  const appIdClause = applicationIdInClause(applicationId);
  const payloads = duplicateGroupPayloads || [];
  const timer = options.exclusiveTimer || null;
  const run = async (name, fn) => (timer ? timer.span(name, fn) : fn());

  if (options.replaceAll) {
    await run("duplicateSidecar.deleteMany.replaceAll", () =>
      ApplicationUserDuplicate.deleteMany({ applicationId: appIdClause }),
    );
  }

  if (payloads.length > 0) {
    const ops = payloads.map((payload) => ({
      updateOne: {
        filter: {
          applicationId: applicationId,
          primaryKeyNormalized: payload.primaryKeyNormalized,
        },
        update: { $set: payload },
        upsert: true,
      },
    }));
    const { bulkWriteChunkedParallel } = await import("../utils/csvUploadPerformance.js");
    await run("duplicateSidecar.bulkWriteChunkedParallel", () =>
      bulkWriteChunkedParallel(ApplicationUserDuplicate, ops, {
        chunkSize: BULK_CHUNK,
        concurrency: 3,
      }),
    );
  }

  if (!options.replaceAll) {
    const activeNorms = payloads.map((p) => p.primaryKeyNormalized).filter(Boolean);
    if (activeNorms.length === 0) {
      await run("duplicateSidecar.deleteMany.clearAll", () =>
        ApplicationUserDuplicate.deleteMany({ applicationId: appIdClause }),
      );
    } else {
      await run("duplicateSidecar.deleteMany.staleNorms", () =>
        ApplicationUserDuplicate.deleteMany({
          applicationId: appIdClause,
          primaryKeyNormalized: { $nin: activeNorms },
        }),
      );
    }
  }
}

/**
 * Upsert canonical users; handle removed users per reconciliation config.
 */
export async function applyCanonicalUsers(application, tenantSlug, payload, applyOptions = {}) {
  const {
    canonicalDocs,
    duplicateGroupPayloads,
    pkField,
    tenantId,
    ingestMeta,
  } = payload;

  const {
    runId = null,
    removedKeys = [],
    removedUserIds = [],
    removedUserHandling = "REMOVED_USER",
    inactiveStatusValue = "inactive",
    replaceAll = false,
    source = "unknown",
    skipFullReRead = false,
    unchangedUserIds = [],
    useSyncIdentityKeys = false,
    skipDedupeScan = false,
  } = applyOptions;

  const { createExclusiveSpanTimer } = await import("../utils/exclusiveSpanTimer.js");
  const timer = applyOptions.exclusiveTimer || createExclusiveSpanTimer("applyCanonicalUsers");
  const ownedTimer = !applyOptions.exclusiveTimer;

  const UsersModel = getDynamicUserModel(application.name, tenantSlug);
  const coll = UsersModel.collection;
  const appId = application._id;
  const appIdClause = applicationIdInClause(appId);
  const reconTime = new Date();
  const userIdByIdentityKey = new Map();
  const { bulkWriteChunkedParallel } = await import("../utils/csvUploadPerformance.js");

  if (replaceAll) {
    await timer.span("apply.replaceAll.deleteMany", () =>
      UsersModel.deleteMany({ applicationId: appIdClause }),
    );
    await timer.span("apply.replaceAll.dropManagedPkIndexes", () =>
      dropManagedUserPkIndexes(coll),
    );
  }

  const ops = [];
  const currentNormKeys = new Set();

  await timer.span("apply.buildBulkOps", async () => {
    for (const doc of canonicalDocs) {
      const norm = normalizePrimaryKeyValue(doc[pkField]);
      if (!norm) continue;
      currentNormKeys.add(norm);
      const update = {
        ...doc,
        tenantId,
        applicationId: appId,
        lastReconRunId: runId,
        updatedAt: reconTime,
      };
      ops.push({
        updateOne: {
          filter: { applicationId: appId, [pkField]: doc[pkField] },
          update: { $set: update },
          upsert: true,
        },
      });
    }
  });

  await timer.span("apply.bulkWriteChunkedParallel", () =>
    bulkWriteChunkedParallel(UsersModel, ops, {
      chunkSize: BULK_CHUNK,
      concurrency: 3,
    }),
  );

  if (canonicalDocs.length) {
    const pkValues = canonicalDocs.map((d) => d[pkField]).filter(Boolean);
    await timer.span("apply.postUpsertFind", async () => {
      for (let i = 0; i < pkValues.length; i += BULK_CHUNK) {
        const slice = pkValues.slice(i, i + BULK_CHUNK);
        if (!slice.length) continue;
        const applied = await UsersModel.find({
          applicationId: appId,
          [pkField]: { $in: slice },
        })
          .select(`_id ${pkField}${useSyncIdentityKeys ? " rawData" : ""}`)
          .lean();
        for (const row of applied) {
          const mapKey = useSyncIdentityKeys
            ? resolveStableSyncKey(
                { rawDoc: row, displayPk: row[pkField] },
                pkField,
              )
            : normalizePrimaryKeyValue(row[pkField]);
          if (mapKey) userIdByIdentityKey.set(mapKey, row._id);
        }
      }
    });
  }

  // Leaf spans only (no parent wrap) so duplicate-sidecar Mongo ops stay exclusive.
  await syncApplicationUserDuplicateSidecar(application._id, duplicateGroupPayloads, {
    replaceAll,
    exclusiveTimer: timer,
  });

  if (tenantId) {
    const { scheduleDataHygieneSummaryRecompute } = await import(
      "./datahygine/dataHygieneSummaryCacheService.js"
    );
    try {
      const { emitHygieneDirty, DEFAULT_APP_DIRTY_WIDGETS } = await import(
        "./datahygine/hygieneRollupService.js"
      );
      await emitHygieneDirty({
        tenantId,
        applicationId: application._id,
        widgetIds: [...DEFAULT_APP_DIRTY_WIDGETS],
        reason: "user_ingest",
      });
    } catch (e) {
      console.error("[applyCanonicalUsers] emitHygieneDirty failed", e?.message || e);
    }
    scheduleDataHygieneSummaryRecompute(tenantId);
  }

  const removedNormSet = new Set((removedKeys || []).map((k) => normalizePrimaryKeyValue(k)));
  const removedIdSet = new Set(
    (removedUserIds || [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  );

  if (removedIdSet.size > 0 && removedUserHandling === "REMOVED_USER") {
    const idsToDelete = [...removedIdSet].filter((id) =>
      mongoose.Types.ObjectId.isValid(id),
    );
    if (idsToDelete.length) {
      await timer.span("apply.removedById.deleteMany", () =>
        UsersModel.deleteMany({
          _id: { $in: idsToDelete },
          applicationId: appIdClause,
        }),
      );
    }
  }

  if (removedNormSet.size > 0 && removedIdSet.size === 0) {
    if (removedUserHandling === "MARK_INACTIVE") {
      const statusField = "status";
      const candidates = await timer.span("apply.removedByPk.findCandidates", () =>
        UsersModel.find({ applicationId: appIdClause })
          .select(`_id ${pkField}`)
          .lean(),
      );
      const markById = [];
      for (const u of candidates) {
        const norm = normalizePrimaryKeyValue(u[pkField]);
        if (!removedNormSet.has(norm)) continue;
        markById.push({
          updateOne: {
            filter: { _id: u._id },
            update: {
              $set: {
                [statusField]: inactiveStatusValue,
                lastReconRunId: runId,
                updatedAt: reconTime,
              },
            },
          },
        });
      }
      await timer.span("apply.removedByPk.bulkWriteMarkInactive", () =>
        bulkWriteChunkedParallel(UsersModel, markById, {
          chunkSize: BULK_CHUNK,
          concurrency: 3,
        }),
      );
    } else {
      const candidates = await timer.span("apply.removedByPk.findCandidates", () =>
        UsersModel.find({ applicationId: appIdClause })
          .select(`_id ${pkField}`)
          .lean(),
      );
      const idsToDelete = [];
      for (const u of candidates) {
        const norm = normalizePrimaryKeyValue(u[pkField]);
        if (removedNormSet.has(norm)) idsToDelete.push(u._id);
      }
      if (idsToDelete.length) {
        await timer.span("apply.removedByPk.deleteMany", () =>
          UsersModel.deleteMany({ _id: { $in: idsToDelete } }),
        );
      }
    }
  }

  if (replaceAll) {
    const liveUsers = await timer.span("apply.replaceAll.findLiveUsers", () =>
      UsersModel.find({ applicationId: appIdClause })
        .select(`_id ${pkField}`)
        .lean(),
    );
    const idsToDelete = [];
    for (const u of liveUsers) {
      const norm = normalizePrimaryKeyValue(u[pkField]);
      if (!currentNormKeys.has(norm)) idsToDelete.push(u._id);
    }
    if (idsToDelete.length) {
      await timer.span("apply.replaceAll.deleteStale", () =>
        UsersModel.deleteMany({ _id: { $in: idsToDelete } }),
      );
    }
  }

  let hasManagedPkIndex = false;
  if (!skipDedupeScan) {
    await timer.span("apply.coll.indexes", async () => {
      try {
        const indexes = await coll.indexes();
        hasManagedPkIndex = (indexes || []).some(
          (idx) => idx?.name && String(idx.name).startsWith(MANAGED_PK_INDEX_PREFIX),
        );
      } catch {
        hasManagedPkIndex = false;
      }
    });
  }
  if (!skipDedupeScan && !hasManagedPkIndex) {
    await timer.span("apply.dedupeLiveUsersByNormalizedPkField", () =>
      dedupeLiveUsersByNormalizedPkField(UsersModel, application._id, pkField),
    );
  }

  try {
    await timer.span("apply.ensureManagedUserPkUniqueIndex", () =>
      ensureManagedUserPkUniqueIndex(coll, pkField),
    );
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.code === 11000 || e?.code === 11001 || msg.includes("E11000") || msg.includes("dup key")) {
      throw new Error(msg);
    }
    throw e;
  }

  let canonicalUserDocsLean;
  let liveRows;

  if (skipFullReRead) {
    const idsToLoad = [
      ...new Set(
        [...userIdByIdentityKey.values(), ...unchangedUserIds].map(String),
      ),
    ].filter(Boolean);

    if (applyOptions.loadCanonicalDocs === false) {
      canonicalUserDocsLean = [];
    } else {
      canonicalUserDocsLean = idsToLoad.length
        ? await timer.span("apply.loadCanonicalDocsById", () =>
            UsersModel.find({ _id: { $in: idsToLoad } }).lean(),
          )
        : [];
    }

    liveRows = await timer.span("apply.countDocuments", () =>
      UsersModel.countDocuments({ applicationId: appIdClause }),
    );
  } else {
    canonicalUserDocsLean = await timer.span("apply.findAllLiveUsers", () =>
      UsersModel.find({ applicationId: appIdClause }).lean(),
    );
    liveRows = canonicalUserDocsLean.length;
  }

  if (tenantId) {
    try {
      const {
        rebuildInactiveAccessSidecar,
        patchInactiveAccessSidecar,
      } = await import("./datahygine/applicationUserInactiveAccessSidecar.js");
      if (skipFullReRead && !replaceAll) {
        await patchInactiveAccessSidecar({
          applicationId: application._id,
          tenantId,
          users: canonicalUserDocsLean,
          removedUserIds: [...removedIdSet],
          pkField,
        });
      } else {
        await rebuildInactiveAccessSidecar({
          applicationId: application._id,
          tenantId,
          users: canonicalUserDocsLean,
          pkField,
        });
      }
    } catch (e) {
      console.error(
        "[applyCanonicalUsers] inactive-access sidecar sync failed",
        e?.message || e,
      );
    }

    try {
      const { scheduleManagerMismatchSidecarRebuild } = await import(
        "./datahygine/applicationManagerMismatchSidecar.js"
      );
      scheduleManagerMismatchSidecarRebuild(application._id, tenantId, {
        skipDirtyEmit: true,
      });
    } catch (e) {
      console.error(
        "[applyCanonicalUsers] manager-mismatch sidecar schedule failed",
        e?.message || e,
      );
    }

    try {
      const { scheduleStatusMismatchSidecarRebuild } = await import(
        "./datahygine/applicationStatusMismatchSidecar.js"
      );
      scheduleStatusMismatchSidecarRebuild(application._id, tenantId, {
        skipDirtyEmit: true,
      });
    } catch (e) {
      console.error(
        "[applyCanonicalUsers] status-mismatch sidecar schedule failed",
        e?.message || e,
      );
    }
  }

  application.totalUsers = liveRows;
  application.lastUpload = reconTime;
  await timer.span("apply.application.save", () => application.save());

  const exclusiveSpans = ownedTimer ? timer.snapshot() : null;

  return {
    summary: { ...ingestMeta, liveRows, source },
    canonicalUserDocs: canonicalUserDocsLean,
    userIdByIdentityKey,
    exclusiveSpans,
  };
}

/**
 * Full refresh: canonical live users + duplicate sidecar + managed unique index.
 * Delegates to reconciliation when `options.skipReconciliation` is false (default: use orchestrator externally).
 */
export async function replaceApplicationUserIngest(application, rawUserDocs, options) {
  let tenantOid = toTenantObjectId(application.tenantId);
  if (!tenantOid && application._id) {
    const row = await Application.findById(application._id).select("tenantId").lean();
    tenantOid = toTenantObjectId(row?.tenantId);
  }
  if (!tenantOid) {
    throw new Error(
      `Cannot ingest application users: application "${String(application.name || "")}" (${String(application._id || "")}) has no valid tenantId.`,
    );
  }

  const payload = await canonicalizeIncomingUsers(application, rawUserDocs, options);
  const tenantSlug = await resolveTenantSlugFromTenantId(tenantOid);
  if (!tenantSlug) {
    throw new Error(
      `Cannot ingest application users: could not resolve tenant slug for application "${String(application.name || "")}" (${String(application._id || "")}).`,
    );
  }

  return applyCanonicalUsers(application, tenantSlug, payload, {
    replaceAll: true,
    source: options?.source || "unknown",
  });
}
