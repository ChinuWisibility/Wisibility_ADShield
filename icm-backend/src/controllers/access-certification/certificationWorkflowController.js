import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { applyDecisionToCampaign } from "../../services/access-certification/certificationDecisionService.js";
import {
  assertTenantForCampaign,
  getTenantCampaignScopeQuery,
} from "../../utils/access-certification/certificationTenantScope.js";
import { auditMetadataFromRequest } from "../../utils/auditMetadata.js";
import { ingestRevokeAccessFromCampaign } from "../../services/remediation/remediationQueueIngestionService.js";

function normalizeDecisionQuery(decision) {
  const d = String(decision ?? "")
    .trim()
    .toLowerCase();
  if (!d) return null;
  if (["approved", "approve"].includes(d)) return "Approved";
  if (["revoked", "revoke"].includes(d)) return "Revoked";
  if (["delegate", "delegated", "reassign"].includes(d)) return "Delegate";
  if (["exception", "ex"].includes(d)) return "Exception";
  return null;
}

export async function completeCampaign(req, res, next) {
  try {
    const tenantScope = await getTenantCampaignScopeQuery(req);
    const campaign = await Campaign.findOne({
      _id: req.params.id,
      ...tenantScope,
    });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, error: { message: "Campaign not found" } });
    }

    const stats = await ReviewItem.aggregate([
      { $match: { campaignId: campaign._id } },
      { $group: { _id: "$decision", count: { $sum: 1 } } },
    ]);

    const updated = await Campaign.findByIdAndUpdate(
      req.params.id,
      {
        status: "Completed",
        endDate: new Date(),
        completionPercentage: 100,
        updatedBy: req.user.id,
      },
      { new: true },
    );

    ingestRevokeAccessFromCampaign(req.params.id).catch((e) =>
      console.error("[completeCampaign] remediation queue ingest failed:", e.message),
    );

    return res.json({ success: true, data: { campaign: updated, stats } });
  } catch (err) {
    return next(err);
  }
}

export async function listCampaignItems(req, res, next) {
  try {
    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const { page = 1, limit = 20, decision } = req.query;
    const query = { campaignId: req.params.id };
    const normalized = decision ? normalizeDecisionQuery(decision) : null;
    if (normalized) query.decision = normalized;

    const [items, total] = await Promise.all([
      ReviewItem.find(query)
        .sort({ createdAt: -1 })
        .skip((Number(page) - 1) * Number(limit))
        .limit(Number(limit)),
      ReviewItem.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    return next(err);
  }
}

export async function decideItem(req, res, next) {
  try {
    const existingItem = await ReviewItem.findById(req.params.id).select(
      "_id campaignId itemId",
    );

    if (!existingItem) {
      return res
        .status(404)
        .json({ success: false, error: { message: "Review item not found" } });
    }

    await assertTenantForCampaign(req, existingItem.campaignId, {
      notFound: true,
    });

    const { decision, comments } = req.body;

    await applyDecisionToCampaign({
      campaignId: existingItem.campaignId,
      targets: [existingItem.itemId],
      reviewerId: req.user.id,
      reviewerEmail: req.user.email,
      reviewerName: [req.user?.firstName, req.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
      decision,
      comment: comments,
      metadata: auditMetadataFromRequest(req),
    });

    const item = await ReviewItem.findById(req.params.id);
    return res.json({ success: true, data: item });
  } catch (err) {
    return next(err);
  }
}

export async function bulkDecideItems(req, res, next) {
  try {
    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    const { itemIds, decision, comments } = req.body;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: { message: "itemIds are required" } });
    }

    const eligibleItems = await ReviewItem.find({
      _id: { $in: itemIds },
      campaignId: req.params.id,
    }).select("itemId");

    if (eligibleItems.length !== itemIds.length) {
      return res.status(400).json({
        success: false,
        error: { message: "Some items are invalid for this campaign" },
      });
    }

    const targets = eligibleItems.map((e) => String(e.itemId));

    await applyDecisionToCampaign({
      campaignId: req.params.id,
      targets,
      reviewerId: req.user.id,
      reviewerEmail: req.user.email,
      reviewerName: [req.user?.firstName, req.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
      decision,
      comment: comments,
      metadata: auditMetadataFromRequest(req),
    });

    return res.json({ success: true, data: { updated: itemIds.length } });
  } catch (err) {
    return next(err);
  }
}
