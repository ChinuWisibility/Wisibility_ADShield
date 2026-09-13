import EmailJob from "../../models/email/EmailJob.js";
import EmailService from "../email/EmailService.js";
import { prepareCertificationEmailForSend } from "../access-certification/certificationEmailTemplates.js";
import { jobTypeToReminderLogType } from "./reminderSchedulerService.js";
import {
  markReminderLogSent,
  markReminderLogFailed,
  resolveCampaignTenantId,
} from "./campaignReminderLogService.js";
import { recordCertificationEmailAudit } from "./campaignEmailAuditService.js";

/**
 * Finalize the reservation ledger + audit trail after an immediate manual send.
 * Mirrors emailWorkerService.finalizeJobSuccess so manual and async paths keep
 * the dedupe source of truth (CampaignReminderLog) consistent.
 */
async function finalizeImmediateSuccess(job, providerMessageId) {
  const logType = jobTypeToReminderLogType(job.type);
  if (!logType || !job.campaignId) return;

  const sentAt = new Date();
  const tenantId =
    job.tenantId ?? (await resolveCampaignTenantId(job.campaignId));

  await markReminderLogSent({
    reminderLogId: job.metadata?.reminderLogId,
    campaignId: job.campaignId,
    tenantId,
    recipientEmail: job.recipientEmail,
    reminderType: logType,
    sentAt,
  }).catch((e) =>
    console.error(
      "[deliverEmailJobNow] CampaignReminderLog finalize failed:",
      e.message,
    ),
  );

  await recordCertificationEmailAudit({
    campaignId: job.campaignId,
    tenantId,
    eventType: "EMAIL_SENT",
    emailType: job.type,
    recipientEmail: job.recipientEmail,
    emailJobId: job._id,
    actorType: "USER",
    details: { providerMessageId, immediate: true },
  });
}

/**
 * On terminal manual-send failure, mark the reservation FAILED and release its
 * window so the reviewer can be retried without a stuck dedupe key.
 */
async function finalizeImmediateFailure(job, errorMessage) {
  const logType = jobTypeToReminderLogType(job.type);
  if (!logType || !job.campaignId) return;

  const tenantId =
    job.tenantId ?? (await resolveCampaignTenantId(job.campaignId));

  await markReminderLogFailed({
    reminderLogId: job.metadata?.reminderLogId,
    campaignId: job.campaignId,
    tenantId,
    recipientEmail: job.recipientEmail,
    reminderType: logType,
    sentAt: new Date(),
  }).catch(() => {});

  await recordCertificationEmailAudit({
    campaignId: job.campaignId,
    tenantId,
    eventType: "EMAIL_FAILED",
    emailType: job.type,
    recipientEmail: job.recipientEmail,
    emailJobId: job._id,
    actorType: "USER",
    details: { errorMessage, immediate: true },
  });
}

/**
 * Claim a PENDING/FAILED EmailJob and attempt SMTP delivery immediately.
 * Shared by workflow action emails and certification manual reminders.
 */
export async function deliverEmailJobNow(emailJobId) {
  if (!emailJobId) {
    return { ok: false, error: "missing_email_job" };
  }

  const claimed = await EmailJob.findOneAndUpdate(
    {
      _id: emailJobId,
      status: { $in: ["PENDING", "FAILED"] },
    },
    {
      $set: {
        status: "PROCESSING",
        processingStartedAt: new Date(),
      },
      $inc: { attempts: 1 },
    },
    { new: true },
  );

  if (!claimed) {
    const existing = await EmailJob.findById(emailJobId)
      .select("status lastError recipientEmail")
      .lean();
    if (existing?.status === "SENT") {
      return { ok: true, status: "SENT", reused: true };
    }
    if (existing?.status === "PROCESSING") {
      return {
        ok: false,
        error: existing.lastError || "Email is already being sent by the worker",
        status: "PROCESSING",
      };
    }
    return {
      ok: false,
      error: existing?.lastError || "email_job_not_claimable",
      status: existing?.status || null,
    };
  }

  try {
    const { html, attachments } = await prepareCertificationEmailForSend(claimed.html);
    const info = await EmailService.send({
      to: claimed.recipientEmail,
      subject: claimed.subject,
      html,
      attachments,
      metadata: {
        emailJobId: claimed._id,
        campaignId: claimed.campaignId,
        tenantId: claimed.tenantId,
        emailType: claimed.type || "OTHER",
      },
    });

    await EmailJob.findByIdAndUpdate(claimed._id, {
      $set: {
        status: "SENT",
        sentAt: new Date(),
        lastError: null,
      },
      $unset: { processingStartedAt: 1 },
    });

    // Update the reservation ledger + audit so this send counts toward dedupe.
    await finalizeImmediateSuccess(claimed, info?.messageId).catch(() => {});

    return {
      ok: true,
      status: "SENT",
      emailJobId: String(claimed._id),
      to: claimed.recipientEmail,
      providerMessageId: info?.messageId || null,
    };
  } catch (err) {
    const message = err?.message || "SMTP delivery failed";
    await EmailJob.findByIdAndUpdate(claimed._id, {
      $set: {
        status: "FAILED",
        lastError: message,
      },
      $unset: { processingStartedAt: 1 },
    });

    await finalizeImmediateFailure(claimed, message).catch(() => {});

    return {
      ok: false,
      status: "FAILED",
      emailJobId: String(claimed._id),
      to: claimed.recipientEmail,
      error: message,
    };
  }
}

/** @deprecated Prefer deliverEmailJobNow */
export const deliverWorkflowEmailNow = deliverEmailJobNow;
