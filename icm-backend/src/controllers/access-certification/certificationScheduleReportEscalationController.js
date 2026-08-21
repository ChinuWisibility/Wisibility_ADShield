import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import CertificationSchedule from "../../models/certification/CertificationSchedule.js";
import CertificationReport from "../../models/certification/CertificationReport.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import User from "../../models/platform/User.js";
import CertificationEscalation from "../../models/certification/CertificationEscalation.js";
import CertificationEscalationChain from "../../models/certification/CertificationEscalationChain.js";
import {
  assertTenantForCampaign,
  isPlatformActor,
  resolveUserTenantId,
} from "../../utils/access-certification/certificationTenantScope.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
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

function normalizeReportType(reportType) {
  const r = String(reportType ?? "")
    .trim()
    .toUpperCase();
  const allowed = new Set(["SUMMARY", "DETAILED", "SIGN_OFF", "REMEDIATION"]);
  return allowed.has(r) ? r : null;
}

function normalizeReportFormat(format) {
  const f = String(format ?? "")
    .trim()
    .toUpperCase();
  const allowed = new Set(["PDF", "XLSX", "CSV"]);
  return allowed.has(f) ? f : "CSV";
}

function normalizeEscalationReason(reason) {
  const r = String(reason ?? "")
    .trim()
    .toUpperCase();
  const allowed = new Set(["NO_RESPONSE", "UNAVAILABLE", "CONFLICT"]);
  return allowed.has(r) ? r : "NO_RESPONSE";
}

async function getTenantDocumentScope(req) {
  if (isPlatformActor(req)) return {};
  const tenantId = await resolveUserTenantId(req);
  if (!tenantId) return null;
  return { tenantId };
}

export async function pauseSchedule(req, res) {
  try {
    const scheduleId = asObjectId(req.params.id);
    if (!scheduleId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid schedule id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const schedule = await CertificationSchedule.findOne({
      _id: scheduleId,
      ...tenantScope,
    });
    if (!schedule)
      return res
        .status(404)
        .json({ success: false, message: "Schedule not found" });

    schedule.isActive = false;
    await schedule.save();
    return res.json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function resumeSchedule(req, res) {
  try {
    const scheduleId = asObjectId(req.params.id);
    if (!scheduleId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid schedule id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const schedule = await CertificationSchedule.findOne({
      _id: scheduleId,
      ...tenantScope,
    });
    if (!schedule)
      return res
        .status(404)
        .json({ success: false, message: "Schedule not found" });

    schedule.isActive = true;
    // Ensure nextRunAt is set if missing.
    if (!schedule.nextRunAt) {
      schedule.nextRunAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    await schedule.save();
    return res.json({ success: true, data: schedule });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

function frequencyToDays(freq) {
  switch (String(freq ?? "").toUpperCase()) {
    case "QUARTERLY":
      return 90;
    case "SEMI_ANNUAL":
      return 180;
    case "ANNUAL":
      return 365;
    case "MONTHLY":
    default:
      return 30;
  }
}

export async function runScheduleNow(req, res) {
  try {
    const scheduleId = asObjectId(req.params.id);
    if (!scheduleId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid schedule id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const schedule = await CertificationSchedule.findOne({
      _id: scheduleId,
      ...tenantScope,
    });
    if (!schedule)
      return res
        .status(404)
        .json({ success: false, message: "Schedule not found" });

    const tpl = schedule.campaignTemplate || {};
    const now = new Date();

    const campaign = await Campaign.create({
      applicationId: schedule.applicationId,
      applicationName: tpl.applicationName || undefined,
      name:
        tpl.name ||
        `${schedule.scheduleName} - ${now.toISOString().slice(0, 10)}`,
      description: tpl.description || undefined,
      category: tpl.category || "IDENTITY",
      campaignMode: tpl.campaignMode || "PRIVILEGED_ONLY",
      identityFilter: tpl.identityFilter || "ALL",
      status: tpl.status || "DecisionPending",
      startDate: tpl.startDate ? new Date(tpl.startDate) : now,
      dueDate: tpl.dueDate
        ? new Date(tpl.dueDate)
        : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      reminderFrequency: tpl.reminderFrequency || "GLOBAL",
      escalationConfig: tpl.escalationConfig || undefined,
      recurrenceEnabled: false,
      recurrenceRule: undefined,
      nextRunDate: undefined,
      reviewersAssigned: tpl.reviewersAssigned || [],
      totalScope: tpl.totalScope || 0,
      history: [
        ...(Array.isArray(tpl.history) ? tpl.history : []),
        {
          at: now,
          by: req.user?.id || "system",
          action: "schedule_campaign_created",
          scheduleId: schedule._id.toString(),
        },
      ],
      sourceContext: {
        ...(tpl.sourceContext || {}),
        scheduleId: schedule._id,
        source: "certification-schedule",
      },
      tenantId: schedule.tenantId || undefined,
      createdBy: req.user?.id || undefined,
      updatedBy: req.user?.id || undefined,
    });

    // Update schedule bookkeeping
    schedule.lastRunAt = now;
    schedule.lastCampaignId = campaign._id;
    schedule.runCount = (schedule.runCount || 0) + 1;
    schedule.nextRunAt = new Date(
      now.getTime() + frequencyToDays(schedule.frequency) * 24 * 60 * 60 * 1000,
    );
    await schedule.save();

    return res
      .status(201)
      .json({ success: true, data: { schedule, campaign } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getScheduleHistory(req, res) {
  try {
    const scheduleId = asObjectId(req.params.id);
    if (!scheduleId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid schedule id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.max(Number(req.query.limit || 50), 1);

    const filter = { "sourceContext.scheduleId": scheduleId, ...tenantScope };

    const [items, total] = await Promise.all([
      Campaign.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Campaign.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { items, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function generateCampaignReport(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const reportType = normalizeReportType(
      req.body?.reportType || req.body?.type || "SUMMARY",
    );
    if (!reportType)
      return res
        .status(400)
        .json({ success: false, message: "Invalid reportType" });

    const format = normalizeReportFormat(req.body?.format || "CSV");

    const [campaign, results] = await Promise.all([
      Campaign.findById(campaignId).lean(),
      ReviewItem.find({ campaignId }).lean(),
    ]);

    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    const totalsByDecision = {};
    for (const r of results) {
      totalsByDecision[r.decision] = (totalsByDecision[r.decision] || 0) + 1;
    }

    const report = await CertificationReport.create({
      campaignId,
      tenantId: campaign.tenantId || undefined,
      reportType,
      format,
      generatedBy: req.user?.id || undefined,
      stats: {
        campaign: {
          name: campaign.name,
          category: campaign.category,
          status: campaign.status,
        },
        totalsByDecision,
        generatedAt: new Date().toISOString(),
      },
      fileLocation: `generated://report/${String(campaignId)}/${Date.now()}`,
      signOffStatus: reportType === "SIGN_OFF" ? "PENDING" : undefined,
      createdBy: req.user?.id || undefined,
      updatedBy: req.user?.id || undefined,
    });

    return res.status(201).json({ success: true, data: report });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function listCampaignReports(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.max(Number(req.query.limit || 50), 1);

    const filter = { campaignId, ...tenantScope };
    const [items, total] = await Promise.all([
      CertificationReport.find(filter)
        .sort({ generatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CertificationReport.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { items, total, page, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function downloadReport(req, res) {
  try {
    const reportId = asObjectId(req.params.id);
    if (!reportId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid report id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const report = await CertificationReport.findOne({
      _id: reportId,
      ...tenantScope,
    }).lean();
    if (!report)
      return res
        .status(404)
        .json({ success: false, message: "Report not found" });

    await assertTenantForCampaign(req, report.campaignId, { notFound: true });

    if (report.format !== "CSV") {
      return res.status(501).json({
        success: false,
        message: `Download for format ${report.format} not implemented yet`,
      });
    }

    const results = await ReviewItem.find({
      campaignId: report.campaignId,
    }).lean();
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
      `attachment; filename=report_${reportId}.csv`,
    );
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function triggerEscalation(req, res) {
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

    const {
      originalReviewerId,
      escalatedToId,
      escalationReason,
      escalatedToEmail,
    } = req.body || {};

    if (!originalReviewerId || !escalatedToId) {
      return res.status(400).json({
        success: false,
        message: "originalReviewerId and escalatedToId are required",
      });
    }

    let originalReviewerEmail = req.body?.originalReviewerEmail
      ? String(req.body.originalReviewerEmail).toLowerCase()
      : null;
    if (!originalReviewerEmail && originalReviewerId) {
      const u = await User.findById(originalReviewerId).select("email").lean();
      originalReviewerEmail = u?.email
        ? String(u.email).toLowerCase()
        : null;
    }

    if (!originalReviewerEmail) {
      return res.status(400).json({
        success: false,
        message: "original reviewer email could not be resolved",
      });
    }

    const pendingItems = await ReviewItem.find({
      campaignId,
      status: "PENDING",
    }).lean();

    const pendingBefore = [];
    const toReassignIds = [];
    for (const ri of pendingItems) {
      const entryEmail = String(ri.reviewerEmail || "").toLowerCase();
      const matchesOriginal =
        Boolean(originalReviewerEmail) && entryEmail === originalReviewerEmail;

      if (!matchesOriginal) continue;

      pendingBefore.push(ri.itemId);
      toReassignIds.push(ri._id);
    }

    let resolvedEscalatedEmail = escalatedToEmail
      ? String(escalatedToEmail).toLowerCase()
      : "";
    if (!resolvedEscalatedEmail && Array.isArray(campaign.reviewersAssigned)) {
      const found = campaign.reviewersAssigned.find(
        (r) =>
          String(r.reviewerId) === String(escalatedToId) ||
          String(r.email || "").toLowerCase() ===
            String(escalatedToId).toLowerCase(),
      );
      resolvedEscalatedEmail = found?.email
        ? String(found.email).toLowerCase()
        : "";
    }

    if (toReassignIds.length && resolvedEscalatedEmail) {
      await ReviewItem.updateMany(
        { _id: { $in: toReassignIds } },
        { $set: { reviewerEmail: resolvedEscalatedEmail } },
      );
    }
    campaign.history = campaign.history || [];
    campaign.history.push({
      at: new Date(),
      by: req.user?.id || "system",
      action: "escalation_triggered",
      originalReviewerId: String(originalReviewerId),
      escalatedToId: String(escalatedToId),
      escalationReason: escalationReason || "NO_RESPONSE",
      itemIds: pendingBefore,
    });

    await campaign.save();

    const escalationAt = new Date();
    const originalReviewerOid = asObjectId(originalReviewerId);
    const escalatedToOid = asObjectId(escalatedToId);

    const escalation = await CertificationEscalation.create({
      campaignId,
      tenantId: campaign.tenantId || undefined,
      originalReviewerId: originalReviewerOid,
      originalReviewerEmail,
      escalatedToId: escalatedToOid,
      escalatedToEmail: resolvedEscalatedEmail || undefined,
      escalatedBy: req.user?._id || req.user?.id || undefined,
      escalatedByEmail: req.user?.email || undefined,
      escalationReason: normalizeEscalationReason(escalationReason),
      escalatedAt: escalationAt,
      pendingItems: pendingBefore.length,
      createdBy: req.user?.id || undefined,
      updatedBy: req.user?.id || undefined,
    });

    // Record the hop in the escalation chain for multi-hop reconstruction.
    CertificationEscalationChain.countDocuments({ campaignId })
      .then((existingHops) =>
        CertificationEscalationChain.create({
          tenantId: campaign.tenantId || undefined,
          campaignId,
          escalationId: escalation._id,
          hopNumber: existingHops + 1,
          fromReviewerId: originalReviewerOid,
          fromReviewerEmail: originalReviewerEmail,
          toReviewerId: escalatedToOid,
          toReviewerEmail: resolvedEscalatedEmail || undefined,
          reason: normalizeEscalationReason(escalationReason),
          escalatedBy: req.user?._id || req.user?.id || undefined,
          escalatedByEmail: req.user?.email || undefined,
          escalatedAt: escalationAt,
          itemsTransferred: toReassignIds,
        }),
      )
      .catch((e) =>
        console.warn("[triggerEscalation] EscalationChain write failed:", e?.message),
      );

    return res.status(201).json({ success: true, data: escalation });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function resolveEscalation(req, res) {
  try {
    const escalationId = asObjectId(req.params.id);
    if (!escalationId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid escalation id" });

    const tenantScope = await getTenantDocumentScope(req);
    if (!tenantScope)
      return res.status(403).json({
        success: false,
        message: "Tenant not found for the current user",
      });

    const escalation = await CertificationEscalation.findOne({
      _id: escalationId,
      ...tenantScope,
    });
    if (!escalation)
      return res
        .status(404)
        .json({ success: false, message: "Escalation not found" });

    await assertTenantForCampaign(req, escalation.campaignId, {
      notFound: true,
    });

    escalation.resolvedAt = new Date();
    escalation.updatedBy = req.user?.id || escalation.updatedBy;
    await escalation.save();

    const campaign = await Campaign.findById(escalation.campaignId);
    if (campaign) {
      campaign.history = campaign.history || [];
      campaign.history.push({
        at: new Date(),
        by: req.user?.id || "system",
        action: "escalation_resolved",
        escalationId: escalation._id.toString(),
      });
      await campaign.save();
    }

    return res.json({ success: true, data: escalation });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function configureAutoEscalation(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId)
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const { escalateAfterDays, escalateToId, escalationReason } =
      req.body || {};

    if (typeof escalateAfterDays !== "number" || !escalateToId) {
      return res.status(400).json({
        success: false,
        message: "escalateAfterDays (number) and escalateToId are required",
      });
    }

    const campaign = await Campaign.findById(campaignId);
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    campaign.escalationConfig = {
      ...(campaign.escalationConfig || {}),
      escalateAfterDays,
      escalateToId,
      escalationReason: escalationReason || "NO_RESPONSE",
    };

    campaign.history = campaign.history || [];
    campaign.history.push({
      at: new Date(),
      by: req.user?.id || "system",
      action: "escalation_config_updated",
      escalateAfterDays,
      escalateToId: String(escalateToId),
    });

    await campaign.save();
    return res.json({ success: true, data: campaign.escalationConfig });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
