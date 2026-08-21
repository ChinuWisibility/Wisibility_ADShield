import mongoose from "mongoose";
import { slugIgaSegment } from "./applicationDynamicCollections.js";

const RECON_SUFFIXES = {
  reconciliation_runs: "reconciliation_runs",
  accounts_snapshot: "accounts_snapshot",
  delta_changes: "delta_changes",
  entitlement_delta: "entitlement_delta",
  staging_accounts: "staging_accounts",
};

/**
 * @param {string} appName
 * @param {string|null|undefined} tenantSlug
 * @param {string} suffix
 */
export function getReconciliationCollectionName(appName, tenantSlug, suffix) {
  const appSeg = slugIgaSegment(appName) || "app";
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      `Cannot build reconciliation collection "${suffix}" for application "${appName}": tenant slug is missing.`,
    );
  }
  if (!RECON_SUFFIXES[suffix] && !Object.values(RECON_SUFFIXES).includes(suffix)) {
    throw new Error(`Unknown reconciliation collection suffix: ${suffix}`);
  }
  const resolved = RECON_SUFFIXES[suffix] || suffix;
  return `app_iga_${tenantSeg}_${appSeg}_${resolved}`;
}

export function getReconciliationRunsCollectionName(appName, tenantSlug) {
  return getReconciliationCollectionName(appName, tenantSlug, "reconciliation_runs");
}

export function getAccountsSnapshotCollectionName(appName, tenantSlug) {
  return getReconciliationCollectionName(appName, tenantSlug, "accounts_snapshot");
}

export function getDeltaChangesCollectionName(appName, tenantSlug) {
  return getReconciliationCollectionName(appName, tenantSlug, "delta_changes");
}

export function getEntitlementDeltaCollectionName(appName, tenantSlug) {
  return getReconciliationCollectionName(appName, tenantSlug, "entitlement_delta");
}

export function getStagingAccountsCollectionName(appName, tenantSlug) {
  return getReconciliationCollectionName(appName, tenantSlug, "staging_accounts");
}

const modelCache = new Map();

/**
 * @param {string} modelKey
 * @param {mongoose.Schema} schema
 * @param {string} collectionName
 */
export function getReconModel(modelKey, schema, collectionName) {
  const cacheKey = `${modelKey}::${collectionName}`;
  if (modelCache.has(cacheKey)) {
    return mongoose.model(modelCache.get(cacheKey));
  }
  const safeKey = modelKey.replace(/[^a-zA-Z0-9_]/g, "_");
  if (mongoose.models[safeKey]) {
    const existing = mongoose.model(safeKey);
    if (existing.collection.name === collectionName) {
      modelCache.set(cacheKey, safeKey);
      return existing;
    }
  }
  const m = mongoose.model(safeKey, schema, collectionName);
  modelCache.set(cacheKey, safeKey);
  return m;
}

export function getReconciliationModels(appName, tenantSlug) {
  return {
    Runs: getReconModel(
      `ReconRuns_${tenantSlug}_${appName}`,
      reconciliationRunSchema,
      getReconciliationRunsCollectionName(appName, tenantSlug),
    ),
    Snapshot: getReconModel(
      `ReconSnapshot_${tenantSlug}_${appName}`,
      accountsSnapshotSchema,
      getAccountsSnapshotCollectionName(appName, tenantSlug),
    ),
    Delta: getReconModel(
      `ReconDelta_${tenantSlug}_${appName}`,
      deltaChangesSchema,
      getDeltaChangesCollectionName(appName, tenantSlug),
    ),
    EntitlementDelta: getReconModel(
      `ReconEntDelta_${tenantSlug}_${appName}`,
      entitlementDeltaSchema,
      getEntitlementDeltaCollectionName(appName, tenantSlug),
    ),
    Staging: getReconModel(
      `ReconStaging_${tenantSlug}_${appName}`,
      stagingAccountsSchema,
      getStagingAccountsCollectionName(appName, tenantSlug),
    ),
  };
}

const reconciliationRunSchema = new mongoose.Schema(
  {
    /** Unique per run; do not set `index: true` here — conflicts with named unique index below. */
    runId: { type: String, required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    reconciliationDate: { type: Date, default: Date.now, index: true },
    source: {
      type: String,
      enum: ["csv_strict", "csv_mapped", "csv_legacy", "connector_ad", "connector_universal", "unknown"],
      default: "unknown",
    },
    uploadedFileName: { type: String, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    previousRunId: { type: String, default: null },
    totalUsers: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    inactiveUsers: { type: Number, default: 0 },
    newUsers: { type: Number, default: 0 },
    updatedUsers: { type: Number, default: 0 },
    removedUsers: { type: Number, default: 0 },
    newEntitlements: { type: Number, default: 0 },
    removedEntitlements: { type: Number, default: 0 },
    /** From ingest canonicalization (first PK row wins; extras in application_user_duplicates). */
    duplicateGroups: { type: Number, default: 0 },
    duplicateRows: { type: Number, default: 0 },
    skippedMissingPk: { type: Number, default: 0 },
    liveRows: { type: Number, default: 0 },
    /** Hash-optimized connector sync (AD / universal connector). */
    hashOptimized: { type: Boolean, default: false },
    skippedUnchanged: { type: Number, default: 0 },
    unchangedAccounts: { type: Number, default: 0 },
    changedAccounts: { type: Number, default: 0 },
    newAccounts: { type: Number, default: 0 },
    removedAccounts: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
      default: "PROCESSING",
      index: true,
    },
    errorMessage: { type: String, default: null },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true },
);

reconciliationRunSchema.index({ applicationId: 1, reconciliationDate: -1 });
reconciliationRunSchema.index({ runId: 1 }, { unique: true, name: "uniq_reconciliation_run_id" });
reconciliationRunSchema.index({ applicationId: 1, status: 1 });

const accountsSnapshotSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    identityKey: { type: String, required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    snapshotDate: { type: Date, default: Date.now },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    entitlements: { type: [String], default: [] },
  },
  { timestamps: false, strict: true },
);

accountsSnapshotSchema.index(
  { applicationId: 1, runId: 1, identityKey: 1 },
  { unique: true },
);
accountsSnapshotSchema.index({ applicationId: 1, runId: 1 });

const attributeChangeSchema = new mongoose.Schema(
  {
    attribute: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const entitlementChangeSchema = new mongoose.Schema(
  {
    entitlementName: { type: String, required: true },
    changeType: { type: String, enum: ["ADDED", "REMOVED"], required: true },
  },
  { _id: false },
);

const deltaChangesSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    identityKey: { type: String, required: true, index: true },
    changeType: {
      type: String,
      enum: ["NEW_USER", "UPDATED", "REMOVED_USER"],
      required: true,
      index: true,
    },
    attributeChanges: { type: [attributeChangeSchema], default: [] },
    entitlementChanges: { type: [entitlementChangeSchema], default: [] },
    changedAt: { type: Date, default: Date.now, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: false, strict: true },
);

deltaChangesSchema.index({ applicationId: 1, runId: 1 });
deltaChangesSchema.index({ applicationId: 1, changeType: 1, changedAt: -1 });
deltaChangesSchema.index({ applicationId: 1, identityKey: 1, changedAt: -1 });

const entitlementDeltaSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    entitlementName: { type: String, required: true },
    changeType: {
      type: String,
      enum: ["NEW_ENTITLEMENT", "REMOVED_ENTITLEMENT"],
      required: true,
    },
    changedAt: { type: Date, default: Date.now },
    applicationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: false, strict: true },
);

entitlementDeltaSchema.index({ applicationId: 1, runId: 1 });

const stagingAccountsSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    identityKey: { type: String, required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    entitlements: { type: [String], default: [] },
    stagedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, strict: true },
);

stagingAccountsSchema.index({ applicationId: 1, runId: 1, identityKey: 1 }, { unique: true });
stagingAccountsSchema.index({ stagedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

const BULK_CHUNK = 1000;

export async function bulkInsertChunked(Model, docs) {
  if (!docs?.length) return 0;
  let inserted = 0;
  const concurrency = 3;
  const chunks = [];
  for (let i = 0; i < docs.length; i += BULK_CHUNK) {
    chunks.push(docs.slice(i, i + BULK_CHUNK));
  }
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map((chunk) => Model.insertMany(chunk, { ordered: false })),
    );
    for (const res of results) inserted += res.length;
  }
  return inserted;
}

/**
 * Drop legacy auto-generated `runId_1` when it is non-unique but schema expects unique.
 * @param {import('mongoose').Model} RunsModel
 */
async function healReconciliationRunIdIndex(RunsModel) {
  const coll = RunsModel.collection;
  let indexes;
  try {
    indexes = await coll.indexes();
  } catch {
    return;
  }
  const legacy = indexes.find((idx) => idx.name === "runId_1");
  const wantsUnique = reconciliationRunSchema.indexes().some(
    ([keys, opts]) => keys?.runId === 1 && opts?.unique,
  );
  if (legacy && wantsUnique && !legacy.unique) {
    await coll.dropIndex("runId_1").catch(() => {});
  }
}

/**
 * @param {import('mongoose').Model} Model
 */
async function syncReconModelIndexes(Model) {
  if (Model.schema === reconciliationRunSchema) {
    await healReconciliationRunIdIndex(Model);
  }
  try {
    await Model.syncIndexes();
  } catch (e) {
    const msg = String(e?.message || e);
    if (
      e?.codeName === "IndexOptionsConflict" ||
      msg.includes("same name as the requested index")
    ) {
      if (Model.schema === reconciliationRunSchema) {
        await Model.collection.dropIndex("runId_1").catch(() => {});
        await Model.syncIndexes();
        return;
      }
    }
    throw e;
  }
}

/**
 * Ensure indexes exist on all reconciliation collections for an application.
 * Cached per process — syncIndexes on every CSV upload was a major remote-Mongo bottleneck.
 */
const _reconIndexReady = new Set();

export async function ensureReconciliationIndexes(appName, tenantSlug, options = {}) {
  const cacheKey = `${String(tenantSlug || "")}::${String(appName || "")}`;
  if (_reconIndexReady.has(cacheKey)) {
    options.exclusiveTimer?.record?.("ensureReconciliationIndexes.cacheHit", 0);
    return;
  }

  const timer = options.exclusiveTimer || null;
  const run = async (name, fn) => (timer ? timer.span(name, fn) : fn());
  const models = getReconciliationModels(appName, tenantSlug);
  await Promise.all([
    run("ensureReconciliationIndexes.Runs.syncIndexes", () =>
      syncReconModelIndexes(models.Runs),
    ),
    run("ensureReconciliationIndexes.Snapshot.syncIndexes", () =>
      syncReconModelIndexes(models.Snapshot),
    ),
    run("ensureReconciliationIndexes.Delta.syncIndexes", () =>
      syncReconModelIndexes(models.Delta),
    ),
    run("ensureReconciliationIndexes.EntitlementDelta.syncIndexes", () =>
      syncReconModelIndexes(models.EntitlementDelta),
    ),
    run("ensureReconciliationIndexes.Staging.syncIndexes", () =>
      syncReconModelIndexes(models.Staging),
    ),
  ]);
  _reconIndexReady.add(cacheKey);
}

/** Test helper — clear index-ensure cache. */
export function clearReconciliationIndexCache() {
  _reconIndexReady.clear();
}

const RECON_SCOPE_SUFFIX_BY_KEY = {
  reconciliationRuns: "reconciliation_runs",
  reconciliationSnapshots: "accounts_snapshot",
  reconciliationDeltaChanges: "delta_changes",
  reconciliationEntitlementDeltas: "entitlement_delta",
  reconciliationStaging: "staging_accounts",
};

/** All reconciliation scope keys (one per physical collection). */
export const RECONCILIATION_DELETION_SCOPE_KEYS = Object.keys(RECON_SCOPE_SUFFIX_BY_KEY);

/**
 * @param {import('mongodb').Db} db
 * @param {string} collectionName
 */
export async function dropReconciliationCollectionByName(db, collectionName) {
  try {
    await db.collection(collectionName).drop();
    return 1;
  } catch (e) {
    if (!String(e?.message || e).includes("ns not found")) throw e;
    return 0;
  }
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} appName
 * @param {string} tenantSlug
 * @param {string} scopeKey
 */
export async function dropReconciliationCollectionByScope(db, appName, tenantSlug, scopeKey) {
  const suffix = RECON_SCOPE_SUFFIX_BY_KEY[scopeKey];
  if (!suffix) {
    throw new Error(`Unknown reconciliation deletion scope: ${scopeKey}`);
  }
  const name = getReconciliationCollectionName(appName, tenantSlug, suffix);
  return dropReconciliationCollectionByName(db, name);
}

export async function dropReconciliationCollections(db, appName, tenantSlug) {
  let dropped = 0;
  for (const scopeKey of RECONCILIATION_DELETION_SCOPE_KEYS) {
    dropped += await dropReconciliationCollectionByScope(db, appName, tenantSlug, scopeKey);
  }
  return dropped;
}
