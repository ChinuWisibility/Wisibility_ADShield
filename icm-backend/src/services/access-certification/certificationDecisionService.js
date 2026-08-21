import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import CertificationReviewerAssignment from "../../models/certification/CertificationReviewerAssignment.js";
import UnifiedAuditEvent from "../../models/compliance/UnifiedAuditEvent.js";
import CertificationReviewerActionLog from "../../models/certification/CertificationReviewerActionLog.js";
import { getProgress, buildEntitlementProgressMaps } from "../reviewItemService.js";
import {
  itemIdsMatch,
  resolveCanonicalItemKey,
} from "../../utils/access-certification/certificationItemId.js";
import { ingestRevokeAccessFromCampaign } from "../remediation/remediationQueueIngestionService.js";
import {
  ingestRevokeAccessFromCampaign as ingestRevokeAccessToWRQ,
} from "../workflowRemediation/workflowRemediationEventIngestionService.js";
import { immediatelyLaunchEvent } from "../workflowRemediation/workflowRemediationTriggerService.js";

/** Authenticated governance UI (owner / reviewer with session). */
export const DECISION_SOURCE_CONSOLE = "CONSOLE";
/** No-login review portal (JWT from certification email). */
export const DECISION_SOURCE_PORTAL = "PORTAL";
/** Legacy or alternate email deep-link flows (reserved). */
export const DECISION_SOURCE_EMAIL_LINK = "EMAIL_LINK";

function normalizeDecision(decision) {
  const d = String(decision ?? "")
    .trim()
    .toLowerCase();
  if (!d) return null;

  if (["approved", "approve"].includes(d)) return "Approved";
  if (["revoked", "revoke"].includes(d)) return "Revoked";
  if (["delegate", "delegated"].includes(d)) return "Delegate";
  if (["exception", "ex"].includes(d)) return "Exception";

  return null;
}

function toStringId(v) {
  if (!v && v !== 0) return "";
  return String(v);
}

const FINAL_DECISIONS = new Set([
  "Approved",
  "Revoked",
  "Delegate",
  "Exception",
]);

function decisionToReviewStatus(decisionNormalized) {
  if (decisionNormalized === "Revoked") return "REVOKE_IN_PROGRESS";
  if (decisionNormalized === "Delegate") return "DELEGATED";
  if (decisionNormalized === "Exception") return "EXCEPTION";
  return "APPROVED";
}

function decisionToEntitlementStatus(decisionNormalized) {
  if (decisionNormalized === "Revoked") return "REVOKE_IN_PROGRESS";
  return "APPROVED";
}

function isRevokeRemediationStatus(status) {
  return status === "REVOKED" || status === "REVOKE_IN_PROGRESS";
}

/** Legacy campaigns may only have itemAccessDetails — bootstrap entitlement rows on first decision. */
function ensureEntitlementDecisions(item) {
  if (Array.isArray(item.entitlementDecisions) && item.entitlementDecisions.length > 0) {
    return item.entitlementDecisions;
  }
  const names = Array.isArray(item.itemAccessDetails) ? item.itemAccessDetails : [];
  const appName = String(item.itemApplicationName || "").trim();
  item.entitlementDecisions = names
    .map((name) => String(name || "").trim())
    .filter(Boolean)
    .map((entitlementName) => ({
      entitlementName,
      applicationName: appName || undefined,
      applicationId: item.applicationId || undefined,
      status: "PENDING",
    }));
  return item.entitlementDecisions;
}

export function isCampaignDecisionLocked(status) {
  return status === "Closed" || status === "Completed";
}

/** Synthetic currentReview keys from ReviewItem rows for resolveCanonicalItemKey. */
function campaignWithKeysFromReviewItems(campaign, reviewItems) {
  const m = new Map();
  for (const ri of reviewItems) {
    m.set(String(ri.itemId), {});
  }
  const plain = campaign.toObject
    ? campaign.toObject()
    : { ...(campaign._doc || campaign) };
  return { ...plain, currentReview: m, selectedIds: campaign.selectedIds };
}

/**
 * Recompute per-reviewer progress counters on the campaign document.
 * Called after any decision so Assigned Reviewers section stays live.
 */
async function syncReviewerProgress(campaignId) {
  const oid = mongoose.Types.ObjectId.isValid(campaignId)
    ? new mongoose.Types.ObjectId(campaignId)
    : campaignId;

  const reviewItems = await ReviewItem.find({ campaignId: oid })
    .select("reviewerEmail reviewerName itemManager entitlementDecisions status")
    .lean();
  const { countMap } = buildEntitlementProgressMaps(reviewItems);

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return;

  campaign.reviewersAssigned = (campaign.reviewersAssigned || []).map((r) => {
    const email = String(r.email || "").toLowerCase();
    const counts = countMap.get(email);
    if (!counts) return r;
    const completion =
      counts.total > 0
        ? Math.round(((counts.approved + counts.revoked) / counts.total) * 100)
        : 0;
    r.progress = {
      total: counts.total,
      approved: counts.approved,
      revoked: counts.revoked,
      pending: counts.pending,
      completion,
      lastActionAt: new Date(),
    };
    return r;
  });

  await campaign.save();
}

/** Sync per-reviewer progress into the CertificationReviewerAssignment collection. */
async function syncReviewerAssignmentRecords(campaignId) {
  const oid = mongoose.Types.ObjectId.isValid(campaignId)
    ? new mongoose.Types.ObjectId(campaignId)
    : campaignId;

  const reviewItems = await ReviewItem.find({ campaignId: oid })
    .select("reviewerEmail reviewerName itemManager entitlementDecisions status")
    .lean();
  const { countMap, nameByEmail } = buildEntitlementProgressMaps(reviewItems);

  const ops = [...countMap.entries()].map(([email, counts]) => {
    const completion =
      counts.total > 0
        ? Math.round(((counts.approved + counts.revoked) / counts.total) * 100)
        : 0;
    return {
      updateOne: {
        filter: { campaignId, reviewerEmail: email },
        update: {
          $set: {
            approvedCount: counts.approved,
            revokedCount: counts.revoked,
            pendingCount: counts.pending,
            assignedItemsCount: counts.total,
            completionPercentage: completion,
            lastActionAt: new Date(),
            ...(nameByEmail.get(email)
              ? { reviewerName: nameByEmail.get(email) }
              : {}),
            ...(counts.pending === 0
              ? { assignmentStatus: "COMPLETED", completedAt: new Date() }
              : {}),
          },
        },
      },
    };
  });

  if (ops.length) {
    await CertificationReviewerAssignment.bulkWrite(ops, { ordered: false });
  }
}

/**
 * Recompute Campaign progress fields from ReviewItem aggregation.
 * (Future: for very large campaigns, consider incremental counters from updateMany modifiedCount.)
 */
export async function updateCampaignProgress(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return null;

  const n = await ReviewItem.countDocuments({ campaignId });
  if (n === 0) return campaign;

  const p = await getProgress(campaignId);
  const totalItems = p.total;

  campaign.completedItems = p.completed;
  campaign.pendingItems = p.pending;
  campaign.approvedItems = p.approved;
  campaign.revokedItems = p.revoked;
  campaign.completionPercentage = p.percentage;

  // Complete when every ReviewItem is non-PENDING (single, batch, bulk, and owner flows all call this).
  const noPendingLeft = totalItems > 0 && p.pending === 0;
  if (noPendingLeft) {
    campaign.status = "Completed";
    campaign.endDate = new Date();
  } else if (campaign.status !== "Active" && campaign.status !== "EndPhase") {
    campaign.status = "Active";
  }

  await campaign.save();
  await syncReviewerProgress(campaignId);
  await syncReviewerAssignmentRecords(campaignId).catch((e) =>
    console.error("[updateCampaignProgress] reviewer assignment sync failed:", e.message),
  );

  if (noPendingLeft) {
    // Legacy remediation queue ingest
    ingestRevokeAccessFromCampaign(campaignId).catch((e) =>
      console.error("[updateCampaignProgress] remediation queue ingest failed:", e.message),
    );

    // Enterprise: WRQ event creation + immediate workflow launch
    ingestRevokeAccessToWRQ(campaignId)
      .then(async (event) => {
        if (event?.eventId) {
          try {
            await immediatelyLaunchEvent(
              campaign.tenantId,
              event.eventId,
              { actor: "certification-auto-launch" },
            );
            console.log(
              `[updateCampaignProgress] auto-launched remediation for campaign ${campaignId}`,
            );
          } catch (launchErr) {
            console.error(
              "[updateCampaignProgress] auto-launch failed (event created):",
              launchErr.message,
            );
          }
        }
      })
      .catch((e) =>
        console.error("[updateCampaignProgress] WRQ event ingest failed:", e.message),
      );
  }

  return Campaign.findById(campaignId);
}

function appendHistory(campaign, payload) {
  campaign.history = campaign.history || [];
  campaign.history.push(payload);
}

function compactAuditMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const out = {};
  if (metadata.ip) out.ip = String(metadata.ip);
  if (metadata.userAgent) out.userAgent = String(metadata.userAgent);
  return Object.keys(out).length ? out : null;
}

/**
 * Per-review-item audit rows (best-effort; does not block decisions on failure).
 * Writes to both UnifiedAuditEvent (compliance framework) and CertificationReviewerActionLog (cert-specific).
 */
async function recordCertDecisionAuditEvents({
  tenantId,
  campaignId,
  reviewerEmail,
  reviewerName,
  reviewerId,
  decisionNormalized,
  previousDecision,
  reviewItemRows,
  mode,
  decisionSource = DECISION_SOURCE_CONSOLE,
  metadata,
}) {
  if (!reviewItemRows?.length) return;
  const email = String(reviewerEmail || "")
    .trim()
    .toLowerCase();
  const now = new Date();
  const meta = compactAuditMetadata(metadata);

  const unifiedDocs = reviewItemRows.map((ri) => ({
    ...(tenantId ? { tenantId } : {}),
    eventType: "CERT_DECISION",
    entityType: "CERT",
    entityId: String(campaignId),
    action: decisionNormalized,
    performedByEmail: email || undefined,
    ...(reviewerId ? { performedBy: reviewerId } : {}),
    performedAt: now,
    sourceDomain: "CERT",
    ...(meta?.ip ? { ipAddress: meta.ip } : {}),
    newValue: {
      reviewItemId: String(ri._id),
      itemId: String(ri.itemId),
      decision: decisionNormalized,
      reviewerEmail: email || undefined,
      mode,
      decisionSource,
      performedAt: now,
      ...(meta ? { metadata: meta } : {}),
    },
  }));

  const actionLogDocs = reviewItemRows.map((ri) => ({
    ...(tenantId ? { tenantId } : {}),
    campaignId,
    reviewItemId: ri._id,
    ...(reviewerId ? { reviewerId } : {}),
    reviewerEmail: email || undefined,
    ...(reviewerName ? { reviewerName } : {}),
    action: decisionNormalized.toUpperCase(),
    previousDecision: previousDecision || null,
    newDecision: decisionNormalized,
    decisionSource,
    ...(meta?.ip ? { ipAddress: meta.ip } : {}),
    ...(meta?.userAgent ? { userAgent: meta.userAgent } : {}),
    actedAt: now,
  }));

  try {
    await UnifiedAuditEvent.insertMany(unifiedDocs, { ordered: false });
  } catch (e) {
    console.warn(
      "[certificationDecisionService] UnifiedAuditEvent insert failed:",
      e?.message || e,
    );
  }

  try {
    await CertificationReviewerActionLog.insertMany(actionLogDocs, {
      ordered: false,
    });
  } catch (e) {
    console.warn(
      "[certificationDecisionService] CertificationReviewerActionLog insert failed:",
      e?.message || e,
    );
  }
}

/**
 * Authenticated / owner APIs: apply decision by legacy item id strings → ReviewItem rows.
 */
export async function applyDecisionToCampaign({
  campaignId,
  targets = [],
  reviewerId,
  reviewerName,
  reviewerEmail,
  decision,
  comment,
  skipReviewerAssignmentGuard = false,
  metadata,
}) {
  const decisionNormalized = normalizeDecision(decision);
  if (!decisionNormalized) {
    throw new Error("Invalid decision");
  }

  if (!campaignId) throw new Error("Missing campaignId");

  const reviewerIdStr = toStringId(reviewerId);
  const reviewerEmailStr = reviewerEmail
    ? String(reviewerEmail).toLowerCase()
    : "";
  const targetsArr = Array.isArray(targets)
    ? targets.map(toStringId).filter(Boolean)
    : [];

  if (!targetsArr.length) {
    throw new Error("Missing targets");
  }

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  if (isCampaignDecisionLocked(campaign.status)) {
    throw new Error("Campaign is already closed/completed");
  }

  const reviewItems = await ReviewItem.find({ campaignId }).lean();
  if (!reviewItems.length) {
    throw new Error("No review items for this campaign");
  }

  const campaignForResolve = campaignWithKeysFromReviewItems(
    campaign,
    reviewItems,
  );

  const isReviewerAssigned = () => {
    if (!campaign.reviewersAssigned || campaign.reviewersAssigned.length === 0)
      return true;

    return campaign.reviewersAssigned.some((r) => {
      const rid = r.reviewerId ? toStringId(r.reviewerId) : "";
      const email = r.email
        ? String(r.email).toLowerCase()
        : r.reviewerEmail
          ? String(r.reviewerEmail).toLowerCase()
          : "";
      return (
        (reviewerIdStr && rid && rid === reviewerIdStr) ||
        (reviewerEmailStr && email && email === reviewerEmailStr)
      );
    });
  };

  const canTouchReviewItem = (ri) => {
    const isNoAccess =
      String(ri?.reviewItemType || "").trim().toUpperCase() === "NO_ACCESS";
    // Enterprise policy: NO_ACCESS decisions must be made by the assigned reviewer
    // (manager/backup) and are never bypassed by admin console guards.
    if (skipReviewerAssignmentGuard && !isNoAccess) return true;
    if (isReviewerAssigned()) return true;
    const assigned = String(ri.reviewerEmail || "")
      .trim()
      .toLowerCase();
    return Boolean(
      reviewerEmailStr && assigned && assigned === reviewerEmailStr,
    );
  };

  const now = new Date();
  const status = decisionToReviewStatus(decisionNormalized);

  const canonicalTargets = [];
  const seen = new Set();
  for (const raw of targetsArr) {
    const canonical = resolveCanonicalItemKey({
      rawId: raw,
      campaign: campaignForResolve,
    });
    if (!seen.has(canonical)) {
      seen.add(canonical);
      canonicalTargets.push(canonical);
    }
  }

  const idsToUpdate = [];
  const rowsToAudit = [];
  for (const ri of reviewItems) {
    if (ri.status !== "PENDING") continue;
    if (!canTouchReviewItem(ri)) continue;
    let match = false;
    for (const t of targetsArr) {
      const canonical = resolveCanonicalItemKey({
        rawId: t,
        campaign: campaignForResolve,
      });
      if (
        itemIdsMatch(String(ri.itemId), canonical) ||
        itemIdsMatch(String(ri.itemId), t)
      ) {
        match = true;
        break;
      }
    }
    if (match) {
      if (String(ri.campaignId) !== String(campaignId)) {
        throw new Error("Invalid campaign");
      }
      idsToUpdate.push(ri._id);
      rowsToAudit.push(ri);
    }
  }

  const uniqueIds = [...new Set(idsToUpdate.map((id) => String(id)))];
  if (!uniqueIds.length) {
    throw new Error("Reviewer not assigned to this campaign");
  }

  const meta = compactAuditMetadata(metadata);

  await ReviewItem.updateMany(
    {
      _id: { $in: uniqueIds },
      campaignId,
      status: "PENDING",
    },
    {
      $set: {
        status,
        decision: decisionNormalized,
        comment: comment ?? "",
        reviewedAt: now,
        decisionSource: DECISION_SOURCE_CONSOLE,
        ...(meta?.ip ? { ipAddress: meta.ip } : {}),
        ...(reviewerIdStr ? { reviewerId: reviewerIdStr } : {}),
        ...(reviewerEmailStr ? { reviewerEmail: reviewerEmailStr } : {}),
        ...(reviewerName ? { reviewerName } : {}),
        provisioningStatus:
          decisionNormalized === "Revoked" ? "PENDING" : "EXECUTED",
      },
    },
  );

  await recordCertDecisionAuditEvents({
    tenantId: campaign.tenantId,
    campaignId,
    reviewerEmail: reviewerEmailStr || reviewerIdStr,
    reviewerName,
    reviewerId: reviewerIdStr || undefined,
    decisionNormalized,
    reviewItemRows: rowsToAudit,
    mode: "batch",
    decisionSource: DECISION_SOURCE_CONSOLE,
    metadata,
  });

  appendHistory(campaign, {
    at: now,
    by: reviewerIdStr || reviewerEmailStr || "system",
    action: `decision_${decisionNormalized}`,
    itemIds: canonicalTargets,
    comment: comment ?? "",
  });

  await campaign.save();
  await updateCampaignProgress(campaign._id);
  return Campaign.findById(campaignId);
}

/**
 * No-login portal: ReviewItem is the only source of truth.
 */
export async function applyDecisionToReviewItem({
  reviewItemId,
  decision,
  reviewerEmail,
  comment,
  expectedCampaignId,
  decisionSource = DECISION_SOURCE_EMAIL_LINK,
  metadata,
}) {
  const item = await ReviewItem.findById(reviewItemId);
  if (!item) throw new Error("Review item not found");
  if (item.status !== "PENDING") throw new Error("Item already decided");

  if (!expectedCampaignId) {
    throw new Error("Missing campaign context");
  }
  if (String(item.campaignId) !== String(expectedCampaignId)) {
    throw new Error("Invalid campaign");
  }

  const email = String(reviewerEmail || "")
    .trim()
    .toLowerCase();
  const assigned = String(item.reviewerEmail || "")
    .trim()
    .toLowerCase();
  if (!email || !assigned || email !== assigned) {
    throw new Error("Reviewer not authorized for this item");
  }

  const decisionNormalized = normalizeDecision(decision);
  if (!decisionNormalized) throw new Error("Invalid decision");

  const campaign = await Campaign.findById(item.campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (isCampaignDecisionLocked(campaign.status)) {
    throw new Error("Campaign is already closed/completed");
  }

  const now = new Date();
  const status = decisionToReviewStatus(decisionNormalized);
  const meta = compactAuditMetadata(metadata);

  // Atomic, condition-on-write update (WIS-020): re-verifies status is still
  // PENDING at the moment of write, closing the TOCTOU window between the
  // findById() check above and this save. Especially relevant here since
  // this path is reachable from an unauthenticated email link that could be
  // double-clicked or replayed concurrently.
  const updatedItem = await ReviewItem.findOneAndUpdate(
    { _id: reviewItemId, status: "PENDING" },
    {
      $set: {
        status,
        decision: decisionNormalized,
        comment: comment ?? "",
        reviewedAt: now,
        reviewerEmail: email,
        decisionSource,
        ...(meta?.ip ? { ipAddress: meta.ip } : {}),
        provisioningStatus: decisionNormalized === "Revoked" ? "PENDING" : "EXECUTED",
      },
    },
    { new: true },
  );
  if (!updatedItem) {
    throw new Error("Item already decided");
  }

  await recordCertDecisionAuditEvents({
    tenantId: campaign.tenantId,
    campaignId: updatedItem.campaignId,
    reviewerEmail: email,
    decisionNormalized,
    reviewItemRows: [updatedItem.toObject ? updatedItem.toObject() : updatedItem],
    mode: "single",
    decisionSource,
    metadata,
  });

  appendHistory(campaign, {
    at: now,
    by: email || "system",
    action: `decision_${decisionNormalized}`,
    itemIds: [String(updatedItem.itemId)],
    comment: comment ?? "",
    reviewItemId: updatedItem._id,
  });
  await campaign.save();

  await updateCampaignProgress(item.campaignId);
  return Campaign.findById(item.campaignId);
}

/**
 * Bulk: single updateMany + one history entry + progress.
 */
export async function applyBulkDecisionToReviewItems({
  campaignId,
  reviewerEmail,
  decision,
  comment,
  decisionSource = DECISION_SOURCE_EMAIL_LINK,
  metadata,
}) {
  const decisionNormalized = normalizeDecision(decision);
  if (!decisionNormalized) throw new Error("Invalid decision");

  const email = String(reviewerEmail || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("Missing reviewerEmail");

  const filter = {
    campaignId,
    reviewerEmail: email,
    status: "PENDING",
  };

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (isCampaignDecisionLocked(campaign.status)) {
    const stillPending = await ReviewItem.countDocuments(filter);
    if (stillPending === 0) {
      const campaignOut = await Campaign.findById(campaignId);
      return { campaign: campaignOut, affectedCount: 0 };
    }
    throw new Error("Campaign is already closed/completed");
  }

  const docs = await ReviewItem.find(filter, {
    _id: 1,
    itemId: 1,
    campaignId: 1,
  }).lean();

  for (const d of docs) {
    if (String(d.campaignId) !== String(campaignId)) {
      throw new Error("Invalid campaign");
    }
  }

  if (!docs.length) {
    await updateCampaignProgress(campaignId);
    const campaignOut = await Campaign.findById(campaignId);
    return { campaign: campaignOut, affectedCount: 0 };
  }

  const now = new Date();
  const status = decisionToReviewStatus(decisionNormalized);
  const meta = compactAuditMetadata(metadata);

  const updateResult = await ReviewItem.updateMany(filter, {
    $set: {
      status,
      decision: decisionNormalized,
      comment: comment ?? "",
      reviewedAt: now,
      reviewerEmail: email,
      decisionSource,
      ...(meta?.ip ? { ipAddress: meta.ip } : {}),
      provisioningStatus:
        decisionNormalized === "Revoked" ? "PENDING" : "EXECUTED",
    },
  });

  const modifiedCount =
    updateResult.modifiedCount ?? updateResult.nModified ?? docs.length;

  await recordCertDecisionAuditEvents({
    tenantId: campaign.tenantId,
    campaignId,
    reviewerEmail: email,
    decisionNormalized,
    reviewItemRows: docs,
    mode: "bulk",
    decisionSource,
    metadata,
  });

  appendHistory(campaign, {
    at: now,
    by: email || "system",
    action: `bulk_decision_${decisionNormalized}`,
    itemIds: [...new Set(docs.map((d) => String(d.itemId)))],
    comment: comment ?? "",
    reviewItemCount: docs.length,
  });
  await campaign.save();

  await updateCampaignProgress(campaign._id);
  const campaignOut = await Campaign.findById(campaignId);
  return { campaign: campaignOut, affectedCount: modifiedCount };
}

/**
 * SailPoint-style: apply a decision to one entitlement within a ReviewItem.
 * Updates the matching entitlementDecisions[] entry and rolls up the top-level
 * ReviewItem status once all entitlements have been decided.
 */
export async function applyEntitlementDecision({
  campaignId,
  reviewItemId,
  entitlementName,
  decision,
  comment,
  reviewerEmail,
  reviewerId,
  reviewerName,
  decisionSource = DECISION_SOURCE_CONSOLE,
  metadata,
}) {
  if (!campaignId || !reviewItemId || !entitlementName) {
    throw new Error("Missing required fields: campaignId, reviewItemId, entitlementName");
  }

  const decisionNormalized = normalizeDecision(decision);
  if (!decisionNormalized) throw new Error("Invalid decision");

  let item = await ReviewItem.findById(reviewItemId);
  if (!item) throw new Error("Review item not found");
  if (String(item.campaignId) !== String(campaignId)) throw new Error("Invalid campaign");

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (isCampaignDecisionLocked(campaign.status)) throw new Error("Campaign is already closed/completed");

  const email = String(reviewerEmail || "").trim().toLowerCase();
  const assigned = String(item.reviewerEmail || "").trim().toLowerCase();
  if (email && assigned && email !== assigned) {
    const isOwner = campaign.reviewersAssigned?.some((r) => {
      const re = String(r.email || r.reviewerEmail || "").toLowerCase();
      const rid = toStringId(r.reviewerId || r._id);
      return (re && re === email) || (reviewerId && rid && rid === toStringId(reviewerId));
    });
    if (!isOwner) throw new Error("Reviewer not authorized for this item");
  }

  if (!Array.isArray(item.entitlementDecisions) || item.entitlementDecisions.length === 0) {
    ensureEntitlementDecisions(item);
  }
  if (!Array.isArray(item.entitlementDecisions) || item.entitlementDecisions.length === 0) {
    throw new Error(
      "This review item has no entitlement decisions. Re-generate the campaign or use the standard decision endpoint.",
    );
  }

  const nameLower = entitlementName.trim().toLowerCase();
  const entryIndex = item.entitlementDecisions.findIndex(
    (ed) => String(ed.entitlementName || "").trim().toLowerCase() === nameLower,
  );
  if (entryIndex === -1) throw new Error(`Entitlement "${entitlementName}" not found on this review item`);
  if (item.entitlementDecisions[entryIndex].status !== "PENDING") {
    throw new Error(`Entitlement "${entitlementName}" has already been decided`);
  }

  const now = new Date();
  const entryStatus = decisionToEntitlementStatus(decisionNormalized);
  const exactEntitlementName = item.entitlementDecisions[entryIndex].entitlementName;

  // Atomic, condition-on-write update (WIS-020): re-verifies the entry is
  // still PENDING at the moment of write, closing the TOCTOU window between
  // the findById()/entryIndex check above and this save — two concurrent
  // requests for the same entitlement can no longer both succeed.
  const entitlementFieldUpdate = {
    "entitlementDecisions.$.status": entryStatus,
    "entitlementDecisions.$.decision": decisionNormalized,
    "entitlementDecisions.$.comment": comment ?? "",
    "entitlementDecisions.$.reviewedAt": now,
    "entitlementDecisions.$.remediationRequired": isRevokeRemediationStatus(entryStatus),
    ...(isRevokeRemediationStatus(entryStatus)
      ? {
          "entitlementDecisions.$.provisioningStatus": "PENDING",
          "entitlementDecisions.$.remediationStatus": "REVOKE_IN_PROGRESS",
        }
      : { "entitlementDecisions.$.provisioningStatus": "EXECUTED" }),
  };

  const atomicResult = await ReviewItem.findOneAndUpdate(
    {
      _id: reviewItemId,
      entitlementDecisions: {
        $elemMatch: { entitlementName: exactEntitlementName, status: "PENDING" },
      },
    },
    { $set: entitlementFieldUpdate },
    { new: true },
  );
  if (!atomicResult) {
    throw new Error(`Entitlement "${entitlementName}" has already been decided`);
  }
  item = atomicResult;

  // Rollup: if every entitlement is now decided, mark the ReviewItem itself as complete.
  const allDecided = item.entitlementDecisions.every((ed) => ed.status !== "PENDING");
  if (allDecided) {
    item.status = "APPROVED"; // "reviewed" — individual revocations live in entitlementDecisions
    item.decision = "Approved";
    item.reviewedAt = now;
    item.decisionSource = decisionSource;
    if (email) item.reviewerEmail = email;
    if (reviewerName) item.reviewerName = reviewerName;
    if (reviewerId) item.reviewerId = reviewerId;
    const meta = compactAuditMetadata(metadata);
    if (meta?.ip) item.ipAddress = meta.ip;
  }

  await item.save();

  const meta = compactAuditMetadata(metadata);
  await recordCertDecisionAuditEvents({
    tenantId: campaign.tenantId,
    campaignId,
    reviewerEmail: email || toStringId(reviewerId),
    reviewerName,
    reviewerId: toStringId(reviewerId) || undefined,
    decisionNormalized,
    previousDecision: null,
    reviewItemRows: [item.toObject ? item.toObject() : item],
    mode: "entitlement",
    decisionSource,
    metadata,
  });

  appendHistory(campaign, {
    at: now,
    by: email || toStringId(reviewerId) || "system",
    action: `entitlement_decision_${decisionNormalized}`,
    itemIds: [String(item.itemId)],
    entitlementName,
    comment: comment ?? "",
    reviewItemId: item._id,
  });
  await campaign.save();

  await updateCampaignProgress(campaign._id);
  return Campaign.findById(campaignId);
}

/**
 * Portal bulk: apply a decision to ALL pending entitlement-level decisions for a reviewer.
 * Falls back to item-level update for ReviewItems that have no entitlementDecisions[].
 */
export async function applyBulkEntitlementDecision({
  campaignId,
  reviewerEmail,
  decision,
  comment,
  decisionSource = DECISION_SOURCE_EMAIL_LINK,
  metadata,
}) {
  const decisionNormalized = normalizeDecision(decision);
  if (!decisionNormalized) throw new Error("Invalid decision");

  const email = String(reviewerEmail || "").trim().toLowerCase();
  if (!email) throw new Error("Missing reviewerEmail");

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (isCampaignDecisionLocked(campaign.status))
    throw new Error("Campaign is already closed/completed");

  const pendingItems = await ReviewItem.find({
    campaignId,
    reviewerEmail: email,
    status: "PENDING",
  });

  if (!pendingItems.length) {
    await updateCampaignProgress(campaignId);
    return { campaign: await Campaign.findById(campaignId), affectedCount: 0 };
  }

  const now = new Date();
  const entryStatus = decisionToEntitlementStatus(decisionNormalized);
  const itemStatus = decisionToReviewStatus(decisionNormalized);
  const meta = compactAuditMetadata(metadata);
  let affectedCount = 0;

  for (const item of pendingItems) {
    if (Array.isArray(item.entitlementDecisions) && item.entitlementDecisions.length > 0) {
      for (let i = 0; i < item.entitlementDecisions.length; i++) {
        if (item.entitlementDecisions[i].status === "PENDING") {
          item.entitlementDecisions[i].status = entryStatus;
          item.entitlementDecisions[i].decision = decisionNormalized;
          item.entitlementDecisions[i].comment = comment ?? "";
          item.entitlementDecisions[i].reviewedAt = now;
          if (isRevokeRemediationStatus(entryStatus)) {
            item.entitlementDecisions[i].provisioningStatus = "PENDING";
            item.entitlementDecisions[i].remediationStatus = "REVOKE_IN_PROGRESS";
          } else {
            item.entitlementDecisions[i].provisioningStatus = "EXECUTED";
          }
        }
      }
      item.status = "APPROVED";
      item.decision = "Approved";
      item.reviewedAt = now;
      item.decisionSource = decisionSource;
      if (email) item.reviewerEmail = email;
      if (meta?.ip) item.ipAddress = meta.ip;
    } else {
      item.status = itemStatus;
      item.decision = decisionNormalized;
      item.comment = comment ?? "";
      item.reviewedAt = now;
      item.decisionSource = decisionSource;
      if (email) item.reviewerEmail = email;
      if (meta?.ip) item.ipAddress = meta.ip;
    }
    await item.save();
    affectedCount++;
  }

  appendHistory(campaign, {
    at: now,
    by: email || "system",
    action: `bulk_entitlement_decision_${decisionNormalized}`,
    comment: comment ?? "",
    reviewItemCount: affectedCount,
  });
  await campaign.save();

  await updateCampaignProgress(campaignId);
  return { campaign: await Campaign.findById(campaignId), affectedCount };
}

/**
 * Owner / admin: apply APPROVE_ALL or REVOKE_ALL to every PENDING ReviewItem in a campaign.
 */
export async function finalizeAllPendingForCampaign({
  campaignId,
  disposition,
  actorId,
  actorEmail,
  comment = "",
  decisionSource = DECISION_SOURCE_CONSOLE,
  metadata,
}) {
  const action = String(disposition || "").toUpperCase();
  const decisionNormalized =
    action === "REVOKE_ALL"
      ? "Revoked"
      : action === "APPROVE_ALL"
        ? "Approved"
        : null;
  if (!decisionNormalized) {
    throw new Error('disposition must be "APPROVE_ALL" or "REVOKE_ALL"');
  }

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error("Campaign not found");
  if (isCampaignDecisionLocked(campaign.status)) {
    const pendingLeft = await ReviewItem.countDocuments({
      campaignId,
      status: "PENDING",
    });
    if (pendingLeft === 0) {
      return {
        campaign: await Campaign.findById(campaignId),
        affectedCount: 0,
      };
    }
    throw new Error("Campaign is already closed/completed");
  }

  const pendingItems = await ReviewItem.find({ campaignId, status: "PENDING" });
  if (!pendingItems.length) {
    await updateCampaignProgress(campaignId);
    return {
      campaign: await Campaign.findById(campaignId),
      affectedCount: 0,
    };
  }

  const now = new Date();
  const entryStatus = decisionToEntitlementStatus(decisionNormalized);
  const itemStatus = decisionToReviewStatus(decisionNormalized);
  const meta = compactAuditMetadata(metadata);
  const actorLabel =
    String(actorEmail || "").trim().toLowerCase() ||
    toStringId(actorId) ||
    "owner";
  let affectedCount = 0;

  for (const item of pendingItems) {
    if (
      Array.isArray(item.entitlementDecisions) &&
      item.entitlementDecisions.length > 0
    ) {
      for (let i = 0; i < item.entitlementDecisions.length; i++) {
        if (item.entitlementDecisions[i].status === "PENDING") {
          item.entitlementDecisions[i].status = entryStatus;
          item.entitlementDecisions[i].decision = decisionNormalized;
          item.entitlementDecisions[i].comment = comment ?? "";
          item.entitlementDecisions[i].reviewedAt = now;
          item.entitlementDecisions[i].remediationRequired =
            isRevokeRemediationStatus(entryStatus);
          if (isRevokeRemediationStatus(entryStatus)) {
            item.entitlementDecisions[i].provisioningStatus = "PENDING";
            item.entitlementDecisions[i].remediationStatus = "REVOKE_IN_PROGRESS";
          }
        }
      }
      const allDecided = item.entitlementDecisions.every(
        (ed) => ed.status !== "PENDING",
      );
      if (allDecided) {
        item.status = itemStatus;
        item.decision = decisionNormalized;
        item.reviewedAt = now;
      }
    } else {
      item.status = itemStatus;
      item.decision = decisionNormalized;
      item.comment = comment ?? "";
      item.reviewedAt = now;
    }
    item.decisionSource = decisionSource;
    if (meta?.ip) item.ipAddress = meta.ip;
    await item.save();
    affectedCount++;
  }

  const historyAction =
    action === "REVOKE_ALL"
      ? "owner_revoked_all_pending"
      : "owner_approved_all_pending";
  appendHistory(campaign, {
    at: now,
    by: actorLabel,
    action: historyAction,
    comment: comment ?? "",
    reviewItemCount: affectedCount,
  });

  campaign.adminAction = action;
  await campaign.save();

  await updateCampaignProgress(campaignId);
  const campaignOut = await Campaign.findById(campaignId);
  return { campaign: campaignOut, affectedCount };
}
