import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { updateCampaignProgress } from "../../services/access-certification/certificationDecisionService.js";
import CertificationDecisionOverride from "../../models/certification/CertificationDecisionOverride.js";
import CertificationReviewerActionLog from "../../models/certification/CertificationReviewerActionLog.js";
import { auditMetadataFromRequest } from "../../utils/auditMetadata.js";
import {
  assertTenantForCampaign,
  getTenantCampaignScopeQuery,
} from "../../utils/access-certification/certificationTenantScope.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function normalizeDecision(decision) {
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

const PROVISIONING_STATUS = {
  PENDING: "PENDING",
  EXECUTED: "EXECUTED",
  FAILED: "FAILED",
};

const FINAL_DECISIONS = new Set([
  "Approved",
  "Revoked",
  "Delegate",
  "Exception",
]);

function decisionToStatus(decision) {
  if (decision === "Revoked") return "REVOKED";
  if (decision === "Delegate") return "DELEGATED";
  if (decision === "Exception") return "EXCEPTION";
  return "APPROVED";
}

export async function enableRecurring(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const { recurrenceEnabled, recurrenceRule, nextRunDate } = req.body || {};

    const campaign = await Campaign.findById(campaignId);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    if (typeof recurrenceEnabled === "boolean")
      campaign.recurrenceEnabled = recurrenceEnabled;
    if (typeof recurrenceRule === "string" && recurrenceRule.trim())
      campaign.recurrenceRule = recurrenceRule.trim();

    if (nextRunDate) {
      const parsed = new Date(nextRunDate);
      if (Number.isNaN(parsed.getTime())) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid nextRunDate" });
      }
      campaign.nextRunDate = parsed;
    } else if (!campaign.nextRunDate) {
      // Fallback: set a conservative next run date.
      // We keep it simple here; later you can replace with a cron-based scheduler.
      campaign.nextRunDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    await campaign.save();
    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getCampaignProgress(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const now = new Date();
    const due = campaign.dueDate ? new Date(campaign.dueDate) : null;

    const reviewRows = await ReviewItem.find({ campaignId }).lean();
    const progressByReviewer = new Map();

    for (const ri of reviewRows) {
      const reviewerKey = String(ri.reviewerEmail || "").toLowerCase();
      if (!reviewerKey) continue;

      if (!progressByReviewer.has(reviewerKey)) {
        progressByReviewer.set(reviewerKey, {
          reviewerId: reviewerKey,
          total: 0,
          completed: 0,
          overdue: false,
        });
      }

      const p = progressByReviewer.get(reviewerKey);
      p.total += 1;

      if (ri.status !== "PENDING") {
        p.completed += 1;
      }
    }

    // Compute overdue after aggregation.
    if (
      due &&
      campaign.status !== "Closed" &&
      campaign.status !== "Completed"
    ) {
      for (const p of progressByReviewer.values()) {
        p.overdue = due < now && p.completed < p.total;
      }
    }

    const items = Array.from(progressByReviewer.values()).map((p) => ({
      ...p,
      percentage: p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0,
      pending: Math.max(0, p.total - p.completed),
    }));

    return res.json({ success: true, data: { campaignId, items } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function closeCampaign(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const campaign = await Campaign.findById(campaignId);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    campaign.status = "Closed";
    campaign.endDate = new Date();
    await campaign.save();

    return res.json({ success: true, data: campaign });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/** Neutralizes CSV/Excel formula injection (CWE-1236) — a cell starting with
 * =, +, -, or @ is treated as a formula by Excel/Sheets when opened. */
function neutralizeFormula(s) {
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvEscape(value) {
  let s = value === null || value === undefined ? "" : String(value);
  s = neutralizeFormula(s);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportCampaignData(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const results = await ReviewItem.find({ campaignId }).lean();

    const headers = [
      "campaignId",
      "itemId",
      "reviewerEmail",
      "decision",
      "comment",
      "reviewedAt",
      "provisioningStatus",
    ];
    const lines = [headers.join(",")];

    for (const r of results) {
      lines.push(
        [
          r.campaignId?.toString?.() ?? "",
          r.itemId ?? "",
          r.reviewerEmail ?? "",
          r.decision ?? "",
          r.comment ?? "",
          r.reviewedAt ? new Date(r.reviewedAt).toISOString() : "",
          r.provisioningStatus ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=campaign_${campaignId}_export.csv`,
    );
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getCampaignResults(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.max(Number(req.query.limit || 20), 1);

    const { decision } = req.query;
    const normalized = decision ? normalizeDecision(decision) : null;

    const query = { campaignId };
    if (normalized) query.decision = normalized;
    if (normalized === "Revoked")
      query.provisioningStatus = PROVISIONING_STATUS.PENDING;

    const [items, total] = await Promise.all([
      ReviewItem.find(query)
        .sort({ reviewedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ReviewItem.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: {
        items,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getResultDetail(req, res) {
  try {
    const item = await ReviewItem.findById(req.params.id).lean();
    if (!item)
      return res
        .status(404)
        .json({ success: false, message: "Result not found" });

    await assertTenantForCampaign(req, item.campaignId, { notFound: true });

    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function overrideDecision(req, res) {
  try {
    const result = await ReviewItem.findById(req.params.id);
    if (!result)
      return res
        .status(404)
        .json({ success: false, message: "Result not found" });

    await assertTenantForCampaign(req, result.campaignId, { notFound: true });

    const decision = normalizeDecision(req.body?.decision);
    if (!decision)
      return res
        .status(400)
        .json({ success: false, message: "Invalid decision" });

    const comment = req.body?.comment ?? req.body?.reason ?? "";
    const meta = auditMetadataFromRequest(req);

    const previousDecision = result.decision || null;
    const now = new Date();

    result.decision = decision;
    result.status = decisionToStatus(decision);
    result.comment = comment;
    result.reviewedAt = now;
    result.reviewerEmail = req.user?.email || "";
    result.reviewerName =
      [req.user?.firstName, req.user?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() || "";
    result.decisionSource = "CONSOLE";
    if (meta?.ip) result.ipAddress = meta.ip;
    result.provisioningStatus =
      decision === "Revoked" ? PROVISIONING_STATUS.PENDING : "EXECUTED";
    await result.save();

    const campaign = await Campaign.findById(result.campaignId);
    if (campaign) {
      campaign.history = campaign.history || [];
      campaign.history.push({
        at: now,
        by: req.user?.id || "system",
        action: "result_override",
        reviewItemId: result._id.toString(),
        previousDecision,
        decision,
      });
      await campaign.save();
    }

    // Write dedicated override audit records (best-effort).
    const overrideReason = comment || "Admin override";
    Promise.all([
      CertificationDecisionOverride.create({
        tenantId: campaign?.tenantId,
        campaignId: result.campaignId,
        reviewItemId: result._id,
        previousDecision,
        newDecision: decision,
        overriddenBy: req.user?._id || req.user?.id,
        overriddenByEmail: req.user?.email,
        overrideReason,
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        overriddenAt: now,
      }),
      CertificationReviewerActionLog.create({
        tenantId: campaign?.tenantId,
        campaignId: result.campaignId,
        reviewItemId: result._id,
        reviewerId: req.user?._id || req.user?.id,
        reviewerEmail: req.user?.email,
        reviewerName:
          [req.user?.firstName, req.user?.lastName]
            .filter(Boolean)
            .join(" ")
            .trim() || req.user?.email,
        action: "OVERRIDE",
        previousDecision,
        newDecision: decision,
        comment,
        decisionSource: "CONSOLE",
        ipAddress: meta?.ip,
        userAgent: meta?.userAgent,
        actedAt: now,
      }),
    ]).catch((e) =>
      console.warn("[overrideDecision] audit write failed:", e?.message),
    );

    await updateCampaignProgress(result.campaignId);

    return res.json({
      success: true,
      data: result.toObject ? result.toObject() : result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getRevokedItems(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const items = await ReviewItem.find({
      campaignId,
      decision: "Revoked",
      provisioningStatus: PROVISIONING_STATUS.PENDING,
    })
      .sort({ reviewedAt: -1 })
      .lean();

    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function markProvisioned(req, res) {
  try {
    const result = await ReviewItem.findById(req.params.id);
    if (!result)
      return res
        .status(404)
        .json({ success: false, message: "Result not found" });

    await assertTenantForCampaign(req, result.campaignId, { notFound: true });

    result.provisioningStatus = PROVISIONING_STATUS.EXECUTED;
    await result.save();

    const campaign = await Campaign.findById(result.campaignId);
    if (campaign) {
      campaign.history = campaign.history || [];
      campaign.history.push({
        at: new Date(),
        by: req.user?.id || "system",
        action: "provisioned",
        reviewItemId: result._id.toString(),
      });
      await campaign.save();
    }

    return res.json({
      success: true,
      data: result.toObject ? result.toObject() : result,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getPendingProvisioning(req, res) {
  try {
    const tenantScope = await getTenantCampaignScopeQuery(req);
    const tenantCampaignIds = await Campaign.find(tenantScope)
      .select("_id")
      .lean()
      .then((docs) => docs.map((d) => d._id));

    const items = await ReviewItem.find({
      campaignId: { $in: tenantCampaignIds },
      decision: "Revoked",
      provisioningStatus: PROVISIONING_STATUS.PENDING,
    })
      .sort({ reviewedAt: -1 })
      .lean();

    return res.json({ success: true, data: items });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
