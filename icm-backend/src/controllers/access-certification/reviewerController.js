import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { AppError } from "../../middleware/errorHandler.js";
import { createRevokeAccessTask } from "../../services/workflowTaskQueue/workflowTaskQueueService.js";
import { auditMetadataFromRequest } from "../../utils/auditMetadata.js";
import { getReviewerProgress, getMissingReviewerCount } from "../../services/reviewItemService.js";
import { applyDecisionToCampaign, applyEntitlementDecision } from "../../services/access-certification/certificationDecisionService.js";
import { validateReviewerToken } from "../../services/access-certification/certificationTokenService.js";
import { buildReviewerAssignmentMap, buildReviewerEmailTokens } from "../../services/access-certification/certificationScopeService.js";
import {
  asObjectId, getUserId, assertTenantForCampaign, mapReviewerAssignment,
  shouldSkipReviewerAssignmentForCertApi, deriveReviewersFromPendingReviewItems,
} from "./certificationControllerHelpers.js";
import { itemIdsMatch } from "../../utils/access-certification/certificationItemId.js";

const isRevokeDecision = (d) =>
  String(d || "").trim().toLowerCase().startsWith("revoke");

/**
 * Best-effort enqueue of remediation workflow executions for revoked review
 * items. Never throws into the decision flow — a remediation failure must not
 * block the certification decision from being recorded.
 */
async function enqueueItemLevelRemediations({
  tenantId,
  campaignId,
  targets,
  eventOwner,
  workflowId = null,
}) {
  try {
    const ids = (targets || []).map(String);
    const objIds = ids
      .filter((x) => mongoose.isValidObjectId(x))
      .map((x) => new mongoose.Types.ObjectId(x));
    const or = [{ itemId: { $in: ids } }];
    if (objIds.length) or.push({ _id: { $in: objIds } });
    const items = await ReviewItem.find({
      campaignId,
      status: { $in: ["REVOKE_IN_PROGRESS", "REVOKED"] },
      $or: or,
    }).lean();
    if (!items.length) return;
    const campaign = await Campaign.findById(campaignId).select("name").lean();
    for (const ri of items) {
      await createRevokeAccessTask({
        tenantId,
        campaignId,
        campaignName: campaign?.name || "",
        reviewItem: ri,
        entitlementName: null,
        createdBy: eventOwner,
        workflowId,
      });
    }
  } catch (err) {
    console.warn("[reviewerController] workflow remediation enqueue failed:", err.message);
  }
}

export const getReviewerProgressHandler = async (req, res, next) => {
  try {
    const campaign = await Campaign.findById(req.params.id)
      .populate("reviewersAssigned.reviewerId", "firstName lastName email")
      .lean();

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const reviewers = await getReviewerProgress(campaign);
    const missingReviewerCount = await getMissingReviewerCount(campaign);

    return res.json({
      success: true,
      data: {
        reviewers,
        missingReviewerCount,
      },
    });
  } catch (err) {
    return next(err);
  }
};

/**
 * POST /campaigns/:id/repair-reviewers — recompute manager routing and set reviewerEmail
 * on PENDING ReviewItems (e.g. after upgrading assignment resolution for existing campaigns).
 */
export const repairCampaignReviewers = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate(
      "applicationId",
      "name tenantId",
    );
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }
    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const statusOk = new Set(["Active", "EndPhase", "DecisionPending"]);
    if (!statusOk.has(String(campaign.status || ""))) {
      return res.status(400).json({
        success: false,
        message:
          "Campaign must be Active, EndPhase, or DecisionPending to repair reviewers",
      });
    }

    const assignmentMap = await buildReviewerAssignmentMap(campaign.toObject());

    const reviewerNameByEmail = new Map();
    for (const r of campaign.reviewersAssigned || []) {
      const e = String(r?.email || r?.reviewerEmail || "")
        .trim()
        .toLowerCase();
      const n = String(r?.name || "").trim();
      if (e && n) reviewerNameByEmail.set(e, n);
    }

    const pending = await ReviewItem.find({
      campaignId: campaign._id,
      status: "PENDING",
    })
      .select("_id itemId reviewerEmail")
      .lean();

    let updated = 0;
    for (const ri of pending) {
      let newEmail = "";
      for (const [k, v] of assignmentMap.entries()) {
        if (itemIdsMatch(String(k), String(ri.itemId || ""))) {
          newEmail = String(v?.reviewerEmail || "")
            .trim()
            .toLowerCase();
          if (newEmail) break;
        }
      }
      if (!newEmail) continue;
      const old = String(ri.reviewerEmail || "")
        .trim()
        .toLowerCase();
      if (old === newEmail) continue;
      await ReviewItem.updateOne(
        { _id: ri._id },
        {
          $set: {
            reviewerEmail: newEmail,
            reviewerName: reviewerNameByEmail.get(newEmail) || undefined,
          },
        },
      );
      updated += 1;
    }

    return res.json({
      success: true,
      data: { updated, examined: pending.length },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCampaignReview = async (req, res) => {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const reviewerId = req.user?.id || undefined;
    const reviewerEmail = req.user?.email || undefined;
    const reviewerName =
      [req.user?.firstName, req.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || reviewerEmail;
    const body = req.body || {};
    const skipReviewerAssignmentGuard =
      shouldSkipReviewerAssignmentForCertApi(req);

    // Preferred contract: { itemIds: [], decision: "Approved"|"Revoked"|..., comment?: "" }
    const itemIds = Array.isArray(body.itemIds)
      ? body.itemIds
      : body.itemId
        ? [body.itemId]
        : Array.isArray(body.targets)
          ? body.targets
          : [];

    if (!itemIds.length) {
      return res
        .status(400)
        .json({ success: false, message: "itemIds are required" });
    }

    const decision =
      body.decision ?? body.action ?? body.reviewDecision ?? null;
    const comment = body.comment ?? body.comments ?? "";
    const workflowId = body.remediationWorkflowId || body.workflowId || null;

    const updatedCampaign = await applyDecisionToCampaign({
      campaignId,
      targets: itemIds,
      reviewerId,
      reviewerName,
      reviewerEmail,
      decision,
      comment,
      skipReviewerAssignmentGuard,
      metadata: auditMetadataFromRequest(req),
    });

    if (isRevokeDecision(decision)) {
      await enqueueItemLevelRemediations({
        tenantId: req.scopedTenantId,
        campaignId,
        targets: itemIds,
        eventOwner: reviewerEmail || reviewerName || "system",
        workflowId: workflowId ? String(workflowId).trim() : null,
      });
    }

    return res.json({ success: true, data: updatedCampaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const bulkOwnerDecision = async (req, res) => {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const rawToken = req.query.token || req.body.token;
    let tokenReviewerEmail = null;
    if (rawToken) {
      try {
        const v = validateReviewerToken(rawToken);
        if (String(v.campaignId) !== String(campaignId)) {
          return res.status(403).json({
            success: false,
            message: "Token does not match this campaign",
          });
        }
        tokenReviewerEmail = v.reviewerEmail;
      } catch (e) {
        return res.status(401).json({
          success: false,
          message: e?.message || "Invalid or expired token",
        });
      }
    }

    const body = req.body || {};

    let itemIds =
      (Array.isArray(body.itemIds) && body.itemIds) ||
      (Array.isArray(body.targets) && body.targets) ||
      (body.itemId ? [body.itemId] : []);

    // Preferred: { itemIds: [], decision: "Approved"|"Revoked"|..., comment?: "" }
    let decision = body.decision ?? body.action ?? null;
    if (!decision && typeof body.bulkDecision === "string") {
      const d = body.bulkDecision.toUpperCase();
      decision =
        d === "REVOKE_ALL"
          ? "Revoked"
          : d === "APPROVE_ALL"
            ? "Approved"
            : null;
    }
    const comment = body.comment ?? body.comments ?? "";

    if (!Array.isArray(itemIds) || !itemIds.length || !decision) {
      return res
        .status(400)
        .json({ success: false, message: "itemIds and decision are required" });
    }

    const reviewerId = req.user?.id || tokenReviewerEmail || undefined;
    const reviewerEmail = req.user?.email || tokenReviewerEmail || undefined;
    const reviewerName =
      [req.user?.firstName, req.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || reviewerEmail;

    const updatedCampaign = await applyDecisionToCampaign({
      campaignId,
      targets: itemIds,
      reviewerId,
      reviewerName,
      reviewerEmail,
      decision,
      comment,
      metadata: auditMetadataFromRequest(req),
    });

    // Record admin action on campaign
    const adminActionValue =
      decision === "Approved"
        ? "APPROVE_ALL"
        : decision === "Revoked"
          ? "REVOKE_ALL"
          : null;
    if (adminActionValue) {
      await Campaign.findByIdAndUpdate(campaignId, {
        adminAction: adminActionValue,
      });
    }

    return res.json({
      success: true,
      data: { updated: itemIds.length, campaign: updatedCampaign },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-campaign: reviewer progress + missing reviewer count
// ─────────────────────────────────────────────────────────────────────────────
export const getCampaignReviewerProgress = async (req, res, next) => {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const [reviewers, missingReviewerCount] = await Promise.all([
      getReviewerProgress(campaign),
      getMissingReviewerCount(campaign),
    ]);

    return res.json({
      success: true,
      data: { reviewers, missingReviewerCount },
    });
  } catch (err) {
    return next(err);
  }
};

// ─── Per-entitlement decision (SailPoint-style) ──────────────────────────────
export const applyEntitlementDecisionHandler = async (req, res, next) => {
  try {
    const { campaignId, reviewItemId } = req.params;
    await assertTenantForCampaign(req, campaignId, { notFound: true });
    const { entitlementName, decision, comment } = req.body;
    const reviewerId = req.user?._id || req.user?.id;
    const reviewerEmail = req.user?.email || "";
    const reviewerName =
      req.user?.name || req.user?.displayName || reviewerEmail;
    const metadata = auditMetadataFromRequest(req);

    const updatedCampaign = await applyEntitlementDecision({
      campaignId,
      reviewItemId,
      entitlementName,
      decision,
      comment,
      reviewerEmail,
      reviewerId,
      reviewerName,
      metadata,
    });

    if (isRevokeDecision(decision)) {
      try {
        const ri = await ReviewItem.findById(reviewItemId).lean();
        if (ri) {
          const campaign = await Campaign.findById(ri.campaignId).select("name").lean();
          await createRevokeAccessTask({
            tenantId: req.scopedTenantId,
            campaignId: ri.campaignId,
            campaignName: campaign?.name || "",
            reviewItem: ri,
            entitlementName,
            createdBy: reviewerEmail || reviewerName || "system",
            workflowId: req.body?.remediationWorkflowId || req.body?.workflowId || null,
          });
        }
      } catch (e) {
        console.warn("[reviewerController] entitlement remediation enqueue failed:", e.message);
      }
    }

    return res.json({ success: true, data: updatedCampaign });
  } catch (err) {
    return next(err);
  }
};
