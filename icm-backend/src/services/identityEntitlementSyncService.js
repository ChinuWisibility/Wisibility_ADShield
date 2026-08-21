import mongoose from "mongoose";
import Application from "../models/application/Application.js";
import IdentityAccountLink from "../models/identity/IdentityAccountLink.js";
import { getDynamicIdentityModelForTenantId } from "../models/identity/Identity.js";
import { getDynamicUserModelForTenantId } from "../models/application/Users.js";
import { getIdentityEntitlementModelForTenantId } from "../models/identityEntitlementModel.js";
import {
  getAppCorrelationCollectionName,
  getAppEntitlementsCollectionName,
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from "../utils/applicationDynamicCollections.js";
import { extractEntitlementTokensFromAppUser } from "../utils/sod/sodAppUserEntitlements.js";
import {
  findAuthSourceApplicationUser,
  forEachAuthSourceIdentityBatch,
  getAuthSourceCorrelationValueFromIdentity,
  loadAuthSourceProfile,
  resolveAuthSourceCorrelationTargetKey,
  resolveAuthSourceMatchStandardField,
} from "./identityEntitlementAuthSource.js";
import {
  beginSyncMetrics,
  endSyncMetrics,
  isSyncMetricsEnabled,
  recordBulkWriteOps,
  recordDeleteMany,
} from "./identityEntitlementSyncMetrics.js";

const LOG_PREFIX = "[identityEntitlementSync]";
const BULK_CHUNK = Number(process.env.IDENTITY_ENTITLEMENT_SYNC_BULK_CHUNK ?? 500);
const LINK_CURSOR_BATCH = Number(process.env.IDENTITY_ENTITLEMENT_SYNC_LINK_BATCH ?? 1000);

function logInfo(msg, meta = {}) {
  console.log(LOG_PREFIX, msg, Object.keys(meta).length ? meta : "");
}

function logWarn(msg, meta = {}) {
  console.warn(LOG_PREFIX, msg, Object.keys(meta).length ? meta : "");
}

function logError(msg, err, meta = {}) {
  console.error(LOG_PREFIX, msg, err?.message || err, meta);
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function looksLikeMongoId(value) {
  return mongoose.Types.ObjectId.isValid(String(value || "").trim());
}

function accountEnabledFromStatus(status) {
  const s = String(status || "").trim().toUpperCase();
  if (!s) return true;
  return !["INACTIVE", "DISABLED", "TERMINATED", "SUSPENDED", "LOCKED"].includes(s);
}

function pickNativeIdentity(accountDoc) {
  if (!accountDoc) return "";
  const d = accountDoc;
  const raw = d.rawData && typeof d.rawData === "object" ? d.rawData : {};
  const candidates = [
    d.user_id,
    d.username,
    d.account_id,
    d.email,
    d.samAccountName,
    d.userPrincipalName,
    raw.user_id,
    raw.account_id,
    raw.username,
    raw.email,
  ];
  for (const c of candidates) {
    if (c != null && String(c).trim()) return String(c).trim();
  }
  return "";
}

/**
 * @param {object} params
 * @returns {object}
 */
export function buildProjectionRow({
  tenantId,
  tenantSlug,
  identity,
  application,
  link,
  accountDoc,
  entitlementDoc,
  correlationStatus = "CORRELATED",
  syncedAt,
}) {
  const ent = entitlementDoc && typeof entitlementDoc === "object" ? entitlementDoc : {};
  const acc = accountDoc && typeof accountDoc === "object" ? accountDoc : {};
  const attrs =
    identity?.attributes && typeof identity.attributes === "object" ? identity.attributes : {};

  const entitlementDisplayName =
    ent.displayName ||
    ent.display_name ||
    ent.entitlement_name ||
    ent.name ||
    String(ent.entitlement_id || ent._id || "");

  const accountOid =
    acc._id && mongoose.Types.ObjectId.isValid(String(acc._id))
      ? new mongoose.Types.ObjectId(String(acc._id))
      : link?.accountId && mongoose.Types.ObjectId.isValid(String(link.accountId))
        ? new mongoose.Types.ObjectId(String(link.accountId))
        : null;

  const entitlementOid =
    ent._id && mongoose.Types.ObjectId.isValid(String(ent._id))
      ? new mongoose.Types.ObjectId(String(ent._id))
      : null;

  if (!accountOid || !entitlementOid) return null;

  return {
    tenantId,
    tenantSlug,
    identityId: identity._id,
    identityProfileId: identity.identityProfileId || undefined,
    applicationId: application._id,
    applicationName: application.name,
    entitlementId: entitlementOid,
    entitlementValue: String(ent.entitlement_id || ent.entitlement_name || entitlementDisplayName || entitlementOid),
    entitlementDisplayName: String(entitlementDisplayName),
    accountId: accountOid,
    nativeIdentity: pickNativeIdentity(acc),
    correlationStatus,
    assignmentType: "DIRECT",
    identitySnapshot: {
      displayName: identity.displayName || "",
      email: identity.email || "",
      username: String(attrs.userid || attrs.user_id || attrs.uid || attrs.username || "").trim(),
      department: identity.department || "",
      jobTitle: identity.title || "",
      managerId: identity.managerId || undefined,
      lifecycleState: identity.lifecycleState || "",
    },
    accountSnapshot: {
      accountStatus: acc.status != null ? String(acc.status) : "",
      enabled: accountEnabledFromStatus(acc.status),
    },
    entitlementSnapshot: {
      riskLevel: String(ent.riskLevel || ent.risk_level || "LOW"),
      isPrivileged: Boolean(ent.is_privilege === true || ent.is_privilege === "true" || ent.isPrivileged === true),
      entitlementType: String(ent.entitlement_type || ent.entitlementType || ""),
    },
    syncedAt,
  };
}

/**
 * Build normalized token → entitlement doc map for one application catalog.
 * Scoped to a single sync execution — caller owns lifetime (no global cache).
 * @param {import('mongodb').Collection} entColl
 */
export async function buildEntitlementLookupMap(entColl) {
  const map = new Map();
  const cursor = entColl
    .find({})
    .project({
      entitlement_name: 1,
      entitlement_id: 1,
      displayName: 1,
      display_name: 1,
      name: 1,
      is_privilege: 1,
      riskLevel: 1,
      risk_level: 1,
      entitlement_type: 1,
    })
    .batchSize(2000);

  for await (const doc of cursor) {
    const keys = [
      doc.entitlement_name,
      doc.entitlement_id,
      doc.displayName,
      doc.display_name,
      doc.name,
      doc._id != null ? String(doc._id) : "",
    ];
    for (const k of keys) {
      const n = normalizeToken(k);
      if (n && !map.has(n)) map.set(n, doc);
    }
  }
  return map;
}

/**
 * Batch-load correlation entitlement ids for many accounts (single query).
 * @returns {Promise<Map<string, string[]>>} accountId → entitlementId strings
 */
async function loadCorrelationEntitlementIdsForAccounts(db, appName, applicationId, userObjectIds) {
  const map = new Map();
  const oids = [...userObjectIds]
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => (id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))));
  if (!oids.length) return map;

  const collName = getAppCorrelationCollectionName(appName);
  let rows = [];
  try {
    rows = await db
      .collection(collName)
      .find({ applicationId, userId: { $in: oids } })
      .project({ entitlementId: 1, userId: 1 })
      .toArray();
  } catch {
    return map;
  }

  for (const row of rows) {
    if (!row?.userId || !row?.entitlementId) continue;
    if (!mongoose.Types.ObjectId.isValid(String(row.entitlementId))) continue;
    const key = String(row.userId);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(String(row.entitlementId));
  }
  return map;
}

/**
 * Remove projection rows not refreshed in the current sync run.
 */
export async function removeStaleAssignments(ProjectionModel, filter, syncedAt) {
  recordDeleteMany();
  await ProjectionModel.deleteMany({
    ...filter,
    $or: [{ syncedAt: { $lt: syncedAt } }, { syncedAt: { $exists: false } }],
  });
}

async function resolveLiveApplicationUserForSync(DynamicUserModel, link, app) {
  const { resolveLiveApplicationUser } = await import(
    "../controllers/correlation/identityAccountLinkController.js"
  );
  return resolveLiveApplicationUser(DynamicUserModel, link, app);
}

/**
 * Batch-load accounts by ObjectId $in; fall back to resolveLiveApplicationUser for misses.
 * Preserves prior resolution semantics for non-ObjectId / native-key accountIds.
 * @returns {Promise<Map<string, object|null>>} key = String(link.accountId)
 */
async function loadAccountsForLinks(DynamicUserModel, links, app) {
  const byAccountKey = new Map();
  if (!links.length) return byAccountKey;

  const mongoIdStrs = [];
  for (const link of links) {
    const idStr = String(link.accountId ?? "").trim();
    if (looksLikeMongoId(idStr)) mongoIdStrs.push(idStr);
  }
  const uniqIds = [...new Set(mongoIdStrs)];

  const found = new Map();
  if (uniqIds.length) {
    const oids = uniqIds.map((id) => new mongoose.Types.ObjectId(id));
    const appOid = app?._id || null;
    if (appOid) {
      const scoped = await DynamicUserModel.find({
        _id: { $in: oids },
        applicationId: appOid,
      }).lean();
      for (const d of scoped) found.set(String(d._id), d);
    }
    const missing = uniqIds.filter((id) => !found.has(id));
    if (missing.length) {
      const loose = await DynamicUserModel.find({
        _id: { $in: missing.map((id) => new mongoose.Types.ObjectId(id)) },
      }).lean();
      for (const d of loose) found.set(String(d._id), d);
    }
  }

  for (const link of links) {
    const idStr = String(link.accountId ?? "").trim();
    if (found.has(idStr)) {
      byAccountKey.set(idStr, found.get(idStr));
      continue;
    }
    try {
      const doc = await resolveLiveApplicationUserForSync(DynamicUserModel, link, app);
      byAccountKey.set(idStr, doc || null);
    } catch (e) {
      logWarn("account resolve failed", {
        identityId: String(link.identityId),
        err: e.message,
      });
      byAccountKey.set(idStr, null);
    }
  }
  return byAccountKey;
}

async function loadIdentityMap(tenantId, identityIds) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const uniq = [...new Set(identityIds.map(String))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  const map = new Map();
  for (let i = 0; i < uniq.length; i += 500) {
    const slice = uniq.slice(i, i + 500);
    const docs = await Identity.find({ _id: { $in: slice } })
      .select(
        "displayName email department title managerId lifecycleState identityProfileId attributes sourceApplication employeeId",
      )
      .lean();
    for (const d of docs) map.set(String(d._id), d);
  }
  return map;
}

/**
 * Resolve entitlement docs from the in-memory catalog map (no Mongo round-trip).
 */
function resolveEntitlementDocsFromLookup(entLookup, entitlementIdStrs) {
  const map = new Map();
  for (const entId of entitlementIdStrs) {
    const hit =
      entLookup.get(normalizeToken(entId)) ||
      (mongoose.Types.ObjectId.isValid(String(entId))
        ? entLookup.get(normalizeToken(String(entId)))
        : null);
    if (hit?._id) map.set(String(hit._id), hit);
  }
  return map;
}

/**
 * Collect entitlement ObjectId strings for one correlated account.
 * @param {Map<string, string[]>|null} corrByAccountId preloaded correlation map
 * @returns {string[]}
 */
function collectEntitlementIdsForAccountSync({
  accountDoc,
  entLookup,
  corrByAccountId = null,
}) {
  const ids = new Set();
  const uid = accountDoc?._id;
  if (uid && corrByAccountId) {
    const corrIds = corrByAccountId.get(String(uid)) || [];
    corrIds.forEach((id) => ids.add(id));
  }

  const raw = accountDoc?.rawData && typeof accountDoc.rawData === "object" ? accountDoc.rawData : {};
  const tokens = extractEntitlementTokensFromAppUser(accountDoc || {}, raw);
  for (const token of tokens) {
    const hit = entLookup.get(normalizeToken(token));
    if (hit?._id) ids.add(String(hit._id));
  }

  return [...ids];
}

async function flushBulkUpserts(ProjectionModel, ops) {
  if (!ops.length) return 0;
  let written = 0;
  for (let i = 0; i < ops.length; i += BULK_CHUNK) {
    const chunk = ops.slice(i, i + BULK_CHUNK);
    recordBulkWriteOps(chunk.length);
    await ProjectionModel.bulkWrite(chunk, { ordered: false });
    written += chunk.length;
  }
  return written;
}

function appendProjectionRowsForIdentityAccountSync({
  bulkOps,
  tenantId,
  tenantSlug,
  identity,
  application,
  link,
  accountDoc,
  entLookup,
  corrByAccountId,
  syncedAt,
}) {
  const entitlementIds = collectEntitlementIdsForAccountSync({
    accountDoc,
    entLookup,
    corrByAccountId,
  });
  if (!entitlementIds.length) return;

  const entById = resolveEntitlementDocsFromLookup(entLookup, entitlementIds);
  for (const entId of entitlementIds) {
    const entDoc = entById.get(String(entId)) || entLookup.get(normalizeToken(entId));
    if (!entDoc?._id) continue;
    const row = buildProjectionRow({
      tenantId,
      tenantSlug,
      identity,
      application,
      link,
      accountDoc,
      entitlementDoc: entDoc,
      syncedAt,
    });
    if (!row) continue;
    bulkOps.push({
      updateOne: {
        filter: {
          tenantId,
          identityId: row.identityId,
          applicationId: row.applicationId,
          entitlementId: row.entitlementId,
          accountId: row.accountId,
        },
        update: { $set: row },
        upsert: true,
      },
    });
  }
}

function identityIsAuthSource(identity, app, profile) {
  if (!identity || !app) return false;
  if (identity.sourceApplication && String(identity.sourceApplication) === String(app._id)) {
    return true;
  }
  if (profile?._id && identity.identityProfileId && String(identity.identityProfileId) === String(profile._id)) {
    return true;
  }
  return false;
}

/**
 * Auth-source path for a single identity (fixes syncForIdentity full-app scan).
 */
async function syncAuthSourceForIdentity({
  identity,
  app,
  tenantId,
  tenantSlug,
  ProjectionModel,
  DynamicUserModel,
  db,
  entLookup,
  syncedAt,
}) {
  const profile = await loadAuthSourceProfile(app._id, tenantId);
  if (!profile) return { upserted: 0, identitiesProcessed: 0 };
  if (!identityIsAuthSource(identity, app, profile)) {
    return { upserted: 0, identitiesProcessed: 0 };
  }

  const correlationTargetKey = resolveAuthSourceCorrelationTargetKey(profile, app);
  const standardField = resolveAuthSourceMatchStandardField(profile, app, correlationTargetKey);
  const corrVal = getAuthSourceCorrelationValueFromIdentity(identity, correlationTargetKey);
  if (!corrVal) return { upserted: 0, identitiesProcessed: 1 };

  const accountDoc = await findAuthSourceApplicationUser(
    DynamicUserModel,
    app._id,
    standardField,
    corrVal,
    correlationTargetKey,
  );
  if (!accountDoc?._id) return { upserted: 0, identitiesProcessed: 1 };

  const corrByAccountId = await loadCorrelationEntitlementIdsForAccounts(
    db,
    app.name,
    app._id,
    [accountDoc._id],
  );

  const syntheticLink = {
    identityId: identity._id,
    accountId: accountDoc._id,
    applicationId: app._id,
    isActive: true,
  };
  const bulkOps = [];
  appendProjectionRowsForIdentityAccountSync({
    bulkOps,
    tenantId,
    tenantSlug,
    identity,
    application: app,
    link: syntheticLink,
    accountDoc,
    entLookup,
    corrByAccountId,
    syncedAt,
  });
  const upserted = await flushBulkUpserts(ProjectionModel, bulkOps);
  return { upserted, identitiesProcessed: 1 };
}

/**
 * Auth-source apps (e.g. AD): identities are created from app users directly — no IdentityAccountLink.
 * Batches correlation loads per identity batch; account match remains per-identity (variable key lookup).
 */
async function syncAuthSourceForApplication({
  app,
  tenantId,
  tenantSlug,
  ProjectionModel,
  DynamicUserModel,
  db,
  entColl,
  entLookup,
  syncedAt,
}) {
  const profile = await loadAuthSourceProfile(app._id, tenantId);
  if (!profile) return { upserted: 0, identitiesProcessed: 0 };

  const correlationTargetKey = resolveAuthSourceCorrelationTargetKey(profile, app);
  const standardField = resolveAuthSourceMatchStandardField(profile, app, correlationTargetKey);
  let upserted = 0;
  let identitiesProcessed = 0;
  const bulkOps = [];

  await forEachAuthSourceIdentityBatch({
    tenantId,
    applicationId: app._id,
    profileId: profile._id,
    onBatch: async (identities) => {
      identitiesProcessed += identities.length;

      const accountByIdentityId = new Map();
      for (const identity of identities) {
        const corrVal = getAuthSourceCorrelationValueFromIdentity(identity, correlationTargetKey);
        if (!corrVal) continue;
        const accountDoc = await findAuthSourceApplicationUser(
          DynamicUserModel,
          app._id,
          standardField,
          corrVal,
          correlationTargetKey,
        );
        if (accountDoc?._id) accountByIdentityId.set(String(identity._id), accountDoc);
      }

      const corrByAccountId = await loadCorrelationEntitlementIdsForAccounts(
        db,
        app.name,
        app._id,
        [...accountByIdentityId.values()].map((a) => a._id),
      );

      for (const identity of identities) {
        const accountDoc = accountByIdentityId.get(String(identity._id));
        if (!accountDoc?._id) continue;

        const syntheticLink = {
          identityId: identity._id,
          accountId: accountDoc._id,
          applicationId: app._id,
          isActive: true,
        };

        appendProjectionRowsForIdentityAccountSync({
          bulkOps,
          tenantId,
          tenantSlug,
          identity,
          application: app,
          link: syntheticLink,
          accountDoc,
          entLookup,
          corrByAccountId,
          syncedAt,
        });
      }

      if (bulkOps.length >= BULK_CHUNK) {
        upserted += await flushBulkUpserts(ProjectionModel, bulkOps.splice(0, bulkOps.length));
      }
    },
  });

  if (bulkOps.length) upserted += await flushBulkUpserts(ProjectionModel, bulkOps);

  if (identitiesProcessed > 0) {
    logInfo("syncAuthSourceForApplication complete", {
      applicationId: String(app._id),
      appName: app.name,
      upserted,
      identitiesProcessed,
      correlationTargetKey,
      standardField,
    });
  }

  return { upserted, identitiesProcessed };
}

/**
 * Rebuild projection rows for all identities linked to an application.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export async function syncAllForApplication(applicationId) {
  const started = Date.now();
  const syncedAt = new Date();
  let upserted = 0;
  let linksProcessed = 0;
  let authIdentitiesProcessed = 0;
  if (isSyncMetricsEnabled()) beginSyncMetrics("syncAllForApplication");

  try {
    const app = await Application.findById(applicationId).lean();
    if (!app) {
      logWarn("syncAllForApplication: application not found", { applicationId: String(applicationId) });
      endSyncMetrics();
      return { upserted: 0, linksProcessed: 0, durationMs: 0 };
    }

    const tenantId = toTenantObjectId(app.tenantId);
    if (!tenantId) {
      logWarn("syncAllForApplication: missing tenantId on application", {
        applicationId: String(applicationId),
        appName: app.name,
      });
      endSyncMetrics();
      return { upserted: 0, linksProcessed: 0, durationMs: 0 };
    }

    const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
    if (!tenantSlug) {
      logWarn("syncAllForApplication: tenant slug unresolved", {
        applicationId: String(applicationId),
        tenantId: String(tenantId),
      });
      endSyncMetrics();
      return { upserted: 0, linksProcessed: 0, durationMs: 0 };
    }

    const ProjectionModel = await getIdentityEntitlementModelForTenantId(tenantId);
    const db = mongoose.connection.db;
    const entColl = db.collection(getAppEntitlementsCollectionName(app.name, tenantSlug));
    // One catalog load per syncAll execution (shared across all link batches + auth-source).
    const entLookup = await buildEntitlementLookupMap(entColl);

    let DynamicUserModel;
    try {
      DynamicUserModel = await getDynamicUserModelForTenantId(app.name, tenantId);
    } catch (e) {
      logError("syncAllForApplication: user model unavailable", e, {
        applicationId: String(applicationId),
      });
      endSyncMetrics();
      return { upserted: 0, linksProcessed: 0, durationMs: Date.now() - started };
    }

    const linkCursor = IdentityAccountLink.find({
      applicationId: app._id,
      isActive: { $ne: false },
    })
      .select("identityId accountId applicationId isActive")
      .lean()
      .cursor({ batchSize: LINK_CURSOR_BATCH });

    let batchLinks = [];
    const bulkOps = [];

    const processLinkBatch = async (links) => {
      if (!links.length) return;
      linksProcessed += links.length;
      const identityMap = await loadIdentityMap(
        tenantId,
        links.map((l) => l.identityId),
      );

      const accountByKey = await loadAccountsForLinks(DynamicUserModel, links, app);
      const accountDocs = [];
      for (const link of links) {
        const doc = accountByKey.get(String(link.accountId ?? "").trim());
        if (doc?._id) accountDocs.push(doc);
      }
      const corrByAccountId = await loadCorrelationEntitlementIdsForAccounts(
        db,
        app.name,
        app._id,
        accountDocs.map((d) => d._id),
      );

      for (const link of links) {
        const identity = identityMap.get(String(link.identityId));
        if (!identity) continue;

        const accountDoc = accountByKey.get(String(link.accountId ?? "").trim());
        if (!accountDoc?._id) continue;

        appendProjectionRowsForIdentityAccountSync({
          bulkOps,
          tenantId,
          tenantSlug,
          identity,
          application: app,
          link,
          accountDoc,
          entLookup,
          corrByAccountId,
          syncedAt,
        });
      }

      if (bulkOps.length >= BULK_CHUNK) {
        upserted += await flushBulkUpserts(ProjectionModel, bulkOps.splice(0, bulkOps.length));
      }
    };

    const authResult = await syncAuthSourceForApplication({
      app,
      tenantId,
      tenantSlug,
      ProjectionModel,
      DynamicUserModel,
      db,
      entColl,
      entLookup,
      syncedAt,
    });
    upserted += authResult.upserted;
    authIdentitiesProcessed += authResult.identitiesProcessed;

    for await (const link of linkCursor) {
      batchLinks.push(link);
      if (batchLinks.length >= LINK_CURSOR_BATCH) {
        await processLinkBatch(batchLinks);
        batchLinks = [];
      }
    }
    if (batchLinks.length) await processLinkBatch(batchLinks);
    if (bulkOps.length) upserted += await flushBulkUpserts(ProjectionModel, bulkOps);

    await removeStaleAssignments(
      ProjectionModel,
      { tenantId, applicationId: app._id },
      syncedAt,
    );

    const durationMs = Date.now() - started;
    logInfo("syncAllForApplication complete", {
      applicationId: String(applicationId),
      appName: app.name,
      upserted,
      linksProcessed,
      authIdentitiesProcessed,
      durationMs,
    });
    endSyncMetrics({ upserted, linksProcessed });
    return { upserted, linksProcessed, authIdentitiesProcessed, durationMs };
  } catch (err) {
    endSyncMetrics({ error: err?.message });
    logError("syncAllForApplication failed", err, { applicationId: String(applicationId) });
    throw err;
  }
}

/**
 * Rebuild projection rows for one identity on one application.
 * @param {import('mongoose').Types.ObjectId|string} identityId
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {{ entLookup?: Map }} [options] optional shared catalog map (same sync execution)
 */
export async function syncForIdentity(identityId, applicationId, options = {}) {
  const started = Date.now();
  const syncedAt = new Date();
  let upserted = 0;
  if (isSyncMetricsEnabled()) beginSyncMetrics("syncForIdentity");

  try {
    if (!mongoose.Types.ObjectId.isValid(String(identityId))) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }
    if (!mongoose.Types.ObjectId.isValid(String(applicationId))) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }

    const app = await Application.findById(applicationId).lean();
    if (!app) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }

    const tenantId = toTenantObjectId(app.tenantId);
    if (!tenantId) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }

    const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
    if (!tenantSlug) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }

    const identityOid = new mongoose.Types.ObjectId(String(identityId));
    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const identity = await Identity.findById(identityOid)
      .select(
        "displayName email department title managerId lifecycleState identityProfileId attributes tenantId sourceApplication employeeId",
      )
      .lean();
    if (!identity) {
      endSyncMetrics();
      return { upserted: 0, durationMs: 0 };
    }

    const ProjectionModel = await getIdentityEntitlementModelForTenantId(tenantId);
    const db = mongoose.connection.db;
    const entColl = db.collection(getAppEntitlementsCollectionName(app.name, tenantSlug));
    const entLookup =
      options.entLookup instanceof Map
        ? options.entLookup
        : await buildEntitlementLookupMap(entColl);
    const DynamicUserModel = await getDynamicUserModelForTenantId(app.name, tenantId);

    const links = await IdentityAccountLink.find({
      identityId: identityOid,
      applicationId: app._id,
      isActive: { $ne: false },
    })
      .select("identityId accountId applicationId")
      .lean();

    if (!links.length) {
      // Auth-source: sync ONLY this identity (never the entire application).
      const authResult = await syncAuthSourceForIdentity({
        identity,
        app,
        tenantId,
        tenantSlug,
        ProjectionModel,
        DynamicUserModel,
        db,
        entLookup,
        syncedAt,
      });
      upserted = authResult.upserted;
      await removeStaleAssignments(
        ProjectionModel,
        { tenantId, identityId: identityOid, applicationId: app._id },
        syncedAt,
      );
      const durationMs = Date.now() - started;
      if (authResult.identitiesProcessed > 0) {
        logInfo("syncForIdentity complete", {
          identityId: String(identityId),
          applicationId: String(applicationId),
          upserted,
          durationMs,
          authSource: true,
        });
      }
      endSyncMetrics({ upserted });
      return { upserted, durationMs };
    }

    const accountByKey = await loadAccountsForLinks(DynamicUserModel, links, app);
    const accountDocs = [];
    for (const link of links) {
      const doc = accountByKey.get(String(link.accountId ?? "").trim());
      if (doc?._id) accountDocs.push(doc);
    }
    const corrByAccountId = await loadCorrelationEntitlementIdsForAccounts(
      db,
      app.name,
      app._id,
      accountDocs.map((d) => d._id),
    );

    const bulkOps = [];
    for (const link of links) {
      const accountDoc = accountByKey.get(String(link.accountId ?? "").trim());
      if (!accountDoc?._id) continue;

      appendProjectionRowsForIdentityAccountSync({
        bulkOps,
        tenantId,
        tenantSlug,
        identity,
        application: app,
        link,
        accountDoc,
        entLookup,
        corrByAccountId,
        syncedAt,
      });
    }

    upserted = await flushBulkUpserts(ProjectionModel, bulkOps);
    await removeStaleAssignments(
      ProjectionModel,
      { tenantId, identityId: identityOid, applicationId: app._id },
      syncedAt,
    );

    const durationMs = Date.now() - started;
    logInfo("syncForIdentity complete", {
      identityId: String(identityId),
      applicationId: String(applicationId),
      upserted,
      durationMs,
    });
    endSyncMetrics({ upserted });
    return { upserted, durationMs };
  } catch (err) {
    endSyncMetrics({ error: err?.message });
    logError("syncForIdentity failed", err, {
      identityId: String(identityId),
      applicationId: String(applicationId),
    });
    throw err;
  }
}

/**
 * Sync many identities for one application sharing a single entitlement catalog load.
 * Used when callers intentionally sync a subset (not after syncAllForApplication).
 */
export async function syncForIdentities(identityIds, applicationId) {
  const uniq = [...new Set([...identityIds].map(String))].filter((id) =>
    mongoose.Types.ObjectId.isValid(id),
  );
  if (!uniq.length || applicationId == null) {
    return { upserted: 0, identitiesProcessed: 0, durationMs: 0 };
  }

  const started = Date.now();
  const app = await Application.findById(applicationId).lean();
  if (!app) return { upserted: 0, identitiesProcessed: 0, durationMs: 0 };
  const tenantId = toTenantObjectId(app.tenantId);
  if (!tenantId) return { upserted: 0, identitiesProcessed: 0, durationMs: 0 };
  const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
  if (!tenantSlug) return { upserted: 0, identitiesProcessed: 0, durationMs: 0 };

  const db = mongoose.connection.db;
  const entColl = db.collection(getAppEntitlementsCollectionName(app.name, tenantSlug));
  const entLookup = await buildEntitlementLookupMap(entColl);

  let upserted = 0;
  for (const identityId of uniq) {
    try {
      const r = await syncForIdentity(identityId, applicationId, { entLookup });
      upserted += r.upserted || 0;
    } catch (err) {
      logError("syncForIdentities item failed", err, { identityId, applicationId: String(applicationId) });
    }
  }
  return {
    upserted,
    identitiesProcessed: uniq.length,
    durationMs: Date.now() - started,
  };
}
