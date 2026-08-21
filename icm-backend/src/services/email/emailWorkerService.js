import EmailJob from "../../models/email/EmailJob.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import EmailService from "./EmailService.js";
import { prepareCertificationEmailForSend } from "../certificationEmailTemplates.js";
import { emailRateLimiter } from "./utils/emailRateLimiter.js";
import {
  getRetryDelayMs,
} from "./emailJobService.js";
import {
  getUtcDayStart,
  jobTypeToReminderLogType,
} from "./reminderSchedulerService.js";
import {
  markReminderLogSent,
  markReminderLogFailed,
  resolveCampaignTenantId,
} from "./campaignReminderLogService.js";
import { recordCertificationEmailAudit } from "./campaignEmailAuditService.js";
import {
  setEmailWorkerRunning,
  markEmailWorkerPoll,
} from "./emailWorkerState.js";

const BATCH_SIZE = Number(process.env.EMAIL_WORKER_BATCH_SIZE || 10);
const STALE_PROCESSING_MS =
  Number(process.env.EMAIL_JOB_STALE_MS) || 10 * 60 * 1000;
const POLL_INTERVAL_MS = Number(process.env.EMAIL_WORKER_POLL_MS) || 30_000;

let workerInterval = null;
let processing = false;
let pollCount = 0;

async function logWorkerHealthIfDue() {
  pollCount += 1;
  if (pollCount % 10 !== 0) return;
  try {
    const [pending, processingCount, failed, retrying] = await Promise.all([
      EmailJob.countDocuments({ status: "PENDING", attempts: 0 }),
      EmailJob.countDocuments({ status: "PROCESSING" }),
      EmailJob.countDocuments({ status: "FAILED" }),
      EmailJob.countDocuments({ status: "PENDING", attempts: { $gt: 0 } }),
    ]);
    console.log("[EmailWorker] health", {
      pending,
      processing: processingCount,
      failed,
      retrying,
    });
  } catch (err) {
    console.warn("[EmailWorker] health log failed:", err.message);
  }
}

/**
 * Reset jobs stuck in PROCESSING after a crash (B28).
 * Jobs already delivered today are closed as SENT instead of re-queued.
 */
export async function recoverStaleProcessingJobs() {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const staleJobs = await EmailJob.find({
    status: "PROCESSING",
    processingStartedAt: { $lt: cutoff },
  }).lean();

  if (staleJobs.length === 0) return;

  let requeued = 0;
  let closed = 0;

  for (const job of staleJobs) {
    if (await isDuplicateSend(job)) {
      await EmailJob.findByIdAndUpdate(job._id, {
        $set: {
          status: "SENT",
          sentAt: new Date(),
          lastError: "recovered_already_sent",
        },
        $unset: { processingStartedAt: 1 },
      });
      closed++;
      continue;
    }

    await EmailJob.findByIdAndUpdate(job._id, {
      $set: { status: "PENDING" },
      $unset: { processingStartedAt: 1 },
    });
    requeued++;
  }

  console.log(
    `[EmailWorker] Recovered ${staleJobs.length} stale PROCESSING job(s) (${requeued} re-queued, ${closed} already sent)`,
  );
}

/**
 * Send-time dedupe guard. A modern job carries `metadata.reminderLogId` pointing
 * at its reservation — if that reservation is already SENT (finalized by another
 * path), we must not send again. Legacy jobs (no reservation) fall back to the
 * same-day window check.
 */
export async function isDuplicateSend(job) {
  const reminderLogId = job.metadata?.reminderLogId;
  if (reminderLogId) {
    const reservation = await CampaignReminderLog.findById(reminderLogId)
      .select("deliveryStatus")
      .lean();
    return Boolean(reservation && reservation.deliveryStatus === "SENT");
  }

  const logType = jobTypeToReminderLogType(job.type);
  if (!logType || !job.campaignId) return false;

  const todayStart = getUtcDayStart();
  const existing = await CampaignReminderLog.findOne({
    campaignId: job.campaignId,
    recipientEmail: job.recipientEmail,
    reminderType: logType,
    deliveryStatus: "SENT",
    sentAt: { $gte: todayStart },
  }).lean();

  return Boolean(existing);
}

async function claimNextJob() {
  const now = new Date();
  return EmailJob.findOneAndUpdate(
    {
      status: "PENDING",
      nextRunAt: { $lte: now },
    },
    {
      $set: {
        status: "PROCESSING",
        processingStartedAt: now,
      },
    },
    { sort: { nextRunAt: 1, createdAt: 1 }, new: true },
  );
}

async function finalizeJobSuccess(job, providerMessageId) {
  const sentAt = new Date();
  await EmailJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "SENT",
      sentAt,
      providerMessageId: providerMessageId || undefined,
      lastError: undefined,
    },
    $unset: { processingStartedAt: 1 },
  });

  const logType = jobTypeToReminderLogType(job.type);
  if (logType && job.campaignId) {
    const tenantId =
      job.tenantId ?? (await resolveCampaignTenantId(job.campaignId));

    // Finalize the reservation created at enqueue time (PENDING → SENT), or
    // create a SENT record directly for legacy jobs that predate reservations.
    await markReminderLogSent({
      reminderLogId: job.metadata?.reminderLogId,
      campaignId: job.campaignId,
      tenantId,
      recipientEmail: job.recipientEmail,
      reminderType: logType,
      sentAt,
    }).catch((e) =>
      console.error(
        "[EmailWorker] CampaignReminderLog finalize failed:",
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
      actorType: "WORKER",
      details: { providerMessageId },
    });
  }
}

async function finalizeJobFailure(job, errorMessage) {
  const attempts = (job.attempts || 0) + 1;
  const maxAttempts = job.maxAttempts || Number(process.env.EMAIL_JOB_MAX_ATTEMPTS || 4);

  if (attempts >= maxAttempts) {
    await EmailJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "FAILED",
        attempts,
        lastError: errorMessage,
      },
      $unset: { processingStartedAt: 1 },
    });

    const logType = jobTypeToReminderLogType(job.type);
    const tenantId =
      job.tenantId ?? (await resolveCampaignTenantId(job.campaignId));
    if (logType && job.campaignId) {
      // Terminal failure: mark the reservation FAILED and release its window
      // (unset dedupeKey/windowKey) so a future legitimate send can re-reserve.
      await markReminderLogFailed({
        reminderLogId: job.metadata?.reminderLogId,
        campaignId: job.campaignId,
        tenantId,
        recipientEmail: job.recipientEmail,
        reminderType: logType,
        sentAt: new Date(),
      }).catch(() => {});
    }

    await recordCertificationEmailAudit({
      campaignId: job.campaignId,
      tenantId,
      eventType: "EMAIL_FAILED",
      emailType: job.type,
      recipientEmail: job.recipientEmail,
      emailJobId: job._id,
      actorType: "WORKER",
      details: { attempts, errorMessage },
    });

    // Surface async SMTP failure: stop remediation at Notify — do not leave WAITING for IAM.
    if (job.type === "WORKFLOW" && job.metadata?.executionId) {
      try {
        const { failRemediationOnWorkflowEmailDelivery } = await import(
          "../workflow/failRemediationOnWorkflowEmailDelivery.js"
        );
        await failRemediationOnWorkflowEmailDelivery({
          executionId: job.metadata.executionId,
          recipientEmail: job.recipientEmail,
          errorMessage,
          orphanId: job.metadata.orphanId,
        });
      } catch (err) {
        console.warn("[EmailWorker] remediation email-failure sync failed:", err.message);
      }
    }

    return;
  }

  const delayMs = getRetryDelayMs(attempts);
  await EmailJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "PENDING",
      attempts,
      lastError: errorMessage,
      nextRunAt: new Date(Date.now() + delayMs),
    },
    $unset: { processingStartedAt: 1 },
  });

  await recordCertificationEmailAudit({
    campaignId: job.campaignId,
    tenantId: job.tenantId ?? (await resolveCampaignTenantId(job.campaignId)),
    eventType: "EMAIL_RETRY_SCHEDULED",
    emailType: job.type,
    recipientEmail: job.recipientEmail,
    emailJobId: job._id,
    actorType: "WORKER",
    details: { attempts, nextRetryMs: delayMs, errorMessage },
  });
}

async function processJob(job) {
  const tenantId =
    job.tenantId ?? (await resolveCampaignTenantId(job.campaignId));

  if (await isDuplicateSend(job)) {
    console.log(
      `[EmailWorker] Skipping duplicate ${job.type} for ${job.recipientEmail} (campaign ${job.campaignId})`,
    );
    await EmailJob.findByIdAndUpdate(job._id, {
      $set: { status: "SENT", sentAt: new Date(), lastError: "skipped_duplicate" },
      $unset: { processingStartedAt: 1 },
    });

    await recordCertificationEmailAudit({
      campaignId: job.campaignId,
      tenantId,
      eventType: "EMAIL_DEDUPE_SKIPPED",
      emailType: job.type,
      recipientEmail: job.recipientEmail,
      emailJobId: job._id,
      actorType: "WORKER",
      details: { phase: "send" },
    });
    return;
  }

  await emailRateLimiter.acquire();

  const { html, attachments } = await prepareCertificationEmailForSend(job.html);

  const info = await EmailService.send({
    to: job.recipientEmail,
    subject: job.subject,
    html,
    attachments,
    metadata: {
      emailJobId: job._id,
      campaignId: job.campaignId,
      tenantId,
      emailType: job.type,
    },
  });

  try {
    await finalizeJobSuccess(job, info?.messageId);
  } catch (finalizeErr) {
    console.warn(
      `[EmailWorker] Post-send finalize failed for job ${job._id}:`,
      finalizeErr.message,
    );
    await EmailJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: info?.messageId || undefined,
        lastError: `finalize_after_send: ${finalizeErr.message}`,
      },
      $unset: { processingStartedAt: 1 },
    });
  }
}

export async function processEmailJobBatch() {
  if (processing) return;
  processing = true;

  try {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const job = await claimNextJob();
      if (!job) break;

      try {
        await processJob(job);
        console.log(
          `[EmailWorker] Sent ${job.type} to ${job.recipientEmail} (job ${job._id})`,
        );
      } catch (err) {
        console.error(
          `[EmailWorker] Failed ${job.type} to ${job.recipientEmail}:`,
          err.message,
        );
        // SMTP may have succeeded while post-send bookkeeping failed — do not retry
        // or recipients get duplicate copies of the same message.
        const fresh = await EmailJob.findById(job._id).select("status sentAt").lean();
        if (fresh?.status === "SENT" || fresh?.sentAt) {
          console.warn(
            `[EmailWorker] Job ${job._id} already marked SENT — skipping retry`,
          );
          continue;
        }
        await finalizeJobFailure(job, err.message);
      }
    }
  } finally {
    processing = false;
  }
}

/**
 * Start background email worker (B13–B15).
 */
export function startEmailWorker() {
  if (workerInterval) return;

  setEmailWorkerRunning(true);
  console.log(
    "[EmailWorker] Starting — poll interval:",
    POLL_INTERVAL_MS / 1000,
    "seconds",
  );

  recoverStaleProcessingJobs()
    .then(() => {
      markEmailWorkerPoll();
      return processEmailJobBatch();
    })
    .catch((err) =>
      console.error("[EmailWorker] Startup error:", err.message),
    );

  workerInterval = setInterval(() => {
    markEmailWorkerPoll();
    processEmailJobBatch()
      .then(() => logWorkerHealthIfDue())
      .catch((err) =>
        console.error("[EmailWorker] Poll error:", err.message),
      );
  }, POLL_INTERVAL_MS);
}

export function stopEmailWorker() {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
  setEmailWorkerRunning(false);
}

export { processEmailJobBatch as runEmailWorkerOnce };
