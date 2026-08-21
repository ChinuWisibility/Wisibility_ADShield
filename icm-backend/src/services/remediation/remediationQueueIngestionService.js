import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import RemediationQueue from "../../models/remediation/RemediationQueue.js";
import {
  aggregateRevokedEntitlements,
  buildItemKey,
  countRevokedEntitlementsForCampaign,
} from "./remediationRevokedUsersService.js";
import {
  createQueueEvent,
  createQueueItems,
  refreshQueueSubjects,
  resolveQueueType,
} from "./remediationQueueService.js";
import { markCertificationReviewerComplete } from "./remediationTrackingService.js";
import { asObjectId } from "../../controllers/access-certification/certificationControllerHelpers.js";
import {
  getAppUsersCollectionName,
  resolveTenantSlugFromTenantId,
} from "../../utils/applicationDynamicCollections.js";
import {
  isInactiveAppUserWithAccess,
  mapAppUserToInactiveAccessHygieneItem,
} from "../../utils/datahygine/appUserInactiveWithAccess.js";
import {
  APP_USER_SCAN_PROJECTION,
  isAppUserMissingManager,
  mapAppUserToMissingManagerItem,
} from "../../utils/datahygine/appUserMissingManager.js";

const REVOKE_ACCESS_CAMPAIGN_STATUSES = ["Completed", "EndPhase"];

function isApplicationLevelCampaign(campaign) {
  if (!campaign) return false;
  if (campaign.certificationScope === "APPLICATION") return true;
  if (campaign.certificationScope) return false;
  return Boolean(campaign.applicationId);
}

const INACTIVE_APP_USER_PROJECTION = {
  user_id: 1,
  email: 1,
  display_name: 1,
  displayName: 1,
  is_active: 1,
  status: 1,
  lifecycle: 1,
  rawData: 1,
  applicationId: 1,
  member_of_entitlements: 1,
  groups: 1,
  roles: 1,
  entitlements: 1,
};

export async function ingestRevokeAccessFromCampaign(campaignId) {
  const cId = asObjectId(campaignId);
  if (!cId) return null;

  const campaign = await Campaign.findById(cId)
    .populate("applicationId", "name tenantId")
    .lean();
  if (!campaign || !REVOKE_ACCESS_CAMPAIGN_STATUSES.includes(campaign.status)) return null;
  if (!isApplicationLevelCampaign(campaign)) return null;

  const tenantId = campaign.tenantId || campaign.applicationId?.tenantId;
  if (!tenantId) return null;
  const tenantIdStr = String(tenantId);

  const revokedResult = await aggregateRevokedEntitlements({
    campaignIds: [String(cId)],
    page: 1,
    limit: 10000,
  });

  if (!revokedResult.items.length) return null;

  const approvedCount = await ReviewItem.countDocuments({
    campaignId: cId,
    status: "APPROVED",
  });
  const pendingCount = await ReviewItem.countDocuments({
    campaignId: cId,
    status: "PENDING",
  });
  const totalReviewed = await ReviewItem.countDocuments({ campaignId: cId });

  const { queue, created } = await createQueueEvent({
    tenantId: tenantIdStr,
    eventType: "REVOKE_ACCESS",
    eventQueueType: "ACCESS_CERTIFICATION",
    sourceCollection: "access_certification_campaigns",
    sourceId: String(cId),
    certificationId: cId,
    certificationName: campaign.name || campaign.applicationName || "Access Certification",
    applicationId: campaign.applicationId?._id || campaign.applicationId,
    applicationName:
      campaign.applicationName || campaign.applicationId?.name || "",
    totalUsersReviewed: totalReviewed,
    revokedUsersCount: revokedResult.total,
    approvedUsersCount: approvedCount,
    pendingUsersCount: pendingCount,
    subjectCount: revokedResult.total,
    severity: revokedResult.total > 50 ? "HIGH" : "MEDIUM",
    detectionSnapshot: { campaignStatus: campaign.status },
  });

  if (created) {
    await createQueueItems(
      queue._id,
      tenantIdStr,
      revokedResult.items.map((row) => ({
        identityId: row.userId,
        identityName: row.itemName,
        identityEmail: row.itemEmail,
        applicationId: row.applicationId,
        applicationName: row.applicationName,
        entitlementName: row.entitlementName,
        managerEmail: row.manager,
        reviewItemId: row.reviewItemId,
        campaignId: row.campaignId,
        itemKey: row.itemKey || buildItemKey(row.reviewItemId, row.entitlementName),
        accessDetails: row.accessDetails,
        metadata: {
          reviewerEmail: row.reviewerEmail,
          reviewerName: row.reviewerName,
          reviewedAt: row.reviewedAt,
        },
      })),
    );
  }

  // Certification reviewer (manager or external) already completed revoke/approve decisions.
  const latestReviewMs = revokedResult.items.reduce((max, row) => {
    const t = row.reviewedAt ? new Date(row.reviewedAt).getTime() : 0;
    return Math.max(max, t);
  }, 0);
  const certReviewAt =
    latestReviewMs > 0 ? new Date(latestReviewMs) : campaign.endDate || new Date();
  await markCertificationReviewerComplete(queue.eventId, { completedAt: certReviewAt }).catch(
    () => {},
  );

  return queue;
}

async function scanAppUsersMissingManagerForApplication(app, tenantSlug, db) {
  let usersColl;
  try {
    usersColl = getAppUsersCollectionName(app.name, tenantSlug);
  } catch {
    return [];
  }

  const matches = [];
  try {
    const cursor = db
      .collection(usersColl)
      .find({ applicationId: app._id })
      .project(APP_USER_SCAN_PROJECTION)
      .batchSize(200);
    for await (const user of cursor) {
      if (isAppUserMissingManager(user)) {
        matches.push(mapAppUserToMissingManagerItem(user, app._id, app.name));
      }
    }
  } catch {
    return [];
  }
  return matches;
}

export async function ingestMissingManagers(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return [];

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) return [];

  const apps = await Application.find({ tenantId: tid, status: "active" })
    .select("name")
    .lean();
  const db = mongoose.connection.db;
  const queues = [];

  for (const app of apps) {
    const matches = await scanAppUsersMissingManagerForApplication(app, tenantSlug, db);
    if (!matches.length) continue;

    const cap = 500;
    const subjects = matches.slice(0, cap);
    const sourceId = `missing-manager-${String(app._id)}`;

    const existing = await RemediationQueue.findOne({
      tenantId: String(tid),
      eventType: "MISSING_MANAGER",
      sourceId,
      status: { $nin: ["CLOSED", "VALIDATED"] },
    }).lean();

    if (existing) {
      await refreshQueueSubjects(existing._id, tid, subjects, {
        subjectCount: matches.length,
        revokedUsersCount: subjects.length,
        applicationId: app._id,
        applicationName: app.name,
      });
      queues.push(await RemediationQueue.findById(existing._id).lean());
      continue;
    }

    const { queue, created } = await createQueueEvent({
      tenantId: String(tid),
      eventType: "MISSING_MANAGER",
      eventQueueType: "IDENTITY_QUALITY",
      sourceCollection: "app_users",
      sourceId,
      applicationId: app._id,
      applicationName: app.name,
      subjectCount: matches.length,
      revokedUsersCount: subjects.length,
      severity: matches.length > 100 ? "HIGH" : "MEDIUM",
      detectionSnapshot: { scannedUsers: matches.length, storedUsers: subjects.length },
    });

    if (created) {
      await createQueueItems(queue._id, tid, subjects);
    }
    queues.push(queue);
  }

  return queues;
}

export async function ingestOrphanAccounts(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return [];

  const orphans = await OrphanAccount.find({
    tenantId: tid,
    status: "OPEN",
  })
    .limit(500)
    .lean();

  if (!orphans.length) return [];

  const byApp = new Map();
  for (const o of orphans) {
    const appKey = String(o.applicationId);
    if (!byApp.has(appKey)) byApp.set(appKey, []);
    byApp.get(appKey).push(o);
  }

  const queues = [];
  for (const [appId, rows] of byApp.entries()) {
    const app = await Application.findById(appId).select("name").lean();
    const sourceId = `orphan-${appId}`;
    const { queue, created } = await createQueueEvent({
      tenantId: String(tid),
      eventType: "ORPHAN_ACCOUNT",
      eventQueueType: "CORRELATION_ENGINE",
      sourceCollection: "orphan_accounts",
      sourceId,
      applicationId: appId,
      applicationName: app?.name || "",
      subjectCount: rows.length,
      revokedUsersCount: rows.length,
      severity: rows.length > 25 ? "HIGH" : "MEDIUM",
    });

    if (created) {
      await createQueueItems(
        queue._id,
        tid,
        rows.map((o) => ({
          accountId: o.accountId,
          identityName: o.accountName || o.accountId,
          applicationId: o.applicationId,
          applicationName: app?.name || "",
          metadata: { correlationKey: o.correlationKey, orphanId: String(o._id) },
        })),
      );
    }
    queues.push(queue);
  }

  return queues;
}

export async function ingestInactiveUserAccess(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return [];

  const apps = await Application.find({ tenantId: tid, status: "active" })
    .select("name")
    .lean();

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) return [];

  const db = mongoose.connection.db;
  const queues = [];

  for (const app of apps) {
    let usersColl;
    try {
      usersColl = getAppUsersCollectionName(app.name, tenantSlug);
    } catch {
      continue;
    }

    const matches = [];
    try {
      const cursor = db
        .collection(usersColl)
        .find({ applicationId: app._id })
        .project(INACTIVE_APP_USER_PROJECTION)
        .batchSize(200);
      for await (const user of cursor) {
        if (isInactiveAppUserWithAccess(user)) {
          matches.push(
            mapAppUserToInactiveAccessHygieneItem(user, app._id, app.name),
          );
        }
      }
    } catch {
      continue;
    }

    if (!matches.length) continue;

    const sourceId = `inactive-${String(app._id)}`;
    const { queue, created } = await createQueueEvent({
      tenantId: String(tid),
      eventType: "INACTIVE_USER_ACCESS",
      eventQueueType: "ACCESS_ANALYTICS",
      sourceCollection: "app_users",
      sourceId,
      applicationId: app._id,
      applicationName: app.name,
      subjectCount: matches.length,
      revokedUsersCount: matches.length,
      severity: matches.length > 25 ? "HIGH" : "MEDIUM",
    });

    if (created) {
      await createQueueItems(
        queue._id,
        tid,
        matches.map((m) => ({
          identityId: m.userId || m.id,
          identityName: m.displayName || m.userId,
          identityEmail: m.email || "",
          accountId: m.userId || m.id,
          applicationId: app._id,
          applicationName: app.name,
          entitlementName: m.entitlementSummary || "",
          metadata: m,
        })),
      );
    }
    queues.push(queue);
  }

  return queues;
}

export async function manualEnqueueFromDetection(tenantId, eventType, subjects = [], sourceMeta = {}) {
  if (!subjects.length) {
    throw new Error("At least one subject is required for manual enqueue");
  }

  const normalizedType = String(eventType).toUpperCase();
  const sourceId =
    sourceMeta.sourceId ||
    `manual-${normalizedType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { queue, created } = await createQueueEvent({
    tenantId: String(tenantId),
    eventType: normalizedType,
    eventQueueType: resolveQueueType(normalizedType),
    sourceCollection: sourceMeta.sourceCollection || "manual",
    sourceId,
    certificationId: sourceMeta.certificationId,
    certificationName: sourceMeta.certificationName,
    applicationId: sourceMeta.applicationId,
    applicationName: sourceMeta.applicationName,
    subjectCount: subjects.length,
    revokedUsersCount: subjects.length,
    severity: sourceMeta.severity || "MEDIUM",
    queuedBy: sourceMeta.queuedBy || "manual",
    metadata: sourceMeta.metadata,
  });

  if (created) {
    await createQueueItems(queue._id, tenantId, subjects);
  }

  return { queue, created };
}

/**
 * Scan completed certification campaigns with revoked entitlements and enqueue REVOKE_ACCESS events.
 */
export async function ingestCompletedRevokeAccessCampaigns(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return { ingested: 0, skipped: 0, scanned: 0 };

  const tenantAppIds = await Application.find({ tenantId: tid }).distinct("_id");
  const campaigns = await Campaign.find({
    status: { $in: REVOKE_ACCESS_CAMPAIGN_STATUSES },
    $and: [
      {
        $or: [
          { certificationScope: "APPLICATION" },
          {
            certificationScope: { $in: [null, ""] },
            applicationId: { $exists: true, $ne: null },
          },
        ],
      },
      { $or: [{ tenantId: tid }, { applicationId: { $in: tenantAppIds } }] },
    ],
  })
    .select("_id name applicationName status certificationScope applicationId")
    .lean();

  let ingested = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    const existing = await RemediationQueue.findOne({
      tenantId: String(tid),
      eventType: "REVOKE_ACCESS",
      sourceId: String(campaign._id),
      status: { $nin: ["CLOSED", "VALIDATED"] },
    }).lean();

    if (existing) {
      skipped += 1;
      continue;
    }

    const revokedCount = await countRevokedEntitlementsForCampaign(campaign._id);
    if (revokedCount === 0) {
      skipped += 1;
      continue;
    }

    const queue = await ingestRevokeAccessFromCampaign(campaign._id);
    if (queue) ingested += 1;
    else skipped += 1;
  }

  return { ingested, skipped, scanned: campaigns.length };
}

export async function runTenantQueueIngestion(tenantId) {
  const results = {
    revokeAccess: { ingested: 0, skipped: 0, scanned: 0 },
    missingManager: [],
    orphanAccounts: [],
    inactiveUserAccess: [],
  };

  try {
    results.revokeAccess = await ingestCompletedRevokeAccessCampaigns(tenantId);
  } catch (err) {
    console.error("[remediationQueueIngestion] revoke access campaigns failed:", err.message);
  }

  try {
    results.missingManager = (await ingestMissingManagers(tenantId)) || [];
  } catch (err) {
    console.error("[remediationQueueIngestion] missing managers failed:", err.message);
  }

  try {
    results.orphanAccounts = await ingestOrphanAccounts(tenantId);
  } catch (err) {
    console.error("[remediationQueueIngestion] orphan accounts failed:", err.message);
  }

  try {
    results.inactiveUserAccess = await ingestInactiveUserAccess(tenantId);
  } catch (err) {
    console.error("[remediationQueueIngestion] inactive user access failed:", err.message);
  }

  return results;
}
