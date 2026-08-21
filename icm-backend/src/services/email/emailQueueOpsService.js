import EmailJob from "../../models/email/EmailJob.js";
import {
  isEmailWorkerRunning,
  getEmailWorkerLastPollAt,
} from "./emailWorkerState.js";

function buildTenantFilter(tenantId) {
  if (!tenantId) return {};
  return { tenantId };
}

const STALE_PROCESSING_MS =
  Number(process.env.EMAIL_JOB_STALE_MS) || 10 * 60 * 1000;

/**
 * Operational stats for the certification email queue (admin / monitoring).
 */
export async function getEmailQueueStats(tenantId = null) {
  const tenantFilter = buildTenantFilter(tenantId);
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MS);

  const [pending, processing, failed, retrying, sentToday, staleProcessing] =
    await Promise.all([
      EmailJob.countDocuments({ ...tenantFilter, status: "PENDING", attempts: 0 }),
      EmailJob.countDocuments({ ...tenantFilter, status: "PROCESSING" }),
      EmailJob.countDocuments({ ...tenantFilter, status: "FAILED" }),
      EmailJob.countDocuments({
        ...tenantFilter,
        status: "PENDING",
        attempts: { $gt: 0 },
      }),
      EmailJob.countDocuments({
        ...tenantFilter,
        status: "SENT",
        sentAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),
      EmailJob.countDocuments({
        ...tenantFilter,
        status: "PROCESSING",
        processingStartedAt: { $lt: staleCutoff },
      }),
    ]);

  const oldestPending = await EmailJob.findOne({
    ...tenantFilter,
    status: "PENDING",
  })
    .sort({ nextRunAt: 1, createdAt: 1 })
    .select("nextRunAt createdAt type recipientEmail campaignId")
    .lean();

  const oldestProcessing = await EmailJob.findOne({
    ...tenantFilter,
    status: "PROCESSING",
  })
    .sort({ processingStartedAt: 1 })
    .select("processingStartedAt type recipientEmail campaignId")
    .lean();

  const now = Date.now();
  const oldestPendingAgeMs = oldestPending?.nextRunAt
    ? Math.max(0, now - new Date(oldestPending.nextRunAt).getTime())
    : null;
  const oldestProcessingAgeMs = oldestProcessing?.processingStartedAt
    ? Math.max(0, now - new Date(oldestProcessing.processingStartedAt).getTime())
    : null;

  return {
    pending,
    processing,
    failed,
    retrying,
    queueSize: pending + retrying + processing,
    sentLast24h: sentToday,
    staleProcessingCount: staleProcessing,
    workerRunning: isEmailWorkerRunning(),
    lastPollAt: getEmailWorkerLastPollAt(),
    oldestPending: oldestPending
      ? {
          nextRunAt: oldestPending.nextRunAt,
          createdAt: oldestPending.createdAt,
          ageMs: oldestPendingAgeMs,
          type: oldestPending.type,
          recipientEmail: oldestPending.recipientEmail,
          campaignId: oldestPending.campaignId,
        }
      : null,
    oldestProcessing: oldestProcessing
      ? {
          processingStartedAt: oldestProcessing.processingStartedAt,
          ageMs: oldestProcessingAgeMs,
          type: oldestProcessing.type,
          recipientEmail: oldestProcessing.recipientEmail,
          campaignId: oldestProcessing.campaignId,
        }
      : null,
    workerPollMs: Number(process.env.EMAIL_WORKER_POLL_MS) || 30_000,
    rateLimitPerMin: Number(process.env.EMAIL_RATE_LIMIT_PER_MIN) || 50,
  };
}

/**
 * Health check for monitoring — unhealthy when thresholds exceeded.
 */
export async function getEmailQueueHealth(tenantId = null) {
  const stats = await getEmailQueueStats(tenantId);
  const failedThreshold = Number(process.env.EMAIL_HEALTH_FAILED_THRESHOLD || 50);
  const pendingAgeThresholdMs =
    Number(process.env.EMAIL_HEALTH_PENDING_AGE_MS) || 30 * 60 * 1000;

  const issues = [];
  if (!stats.workerRunning) issues.push("worker_not_running");
  if (stats.failed > failedThreshold) issues.push("failed_jobs_high");
  if (
    stats.oldestPending?.ageMs != null &&
    stats.oldestPending.ageMs > pendingAgeThresholdMs
  ) {
    issues.push("pending_backlog");
  }
  if (stats.staleProcessingCount > 0) issues.push("stale_processing_jobs");

  return {
    healthy: issues.length === 0,
    issues,
    stats,
  };
}
