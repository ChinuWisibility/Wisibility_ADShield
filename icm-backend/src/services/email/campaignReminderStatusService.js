import mongoose from "mongoose";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import CampaignAuditLog from "../../models/certification/CampaignAuditLog.js";
import EmailJob from "../../models/email/EmailJob.js";
import EmailDeliveryLog from "../../models/email/EmailDeliveryLog.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { jobTypeToReminderLogType } from "./reminderSchedulerService.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeCampaignId(campaignId) {
  if (!campaignId) return null;
  const raw = campaignId._id ?? campaignId;
  if (mongoose.isValidObjectId(raw)) {
    return new mongoose.Types.ObjectId(String(raw));
  }
  return raw;
}

function jobTypeToStatusKey(type) {
  switch (String(type || "").toUpperCase()) {
    case "ESCALATION":
      return "escalation";
    case "EXPIRY":
      return "expiry";
    case "REMINDER":
      return "standard";
    default:
      return null;
  }
}

function reminderLogTypeToStatusKey(reminderType) {
  switch (String(reminderType || "").toUpperCase()) {
    case "ESCALATION":
      return "escalation";
    case "EXPIRY":
      return "expiry";
    default:
      return "standard";
  }
}

function mergeStatusEntry(byReviewer, email, typeKey, entry) {
  if (!email || !typeKey || !entry?.sentAt) return;

  if (!byReviewer[email]) {
    byReviewer[email] = {
      recipientEmail: email,
      standard: null,
      escalation: null,
      expiry: null,
    };
  }

  const existing = byReviewer[email][typeKey];
  if (
    !existing ||
    new Date(entry.sentAt).getTime() > new Date(existing.sentAt).getTime()
  ) {
    byReviewer[email][typeKey] = entry;
  }
}

function collectReviewerEmails(campaign) {
  const emails = new Set();
  for (const r of campaign?.reviewersAssigned || []) {
    const e = normalizeEmail(r.email || r.reviewerEmail);
    if (e) emails.add(e);
  }
  if (campaign?.backupManagerReviewerEmail) {
    emails.add(normalizeEmail(campaign.backupManagerReviewerEmail));
  }
  return [...emails];
}

async function resolveReviewerEmails(campaignId, campaign) {
  const fromCampaign = collectReviewerEmails(campaign);
  if (fromCampaign.length > 0) return fromCampaign;

  const cid = normalizeCampaignId(campaignId);
  if (!cid) return [];

  const fromItems = await ReviewItem.distinct("reviewerEmail", {
    campaignId: cid,
  });
  return fromItems.map(normalizeEmail).filter(Boolean);
}

async function applyHistoryFallback(byReviewer, campaignId, campaign) {
  const history = Array.isArray(campaign?.history) ? campaign.history : [];
  const manualReminders = history
    .filter((h) => h?.action === "manual_reminder_triggered" && h?.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (manualReminders.length === 0) return;

  const latest = manualReminders[0];
  const sentAt = new Date(latest.at);
  const deliveryStatus =
    Number(latest.emailsSent) > 0
      ? "SENT"
      : Number(latest.failedDeliveries) > 0
        ? "FAILED"
        : "SENT";

  const targets = await resolveReviewerEmails(campaignId, campaign);
  const recipients =
    targets.length > 0 ? targets : ["__campaign__"];

  for (const email of recipients) {
    mergeStatusEntry(byReviewer, email, "standard", {
      sentAt,
      deliveryStatus,
      reminderType: "STANDARD",
      source: "campaign_history",
    });
  }
}

function buildCampaignSummary(byReviewerMap) {
  let latest = null;

  for (const [email, row] of Object.entries(byReviewerMap)) {
    for (const typeKey of ["standard", "escalation", "expiry"]) {
      const entry = row[typeKey];
      if (!entry?.sentAt) continue;
      if (
        !latest ||
        new Date(entry.sentAt).getTime() > new Date(latest.sentAt).getTime()
      ) {
        latest = {
          ...entry,
          type: typeKey,
          recipientEmail: email === "__campaign__" ? null : email,
        };
      }
    }
  }

  if (!latest) return null;

  return {
    lastReminderAt: latest.sentAt,
    lastReminderStatus: latest.deliveryStatus,
    reminderType: latest.reminderType,
    recipientEmail: latest.recipientEmail,
    source: latest.source,
  };
}

/**
 * Build per-reviewer reminder status from logs, queue, delivery audit, and history.
 * Tenant access must already be validated via assertTenantForCampaign.
 */
export async function buildCampaignReminderStatusByReviewer(
  campaignId,
  _tenantId,
  campaignDoc = null,
) {
  const byReviewer = {};
  const cid = normalizeCampaignId(campaignId);
  if (!cid) return { byReviewer: [], campaignSummary: null };

  const baseFilter = { campaignId: cid };

  // Exclude PENDING reservations — those are in-flight holds, not real sends.
  const logs = await CampaignReminderLog.find({
    ...baseFilter,
    deliveryStatus: { $ne: "PENDING" },
  })
    .sort({ sentAt: -1 })
    .lean();

  for (const log of logs) {
    const email = normalizeEmail(log.recipientEmail);
    const typeKey = reminderLogTypeToStatusKey(log.reminderType);
    mergeStatusEntry(byReviewer, email, typeKey, {
      sentAt: log.sentAt,
      deliveryStatus: log.deliveryStatus,
      reminderType: log.reminderType,
      source: "campaign_reminder_log",
    });
  }

  const auditEvents = await CampaignAuditLog.find({
    ...baseFilter,
    eventType: { $in: ["EMAIL_SENT", "EMAIL_FAILED"] },
    emailType: { $in: ["REMINDER", "ESCALATION", "EXPIRY"] },
  })
    .sort({ createdAt: -1 })
    .lean();

  for (const event of auditEvents) {
    const email = normalizeEmail(event.recipientEmail);
    const typeKey = jobTypeToStatusKey(event.emailType);
    mergeStatusEntry(byReviewer, email, typeKey, {
      sentAt: event.createdAt,
      deliveryStatus:
        event.eventType === "EMAIL_SENT" ? "SENT" : "FAILED",
      reminderType: jobTypeToReminderLogType(event.emailType),
      source: "campaign_audit_log",
    });
  }

  const jobs = await EmailJob.find({
    ...baseFilter,
    type: { $in: ["REMINDER", "ESCALATION", "EXPIRY"] },
    status: { $in: ["SENT", "FAILED", "PENDING", "PROCESSING"] },
  })
    .sort({ sentAt: -1, updatedAt: -1 })
    .lean();

  for (const job of jobs) {
    const email = normalizeEmail(job.recipientEmail);
    const typeKey = jobTypeToStatusKey(job.type);
    const deliveryStatus =
      job.status === "SENT"
        ? "SENT"
        : job.status === "FAILED"
          ? "FAILED"
          : "QUEUED";
    mergeStatusEntry(byReviewer, email, typeKey, {
      sentAt: job.sentAt || job.updatedAt || job.createdAt,
      deliveryStatus,
      reminderType: jobTypeToReminderLogType(job.type),
      source: "email_job",
    });
  }

  const deliveries = await EmailDeliveryLog.find({
    ...baseFilter,
    emailType: { $in: ["REMINDER", "ESCALATION", "EXPIRY"] },
  })
    .sort({ deliveredAt: -1 })
    .lean();

  for (const delivery of deliveries) {
    const email = normalizeEmail(delivery.recipientEmail);
    const typeKey = jobTypeToStatusKey(delivery.emailType);
    mergeStatusEntry(byReviewer, email, typeKey, {
      sentAt: delivery.deliveredAt,
      deliveryStatus: delivery.deliveryStatus,
      reminderType: jobTypeToReminderLogType(delivery.emailType),
      source: "email_delivery_log",
    });
  }

  if (campaignDoc) {
    await applyHistoryFallback(byReviewer, campaignId, campaignDoc);
  }

  const campaignSummary = buildCampaignSummary(byReviewer);

  const byReviewerList = Object.entries(byReviewer)
    .filter(([email]) => email !== "__campaign__")
    .map(([, row]) => row);

  return { byReviewer: byReviewerList, campaignSummary };
}
