import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../models/identity/Identity.js';

/**
 * Recalculates totalAccounts, totalEntitlements, and totalPrivilegedEntitlements.
 * Uses the same access inventory as Identity Posture so peer/ranking scores stay aligned.
 *
 * @param {import('mongoose').Types.ObjectId|string} identityId
 * @param {{ applications?: object[] }} [options] Reserved for batch callers (unused).
 */
export const syncIdentityStats = async (identityId, options = {}) => {
  void options;
  try {
    const LegacyIdentity = getLegacyIdentityModel();
    const legacyIdentity = await LegacyIdentity.findById(identityId).lean();
    if (!legacyIdentity?.tenantId) return;

    const Identity = await getDynamicIdentityModelForTenantId(legacyIdentity.tenantId);
    const identity = await Identity.findById(identityId).select('_id').lean();
    if (!identity) return;

    const tenantId = legacyIdentity.tenantId;
    // Dynamic import avoids circular deps with posture ↔ account-link controllers.
    const { loadAccessInventoryByApplication } = await import(
      '../services/identity/posture/identityPostureDashboard.js'
    );
    const inventory = await loadAccessInventoryByApplication(identityId, tenantId);
    const accountCount = inventory.totals.totalAccounts || 0;
    const entitlementCount = inventory.totals.totalEntitlements || 0;
    const privilegedEntitlementCount = inventory.totals.privilegedEntitlementCount || 0;

    const update = {
      $set: {
        totalAccounts: accountCount,
        totalEntitlements: entitlementCount,
        totalPrivilegedEntitlements: privilegedEntitlementCount,
      },
    };

    await Promise.all([
      Identity.findByIdAndUpdate(identityId, update),
      LegacyIdentity.findByIdAndUpdate(identityId, update),
    ]);

    return {
      accountCount,
      entitlementCount,
      privilegedEntitlementCount,
    };
  } catch (error) {
    console.error(`Failed to sync stats for Identity ${identityId}:`, error);
  }
};
