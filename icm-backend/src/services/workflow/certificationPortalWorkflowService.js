import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { createRevokeAccessTask } from "../workflowTaskQueue/workflowTaskQueueService.js";

export function isRevokeDecision(decision) {
  return String(decision || "")
    .trim()
    .toLowerCase()
    .startsWith("revoke");
}

function isRevokeRemediationStatus(status) {
  return status === "REVOKED" || status === "REVOKE_IN_PROGRESS";
}

/**
 * After a portal revoke decision is saved, enqueue workflow task (best-effort).
 */
export async function enqueuePortalRevokeRemediation({
  campaignId,
  reviewItemId,
  entitlementName = null,
  reviewerEmail,
}) {
  if (!reviewItemId) return null;
  try {
    const campaign = await Campaign.findById(campaignId).select("name tenantId").lean();
    const ri = await ReviewItem.findById(reviewItemId).lean();
    if (!campaign || !ri || String(ri.campaignId) !== String(campaignId)) return null;

    return await createRevokeAccessTask({
      tenantId: campaign.tenantId ? String(campaign.tenantId) : null,
      campaignId,
      campaignName: campaign.name || "",
      reviewItem: ri,
      entitlementName: entitlementName || null,
      createdBy: reviewerEmail || "certification-portal",
    });
  } catch (err) {
    console.warn("[certificationPortalWorkflow] queue task failed:", err.message);
    return null;
  }
}

/** Enqueue workflow tasks for revoked entitlements (bulk revoke). */
export async function enqueueBulkPortalRevokeRemediations({
  campaignId,
  reviewerEmail,
}) {
  const email = String(reviewerEmail || "").trim().toLowerCase();
  if (!email) return;

  const campaign = await Campaign.findById(campaignId).select("name tenantId").lean();
  if (!campaign) return;

  const items = await ReviewItem.find({
    campaignId,
    reviewerEmail: email,
  }).lean();

  for (const ri of items) {
    if (Array.isArray(ri.entitlementDecisions) && ri.entitlementDecisions.length) {
      for (const ed of ri.entitlementDecisions) {
        if (isRevokeRemediationStatus(ed.status)) {
          await createRevokeAccessTask({
            tenantId: campaign.tenantId ? String(campaign.tenantId) : null,
            campaignId,
            campaignName: campaign.name || "",
            reviewItem: ri,
            entitlementName: ed.entitlementName,
            createdBy: reviewerEmail,
          });
        }
      }
    } else if (isRevokeRemediationStatus(ri.status)) {
      await createRevokeAccessTask({
        tenantId: campaign.tenantId ? String(campaign.tenantId) : null,
        campaignId,
        campaignName: campaign.name || "",
        reviewItem: ri,
        entitlementName: null,
        createdBy: reviewerEmail,
      });
    }
  }
}
