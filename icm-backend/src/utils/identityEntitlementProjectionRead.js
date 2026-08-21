import mongoose from "mongoose";
import {
  getIdentityEntitlementModelForTenantId,
} from "../models/identityEntitlementModel.js";
import {
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from "./applicationDynamicCollections.js";

/**
 * Same response shape as fetchCorrelatedEntitlementsForAccount.
 * @returns {Promise<{ entitlementId: string, entitlementName: string, displayName: string }[]|null>}
 *   null → projection not populated; caller should use legacy join path.
 */
export async function tryProjectedCorrelatedEntitlements(
  identityId,
  applicationId,
  accountId,
  tenantId,
) {
  const tid = toTenantObjectId(tenantId);
  if (!tid || !mongoose.Types.ObjectId.isValid(String(identityId))) return null;
  if (!mongoose.Types.ObjectId.isValid(String(applicationId))) return null;
  if (!mongoose.Types.ObjectId.isValid(String(accountId))) return null;

  const tenantHasProjection = await tenantProjectionLayerActive(tid);
  if (!tenantHasProjection) return null;

  const ProjectionModel = await getIdentityEntitlementModelForTenantId(tid);
  const rows = await ProjectionModel.find({
    tenantId: tid,
    identityId: new mongoose.Types.ObjectId(String(identityId)),
    applicationId: new mongoose.Types.ObjectId(String(applicationId)),
    accountId: new mongoose.Types.ObjectId(String(accountId)),
  })
    .select("entitlementId entitlementDisplayName entitlementValue")
    .lean();

  return rows.map((r) => {
    const label = r.entitlementDisplayName || r.entitlementValue || String(r.entitlementId);
    return {
      entitlementId: String(r.entitlementId),
      entitlementName: label,
      displayName: label,
    };
  });
}

/**
 * Load all projected entitlements for an identity grouped by account key.
 * @returns {Promise<Map<string, object[]>|null>} null when projection inactive for tenant.
 */
export async function loadProjectedEntitlementsByAccountForIdentity(identityId, tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid || !mongoose.Types.ObjectId.isValid(String(identityId))) return null;

  const tenantHasProjection = await tenantProjectionLayerActive(tid);
  if (!tenantHasProjection) return null;

  const identityOid = new mongoose.Types.ObjectId(String(identityId));
  const ProjectionModel = await getIdentityEntitlementModelForTenantId(tid);
  const rows = await ProjectionModel.find({
    tenantId: tid,
    identityId: identityOid,
  })
    .select("applicationId accountId entitlementId entitlementDisplayName entitlementValue")
    .lean();

  const byAccount = new Map();
  for (const r of rows) {
    const key = `${String(r.applicationId)}:${String(r.accountId)}`;
    if (!byAccount.has(key)) byAccount.set(key, []);
    const label = r.entitlementDisplayName || r.entitlementValue || String(r.entitlementId);
    byAccount.get(key).push({
      entitlementId: String(r.entitlementId),
      entitlementName: label,
      displayName: label,
    });
  }
  return byAccount;
}

/**
 * @returns {Promise<{ accountCount: number, entitlementCount: number }|null>}
 */
export async function countIdentityStatsFromProjection(identityId, tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid || !mongoose.Types.ObjectId.isValid(String(identityId))) return null;

  const tenantHasProjection = await tenantProjectionLayerActive(tid);
  if (!tenantHasProjection) return null;

  const identityOid = new mongoose.Types.ObjectId(String(identityId));
  const ProjectionModel = await getIdentityEntitlementModelForTenantId(tid);

  const entitlementCount = await ProjectionModel.countDocuments({
    tenantId: tid,
    identityId: identityOid,
  });

  const accountAgg = await ProjectionModel.aggregate([
    { $match: { tenantId: tid, identityId: identityOid } },
    {
      $group: {
        _id: { applicationId: "$applicationId", accountId: "$accountId" },
      },
    },
    { $count: "n" },
  ]);

  return {
    accountCount: accountAgg[0]?.n ?? 0,
    entitlementCount,
  };
}

/** @type {Map<string, { active: boolean, checkedAt: number }>} */
const tenantProjectionActiveCache = new Map();
const CACHE_TTL_MS = 60_000;

async function tenantProjectionLayerActive(tenantId) {
  const key = String(tenantId);
  const cached = tenantProjectionActiveCache.get(key);
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return cached.active;
  }
  try {
    const ProjectionModel = await getIdentityEntitlementModelForTenantId(tenantId);
    const hit = await ProjectionModel.findOne({ tenantId }).select("_id").lean();
    const active = Boolean(hit);
    tenantProjectionActiveCache.set(key, { active, checkedAt: Date.now() });
    return active;
  } catch {
    tenantProjectionActiveCache.set(key, { active: false, checkedAt: Date.now() });
    return false;
  }
}

export function clearProjectionReadCache() {
  tenantProjectionActiveCache.clear();
}

export async function resolveTenantSlugForProjection(tenantId) {
  return resolveTenantSlugFromTenantId(tenantId);
}

/**
 * Projection-first entitlement read; falls back to legacy join when tenant cube is empty.
 * @param {() => Promise<object[]>} legacyFetch
 */
export async function fetchCorrelatedEntitlementsWithProjectionFallback({
  identityId,
  applicationId,
  accountId,
  tenantId,
  legacyFetch,
}) {
  const projected = await tryProjectedCorrelatedEntitlements(
    identityId,
    applicationId,
    accountId,
    tenantId,
  );
  if (projected !== null) return projected;
  return legacyFetch();
}
