/**
 * Export semantic fingerprints of reconciliation collections for equivalence checks.
 * Normalizes runId / timestamps / ObjectIds that legitimately differ across runs.
 */
import IdentitySyncState from "../../models/sync/IdentitySyncState.js";
import ApplicationUserDuplicate from "../../models/application/ApplicationUserDuplicate.js";
import { getDynamicUserModel } from "../../models/application/Users.js";
import { getReconciliationModels } from "../../utils/reconciliationCollections.js";
import { resolveTenantSlugFromTenantId } from "../../utils/applicationDynamicCollections.js";
import {
  applicationIdInClause,
  normalizePrimaryKeyValue,
} from "../application/applicationUserIngestService.js";

function stableStringify(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(stableStringify);
  if (typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (value._bsontype === "ObjectID" || value._bsontype === "ObjectId") {
      return String(value);
    }
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = stableStringify(value[k]);
    }
    return out;
  }
  return value;
}

/**
 * @param {object} application
 * @param {string} pkField
 */
export async function exportApplicationIngestState(application, pkField = "employee_id") {
  const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
  const models = getReconciliationModels(application.name, tenantSlug);
  const UsersModel = getDynamicUserModel(application.name, tenantSlug);
  const appId = application._id;
  const appClause = applicationIdInClause(appId);

  const [users, snapshots, deltas, entDeltas, staging, runs, syncStates, duplicates] =
    await Promise.all([
      UsersModel.find({ applicationId: appClause }).lean(),
      models.Snapshot.find({ applicationId: appId }).lean(),
      models.Delta.find({ applicationId: appId }).lean(),
      models.EntitlementDelta.find({ applicationId: appId }).lean(),
      models.Staging.find({ applicationId: appId }).lean(),
      models.Runs.find({ applicationId: appClause, status: "COMPLETED" })
        .sort({ reconciliationDate: -1 })
        .limit(5)
        .lean(),
      IdentitySyncState.find({ applicationId: appClause }).lean(),
      ApplicationUserDuplicate.find({ applicationId: appClause }).lean(),
    ]);

  const userByPk = new Map();
  for (const u of users) {
    const pk = normalizePrimaryKeyValue(u[pkField]);
    if (!pk) continue;
    const {
      _id,
      createdAt,
      updatedAt,
      lastReconRunId,
      applicationId,
      __v,
      ...rest
    } = u;
    userByPk.set(pk, stableStringify(rest));
  }

  const snapshotByKey = new Map();
  for (const s of snapshots) {
    const { _id, runId, snapshotDate, applicationId, ...rest } = s;
    const key = String(rest.identityKey || "");
    snapshotByKey.set(key, stableStringify({ ...rest }));
  }

  const deltaByKey = new Map();
  for (const d of deltas) {
    const { _id, runId, changedAt, applicationId, ...rest } = d;
    const key = `${rest.identityKey}|${rest.changeType}`;
    deltaByKey.set(key, stableStringify({ ...rest }));
  }

  const syncByKey = new Map();
  for (const s of syncStates) {
    const {
      _id,
      userId,
      lastSeenAt,
      lastSyncRunId,
      createdAt,
      updatedAt,
      applicationId,
      __v,
      ...rest
    } = s;
    syncByKey.set(String(rest.identityKey || ""), stableStringify(rest));
  }

  const dupByKey = new Map();
  for (const d of duplicates) {
    const {
      _id,
      observedAt,
      createdAt,
      updatedAt,
      applicationId,
      __v,
      ...rest
    } = d;
    dupByKey.set(String(rest.primaryKeyNormalized || ""), stableStringify(rest));
  }

  const latestRun = runs[0] || null;
  const runSemantic = latestRun
    ? {
        source: latestRun.source,
        status: latestRun.status,
        totalUsers: latestRun.totalUsers,
        newUsers: latestRun.newUsers,
        updatedUsers: latestRun.updatedUsers,
        removedUsers: latestRun.removedUsers,
        liveRows: latestRun.liveRows,
        hashOptimized: latestRun.hashOptimized,
        duplicateGroups: latestRun.duplicateGroups,
        duplicateRows: latestRun.duplicateRows,
        skippedMissingPk: latestRun.skippedMissingPk,
      }
    : null;

  return {
    counts: {
      users: users.length,
      snapshots: snapshots.length,
      deltas: deltas.length,
      entitlementDeltas: entDeltas.length,
      staging: staging.length,
      syncStates: syncStates.length,
      duplicates: duplicates.length,
      completedRuns: runs.length,
    },
    userByPk,
    snapshotByKey,
    deltaByKey,
    syncByKey,
    dupByKey,
    runSemantic,
  };
}

function compareMaps(label, a, b, mismatches) {
  if (a.size !== b.size) {
    mismatches.push(`${label}: size ${a.size} vs ${b.size}`);
  }
  for (const [k, v] of a) {
    if (!b.has(k)) {
      mismatches.push(`${label}: missing key in B: ${k}`);
      continue;
    }
    const bv = b.get(k);
    if (JSON.stringify(v) !== JSON.stringify(bv)) {
      mismatches.push(`${label}: value mismatch for key ${k}`);
    }
  }
  for (const k of b.keys()) {
    if (!a.has(k)) mismatches.push(`${label}: extra key in B: ${k}`);
  }
}

/**
 * @returns {{ ok: boolean, mismatches: string[], counts: object }}
 */
export function compareIngestStates(legacy, optimized) {
  const mismatches = [];
  const countKeys = Object.keys(legacy.counts || {});
  for (const k of countKeys) {
    // Staging is empty on hash path for both — still compare.
    // Snapshot/delta counts must match for same CSV baseline.
    if (legacy.counts[k] !== optimized.counts[k]) {
      mismatches.push(
        `counts.${k}: legacy=${legacy.counts[k]} optimized=${optimized.counts[k]}`,
      );
    }
  }

  compareMaps("users", legacy.userByPk, optimized.userByPk, mismatches);
  compareMaps("snapshots", legacy.snapshotByKey, optimized.snapshotByKey, mismatches);
  compareMaps("deltas", legacy.deltaByKey, optimized.deltaByKey, mismatches);
  compareMaps("syncState", legacy.syncByKey, optimized.syncByKey, mismatches);
  compareMaps("duplicates", legacy.dupByKey, optimized.dupByKey, mismatches);

  const lr = legacy.runSemantic || {};
  const or = optimized.runSemantic || {};
  for (const field of [
    "source",
    "status",
    "totalUsers",
    "newUsers",
    "updatedUsers",
    "removedUsers",
    "liveRows",
    "hashOptimized",
    "duplicateGroups",
    "duplicateRows",
    "skippedMissingPk",
  ]) {
    if (lr[field] !== or[field]) {
      mismatches.push(`run.${field}: legacy=${lr[field]} optimized=${or[field]}`);
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    counts: { legacy: legacy.counts, optimized: optimized.counts },
  };
}
