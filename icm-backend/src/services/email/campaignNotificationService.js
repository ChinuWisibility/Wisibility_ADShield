import mongoose from "mongoose";
import EmailJob from "../../models/email/EmailJob.js";
import EmailDeliveryLog from "../../models/email/EmailDeliveryLog.js";
import CampaignAuditLog from "../../models/certification/CampaignAuditLog.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { recordCertificationEmailAudit } from "./campaignEmailAuditService.js";
import { getReviewerProgress } from "../reviewItemService.js";
import Campaign from "../../models/certification/Campaign.js";
import { buildTenantScopedCampaignFilter } from "./tenantCampaignFilter.js";

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

function buildNotificationQuery(campaignId, tenantId) {
  const cid = normalizeCampaignId(campaignId);
  return buildTenantScopedCampaignFilter(cid, tenantId);
}

function formatJobDisplayStatus(job) {
  const status = String(job?.status || "").toUpperCase();
  const attempts = Number(job?.attempts) || 0;
  if (status === "PENDING" && attempts > 0) return "RETRYING";
  return status || "UNKNOWN";
}

function reminderLogTypeToJobType(reminderType) {
  switch (String(reminderType || "").toUpperCase()) {
    case "ESCALATION":
      return "ESCALATION";
    case "EXPIRY":
      return "EXPIRY";
    default:
      return "REMINDER";
  }
}

function pickLatest(a, b) {
  if (!a) return b;
  if (!b) return a;
  const aTime = new Date(a.at || a.sentAt || a.createdAt || 0).getTime();
  const bTime = new Date(b.at || b.sentAt || b.createdAt || 0).getTime();
  return bTime >= aTime ? b : a;
}

function mergeTypeStatus(existing, entry) {
  if (!entry?.at) return existing;
  if (!existing?.at) return entry;
  return pickLatest(existing, entry);
}

function typeSentStatusFromEntry(entry) {
  if (!entry) return { sent: false, status: "NONE", at: null, source: null };
  const status = String(entry.status || entry.deliveryStatus || "SENT").toUpperCase();
  const display =
    status === "SENT" || status === "DELIVERED"
      ? "SENT"
      : status === "FAILED" || status === "BOUNCED"
        ? "FAILED"
        : status;
  return {
    sent: display === "SENT",
    status: display,
    at: entry.at || entry.sentAt || entry.createdAt,
    source: entry.source || null,
  };
}

function pickLatestJobByType(jobs, type) {
  const filtered = jobs.filter(
    (j) => String(j.type || "").toUpperCase() === type,
  );
  if (filtered.length === 0) return null;
  filtered.sort(
    (a, b) =>
      new Date(b.sentAt || b.updatedAt || b.createdAt).getTime() -
      new Date(a.sentAt || a.updatedAt || a.createdAt).getTime(),
  );
  return filtered[0];
}

const TIMELINE_LABELS = {
  EMAIL_ENQUEUED: "Email queued",
  EMAIL_SENT: "Email sent",
  EMAIL_FAILED: "Email failed",
  EMAIL_DEDUPE_SKIPPED: "Duplicate send skipped",
  EMAIL_RETRY_SCHEDULED: "Retry scheduled",
  DELIVERY_SENT: "Delivery confirmed",
  DELIVERY_FAILED: "Delivery failed",
  DELIVERY_BOUNCED: "Delivery bounced",
  CAMPAIGN_ACTIVATED: "Campaign activated",
  manual_reminder_triggered: "Manual reminder triggered",
  escalation_triggered: "Escalation sent",
  escalation_resolved: "Escalation resolved",
};

const TYPED_SEND_LABELS = {
  LAUNCH: "Launch email sent",
  REMINDER: "Reminder sent",
  ESCALATION: "Escalation sent",
  EXPIRY: "Expiry notice sent",
};

function formatTimelineLabel(eventType, emailType) {
  const type = String(emailType || "").toUpperCase();
  if (eventType === "EMAIL_SENT" && TYPED_SEND_LABELS[type]) {
    return TYPED_SEND_LABELS[type];
  }
  if (eventType === "DELIVERY_SENT" && TYPED_SEND_LABELS[type]) {
    return TYPED_SEND_LABELS[type];
  }
  return (
    TIMELINE_LABELS[eventType] ||
    String(eventType || "Event").replace(/_/g, " ")
  );
}

function timelineDedupeKey(item) {
  const email = normalizeEmail(item.recipientEmail);
  const type = String(item.emailType || "").toUpperCase();
  const day = new Date(item.at).toISOString().slice(0, 10);
  const bucket = Math.floor(new Date(item.at).getTime() / 60000);
  return `${email}::${type}::${day}::${bucket}::${item.eventType}`;
}

function dedupeTimelineItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const email = normalizeEmail(item.recipientEmail);
    const type = String(item.emailType || "").toUpperCase();
    const time = new Date(item.at).getTime();

    if (
      email &&
      type &&
      (item.eventType === "EMAIL_SENT" || item.eventType === "DELIVERY_SENT")
    ) {
      const pairKey = `${email}::${type}::${Math.floor(time / 60000)}`;
      if (item.eventType === "DELIVERY_SENT") {
        const sentKey = `${pairKey}::EMAIL_SENT`;
        if (seen.has(sentKey)) continue;
        seen.add(`${pairKey}::DELIVERY_SENT`);
        seen.add(sentKey);
        result.push(item);
        continue;
      }
      if (seen.has(`${pairKey}::DELIVERY_SENT`)) continue;
      seen.add(`${pairKey}::EMAIL_SENT`);
      result.push(item);
      continue;
    }

    const key = timelineDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function buildReminderCountMap(reminderLogs) {
  const counts = new Map();
  for (const log of reminderLogs) {
    if (log.deliveryStatus !== "SENT") continue;
    if (String(log.reminderType || "").toUpperCase() === "ESCALATION") continue;
    const email = normalizeEmail(log.recipientEmail);
    if (!email) continue;
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  return counts;
}

const AUDIT_EVENT_TYPES = [
  "EMAIL_ENQUEUED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "EMAIL_DEDUPE_SKIPPED",
  "EMAIL_RETRY_SCHEDULED",
];

async function loadCampaignContext(campaignId, tenantId) {
  const cid = normalizeCampaignId(campaignId);
  if (!cid) return null;
  return Campaign.findById(cid)
    .select(
      "tenantId reviewersAssigned backupManagerReviewerEmail backupManagerReviewerName backupReviewerSource history startDate status createdAt",
    )
    .lean();
}

async function resolveReviewerNameMap(campaign) {
  const reviewerNameByEmail = new Map();
  if (!campaign) return reviewerNameByEmail;

  try {
    const reviewers = await getReviewerProgress(campaign);
    for (const r of reviewers || []) {
      const email = normalizeEmail(r.email);
      if (email) reviewerNameByEmail.set(email, r.name || email);
    }
  } catch {
    // best-effort
  }

  for (const r of campaign.reviewersAssigned || []) {
    const email = normalizeEmail(r.email || r.reviewerEmail);
    if (email && !reviewerNameByEmail.has(email)) {
      reviewerNameByEmail.set(email, r.name || r.email || email);
    }
  }

  if (campaign.backupManagerReviewerEmail) {
    const backup = normalizeEmail(campaign.backupManagerReviewerEmail);
    if (backup && !reviewerNameByEmail.has(backup)) {
      reviewerNameByEmail.set(
        backup,
        campaign.backupManagerReviewerName || backup,
      );
    }
  }

  return reviewerNameByEmail;
}

async function collectAllReviewerEmails(campaignId, campaign, extraEmails = []) {
  const emails = new Set(extraEmails.map(normalizeEmail).filter(Boolean));

  for (const r of campaign?.reviewersAssigned || []) {
    const e = normalizeEmail(r.email || r.reviewerEmail);
    if (e) emails.add(e);
  }
  if (campaign?.backupManagerReviewerEmail) {
    emails.add(normalizeEmail(campaign.backupManagerReviewerEmail));
  }

  const cid = normalizeCampaignId(campaignId);
  if (cid) {
    const fromItems = await ReviewItem.distinct("reviewerEmail", {
      campaignId: cid,
    });
    for (const e of fromItems) {
      const n = normalizeEmail(e);
      if (n) emails.add(n);
    }
  }

  return [...emails];
}

function isBackupReviewerEmail(campaign, recipientEmail) {
  const backup = normalizeEmail(campaign?.backupManagerReviewerEmail);
  const email = normalizeEmail(recipientEmail);
  return Boolean(backup && email && backup === email);
}

function buildNotificationMeta(campaign) {
  const backupEmail = normalizeEmail(campaign?.backupManagerReviewerEmail);
  return {
    backupReviewer: backupEmail
      ? {
          email: backupEmail,
          name: campaign?.backupManagerReviewerName || backupEmail,
          source: campaign?.backupReviewerSource || null,
        }
      : null,
    retryPolicy: {
      maxAttempts: Number(process.env.EMAIL_JOB_MAX_ATTEMPTS || 4),
      backoffMinutes: [1, 5, 15],
      description:
        "Failed queue jobs retry automatically (1 min, 5 min, 15 min). After max attempts the job stays FAILED until an admin clicks Retry.",
      manualRetry: "Resets a FAILED queue job to PENDING for immediate worker pickup.",
      legacyNote:
        "Legacy rows were sent before the email queue existed — use the campaign Reminder button to send again.",
    },
  };
}

function legacyEntriesFromHistory(campaign) {
  const history = Array.isArray(campaign?.history) ? campaign.history : [];
  const manualReminders = history
    .filter((h) => h?.action === "manual_reminder_triggered" && h?.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (manualReminders.length === 0) return [];

  const latest = manualReminders[0];
  const sentAt = new Date(latest.at);
  const deliveryStatus =
    Number(latest.emailsSent) > 0
      ? "SENT"
      : Number(latest.failedDeliveries) > 0
        ? "FAILED"
        : "SENT";

  return [
    {
      type: "REMINDER",
      recipientEmail: null,
      status: deliveryStatus,
      at: sentAt,
      source: "campaign_history",
      legacy: true,
    },
  ];
}

function buildLegacySyntheticJobs(reminderLogs, deliveryLogs, historyEntries) {
  const synthetics = [];
  const seen = new Set();

  for (const log of reminderLogs) {
    const email = normalizeEmail(log.recipientEmail);
    const type = reminderLogTypeToJobType(log.reminderType);
    const key = `${email}::${type}::${log.sentAt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    synthetics.push({
      _id: null,
      type,
      recipientEmail: email,
      status:
        log.deliveryStatus === "FAILED" || log.deliveryStatus === "BOUNCED"
          ? "FAILED"
          : "SENT",
      sentAt: log.sentAt,
      updatedAt: log.sentAt,
      createdAt: log.sentAt,
      attempts: 0,
      maxAttempts: 0,
      nextRunAt: null,
      lastError: null,
      subject: `${type} (legacy log)`,
      legacy: true,
      source: "campaign_reminder_log",
    });
  }

  for (const dl of deliveryLogs) {
    const email = normalizeEmail(dl.recipientEmail);
    const type = String(dl.emailType || "REMINDER").toUpperCase();
    const key = `dl::${email}::${type}::${dl.deliveredAt}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const alreadyFromReminder = synthetics.some(
      (s) =>
        normalizeEmail(s.recipientEmail) === email &&
        s.type === type &&
        Math.abs(new Date(s.sentAt).getTime() - new Date(dl.deliveredAt).getTime()) <
          60000,
    );
    if (alreadyFromReminder) continue;

    synthetics.push({
      _id: null,
      type,
      recipientEmail: email,
      status:
        dl.deliveryStatus === "FAILED" || dl.deliveryStatus === "BOUNCED"
          ? "FAILED"
          : "SENT",
      sentAt: dl.deliveredAt,
      updatedAt: dl.deliveredAt,
      createdAt: dl.deliveredAt,
      attempts: 0,
      maxAttempts: 0,
      nextRunAt: null,
      lastError: dl.errorMessage || null,
      subject: `${type} (delivery log)`,
      legacy: true,
      source: "email_delivery_log",
    });
  }

  for (const h of historyEntries) {
    if (!h.recipientEmail) continue;
    const email = normalizeEmail(h.recipientEmail);
    const key = `hist::${email}::${h.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    synthetics.push({
      _id: null,
      type: h.type,
      recipientEmail: email,
      status: h.status,
      sentAt: h.at,
      updatedAt: h.at,
      createdAt: h.at,
      attempts: 0,
      maxAttempts: 0,
      nextRunAt: null,
      lastError: null,
      subject: `${h.type} (campaign history)`,
      legacy: true,
      source: "campaign_history",
    });
  }

  return synthetics;
}

function buildReviewerTypeMap(allJobs, reminderLogs, deliveryLogs, historyEntries) {
  const byEmail = new Map();

  const ensure = (email) => {
    const key = normalizeEmail(email);
    if (!key) return null;
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        launch: null,
        reminder: null,
        escalation: null,
        expiry: null,
        latest: null,
      });
    }
    return byEmail.get(key);
  };

  for (const job of allJobs) {
    const email = normalizeEmail(job.recipientEmail);
    const row = ensure(email);
    if (!row) continue;
    const type = String(job.type || "").toUpperCase();
    const entry = {
      at: job.sentAt || job.updatedAt || job.createdAt,
      status: formatJobDisplayStatus(job),
      source: job.legacy ? job.source || "legacy" : "email_job",
    };
    if (type === "LAUNCH") row.launch = mergeTypeStatus(row.launch, entry);
    else if (type === "REMINDER") row.reminder = mergeTypeStatus(row.reminder, entry);
    else if (type === "ESCALATION")
      row.escalation = mergeTypeStatus(row.escalation, entry);
    row.latest = pickLatest(row.latest, { ...entry, type });
  }

  for (const log of reminderLogs) {
    const email = normalizeEmail(log.recipientEmail);
    const row = ensure(email);
    if (!row) continue;
    const type = reminderLogTypeToJobType(log.reminderType);
    const entry = {
      at: log.sentAt,
      status: log.deliveryStatus || "SENT",
      source: "campaign_reminder_log",
    };
    if (type === "REMINDER") row.reminder = mergeTypeStatus(row.reminder, entry);
    else if (type === "ESCALATION")
      row.escalation = mergeTypeStatus(row.escalation, entry);
    row.latest = pickLatest(row.latest, { ...entry, type });
  }

  for (const dl of deliveryLogs) {
    const email = normalizeEmail(dl.recipientEmail);
    const row = ensure(email);
    if (!row) continue;
    const type = String(dl.emailType || "REMINDER").toUpperCase();
    const entry = {
      at: dl.deliveredAt,
      status: dl.deliveryStatus || "SENT",
      source: "email_delivery_log",
    };
    if (type === "LAUNCH") row.launch = mergeTypeStatus(row.launch, entry);
    else if (type === "REMINDER") row.reminder = mergeTypeStatus(row.reminder, entry);
    else if (type === "ESCALATION")
      row.escalation = mergeTypeStatus(row.escalation, entry);
    row.latest = pickLatest(row.latest, { ...entry, type });
  }

  for (const h of historyEntries) {
    if (!h.recipientEmail) continue;
    const row = ensure(h.recipientEmail);
    if (!row) continue;
    const entry = {
      at: h.at,
      status: h.status,
      source: "campaign_history",
    };
    row.reminder = mergeTypeStatus(row.reminder, entry);
    row.latest = pickLatest(row.latest, { ...entry, type: "REMINDER" });
  }

  return byEmail;
}

function buildLifecycleTimelineEvents(campaign) {
  const items = [];
  if (!campaign) return items;

  if (campaign.startDate) {
    items.push({
      at: campaign.startDate,
      eventType: "CAMPAIGN_ACTIVATED",
      label: TIMELINE_LABELS.CAMPAIGN_ACTIVATED,
      emailType: null,
      recipientEmail: null,
      details: { status: campaign.status },
      source: "campaign_lifecycle",
    });
  }

  const history = Array.isArray(campaign.history) ? campaign.history : [];
  for (const entry of history) {
    if (!entry?.at || !entry?.action) continue;
    const label = TIMELINE_LABELS[entry.action];
    if (!label) continue;
    items.push({
      at: entry.at,
      eventType: entry.action,
      label,
      emailType:
        entry.action === "escalation_triggered" ? "ESCALATION" : null,
      recipientEmail: null,
      details: {
        emailsSent: entry.emailsSent,
        failedDeliveries: entry.failedDeliveries,
        attemptedRecipients: entry.attemptedRecipients,
      },
      source: "campaign_history",
    });
  }

  return items;
}

function buildTimeline(auditEvents, deliveryLogs, campaign = null) {
  const items = [...buildLifecycleTimelineEvents(campaign)];

  for (const ev of auditEvents) {
    items.push({
      at: ev.createdAt,
      eventType: ev.eventType,
      label: formatTimelineLabel(ev.eventType, ev.emailType),
      emailType: ev.emailType,
      recipientEmail: ev.recipientEmail,
      emailJobId: ev.emailJobId,
      details: ev.details || null,
      source: "campaign_audit_log",
    });
  }

  for (const dl of deliveryLogs) {
    const st = String(dl.deliveryStatus || "").toUpperCase();
    const eventKey =
      st === "SENT" || st === "DELIVERED"
        ? "DELIVERY_SENT"
        : st === "BOUNCED"
          ? "DELIVERY_BOUNCED"
          : "DELIVERY_FAILED";
    items.push({
      at: dl.deliveredAt,
      eventType: eventKey,
      label: formatTimelineLabel(eventKey, dl.emailType),
      emailType: dl.emailType,
      recipientEmail: dl.recipientEmail,
      emailJobId: dl.emailJobId,
      details: {
        provider: dl.provider,
        providerMessageId: dl.providerMessageId,
        errorMessage: dl.errorMessage,
      },
      source: "email_delivery_log",
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return dedupeTimelineItems(items).slice(0, 100);
}

function countLegacySent(reminderLogs, deliveryLogs) {
  let count = 0;
  const seen = new Set();
  for (const log of reminderLogs) {
    if (log.deliveryStatus === "SENT") {
      const k = `${normalizeEmail(log.recipientEmail)}::${log.sentAt}`;
      if (!seen.has(k)) {
        seen.add(k);
        count++;
      }
    }
  }
  for (const dl of deliveryLogs) {
    if (dl.deliveryStatus === "SENT" || dl.deliveryStatus === "DELIVERED") {
      const k = `dl::${normalizeEmail(dl.recipientEmail)}::${dl.deliveredAt}`;
      if (!seen.has(k)) {
        seen.add(k);
        count++;
      }
    }
  }
  return count;
}

function mapJobRow(job, reviewerNameByEmail, campaign) {
  const email = normalizeEmail(job.recipientEmail);
  return {
    id: job._id || null,
    type: job.type,
    recipientEmail: job.recipientEmail,
    recipientName: reviewerNameByEmail.get(email) || job.recipientEmail,
    status: formatJobDisplayStatus(job),
    rawStatus: job.status,
    attempts: job.attempts || 0,
    maxAttempts: job.maxAttempts || 4,
    nextRunAt: job.nextRunAt,
    sentAt: job.sentAt,
    lastError: job.lastError,
    subject: job.subject,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    legacy: Boolean(job.legacy),
    isBackupReviewer: isBackupReviewerEmail(campaign, email),
    source: job.source || (job.legacy ? "legacy" : "email_job"),
    canRetry:
      Boolean(job._id) &&
      !job.legacy &&
      String(job.status || "").toUpperCase() !== "SENT",
  };
}

function applyJobFilters(jobs, typeFilter, statusFilter) {
  let result = jobs;

  if (typeFilter && typeFilter !== "ALL") {
    result = result.filter(
      (j) => String(j.type || "").toUpperCase() === typeFilter,
    );
  }

  if (statusFilter && statusFilter !== "ALL") {
    if (statusFilter === "RETRYING") {
      result = result.filter(
        (j) =>
          String(j.status || "").toUpperCase() === "PENDING" &&
          Number(j.attempts) > 0,
      );
    } else if (statusFilter === "SENT") {
      result = result.filter(
        (j) =>
          String(j.status || "").toUpperCase() === "SENT" ||
          formatJobDisplayStatus(j) === "SENT",
      );
    } else {
      result = result.filter(
        (j) =>
          String(j.status || "").toUpperCase() === statusFilter ||
          formatJobDisplayStatus(j) === statusFilter,
      );
    }
  }

  return result;
}

async function loadNotificationSources(campaignId, tenantId) {
  const baseFilter = buildNotificationQuery(campaignId, tenantId);
  const campaign = await loadCampaignContext(campaignId, tenantId);

  const [queueJobs, reminderLogs, deliveryLogs, auditEvents] =
    await Promise.all([
      EmailJob.find(baseFilter)
        .select("-html")
        .sort({ createdAt: -1 })
        .lean(),
      CampaignReminderLog.find({
        ...baseFilter,
        deliveryStatus: { $ne: "PENDING" },
      })
        .sort({ sentAt: -1 })
        .lean(),
      EmailDeliveryLog.find(baseFilter).sort({ deliveredAt: -1 }).lean(),
      CampaignAuditLog.find({
        ...baseFilter,
        eventType: { $in: AUDIT_EVENT_TYPES },
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

  const historyEntries = legacyEntriesFromHistory(campaign);
  let historyForSynthetics = historyEntries.filter((h) => h.recipientEmail);
  if (historyEntries.length > 0 && historyForSynthetics.length === 0) {
    const latest = historyEntries[0];
    const targets = await collectAllReviewerEmails(
      campaignId,
      campaign,
      reminderLogs.map((l) => l.recipientEmail),
    );
    historyForSynthetics = targets.map((email) => ({
      type: "REMINDER",
      recipientEmail: email,
      status: latest.status,
      at: latest.at,
      source: "campaign_history",
      legacy: true,
    }));
  }

  const syntheticJobs = buildLegacySyntheticJobs(
    reminderLogs,
    deliveryLogs,
    historyForSynthetics,
  );

  const dedupedSynthetics = syntheticJobs.filter((s) => {
    const nearMatch = queueJobs.some(
      (q) =>
        normalizeEmail(q.recipientEmail) === normalizeEmail(s.recipientEmail) &&
        q.type === s.type &&
        Math.abs(
          new Date(q.sentAt || q.createdAt).getTime() -
            new Date(s.sentAt).getTime(),
        ) < 60000,
    );
    return !nearMatch;
  });

  const allJobs = [...queueJobs, ...dedupedSynthetics];

  return {
    campaign,
    queueJobs,
    allJobs,
    dedupedSynthetics,
    reminderLogs,
    deliveryLogs,
    auditEvents,
    historyEntries,
  };
}

/**
 * Aggregate job counts for notification summary cards.
 */
export async function getCampaignNotificationSummary(campaignId, tenantId) {
  const empty = {
    totalJobs: 0,
    sent: 0,
    failed: 0,
    pending: 0,
    processing: 0,
    retries: 0,
    retrying: 0,
    legacySent: 0,
    totalEvents: 0,
  };

  const cid = normalizeCampaignId(campaignId);
  if (!cid) return empty;

  const baseFilter = buildNotificationQuery(campaignId, tenantId);

  const rows = await EmailJob.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const byStatus = Object.fromEntries(
    (rows || []).map((r) => [String(r._id || ""), r]),
  );

  const sent = Number(byStatus.SENT?.count) || 0;
  const failed = Number(byStatus.FAILED?.count) || 0;
  const pending = Number(byStatus.PENDING?.count) || 0;
  const processing = Number(byStatus.PROCESSING?.count) || 0;
  const totalJobs = sent + failed + pending + processing;

  const retryingJobs = await EmailJob.countDocuments({
    ...baseFilter,
    status: "PENDING",
    attempts: { $gt: 0 },
  });

  const retries = await EmailJob.countDocuments({
    ...baseFilter,
    attempts: { $gt: 0 },
  });

  const [reminderLogs, deliveryLogs] = await Promise.all([
    CampaignReminderLog.find({
      ...baseFilter,
      deliveryStatus: { $ne: "PENDING" },
    }).lean(),
    EmailDeliveryLog.find(baseFilter).lean(),
  ]);

  const legacySent = countLegacySent(reminderLogs, deliveryLogs);
  const totalEvents = totalJobs + legacySent;

  return {
    totalJobs,
    sent: sent + legacySent,
    failed,
    pending,
    processing,
    retries,
    retrying: retryingJobs,
    legacySent,
    totalEvents,
  };
}

/**
 * Full notification dashboard payload for a campaign.
 */
export async function getCampaignNotifications(campaignId, options = {}) {
  const tenantId = options.tenantId;
  const typeFilter = String(options.type || "")
    .trim()
    .toUpperCase();
  const statusFilter = String(options.status || "")
    .trim()
    .toUpperCase();

  const page = Math.max(Number(options.page) || 1, 1);
  const limit = Math.min(500, Math.max(Number(options.limit) || 50, 1));

  const cid = normalizeCampaignId(campaignId);
  if (!cid) {
    return {
      summary: await getCampaignNotificationSummary(campaignId, tenantId),
      byReviewer: [],
      jobs: [],
      failed: [],
      retries: [],
      timeline: [],
      pagination: { page: 1, limit, total: 0, totalPages: 1 },
    };
  }

  const sources = await loadNotificationSources(campaignId, tenantId);
  const {
    campaign,
    queueJobs,
    allJobs,
    reminderLogs,
    deliveryLogs,
    auditEvents,
    historyEntries,
  } = sources;

  const reviewerNameByEmail = await resolveReviewerNameMap(campaign);

  for (const log of reminderLogs) {
    const email = normalizeEmail(log.recipientEmail);
    if (email && !reviewerNameByEmail.has(email)) {
      reviewerNameByEmail.set(email, email);
    }
  }

  let expandedHistory = historyEntries.filter((h) => h.recipientEmail);
  if (historyEntries.length > 0 && expandedHistory.length === 0) {
    const latest = historyEntries[0];
    const targets = await collectAllReviewerEmails(
      campaignId,
      campaign,
      reminderLogs.map((l) => l.recipientEmail),
    );
    expandedHistory = targets.map((email) => ({
      type: "REMINDER",
      recipientEmail: email,
      status: latest.status,
      at: latest.at,
      source: "campaign_history",
      legacy: true,
    }));
  }

  const reviewerTypeMap = buildReviewerTypeMap(
    allJobs,
    reminderLogs,
    deliveryLogs,
    expandedHistory,
  );

  const allEmails = await collectAllReviewerEmails(
    campaignId,
    campaign,
    [
      ...reviewerTypeMap.keys(),
      ...reminderLogs.map((l) => l.recipientEmail),
      ...queueJobs.map((j) => j.recipientEmail),
    ],
  );

  for (const email of allEmails) {
    if (!reviewerTypeMap.has(email)) {
      reviewerTypeMap.set(email, {
        launch: null,
        reminder: null,
        escalation: null,
        expiry: null,
        latest: null,
      });
    }
  }

  const reminderCountByEmail = buildReminderCountMap(reminderLogs);

  const byReviewer = [...reviewerTypeMap.entries()]
    .map(([email, row]) => ({
      recipientEmail: email,
      recipientName: reviewerNameByEmail.get(email) || email,
      isBackupReviewer: isBackupReviewerEmail(campaign, email),
      launch: typeSentStatusFromEntry(row.launch),
      reminder: typeSentStatusFromEntry(row.reminder),
      escalation: typeSentStatusFromEntry(row.escalation),
      reminderCount: reminderCountByEmail.get(email) || 0,
      lastReminderAt: row.reminder?.at || null,
      lastSentAt: row.latest?.at || null,
      overallStatus: row.latest?.status || "NONE",
    }))
    .filter(
      (r) =>
        r.launch.status !== "NONE" ||
        r.reminder.status !== "NONE" ||
        r.escalation.status !== "NONE" ||
        allEmails.includes(r.recipientEmail),
    );

  byReviewer.sort((a, b) =>
    String(a.recipientName).localeCompare(String(b.recipientName)),
  );

  const filteredAllJobs = applyJobFilters(allJobs, typeFilter, statusFilter);
  const total = filteredAllJobs.length;
  const skip = (page - 1) * limit;
  const pagedJobs = filteredAllJobs.slice(skip, skip + limit);
  const mappedJobs = pagedJobs.map((job) =>
    mapJobRow(job, reviewerNameByEmail, campaign),
  );

  const failedFromJobs = allJobs
    .filter(
      (j) =>
        String(j.status || "").toUpperCase() === "FAILED" ||
        formatJobDisplayStatus(j) === "FAILED",
    )
    .map((job) => mapJobRow(job, reviewerNameByEmail, campaign));

  const failedFromDelivery = deliveryLogs
    .filter(
      (dl) =>
        dl.deliveryStatus === "FAILED" || dl.deliveryStatus === "BOUNCED",
    )
    .map((dl) => ({
      id: null,
      type: dl.emailType || "REMINDER",
      recipientEmail: dl.recipientEmail,
      recipientName:
        reviewerNameByEmail.get(normalizeEmail(dl.recipientEmail)) ||
        dl.recipientEmail,
      status: "FAILED",
      rawStatus: "FAILED",
      attempts: 0,
      maxAttempts: 0,
      nextRunAt: null,
      sentAt: dl.deliveredAt,
      lastError: dl.errorMessage || "Delivery failed",
      subject: null,
      legacy: true,
      isBackupReviewer: isBackupReviewerEmail(campaign, dl.recipientEmail),
      source: "email_delivery_log",
      canRetry: false,
    }));

  const failedKey = (r) =>
    `${normalizeEmail(r.recipientEmail)}::${r.lastError}::${r.sentAt}`;
  const failedSeen = new Set();
  const failed = [];
  for (const row of [...failedFromJobs, ...failedFromDelivery]) {
    const k = failedKey(row);
    if (failedSeen.has(k)) continue;
    failedSeen.add(k);
    failed.push(row);
  }

  const baseFilter = buildNotificationQuery(campaignId, tenantId);
  const retries = await EmailJob.find({
    ...baseFilter,
    status: "PENDING",
    attempts: { $gt: 0 },
  })
    .sort({ nextRunAt: 1 })
    .select("-html")
    .lean();

  const mappedRetries = retries.map((job) => ({
    id: job._id,
    recipientEmail: job.recipientEmail,
    recipientName:
      reviewerNameByEmail.get(normalizeEmail(job.recipientEmail)) ||
      job.recipientEmail,
    type: job.type,
    attempts: job.attempts || 0,
    maxAttempts: job.maxAttempts || 4,
    nextRunAt: job.nextRunAt,
    lastError: job.lastError,
  }));

  const timeline = buildTimeline(auditEvents, deliveryLogs, campaign);
  const summary = await getCampaignNotificationSummary(campaignId, tenantId);

  return {
    summary,
    byReviewer,
    jobs: mappedJobs,
    failed,
    retries: mappedRetries,
    timeline,
    meta: buildNotificationMeta(campaign),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Detailed log for a single email job (View Log).
 */
export async function getNotificationJobLog(campaignId, jobId, tenantId) {
  const cid = normalizeCampaignId(campaignId);
  if (!cid || !mongoose.isValidObjectId(String(jobId))) {
    const err = new Error("Invalid job or campaign id");
    err.statusCode = 400;
    throw err;
  }

  const baseFilter = buildNotificationQuery(campaignId, tenantId);
  const job = await EmailJob.findOne({ ...baseFilter, _id: jobId })
    .select("-html")
    .lean();

  if (!job) {
    const err = new Error("Email job not found");
    err.statusCode = 404;
    throw err;
  }

  const [deliveryLogs, auditEvents] = await Promise.all([
    EmailDeliveryLog.find({
      ...baseFilter,
      $or: [{ emailJobId: job._id }, { recipientEmail: job.recipientEmail }],
    })
      .sort({ deliveredAt: -1 })
      .lean(),
    CampaignAuditLog.find({
      ...baseFilter,
      emailJobId: job._id,
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return {
    job,
    deliveryLogs,
    auditEvents,
    timeline: buildTimeline(auditEvents, deliveryLogs),
  };
}

/**
 * Manual retry — reset job to PENDING for immediate worker pickup.
 */
export async function retryEmailJob(jobId, { actorId, campaignId } = {}) {
  if (!campaignId) {
    const err = new Error("campaignId is required");
    err.statusCode = 400;
    throw err;
  }

  const job = await EmailJob.findById(jobId);
  if (!job) {
    const err = new Error("Email job not found");
    err.statusCode = 404;
    throw err;
  }

  if (String(job.campaignId) !== String(campaignId)) {
    const err = new Error("Job does not belong to this campaign");
    err.statusCode = 403;
    throw err;
  }

  if (job.status === "SENT") {
    const err = new Error("Job already sent");
    err.statusCode = 400;
    throw err;
  }

  if (job.status === "PROCESSING") {
    const err = new Error("Job is currently processing");
    err.statusCode = 409;
    throw err;
  }

  await EmailJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "PENDING",
      nextRunAt: new Date(),
    },
    $unset: { processingStartedAt: 1 },
  });

  await recordCertificationEmailAudit({
    campaignId: job.campaignId,
    tenantId: job.tenantId,
    eventType: "EMAIL_RETRY_SCHEDULED",
    emailType: job.type,
    recipientEmail: job.recipientEmail,
    emailJobId: job._id,
    actorType: "USER",
    actorId: actorId || undefined,
    details: { manual: true, attempts: job.attempts || 0 },
  });

  return EmailJob.findById(job._id).select("-html").lean();
}
