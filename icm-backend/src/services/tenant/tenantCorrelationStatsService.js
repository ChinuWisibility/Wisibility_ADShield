import mongoose from "mongoose";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import TenantCorrelationStats from "../../models/identity/TenantCorrelationStats.js";
import Account from "../../models/access/Account.js";

function toOid(tenantId) {
  const s = String(tenantId);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/** All identity-backed links (governance may set isOrphan on correlated links). */
const LINK_BASE_MATCH = {
  isActive: true,
  identityId: { $exists: true, $ne: null },
};

/**
 * Tenant-scoped stages. Prefer denormalized tenantId (fast). Fall back to identity join
 * when this tenant has no tenantId-stamped links yet.
 */
async function tenantCorrelatedLinksBaseStages(tid) {
  const scoped = await IdentityAccountLink.countDocuments({
    ...LINK_BASE_MATCH,
    tenantId: tid,
  });
  if (scoped > 0) {
    return [{ $match: { ...LINK_BASE_MATCH, tenantId: tid } }];
  }
  return [
    { $match: LINK_BASE_MATCH },
    {
      $lookup: {
        from: "identities",
        localField: "identityId",
        foreignField: "_id",
        as: "identityArr",
      },
    },
    { $unwind: { path: "$identityArr", preserveNullAndEmptyArrays: false } },
    { $match: { "identityArr.tenantId": tid } },
  ];
}

async function countCorrelatedLinksForTenant(tid) {
  const scoped = await IdentityAccountLink.countDocuments({
    ...LINK_BASE_MATCH,
    tenantId: tid,
  });
  if (scoped > 0) return scoped;

  const agg = await IdentityAccountLink.aggregate([
    ...(await tenantCorrelatedLinksBaseStages(tid)),
    { $count: "total" },
  ]);
  return agg[0]?.total ?? 0;
}

async function countDistinctTargetAppsForTenant(tid) {
  const stages = await tenantCorrelatedLinksBaseStages(tid);
  const agg = await IdentityAccountLink.aggregate([
    ...stages,
    { $group: { _id: "$applicationId" } },
    { $count: "total" },
  ]);
  return agg[0]?.total ?? 0;
}

/**
 * Live rollups when tenant_correlation_stats cache is cold.
 */
export async function getLiveTenantCorrelationRollups(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return null;

  const stages = await tenantCorrelatedLinksBaseStages(tid);
  const [facetRow, totalWarehouseAccountsCount] = await Promise.all([
    IdentityAccountLink.aggregate([
      ...stages,
      {
        $facet: {
          totalCount: [{ $count: "total" }],
          distinctApps: [{ $group: { _id: "$applicationId" } }, { $count: "total" }],
          lastActivity: [{ $group: { _id: null, maxAt: { $max: "$updatedAt" } } }],
        },
      },
    ]).option({ allowDiskUse: true }),
    Account.countDocuments({ tenantId: tid }),
  ]);

  const fr = facetRow[0] || {};
  return {
    correlatedLinksCount: fr.totalCount?.[0]?.total ?? 0,
    distinctTargetApplicationsCount: fr.distinctApps?.[0]?.total ?? 0,
    lastActivityAt: fr.lastActivity?.[0]?.maxAt ?? null,
    totalWarehouseAccountsCount,
  };
}

/**
 * Recompute and upsert cached stats for dashboard cards.
 */
export async function recomputeTenantCorrelationStats(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return;

  try {
    const [
      correlatedLinksCount,
      orphansOpenCount,
      orphansHighRiskCount,
      distinctTargetApplicationsCount,
      totalWarehouseAccountsCount,
    ] = await Promise.all([
      countCorrelatedLinksForTenant(tid),
      OrphanAccount.countDocuments({ tenantId: tid, status: "OPEN" }),
      OrphanAccount.countDocuments({
        tenantId: tid,
        status: "OPEN",
        riskLevel: { $in: ["HIGH", "CRITICAL"] },
      }),
      countDistinctTargetAppsForTenant(tid),
      Account.countDocuments({ tenantId: tid }),
    ]);

    const now = new Date();
    await TenantCorrelationStats.findOneAndUpdate(
      { tenantId: tid },
      {
        $set: {
          correlatedLinksCount,
          orphansOpenCount,
          orphansHighRiskCount,
          distinctTargetApplicationsCount,
          totalWarehouseAccountsCount,
          lastCorrelationRunAt: now,
        },
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    console.error("[tenantCorrelationStats] recompute failed", err?.message || err);
  }
}

export async function getCachedTenantCorrelationStats(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return null;
  return TenantCorrelationStats.findOne({ tenantId: tid }).lean();
}
