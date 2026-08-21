import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import SodViolation from "../../models/sod/SodViolation.js";
import WorkflowRemediationEvent from "../../models/workflowRemediation/WorkflowRemediationEvent.js";
import {
  WORKFLOW_REMEDIATION_EVENT_SOURCES,
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
} from "../../constants/workflowRemediation.js";
import { asObjectId } from "../../controllers/access-certification/certificationControllerHelpers.js";
import {
  aggregateRevokedEntitlements,
  buildItemKey,
  countRevokedEntitlementsForCampaign,
} from "../remediation/remediationRevokedUsersService.js";
import {
  createWorkflowRemediationEvent,
  preventDuplicateWorkflowEvent,
} from "./workflowRemediationEventService.js";
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

  const existing = await preventDuplicateWorkflowEvent(
    tenantIdStr,
    WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
    String(cId),
    WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
  );
  if (existing) return existing;

  const revokedResult = await aggregateRevokedEntitlements({
    campaignIds: [String(cId)],
    page: 1,
    limit: 10000,
  });
  if (!revokedResult.items.length) return null;

  const { event, created } = await createWorkflowRemediationEvent({
    tenantId: tenantIdStr,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
    sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.CERTIFICATION,
    sourceRef: String(cId),
    campaignId: String(cId),
    campaignName: campaign.name || campaign.applicationName || "Access Certification",
    applicationId: campaign.applicationId?._id || campaign.applicationId,
    applicationName: campaign.applicationName || campaign.applicationId?.name || "",
    subjectCount: revokedResult.total,
    createdBy: "system",
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
    metadata: { campaignStatus: campaign.status },
    items: revokedResult.items.map((row) => ({
      userId: row.userId,
      identityName: row.itemName,
      identityEmail: row.itemEmail,
      applicationId: row.applicationId,
      applicationName: row.applicationName,
      entitlementName: row.entitlementName,
      sourceRef: row.reviewItemId,
      metadata: {
        reviewItemId: row.reviewItemId,
        campaignId: row.campaignId,
        itemKey: row.itemKey || buildItemKey(row.reviewItemId, row.entitlementName),
        accessDetails: row.accessDetails,
        reviewerEmail: row.reviewerEmail,
        reviewerName: row.reviewerName,
        reviewedAt: row.reviewedAt,
        manager: row.manager,
      },
    })),
  });

  return created ? event : null;
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
  const events = [];

  for (const app of apps) {
    const matches = await scanAppUsersMissingManagerForApplication(app, tenantSlug, db);
    if (!matches.length) continue;

    const cap = 500;
    const subjects = matches.slice(0, cap);
    const sourceRef = `missing-manager-${String(app._id)}`;

    const existing = await preventDuplicateWorkflowEvent(
      String(tid),
      WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER,
      sourceRef,
      WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
    );
    if (existing) {
      events.push(existing);
      continue;
    }

    const { event, created } = await createWorkflowRemediationEvent({
      tenantId: String(tid),
      eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER,
      sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.MISSING_MANAGER,
      sourceRef,
      applicationId: String(app._id),
      applicationName: app.name,
      subjectCount: matches.length,
      createdBy: "system",
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      metadata: { scannedUsers: matches.length, storedUsers: subjects.length },
      items: subjects.map((s) => ({
        userId: s.userId || s.identityId,
        identityName: s.identityName || s.itemName,
        identityEmail: s.identityEmail || s.itemEmail,
        applicationId: app._id,
        applicationName: app.name,
        sourceRef: s.userId || s.identityId,
        metadata: s,
      })),
    });

    if (created) events.push(event);
  }

  return events;
}

export async function ingestOrphanAccounts(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return [];

  const orphans = await OrphanAccount.find({ tenantId: tid, status: "OPEN" })
    .limit(500)
    .lean();
  if (!orphans.length) return [];

  const byApp = new Map();
  for (const o of orphans) {
    const appKey = String(o.applicationId);
    if (!byApp.has(appKey)) byApp.set(appKey, []);
    byApp.get(appKey).push(o);
  }

  const events = [];
  for (const [appId, rows] of byApp.entries()) {
    const app = await Application.findById(appId).select("name").lean();
    const sourceRef = `orphan-${appId}`;

    const existing = await preventDuplicateWorkflowEvent(
      String(tid),
      WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
      sourceRef,
      WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
    );
    if (existing) {
      events.push(existing);
      continue;
    }

    const { event, created } = await createWorkflowRemediationEvent({
      tenantId: String(tid),
      eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
      sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.UNCORRELATED_ACCOUNT,
      sourceRef,
      applicationId: appId,
      applicationName: app?.name || "",
      subjectCount: rows.length,
      createdBy: "system",
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      items: rows.map((o) => ({
        accountId: o.accountId,
        identityName: o.accountName || o.accountId,
        applicationId: o.applicationId,
        applicationName: app?.name || "",
        sourceRef: String(o._id),
        metadata: { orphanId: String(o._id), correlationKey: o.correlationKey },
      })),
    });

    if (created) events.push(event);
  }

  return events;
}

export async function ingestDormantAccounts(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return [];

  const apps = await Application.find({ tenantId: tid, status: "active" })
    .select("name")
    .lean();
  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) return [];

  const db = mongoose.connection.db;
  const events = [];

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
        .project({
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
        })
        .batchSize(200);
      for await (const user of cursor) {
        if (isInactiveAppUserWithAccess(user)) {
          matches.push(mapAppUserToInactiveAccessHygieneItem(user, app._id, app.name));
        }
      }
    } catch {
      continue;
    }

    if (!matches.length) continue;

    const cap = 500;
    const subjects = matches.slice(0, cap);
    const sourceRef = `dormant-${String(app._id)}`;

    const existing = await preventDuplicateWorkflowEvent(
      String(tid),
      WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT,
      sourceRef,
      WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
    );
    if (existing) {
      events.push(existing);
      continue;
    }

    const { event, created } = await createWorkflowRemediationEvent({
      tenantId: String(tid),
      eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT,
      sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.DORMANT_ACCOUNT,
      sourceRef,
      applicationId: String(app._id),
      applicationName: app.name,
      subjectCount: matches.length,
      createdBy: "system",
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
      metadata: { scannedUsers: matches.length, storedUsers: subjects.length },
      items: subjects.map((s) => ({
        userId: s.userId || s.identityId,
        identityName: s.identityName || s.itemName,
        identityEmail: s.identityEmail || s.itemEmail,
        applicationId: app._id,
        applicationName: app.name,
        sourceRef: s.userId || s.identityId,
        metadata: s,
      })),
    });

    if (created) events.push(event);
  }

  return events;
}

export async function ingestSodViolations(tenantId) {
  const tid = String(tenantId);
  const violations = await SodViolation.find({ tenantId: tid, status: "open" })
    .limit(500)
    .lean();
  if (!violations.length) return [];

  const sourceRef = `sod-open-${tid}`;
  const existing = await preventDuplicateWorkflowEvent(
    tid,
    WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION,
    sourceRef,
    WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
  );
  if (existing) return [existing];

  const { event, created } = await createWorkflowRemediationEvent({
    tenantId: tid,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION,
    sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.SOD,
    sourceRef,
    subjectCount: violations.length,
    createdBy: "system",
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.SCHEDULER,
    metadata: { violationCount: violations.length },
    items: violations.map((v) => ({
      userId: v.identity ? String(v.identity) : "",
      identityName: v.identityName || "",
      identityEmail: v.identityEmail || "",
      sourceRef: String(v._id),
      metadata: {
        policyName: v.policyName,
        ruleName: v.ruleName,
        severity: v.severity,
        leftEntitlements: v.leftEntitlements,
        rightEntitlements: v.rightEntitlements,
      },
    })),
  });

  return created ? [event] : [];
}

export async function ingestCompletedRevokeAccessCampaigns(tenantId) {
  const tid = asObjectId(tenantId);
  if (!tid) return { ingested: 0, skipped: 0, scanned: 0 };

  const campaigns = await Campaign.find({
    tenantId: tid,
    status: { $in: REVOKE_ACCESS_CAMPAIGN_STATUSES },
  })
    .select("_id status")
    .lean();

  let ingested = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    const existing = await WorkflowRemediationEvent.findOne({
      tenantId: String(tid),
      eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
      sourceRef: String(campaign._id),
      queueStatus: { $nin: ["VALIDATED", "FAILED"] },
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

    const event = await ingestRevokeAccessFromCampaign(campaign._id);
    if (event) ingested += 1;
    else skipped += 1;
  }

  return { ingested, skipped, scanned: campaigns.length };
}

export async function runTenantWorkflowRemediationIngestion(tenantId) {
  // Automatic WRQ ingestion is disabled by default. Events are created only via explicit user actions.
  return {
    revokeAccess: { ingested: 0, skipped: 0, scanned: 0 },
    missingManager: [],
    orphanAccounts: [],
    dormantAccounts: [],
    sodViolations: [],
    disabled: true,
  };
}

export async function createRevokeAccessEventFromReviewItem({
  tenantId,
  campaignId,
  campaignName,
  reviewItem,
  entitlementName = null,
  createdBy = "system",
}) {
  if (!reviewItem) return null;

  const sourceRef = entitlementName
    ? `${reviewItem._id}:${entitlementName}`
    : String(reviewItem._id);

  const existing = await preventDuplicateWorkflowEvent(
    tenantId,
    WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
    sourceRef,
    WORKFLOW_REMEDIATION_QUEUE_SOURCES.CERTIFICATION,
  );
  if (existing) return { event: existing, created: false };

  const appId = reviewItem.applicationId;
  const app = appId ? await Application.findById(appId).select("name").lean() : null;

  return createWorkflowRemediationEvent({
    tenantId,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
    sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.CERTIFICATION,
    sourceRef,
    targetId: String(reviewItem._id),
    campaignId: campaignId ? String(campaignId) : undefined,
    campaignName,
    applicationId: appId ? String(appId) : undefined,
    applicationName: reviewItem.applicationName || app?.name || "",
    subjectCount: 1,
    createdBy,
    queuedBy: createdBy,
    queuedAt: new Date(),
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.CERTIFICATION,
    metadata: { targetId: String(reviewItem._id), intakeMode: "revoke" },
    items: [
      {
        userId: reviewItem.userId || reviewItem.itemId,
        identityName: reviewItem.itemName,
        identityEmail: reviewItem.itemEmail,
        applicationId: appId,
        applicationName: reviewItem.applicationName || app?.name || "",
        entitlementName: entitlementName || undefined,
        sourceRef: String(reviewItem._id),
        metadata: {
          reviewItemId: String(reviewItem._id),
          campaignId: campaignId ? String(campaignId) : undefined,
          itemKey: buildItemKey(reviewItem._id, entitlementName),
        },
      },
    ],
  });
}

export async function createUncorrelatedAccountEvent({
  tenantId,
  orphan,
  createdBy = "system",
  selectedWorkflowId,
  selectedWorkflowName,
}) {
  if (!orphan) return null;

  const app = orphan.applicationId
    ? await Application.findById(orphan.applicationId).select("name").lean()
    : null;

  const sourceRef = String(orphan._id);
  const existing = await preventDuplicateWorkflowEvent(
    tenantId,
    WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
    sourceRef,
    WORKFLOW_REMEDIATION_QUEUE_SOURCES.API,
  );
  if (existing) return { event: existing, created: false };

  return createWorkflowRemediationEvent({
    tenantId,
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
    sourceType: WORKFLOW_REMEDIATION_EVENT_SOURCES.UNCORRELATED_ACCOUNT,
    sourceRef,
    targetId: String(orphan._id),
    applicationId: orphan.applicationId ? String(orphan.applicationId) : undefined,
    applicationName: app?.name || "",
    subjectCount: 1,
    createdBy,
    queuedBy: createdBy,
    queuedAt: new Date(),
    selectedWorkflowId,
    selectedWorkflowName,
    queueSource: WORKFLOW_REMEDIATION_QUEUE_SOURCES.API,
    metadata: { targetId: String(orphan._id), intakeMode: "orphan" },
    items: [
      {
        accountId: orphan.accountId,
        identityName: orphan.accountName || orphan.accountId,
        applicationId: orphan.applicationId,
        applicationName: app?.name || "",
        sourceRef: String(orphan._id),
        metadata: {
          orphanId: String(orphan._id),
          correlationKey: orphan.correlationKey,
          riskLevel: orphan.riskLevel,
        },
      },
    ],
  });
}
