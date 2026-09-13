import mongoose from "mongoose";
import { resolveTenantSlugFromTenantId } from "../../utils/applicationDynamicCollections.js";
import {
  appNameToCorrelationSlug,
  applyIncrementalAdMembershipCorrelation,
  rebuildCorrelationEntitlementStats,
  runAdMembershipAccountEntitlementCorrelation,
} from "../../utils/accountEntitlementCorrelation.js";

/** Primary AD connector or AD-derived child app — membership correlation is automatic. */
export function isAdAutoAccountEntitlementCorrelationApp(app) {
  if (!app) return false;
  const sourceId = app.sourceApplicationId?._id || app.sourceApplicationId;
  if (sourceId && app.connectionConfig?.derivedAd) return true;
  return (
    app.connectorType === "ACTIVE_DIRECTORY" || Boolean(app.connectionConfig?.ad)
  );
}

async function resolveCorrelationContext(application) {
  const appName = appNameToCorrelationSlug(application.name);
  const db = mongoose.connection.db;
  const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
  if (!tenantSlug) {
    throw new Error(
      "Could not resolve tenant slug for dynamic user/entitlement collections.",
    );
  }
  return { appName, db, tenantSlug };
}

/**
 * Rebuild account ↔ entitlement correlation from AD group DNs (legacy full rebuild).
 * @param {import('../../models/application/Application.js').default | object} application
 */
export async function rebuildAdConnectorAccountEntitlementCorrelation(application) {
  const { appName, db, tenantSlug } = await resolveCorrelationContext(application);

  const { clearApplicationAccountEntitlementCorrelation } = await import(
    "../../utils/accountEntitlementCorrelation.js"
  );

  await clearApplicationAccountEntitlementCorrelation(
    db,
    appName,
    application._id,
  );

  const stats = await runAdMembershipAccountEntitlementCorrelation(db, {
    appName,
    applicationDisplayName: application.name,
    applicationId: application._id,
    tenantId: application.tenantId,
    tenantSlug,
  });

  await rebuildCorrelationEntitlementStats(db, appName, application._id);

  return stats;
}

/**
 * Incremental AD membership correlation (preferred during sync).
 * @param {object} application
 * @param {{
 *   userDocs: object[],
 *   membershipChangedUserIds?: object[],
 *   removedUserIds?: object[],
 *   deferStats?: boolean,
 *   forceFullRebuild?: boolean,
 * }} options
 */
export async function incrementalAdConnectorAccountEntitlementCorrelation(
  application,
  options = {},
) {
  const {
    userDocs = [],
    membershipChangedUserIds = [],
    removedUserIds = [],
    deferStats = true,
    forceFullRebuild = false,
  } = options;

  if (forceFullRebuild) {
    return rebuildAdConnectorAccountEntitlementCorrelation(application);
  }

  const { appName, db, tenantSlug } = await resolveCorrelationContext(application);

  const stats = await applyIncrementalAdMembershipCorrelation(db, {
    appName,
    applicationDisplayName: application.name,
    applicationId: application._id,
    tenantId: application.tenantId,
    tenantSlug,
    userDocs,
    membershipChangedUserIds,
    removedUserIds,
    rebuildStats: !deferStats,
  });

  return stats;
}

/**
 * Schedule correlation stats rebuild in background.
 */
export function scheduleCorrelationStatsRebuild(application) {
  setImmediate(() => {
    void (async () => {
      try {
        const { appName, db } = await resolveCorrelationContext(application);
        await rebuildCorrelationEntitlementStats(db, appName, application._id);
      } catch (err) {
        console.error(
          "[adConnectorCorrelationService] stats rebuild failed:",
          err?.message || err,
        );
      }
    })();
  });
}
