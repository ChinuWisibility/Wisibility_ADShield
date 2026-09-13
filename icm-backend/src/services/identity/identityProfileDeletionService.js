import mongoose from "mongoose";
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from "../../models/identity/Identity.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import CorrelationResult from "../../models/correlation/CorrelationResult.js";
import RoleAssignment from "../../models/access/RoleAssignment.js";
import EntitlementHygieneFinding from "../../models/dataHygiene/EntitlementHygieneFinding.js";
import ManagerHierarchy from "../../models/identity/ManagerHierarchy.js";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import IdentitySnapshot from "../../models/identity/IdentitySnapshot.js";
import AccessRecommendation from "../../models/accessIntelligence/AccessRecommendation.js";
import AccessOutlier from "../../models/accessIntelligence/AccessOutlier.js";
import RiskTrendSnapshot from "../../models/accessIntelligence/RiskTrendSnapshot.js";
import { recomputeIdentityTenantStats, toTenantObjectId } from "./identityTenantStatsService.js";
import { resolveTenantIdForLock } from "../tenant/tenantMaterializationLockService.js";

function profileOid(profileId) {
  if (!mongoose.Types.ObjectId.isValid(String(profileId))) return null;
  return new mongoose.Types.ObjectId(String(profileId));
}

/** Identities authored from this profile (by ref or legacy name string). */
export function identityMatchFilterForProfile(profile) {
  const pid = profile._id;
  const name = String(profile.name || "").trim();
  const parts = [{ identityProfileId: pid }];
  if (name) parts.push({ identityProfile: name });
  return { tenantId: profile.tenantId, $or: parts };
}

async function countByIdentityIds(Model, identityIds, label) {
  if (!identityIds?.length) return 0;
  try {
    return await Model.countDocuments({ identityId: { $in: identityIds } });
  } catch (e) {
    console.warn(`[identity-profile-deletion] count ${label}:`, e?.message || e);
    return 0;
  }
}

async function deleteByIdentityIds(Model, identityIds, label) {
  if (!identityIds?.length) return 0;
  try {
    const r = await Model.deleteMany({ identityId: { $in: identityIds } });
    return r.deletedCount ?? 0;
  } catch (e) {
    console.warn(`[identity-profile-deletion] delete ${label}:`, e?.message || e);
    return 0;
  }
}

/**
 * @param {string|mongoose.Types.ObjectId} profileId
 * @returns {Promise<object|null>}
 */
export async function computeIdentityProfileDeletionImpact(profileId) {
  const oid = profileOid(profileId);
  if (!oid) return null;

  const profile = await IdentityProfile.findById(oid).lean();
  if (!profile) return null;
  const Identity = await getDynamicIdentityModelForTenantId(profile.tenantId);

  const identities = await Identity.find(identityMatchFilterForProfile(profile)).select("_id isCorrelated").lean();
  const identityIds = identities.map((i) => i._id);

  const identityFlags = {
    total: identities.length,
    markedCorrelated: identities.filter((i) => i.isCorrelated === true).length,
    markedNotCorrelated: identities.filter((i) => i.isCorrelated !== true).length,
  };

  let accountLinks = { total: 0, correlated: 0, uncorrelated: 0, ambiguous: 0, active: 0, inactive: 0 };
  if (identityIds.length) {
    const rows = await IdentityAccountLink.aggregate([
      { $match: { identityId: { $in: identityIds } } },
      {
        $facet: {
          byStatus: [{ $group: { _id: "$correlationStatus", c: { $sum: 1 } } }],
          byActive: [{ $group: { _id: "$isActive", c: { $sum: 1 } } }],
          total: [{ $count: "c" }],
        },
      },
    ]);
    const facet = rows[0] || {};
    accountLinks.total = facet.total?.[0]?.c ?? 0;
    for (const row of facet.byStatus || []) {
      const k = String(row._id || "").toLowerCase();
      if (k === "correlated") accountLinks.correlated = row.c;
      else if (k === "uncorrelated") accountLinks.uncorrelated = row.c;
      else if (k === "ambiguous") accountLinks.ambiguous = row.c;
    }
    for (const row of facet.byActive || []) {
      if (row._id === true) accountLinks.active = row.c;
      else accountLinks.inactive = row.c;
    }
  }

  const correlationResults = await countByIdentityIds(CorrelationResult, identityIds, "CorrelationResult");
  const roleAssignments = await countByIdentityIds(RoleAssignment, identityIds, "RoleAssignment");
  const entitlementHygieneFindings = await countByIdentityIds(
    EntitlementHygieneFinding,
    identityIds,
    "EntitlementHygieneFinding",
  );
  const managerHierarchyRows = await countByIdentityIds(ManagerHierarchy, identityIds, "ManagerHierarchy");
  const lifecycleEvents = await countByIdentityIds(LifecycleEvent, identityIds, "LifecycleEvent");
  const identitySnapshots = await countByIdentityIds(IdentitySnapshot, identityIds, "IdentitySnapshot");
  const accessRecommendations = await countByIdentityIds(AccessRecommendation, identityIds, "AccessRecommendation");
  const accessOutliers = await countByIdentityIds(AccessOutlier, identityIds, "AccessOutlier");
  const riskTrendSnapshots = await countByIdentityIds(RiskTrendSnapshot, identityIds, "RiskTrendSnapshot");

  let dependentManagerLinks = 0;
  if (identityIds.length) {
    dependentManagerLinks = await Identity.countDocuments({
      tenantId: profile.tenantId,
      managerId: { $in: identityIds },
    });
  }

  const tree = [
    {
      id: "root",
      label: profile.name,
      children: [
        {
          id: "identities",
          label: `Identities (${identityFlags.total})`,
          detail:
            identityFlags.total > 0
              ? `${identityFlags.markedCorrelated} flagged correlated · ${identityFlags.markedNotCorrelated} not flagged`
              : "None linked to this profile",
          children: [],
        },
        {
          id: "accounts",
          label: `Account links — entitlement / app correlation (${accountLinks.total})`,
          detail: `correlated ${accountLinks.correlated} · uncorrelated ${accountLinks.uncorrelated} · ambiguous ${accountLinks.ambiguous} · active ${accountLinks.active} / inactive ${accountLinks.inactive}`,
          children: [],
        },
        {
          id: "correlationEngine",
          label: `Correlation engine results (${correlationResults})`,
          detail: "Application ↔ identity correlation rows stored for these identities",
          children: [],
        },
        {
          id: "roles",
          label: `Role assignments (${roleAssignments})`,
          detail: "Access roles bound to these identities",
          children: [],
        },
        {
          id: "hygiene",
          label: `Entitlement hygiene & intelligence (${entitlementHygieneFindings + accessRecommendations + accessOutliers + riskTrendSnapshots})`,
          detail: `Hygiene findings ${entitlementHygieneFindings} · recommendations ${accessRecommendations} · outliers ${accessOutliers} · risk snapshots ${riskTrendSnapshots}`,
          children: [],
        },
        {
          id: "lifecycle",
          label: `Lifecycle / hierarchy / snapshots (${lifecycleEvents + managerHierarchyRows + identitySnapshots})`,
          detail: `Events ${lifecycleEvents} · manager-hierarchy rows ${managerHierarchyRows} · snapshots ${identitySnapshots}`,
          children: [],
        },
        {
          id: "managers",
          label: `Other identities with manager = one of these (${dependentManagerLinks})`,
          detail:
            dependentManagerLinks > 0
              ? "Manager references will be cleared before identities are removed"
              : "No dependent manager links",
          children: [],
        },
      ],
    },
  ];

  return {
    profile: { _id: String(profile._id), name: profile.name, tenantId: String(profile.tenantId) },
    identities: identityFlags,
    accountLinks,
    correlationResults,
    roleAssignments,
    entitlementHygieneFindings,
    managerHierarchyRows,
    lifecycleEvents,
    identitySnapshots,
    accessRecommendations,
    accessOutliers,
    riskTrendSnapshots,
    dependentManagerLinks,
    tree,
  };
}

/**
 * @param {import('express').Request} req
 * @param {{ confirmDeletion?: boolean, deleteLinkedIdentities?: boolean }} options
 */
export async function executeIdentityProfileDeletion(profileId, req, options = {}) {
  const oid = profileOid(profileId);
  if (!oid) return { ok: false, status: 400, message: "Invalid profile id" };

  const profile = await IdentityProfile.findById(oid).lean();
  if (!profile) return { ok: false, status: 404, message: "Identity Profile not found" };
  const Identity = await getDynamicIdentityModelForTenantId(profile.tenantId);
  const LegacyIdentity = getLegacyIdentityModel();

  try {
    resolveTenantIdForLock(req, profile.tenantId);
  } catch (e) {
    return { ok: false, status: e.statusCode || 403, message: e.message };
  }

  const identities = await Identity.find(identityMatchFilterForProfile(profile)).select("_id").lean();
  const identityIds = identities.map((i) => i._id);
  const impactSummary = {
    identities: identityIds.length,
    accountLinks: await IdentityAccountLink.countDocuments({ identityId: { $in: identityIds } }),
  };

  if (identityIds.length > 0) {
    if (!options.confirmDeletion || !options.deleteLinkedIdentities) {
      const impact = await computeIdentityProfileDeletionImpact(profileId);
      return {
        ok: false,
        status: 400,
        code: "DELETION_REQUIRES_CONFIRM",
        message:
          "This profile has linked identities and correlation data. Confirm deletion with deleteLinkedIdentities and confirmDeletion, or fetch GET …/deletion-impact first.",
        impact,
      };
    }

    const managerResetFilter = { tenantId: profile.tenantId, managerId: { $in: identityIds } };
    const managerResetUpdate = {
      $set: {
        managerId: null,
        managerResolutionStatus: "unresolved",
        managerKeyRaw: null,
      },
    };
    await Promise.all([
      Identity.updateMany(managerResetFilter, managerResetUpdate),
      LegacyIdentity.updateMany(managerResetFilter, managerResetUpdate),
    ]);

    const removed = {
      identityAccountLinks: await deleteByIdentityIds(IdentityAccountLink, identityIds, "IdentityAccountLink"),
      correlationResults: await deleteByIdentityIds(CorrelationResult, identityIds, "CorrelationResult"),
      roleAssignments: await deleteByIdentityIds(RoleAssignment, identityIds, "RoleAssignment"),
      entitlementHygieneFindings: await deleteByIdentityIds(
        EntitlementHygieneFinding,
        identityIds,
        "EntitlementHygieneFinding",
      ),
      managerHierarchy: await deleteByIdentityIds(ManagerHierarchy, identityIds, "ManagerHierarchy"),
      lifecycleEvents: await deleteByIdentityIds(LifecycleEvent, identityIds, "LifecycleEvent"),
      identitySnapshots: await deleteByIdentityIds(IdentitySnapshot, identityIds, "IdentitySnapshot"),
      accessRecommendations: await deleteByIdentityIds(AccessRecommendation, identityIds, "AccessRecommendation"),
      accessOutliers: await deleteByIdentityIds(AccessOutlier, identityIds, "AccessOutlier"),
      riskTrendSnapshots: await deleteByIdentityIds(RiskTrendSnapshot, identityIds, "RiskTrendSnapshot"),
    };

    const deleteFilter = { _id: { $in: identityIds } };
    const [delIdent] = await Promise.all([
      Identity.deleteMany(deleteFilter),
      LegacyIdentity.deleteMany(deleteFilter),
    ]);
    removed.identities = delIdent.deletedCount ?? 0;

    await IdentityProfile.findByIdAndDelete(oid);
    const tid = toTenantObjectId(profile.tenantId);
    if (tid) {
      void recomputeIdentityTenantStats(tid).catch((err) =>
        console.error("[identity-profile-deletion] tenant stats recompute failed", err?.message || err),
      );
    }

    return {
      ok: true,
      status: 200,
      message: "Identity profile and linked identities were removed.",
      data: { removed, impactSummary },
    };
  }

  await IdentityProfile.findByIdAndDelete(oid);
  const tid = toTenantObjectId(profile.tenantId);
  if (tid) {
    void recomputeIdentityTenantStats(tid).catch((err) =>
      console.error("[identity-profile-deletion] tenant stats recompute failed", err?.message || err),
    );
  }

  return {
    ok: true,
    status: 200,
    message: "Identity profile deleted (no linked identities).",
    data: { removed: {}, impactSummary },
  };
}
