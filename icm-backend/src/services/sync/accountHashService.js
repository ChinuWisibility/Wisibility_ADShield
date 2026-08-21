import mongoose from "mongoose";
import crypto from "crypto";
import IdentitySyncState from "../../models/sync/IdentitySyncState.js";
import { memberGroupDnsForAdUser } from "../../utils/accountEntitlementCorrelation.js";
import {
  applicationIdInClause,
  normalizePrimaryKeyValue,
} from "../applicationUserIngestService.js";
import { bulkWriteChunkedParallel } from "../../utils/csvUploadPerformance.js";

const BULK_CHUNK = 1000;
/** Match user-upsert / delta insert parallelism in the shared reconciliation pipeline. */
const BULK_CONCURRENCY = 3;

/** Bump when hash input canonicalization changes — forces one re-hash pass. */
export const HASH_ALGORITHM_VERSION = 2;

/** LDAP / connector attributes that must not invalidate sync hashes. */
const VOLATILE_ATTR_PREFIXES = [
  "lastlogon",
  "pwdlast",
  "lockout",
  "badpassword",
  "whenchanged",
  "whencreated",
  "usnchanged",
  "usncreated",
  "lastrecon",
  "updatedat",
  "createdat",
  "lastsync",
  "correlatedat",
];

function stableHash(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function normalizeObjectGuid(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^[0-9A-F-]{36}$/i.test(s)) return s.toUpperCase();
  return s.toLowerCase();
}

function stableAttributes(attributes = {}) {
  const out = {};
  for (const key of Object.keys(attributes).sort()) {
    const lower = key.toLowerCase();
    if (VOLATILE_ATTR_PREFIXES.some((p) => lower.includes(p))) continue;
    const v = attributes[key];
    if (v === undefined || v === null || v === "") {
      out[key] = null;
    } else if (Array.isArray(v)) {
      out[key] = [...v]
        .map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x).trim()))
        .filter(Boolean)
        .sort()
        .join("; ") || null;
    } else if (typeof v === "object") {
      out[key] = JSON.stringify(v);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[key] = v;
    } else {
      out[key] = String(v).trim() || null;
    }
  }
  return out;
}

/**
 * Immutable AD identity for sync state — objectGUID when present, else normalized PK.
 * @param {object} entry buildAccountEntryFromDoc output
 * @param {string} [pkField]
 */
export function resolveStableSyncKey(entry, pkField = "") {
  const rawDoc = entry?.rawDoc || {};
  const rd = rawDoc.rawData && typeof rawDoc.rawData === "object" ? rawDoc.rawData : {};
  const guid = normalizeObjectGuid(
    rd.objectGUID || rd.objectguid || rawDoc.objectGUID || entry.objectGuid || "",
  );
  if (guid) return `guid:${guid}`;
  const pk =
    rawDoc[pkField] ||
    entry.displayPk ||
    rawDoc.user_id ||
    rawDoc.email ||
    "";
  const norm = normalizePrimaryKeyValue(pk);
  return norm ? `pk:${norm}` : "";
}

/**
 * Compute deterministic account + membership hashes from a reconciliation account entry.
 * @param {object} entry - buildAccountEntryFromDoc output
 */
export function computeAccountEntryHashes(entry) {
  const attributes = entry.attributes || {};
  const sortedAttrs = stableAttributes(attributes);
  const memberDns = memberGroupDnsForAdUser(entry.rawDoc || {}).sort();
  const accountHash = stableHash({
    attributes: sortedAttrs,
    memberDns,
  });
  const membershipHash = stableHash({ memberDns });
  const objectGuid = normalizeObjectGuid(
    entry.rawDoc?.rawData?.objectGUID ||
      entry.rawDoc?.rawData?.objectguid ||
      entry.rawDoc?.objectGUID ||
      "",
  );
  return { accountHash, membershipHash, objectGuid };
}

/**
 * Classify incoming accounts vs persisted sync state.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {Map<string, object>} currentMap PK identityKey → account entry
 * @param {string} pkField
 */
export async function partitionAccountsBySyncState(
  applicationId,
  currentMap,
  pkField = "",
  options = {},
) {
  const hashGenerateStart = Date.now();
  const appClause = applicationIdInClause(applicationId);
  const timer = options.exclusiveTimer || null;
  const run = async (name, fn) => (timer ? timer.span(name, fn) : fn());
  const existing = await run("partitionAccountsBySyncState.IdentitySyncState.find", () =>
    IdentitySyncState.find({ applicationId: appClause })
      .select("identityKey accountHash membershipHash userId objectGuid hashVersion")
      .lean(),
  );
  const hashCompareStart = Date.now();

  const stateByKey = new Map(existing.map((row) => [row.identityKey, row]));

  const unchangedKeys = [];
  const changedKeys = [];
  const newKeys = [];
  const unchangedPkKeys = [];
  const changedPkKeys = [];
  const newPkKeys = [];
  const hashByKey = new Map();
  const membershipHashByKey = new Map();
  const objectGuidByKey = new Map();
  const syncKeyByPkKey = new Map();

  for (const [pkIdentityKey, entry] of currentMap) {
    const syncKey = resolveStableSyncKey(entry, pkField);
    if (!syncKey) continue;
    syncKeyByPkKey.set(pkIdentityKey, syncKey);

    const { accountHash, membershipHash, objectGuid } = computeAccountEntryHashes(entry);
    hashByKey.set(syncKey, accountHash);
    membershipHashByKey.set(syncKey, membershipHash);
    if (objectGuid) objectGuidByKey.set(syncKey, objectGuid);

    const prev = stateByKey.get(syncKey);
    if (!prev) {
      newKeys.push(syncKey);
      newPkKeys.push(pkIdentityKey);
    } else if (prev.accountHash === accountHash) {
      // Same logical account — unchanged even when hashVersion lags (algorithm bump).
      unchangedKeys.push(syncKey);
      unchangedPkKeys.push(pkIdentityKey);
    } else {
      changedKeys.push(syncKey);
      changedPkKeys.push(pkIdentityKey);
    }
  }

  const removedKeys = [];
  const removedUserIds = [];
  const migratedSyncKeys = [];
  const activeSyncKeys = new Set([...hashByKey.keys()]);
  const currentGuids = new Set(
    [...objectGuidByKey.values()].filter(Boolean),
  );
  for (const row of existing) {
    if (activeSyncKeys.has(row.identityKey)) continue;

    const rowGuid = normalizeObjectGuid(row.objectGuid || "");
    if (rowGuid && currentGuids.has(rowGuid)) {
      migratedSyncKeys.push(row.identityKey);
      continue;
    }

    const legacyPk =
      row.identityKey.startsWith("pk:")
        ? row.identityKey.slice(3)
        : row.identityKey.startsWith("guid:")
          ? ""
          : row.identityKey;
    if (legacyPk && currentMap.has(legacyPk)) {
      migratedSyncKeys.push(row.identityKey);
      continue;
    }

    removedKeys.push(row.identityKey);
    if (row.userId) removedUserIds.push(row.userId);
  }

  const membershipChangedKeys = [];
  for (const key of [...newKeys, ...changedKeys]) {
    const prev = stateByKey.get(key);
    const nextMembership = membershipHashByKey.get(key) || "";
    if (!prev || prev.membershipHash !== nextMembership) {
      membershipChangedKeys.push(key);
    }
  }

  return {
    stateByKey,
    unchangedKeys,
    changedKeys,
    newKeys,
    unchangedPkKeys,
    changedPkKeys,
    newPkKeys,
    removedKeys,
    removedUserIds,
    migratedSyncKeys,
    membershipChangedKeys,
    hashByKey,
    membershipHashByKey,
    objectGuidByKey,
    syncKeyByPkKey,
    existingStateCount: existing.length,
    timings: {
      hashGenerateMs: hashCompareStart - hashGenerateStart,
      hashCompareMs: Date.now() - hashCompareStart,
    },
  };
}

/**
 * Upsert sync state rows after a successful reconciliation run.
 * @param {object} params
 * @param {Set<string>|string[]|null} [params.syncKeysToFullUpsert] when set, only these keys get full hash upserts
 * @param {Set<string>|string[]|null} [params.syncKeysToTouch] when set, only lastSeenAt/lastSyncRunId updated
 */
export async function upsertIdentitySyncStateBatch({
  applicationId,
  tenantId,
  runId,
  currentMap,
  hashByKey,
  membershipHashByKey,
  objectGuidByKey,
  userIdByIdentityKey,
  removedKeys,
  pkField = "",
  syncKeysToFullUpsert = null,
  syncKeysToTouch = null,
  exclusiveTimer = null,
}) {
  const seenAt = new Date();
  const ops = [];
  const appOid = mongoose.Types.ObjectId.isValid(String(applicationId))
    ? new mongoose.Types.ObjectId(String(applicationId))
    : applicationId;
  const run = async (name, fn) => (exclusiveTimer ? exclusiveTimer.span(name, fn) : fn());

  const fullUpsertSet =
    syncKeysToFullUpsert == null
      ? null
      : new Set(Array.isArray(syncKeysToFullUpsert) ? syncKeysToFullUpsert : [...syncKeysToFullUpsert]);

  for (const [, entry] of currentMap) {
    const syncKey = resolveStableSyncKey(entry, pkField);
    const accountHash = hashByKey.get(syncKey);
    if (!syncKey || !accountHash) continue;
    if (fullUpsertSet && !fullUpsertSet.has(syncKey)) continue;
    ops.push({
      updateOne: {
        filter: { applicationId: appOid, identityKey: syncKey },
        update: {
          $set: {
            tenantId,
            applicationId: appOid,
            identityKey: syncKey,
            accountHash,
            membershipHash: membershipHashByKey.get(syncKey) || "",
            objectGuid: objectGuidByKey.get(syncKey) || "",
            userId: userIdByIdentityKey.get(syncKey) || null,
            hashVersion: HASH_ALGORITHM_VERSION,
            lastSeenAt: seenAt,
            lastSyncRunId: runId,
          },
        },
        upsert: true,
      },
    });
  }

  let upserted = 0;
  if (ops.length) {
    // Reuse the shared parallel bulkWrite helper (same chunk/concurrency contract as
    // applyCanonicalUsers / duplicate sidecar). Ops are independent per identityKey
    // (unique index on applicationId+identityKey), so wave-parallel unordered writes
    // preserve document contents and failure class vs serial unordered bulkWrite.
    const writeRes = await run("upsertIdentitySyncStateBatch.bulkWriteChunkedParallel", () =>
      bulkWriteChunkedParallel(IdentitySyncState, ops, {
        chunkSize: BULK_CHUNK,
        concurrency: BULK_CONCURRENCY,
      }),
    );
    upserted = (writeRes.upsertedCount || 0) + (writeRes.modifiedCount || 0);
  }

  let touched = 0;
  if (syncKeysToTouch != null) {
    const touchKeys = Array.isArray(syncKeysToTouch)
      ? syncKeysToTouch
      : [...syncKeysToTouch];
    // Touch path still uses updateMany (one filter per chunk). Kept sequential here so
    // this change only swaps the duplicated bulkWrite loop for the shared helper;
    // parallel updateMany is a separate shared bottleneck (see report).
    for (let i = 0; i < touchKeys.length; i += BULK_CHUNK) {
      const chunk = touchKeys.slice(i, i + BULK_CHUNK);
      if (!chunk.length) continue;
      const res = await run("upsertIdentitySyncStateBatch.updateMany.touch", () =>
        IdentitySyncState.updateMany(
          {
            applicationId: appOid,
            identityKey: { $in: chunk },
          },
          {
            $set: {
              lastSeenAt: seenAt,
              lastSyncRunId: runId,
              hashVersion: HASH_ALGORITHM_VERSION,
            },
          },
        ),
      );
      touched += res.modifiedCount || 0;
    }
  }

  if (removedKeys.length) {
    await run("upsertIdentitySyncStateBatch.deleteMany.removed", () =>
      IdentitySyncState.deleteMany({
        applicationId: applicationIdInClause(applicationId),
        identityKey: { $in: removedKeys },
      }),
    );
  }

  // Avoid countDocuments on the full sync-state collection (remote RTT + collection scan).
  return {
    upserted,
    touched,
    persisted: ops.length + touched,
    attempted: ops.length,
  };
}

/**
 * Load prior snapshot entries only for keys that changed (targeted baseline).
 * @param {import('mongoose').Model} SnapshotModel
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {string|null} previousRunId
 * @param {string[]} identityKeys
 */
export async function loadSnapshotSubsetMap(
  SnapshotModel,
  applicationId,
  previousRunId,
  identityKeys,
  options = {},
) {
  const map = new Map();
  if (!previousRunId || !identityKeys.length) return map;

  const timer = options.exclusiveTimer || null;
  const run = async (name, fn) => (timer ? timer.span(name, fn) : fn());
  const rows = await run("loadSnapshotSubsetMap.Snapshot.find", () =>
    SnapshotModel.find({
      applicationId,
      runId: previousRunId,
      identityKey: { $in: identityKeys },
    })
      .select("identityKey attributes entitlements")
      .lean(),
  );

  for (const row of rows) {
    map.set(row.identityKey, {
      identityKey: row.identityKey,
      attributes: row.attributes || {},
      entitlements: new Set(row.entitlements || []),
    });
  }
  return map;
}

/**
 * When sync hashes match but live user rows are missing/stale, reclassify accounts for upsert.
 * @param {object} hashPartition output of partitionAccountsBySyncState
 * @param {Map<string, object>} currentMap PK → account entry
 * @param {string} pkField
 * @param {Set<string>} [livePkSet] normalized PKs that exist in the user collection
 */
export function reclassifyHashPartitionForLiveUserRepair(
  hashPartition,
  currentMap,
  pkField = "",
  livePkSet = null,
) {
  const newPkKeys = [...(hashPartition.newPkKeys || [])];
  const newKeys = [...(hashPartition.newKeys || [])];
  const changedPkKeys = [...(hashPartition.changedPkKeys || [])];
  const changedKeys = [...(hashPartition.changedKeys || [])];
  const unchangedPkKeys = [];
  const unchangedKeys = [];

  for (const pkIdentityKey of hashPartition.unchangedPkKeys || []) {
    const entry = currentMap.get(pkIdentityKey);
    const syncKey =
      hashPartition.syncKeyByPkKey.get(pkIdentityKey) ||
      (entry ? resolveStableSyncKey(entry, pkField) : "");
    if (!syncKey) continue;

    const existsInDb = livePkSet ? livePkSet.has(pkIdentityKey) : false;
    if (existsInDb) {
      unchangedPkKeys.push(pkIdentityKey);
      unchangedKeys.push(syncKey);
    } else {
      newPkKeys.push(pkIdentityKey);
      newKeys.push(syncKey);
    }
  }

  hashPartition.newPkKeys = newPkKeys;
  hashPartition.newKeys = newKeys;
  hashPartition.changedPkKeys = changedPkKeys;
  hashPartition.changedKeys = changedKeys;
  hashPartition.unchangedPkKeys = unchangedPkKeys;
  hashPartition.unchangedKeys = unchangedKeys;

  const membershipChangedKeys = [];
  for (const key of [...newKeys, ...changedKeys]) {
    const prev = hashPartition.stateByKey.get(key);
    const nextMembership = hashPartition.membershipHashByKey.get(key) || "";
    if (!prev || prev.membershipHash !== nextMembership) {
      membershipChangedKeys.push(key);
    }
  }
  hashPartition.membershipChangedKeys = membershipChangedKeys;
}

/**
 * Map guid:/pk: sync keys → live user _id from the dynamic users collection.
 */
export async function loadLiveUserIdsBySyncKey(
  UsersModel,
  applicationId,
  pkField = "",
  options = {},
) {
  const appClause = applicationIdInClause(applicationId);
  const run = async (name, fn) =>
    options.exclusiveTimer ? options.exclusiveTimer.span(name, fn) : fn();
  const rows = await run("loadLiveUserIdsBySyncKey.Users.find", () =>
    UsersModel.find({ applicationId: appClause })
      .select(`_id ${pkField} rawData`)
      .lean(),
  );
  const map = new Map();
  for (const row of rows) {
    const syncKey = resolveStableSyncKey(
      { rawDoc: row, displayPk: row[pkField] },
      pkField,
    );
    if (syncKey && row._id) map.set(syncKey, row._id);
  }
  return map;
}

export function isHashReconciliationEnabled(meta = {}) {
  if (meta.disableHashReconciliation) return false;
  if (process.env.DISABLE_HASH_RECONCILIATION === "1") return false;
  const source = String(meta.source || "");
  // CSV imports previously skipped hash optimization and paid for full staging +
  // snapshot + full collection re-read on every upload (25–60s for ~5k rows).
  return (
    source === "connector_ad" ||
    source === "connector_universal" ||
    source === "csv_mapped" ||
    source === "csv_strict" ||
    source === "csv_legacy"
  );
}
