import Campaign from "../../models/certification/Campaign.js";
import {
  applyBulkDecisionToReviewItems,
  applyDecisionToReviewItem,
  applyEntitlementDecision,
  applyBulkEntitlementDecision,
  DECISION_SOURCE_EMAIL_LINK,
} from "../../services/access-certification/certificationDecisionService.js";
import {
  validateReviewerToken,
} from "../../services/access-certification/certificationTokenService.js";
import { getReviewItemsForReviewer } from "../../services/access-certification/reviewItemService.js";
import { buildPortalItemDetails } from "./certificationTokenController.js";
import { auditMetadataFromRequest } from "../../utils/auditMetadata.js";
import CertificationReviewerPortalSession from "../../models/certification/CertificationReviewerPortalSession.js";
import {
  enqueuePortalRevokeRemediation,
  enqueueBulkPortalRevokeRemediations,
  isRevokeDecision,
} from "../../services/workflow/certificationPortalWorkflowService.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function isProfileIdentityCampaign(campaign) {
  return (
    String(campaign?.certificationScope || "").toUpperCase() === "PROFILE" &&
    String(campaign?.category || "").toUpperCase() === "IDENTITY"
  );
}

function resolvePortalDetail(detailById, itemId) {
  const key = normalizeText(itemId);
  if (!key) return {};
  return detailById.get(key) || detailById.get(key.toLowerCase()) || {};
}

function synthesizeEntitlementDecisions(reviewItem, accessDetails, detail = {}) {
  const existing = Array.isArray(reviewItem.entitlementDecisions)
    ? reviewItem.entitlementDecisions
    : [];
  if (existing.length > 0) return existing;

  const fromDetail = Array.isArray(detail.entitlementDecisions)
    ? detail.entitlementDecisions
    : [];
  if (fromDetail.length > 0) return fromDetail;

  const names = Array.isArray(accessDetails) ? accessDetails : [];
  const appName =
    normalizeText(reviewItem.itemApplicationName) ||
    normalizeText(detail.appName) ||
    "";
  return names
    .map((name) => normalizeText(name))
    .filter(Boolean)
    .map((entitlementName) => ({
      entitlementName,
      applicationName: appName || undefined,
      status: "PENDING",
    }));
}

function mapReviewItemForPortal(ri, campaign, detailById) {
  const detail = resolvePortalDetail(detailById, ri.itemId);
  const accessDetails =
    Array.isArray(ri.itemAccessDetails) && ri.itemAccessDetails.length > 0
      ? ri.itemAccessDetails
      : Array.isArray(detail.accessDetails)
        ? detail.accessDetails
        : [];

  return {
    reviewItemId: ri._id,
    itemId: ri.itemId,
    status: ri.status,
    decision: ri.decision,
    identityName:
      normalizeText(ri.itemName) ||
      detail.identityName ||
      normalizeText(ri.userId) ||
      "Unknown User",
    identityEmail:
      normalizeText(ri.itemEmail) ||
      detail.identityEmail ||
      "",
    appName:
      normalizeText(ri.itemApplicationName) ||
      detail.appName ||
      normalizeText(campaign.applicationName) ||
      "—",
    role:
      normalizeText(ri.itemTitle) ||
      detail.role ||
      "—",
    accessDetails,
    entitlementDecisions: synthesizeEntitlementDecisions(ri, accessDetails, detail),
    manager: normalizeText(ri.itemManager) || detail.manager || "",
    managerEmail: normalizeText(ri.itemManagerEmail) || detail.managerEmail || "",
    department: normalizeText(ri.itemDepartment) || detail.department || "",
    userId: normalizeText(ri.userId) || "",
    userPrimaryKey: normalizeText(ri.userPrimaryKey) || "",
    employeeId:
      normalizeText(ri.userPrimaryKey) ||
      detail.employeeId ||
      normalizeText(ri.itemId) ||
      normalizeText(ri.userId) ||
      "",
    reviewItemType: ri.reviewItemType || "",
  };
}

function updatePortalSessionOnDecision(campaignId, reviewerEmail, metadata) {
  const email = String(reviewerEmail || "").trim().toLowerCase();
  if (!email || !campaignId) return;
  const update = { $inc: { decisionsCount: 1 } };
  if (metadata?.ip) update.$addToSet = { ...(update.$addToSet || {}), ipAddresses: metadata.ip };
  if (metadata?.userAgent) update.$addToSet = { ...(update.$addToSet || {}), userAgents: metadata.userAgent };
  CertificationReviewerPortalSession
    .findOneAndUpdate({ campaignId: String(campaignId), reviewerEmail: email }, update)
    .catch(() => {});
}

/**
 * GET /api/certifications/review?token=<JWT>
 */
export async function getReviewSession(req, res) {
  try {
    const raw = req.query.token;
    if (!raw) {
      return res.status(400).json({ success: false, message: "Missing token" });
    }

    let payload;
    try {
      payload = validateReviewerToken(raw);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const { reviewerEmail, campaignId, sub: reviewerId } = payload;
    const campaign = await Campaign.findById(campaignId)
      .select(
        "name dueDate category certificationScope applicationName status applicationId reviewersAssigned tenantId",
      )
      .lean();
    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    const statusFilter = req.query.status;
    const reviewRows = await getReviewItemsForReviewer(campaignId, reviewerEmail, {
      status: statusFilter || undefined,
      reviewerId: reviewerId || undefined,
    });

    const tokenEmail = String(reviewerEmail || "").trim().toLowerCase();
    // Match by reviewerId (stable) first; fall back to email for items without an id.
    const myRows = reviewRows.filter((ri) => {
      if (reviewerId && ri.reviewerId) return String(ri.reviewerId) === String(reviewerId);
      return String(ri.reviewerEmail || "").trim().toLowerCase() === tokenEmail;
    });

    const profileIdentity = isProfileIdentityCampaign(campaign);
    const needsEnrichment =
      profileIdentity ||
      myRows.some(
        (ri) =>
          !normalizeText(ri.itemEmail) ||
          !normalizeText(ri.itemTitle) ||
          !normalizeText(ri.itemDepartment) ||
          !normalizeText(ri.itemManager) ||
          (!(Array.isArray(ri.entitlementDecisions) && ri.entitlementDecisions.length > 0) &&
            !(Array.isArray(ri.itemAccessDetails) && ri.itemAccessDetails.length > 0)),
      );

    let detailById = new Map();
    if (needsEnrichment) {
      const itemIds = myRows.map((r) => r.itemId).filter(Boolean);
      detailById = await buildPortalItemDetails({ campaign, itemIds });
    }

    const items = myRows.map((ri) => mapReviewItemForPortal(ri, campaign, detailById));

    const reviewerName = (() => {
      const assigned = Array.isArray(campaign.reviewersAssigned)
        ? campaign.reviewersAssigned
        : [];
      const match = assigned.find(
        (r) =>
          String(r?.email || r?.reviewerEmail || "")
            .trim()
            .toLowerCase() === tokenEmail,
      );
      return normalizeText(match?.name) || "";
    })();

    return res.json({
      success: true,
      data: {
        campaign: {
          id: campaign._id,
          name: campaign.name,
          dueDate: campaign.dueDate,
          category: campaign.category,
          certificationScope: campaign.certificationScope || "",
          status: campaign.status,
        },
        reviewer: { email: reviewerEmail, id: reviewerId || null, name: reviewerName },
        items,
        tokenType: "jwt",
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/certifications/decision  { token, reviewItemId, decision, comment? }
 */
export async function postReviewDecision(req, res) {
  try {
    const { token, reviewItemId, decision, comment, remediationWorkflowId } = req.body || {};
    if (!token || !reviewItemId || !decision) {
      return res.status(400).json({
        success: false,
        message: "token, reviewItemId, and decision are required",
      });
    }

    let payload;
    try {
      payload = validateReviewerToken(token);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const { reviewerEmail, campaignId: sessionCampaignId } = payload;

    const meta = auditMetadataFromRequest(req);
    const updated = await applyDecisionToReviewItem({
      reviewItemId,
      decision,
      reviewerEmail,
      comment: comment ?? "",
      expectedCampaignId: sessionCampaignId,
      decisionSource: DECISION_SOURCE_EMAIL_LINK,
      metadata: meta,
    });

    updatePortalSessionOnDecision(sessionCampaignId, reviewerEmail, meta);

    if (isRevokeDecision(decision)) {
      await enqueuePortalRevokeRemediation({
        campaignId: sessionCampaignId,
        reviewItemId,
        reviewerEmail,
      });
    }

    return res.json({ success: true, data: { campaign: updated } });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/certifications/entitlement-decision
 * { token, reviewItemId, entitlementName, decision, comment? }
 */
export async function postEntitlementDecision(req, res) {
  try {
    const {
      token,
      reviewItemId,
      entitlementName,
      decision,
      comment,
      remediationWorkflowId,
    } = req.body || {};
    if (!token || !reviewItemId || !entitlementName || !decision) {
      return res.status(400).json({
        success: false,
        message: "token, reviewItemId, entitlementName, and decision are required",
      });
    }

    let payload;
    try {
      payload = validateReviewerToken(token);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const { reviewerEmail, campaignId } = payload;
    const meta = auditMetadataFromRequest(req);

    const updated = await applyEntitlementDecision({
      campaignId,
      reviewItemId,
      entitlementName,
      decision,
      comment: comment ?? "",
      reviewerEmail,
      reviewerId: null,
      reviewerName: reviewerEmail,
      decisionSource: DECISION_SOURCE_EMAIL_LINK,
      metadata: meta,
    });

    updatePortalSessionOnDecision(campaignId, reviewerEmail, meta);

    if (isRevokeDecision(decision)) {
      await enqueuePortalRevokeRemediation({
        campaignId,
        reviewItemId,
        entitlementName,
        reviewerEmail,
      });
    }

    return res.json({ success: true, data: { campaign: updated } });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/certifications/bulk-entitlement-decision
 * { token, decision, comment? }
 */
export async function postBulkEntitlementDecision(req, res) {
  try {
    const { token, decision, comment, remediationWorkflowId } = req.body || {};
    if (!token || !decision) {
      return res.status(400).json({ success: false, message: "token and decision are required" });
    }

    let payload;
    try {
      payload = validateReviewerToken(token);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const { reviewerEmail, campaignId } = payload;
    const meta = auditMetadataFromRequest(req);

    const { campaign: updated, affectedCount } = await applyBulkEntitlementDecision({
      campaignId,
      reviewerEmail,
      decision,
      comment: comment ?? "",
      decisionSource: DECISION_SOURCE_EMAIL_LINK,
      metadata: meta,
    });

    if (affectedCount > 0) {
      updatePortalSessionOnDecision(campaignId, reviewerEmail, meta);
    }

    if (isRevokeDecision(decision) && affectedCount > 0) {
      await enqueueBulkPortalRevokeRemediations({
        campaignId,
        reviewerEmail,
      });
    }

    return res.json({ success: true, data: { itemCount: affectedCount, campaign: updated } });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/**
 * POST /api/certifications/bulk-decision  { token, decision, comment? }
 */
export async function postReviewBulkDecision(req, res) {
  try {
    const { token, decision, comment, remediationWorkflowId } = req.body || {};
    if (!token || !decision) {
      return res
        .status(400)
        .json({ success: false, message: "token and decision are required" });
    }

    let payload;
    try {
      payload = validateReviewerToken(token);
    } catch (e) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const { reviewerEmail, campaignId } = payload;

    const meta = auditMetadataFromRequest(req);
    const { campaign: updated, affectedCount } =
      await applyBulkDecisionToReviewItems({
        campaignId,
        reviewerEmail,
        decision,
        comment: comment ?? "",
        decisionSource: DECISION_SOURCE_EMAIL_LINK,
        metadata: meta,
      });

    if (affectedCount > 0) {
      updatePortalSessionOnDecision(campaignId, reviewerEmail, meta);
    }

    if (isRevokeDecision(decision) && affectedCount > 0) {
      const items = await (
        await import("../../models/certification/ReviewItem.js")
      ).default.find({
        campaignId,
        reviewerEmail: String(reviewerEmail || "").trim().toLowerCase(),
        status: "REVOKED",
      }).lean();
      for (const ri of items) {
        await enqueuePortalRevokeRemediation({
          campaignId,
          reviewItemId: ri._id,
          reviewerEmail,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        itemCount: affectedCount,
        campaign: updated,
      },
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
