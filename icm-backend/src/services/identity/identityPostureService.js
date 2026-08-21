import mongoose from 'mongoose';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import { syncIdentityStats } from '../../utils/syncIdentityStats.js';
import {
  buildConflictStrings,
  computeOverallRanking,
  computePeerComparison,
  computePostureFromInputs,
  getMetricLabel,
  highestSeverity,
  loadAccessInventoryByApplication,
  loadOpenSodViolations,
  loadTenantOpenSodViolations,
  resolveAccessHygieneTierLabel,
  resolveDisplayName,
  resolveIdentityDepartmentForDisplay,
  resolveIdentityTitle,
  resolveManagerName,
  resolveSodViolationTierLabel,
} from './posture/identityPostureDashboard.js';
import { resolvePostureRules } from './posture/postureRuleResolver.js';

async function resolveTenantIdForIdentity(identityId, scopedTenantId) {
  if (scopedTenantId && mongoose.Types.ObjectId.isValid(String(scopedTenantId))) {
    return scopedTenantId;
  }
  const LegacyIdentity = getLegacyIdentityModel();
  const stub = await LegacyIdentity.findById(identityId).select('tenantId').lean();
  return stub?.tenantId || null;
}

async function loadIdentityFromTenantCollection(identityId, tenantId) {
  const IdentityModel = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await IdentityModel.findById(identityId)
    .populate('managerId', 'displayName firstName lastName email')
    .lean();
  return { identity, IdentityModel };
}

async function cachePrivilegedEntitlementCount(identityId, tenantId, count) {
  const privilegedEntitlementCount = Math.max(0, Number(count) || 0);
  const update = { $set: { totalPrivilegedEntitlements: privilegedEntitlementCount } };
  try {
    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const LegacyIdentity = getLegacyIdentityModel();
    await Promise.all([
      Identity.findByIdAndUpdate(identityId, update),
      LegacyIdentity.findByIdAndUpdate(identityId, update),
    ]);
  } catch {
    /* non-fatal cache for peer ranking */
  }
  return privilegedEntitlementCount;
}

async function computeFullPosture(identityId, identity, rules) {
  // Stats sync is useful for peer ranking caches but does not feed accessInventory.
  // Do not block posture on it — refresh in the background for the next request.
  void syncIdentityStats(identityId).catch((err) => {
    console.warn('[computeFullPosture] syncIdentityStats', err?.message || err);
  });

  const [accessInventory, violations] = await Promise.all([
    loadAccessInventoryByApplication(identityId, identity.tenantId),
    loadOpenSodViolations(identityId, identity, identity.tenantId),
  ]);

  await cachePrivilegedEntitlementCount(
    identityId,
    identity.tenantId,
    accessInventory.totals.privilegedEntitlementCount,
  );

  const posture = computePostureFromInputs(
    identity,
    accessInventory.totals.totalAccounts,
    accessInventory.totals.totalEntitlements,
    violations.length,
    accessInventory.totals.privilegedEntitlementCount,
    rules,
  );

  return {
    ...posture,
    violations,
    accessInventory,
  };
}

/**
 * Build full identity posture payload for one identity.
 * Identity document is always loaded from app_{tenantSlug}_identities only.
 */
export async function buildIdentityPosture(identityId, scopedTenantId) {
  if (!mongoose.Types.ObjectId.isValid(String(identityId))) {
    const err = new Error('Invalid identity ID');
    err.statusCode = 400;
    throw err;
  }

  const tenantId = await resolveTenantIdForIdentity(identityId, scopedTenantId);
  if (!tenantId) {
    const err = new Error('Identity not found');
    err.statusCode = 404;
    throw err;
  }

  const { identity, IdentityModel } = await loadIdentityFromTenantCollection(identityId, tenantId);
  if (!identity) {
    const err = new Error('Identity not found');
    err.statusCode = 404;
    throw err;
  }

  const tenantSodPromise = loadTenantOpenSodViolations(tenantId);
  const { rules, source: ruleSetSource } = await resolvePostureRules(tenantId);
  const posture = await computeFullPosture(identityId, identity, rules);
  const sodTier = resolveSodViolationTierLabel(posture.sodViolationCount, rules);
  const accessTier = resolveAccessHygieneTierLabel(posture.privilegedEntitlementCount, rules);
  const tenantSodViolations = await tenantSodPromise;

  const [peerComparison, overallRanking] = await Promise.all([
    computePeerComparison(identityId, identity, posture, tenantId, IdentityModel, rules, tenantSodViolations),
    computeOverallRanking(identityId, posture.finalPosture, tenantId, IdentityModel, rules, tenantSodViolations),
  ]);

  return {
    meta: {
      ruleSetSource,
      tenantId: String(tenantId),
    },
    profile: {
      id: String(identity._id),
      profilePhotoUrl: identity.profilePhotoId
        ? `/api/identities/${identity._id}/profile-photo/image`
        : null,
      displayName: resolveDisplayName(identity),
      email: identity.email || '—',
      employeeId: identity.employeeId || '—',
      title: resolveIdentityTitle(identity) || '—',
      department: resolveIdentityDepartmentForDisplay(identity),
      identityType: identity.identityType || 'employee',
      manager: resolveManagerName(identity),
      managerEmail: identity.managerEmail || '—',
      lifecycleState: identity.lifecycleState || 'ACTIVE',
      maturityLevel: posture.maturityLevel,
      attributeChecks: posture.attributeChecks,
    },
    healthAnalysis: {
      identityHygiene: Math.round(posture.identityHygiene),
      accessHygiene: Math.round(posture.accessHygiene),
      sodRisk: Math.round(posture.sodRisk),
      complexity: Math.round(posture.complexity),
      finalPosture: Math.round(posture.finalPosture),
      labels: {
        identityHygiene: getMetricLabel('identityHygiene', posture.identityHygiene, rules),
        accessHygiene: accessTier.label,
        sodRisk: sodTier.label,
        complexity: getMetricLabel('complexity', posture.complexity, rules),
        finalPosture: getMetricLabel('finalPosture', posture.finalPosture, rules),
      },
    },
    sodAnalysis: {
      violationCount: posture.violations.length,
      severity: highestSeverity(posture.violations),
      riskTier: sodTier.label,
      riskTierKey: sodTier.key,
      riskScore: Math.round(posture.sodRisk),
      status: sodTier.key === 'safe' ? 'SAFE' : 'RISKY',
      conflicts: buildConflictStrings(posture.violations),
    },
    peerComparison,
    overallRanking,
    accessDetails: {
      byApplication: posture.accessInventory.byApplication || [],
      linkedAccounts: posture.accessInventory.linkedAccounts || [],
      totalAccounts: posture.accessInventory.totals.totalAccounts,
      totalEntitlements: posture.accessInventory.totals.totalEntitlements,
      privilegedEntitlementCount: posture.accessInventory.totals.privilegedEntitlementCount,
      privilegedCount: posture.accessInventory.totals.privilegedEntitlementCount,
    },
  };
}
