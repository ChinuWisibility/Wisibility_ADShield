import mongoose from "mongoose";
import os from "os";
import HygieneJob from "../../models/dataHygiene/HygieneJob.js";
import { hygieneLog, hygieneMetricInc } from "./hygieneTelemetry.js";

const BACKOFF_MS = [
  2 * 1000,
  10 * 1000,
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
];

function toOid(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function workerId() {
  return `${os.hostname()}:${process.pid}`;
}

export function getHygieneRetryDelayMs(attempts) {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

/**
 * Coalesce: cancel older pending jobs for same scope with lower generation;
 * skip if equal/higher generation already pending/processing.
 *
 * @param {{
 *   tenantId: import("mongoose").Types.ObjectId|string,
 *   applicationId?: import("mongoose").Types.ObjectId|string|null,
 *   widgetId?: string|null,
 *   sourceGeneration?: number,
 *   kind: string,
 *   reason?: string,
 *   metadata?: object,
 *   scheduledFor?: Date,
 * }} params
 */
export async function enqueueHygieneJob(params) {
  const tenantId = toOid(params.tenantId);
  if (!tenantId) return null;

  const kind = String(params.kind || "").trim();
  if (!kind) return null;

  const applicationId = params.applicationId != null ? toOid(params.applicationId) : null;
  const widgetId = params.widgetId != null ? String(params.widgetId) : null;
  const sourceGeneration = Number(params.sourceGeneration || 0);
  const now = params.scheduledFor || new Date();

  const scopeFilter = {
    tenantId,
    kind,
    status: { $in: ["PENDING", "PROCESSING"] },
  };
  if (applicationId) scopeFilter.applicationId = applicationId;
  else scopeFilter.applicationId = null;
  if (widgetId != null) scopeFilter.widgetId = widgetId;
  else scopeFilter.widgetId = null;

  const existing = await HygieneJob.find(scopeFilter)
    .select("_id sourceGeneration status")
    .lean();

  for (const job of existing) {
    if ((job.sourceGeneration || 0) >= sourceGeneration) {
      hygieneMetricInc("hygiene.job.enqueue_coalesced");
      hygieneLog("job_enqueue_skip", {
        reason: "newer_or_equal_in_flight",
        kind,
        tenantId: String(tenantId),
        applicationId: applicationId ? String(applicationId) : null,
        widgetId,
        sourceGeneration,
        existingGeneration: job.sourceGeneration,
        existingJobId: String(job._id),
      });
      return null;
    }
  }

  // Supersede older pending generations for this scope.
  if (existing.length) {
    await HygieneJob.updateMany(
      {
        _id: { $in: existing.map((j) => j._id) },
        status: "PENDING",
        sourceGeneration: { $lt: sourceGeneration },
      },
      {
        $set: {
          status: "DONE",
          completedAt: now,
          lastError: "superseded_by_newer_generation",
        },
        $unset: { processingStartedAt: 1, leaseExpiresAt: 1, lockedBy: 1 },
      },
    );
  }

  const job = await HygieneJob.create({
    kind,
    status: "PENDING",
    tenantId,
    applicationId: applicationId || null,
    widgetId: widgetId || null,
    sourceGeneration,
    nextRunAt: now,
    metadata: {
      reason: params.reason || undefined,
      ...(params.metadata || {}),
    },
    maxAttempts: Number(process.env.HYGIENE_JOB_MAX_ATTEMPTS || 5),
  });

  hygieneMetricInc("hygiene.job.enqueued");
  hygieneLog("job_enqueued", {
    jobId: String(job._id),
    kind,
    tenantId: String(tenantId),
    applicationId: applicationId ? String(applicationId) : null,
    widgetId,
    sourceGeneration,
  });

  return job;
}

/**
 * Enqueue RECOMPUTE_APP_WIDGET jobs for dirty widget generations.
 */
export async function enqueueHygieneRecomputeJobs({
  tenantId,
  applicationId,
  sourceGenerations,
  reason,
}) {
  const tid = toOid(tenantId);
  const aid = toOid(applicationId);
  if (!tid || !aid || !sourceGenerations) return [];

  const jobs = [];
  for (const [widgetId, gen] of Object.entries(sourceGenerations)) {
    const job = await enqueueHygieneJob({
      kind: "RECOMPUTE_APP_WIDGET",
      tenantId: tid,
      applicationId: aid,
      widgetId,
      sourceGeneration: gen,
      reason,
    });
    if (job) jobs.push(job);
  }

  // Also schedule assemble so summary catches up after widgets (worker may re-enqueue).
  await enqueueAssembleTenantSummary({
    tenantId: tid,
    reason: reason ? `after_dirty:${reason}` : "after_dirty",
    // Slight delay so widget jobs run first when possible.
    scheduledFor: new Date(Date.now() + 1500),
    sourceGeneration: Math.max(0, ...Object.values(sourceGenerations).map(Number)),
  });

  return jobs;
}

/**
 * @param {{ tenantId: import("mongoose").Types.ObjectId|string, reason?: string, scheduledFor?: Date, sourceGeneration?: number }} params
 */
export async function enqueueAssembleTenantSummary(params) {
  const tenantId = toOid(params.tenantId);
  if (!tenantId) return null;

  // Coalesce assemble jobs: use max known dirty generation as sourceGeneration.
  let sourceGeneration = Number(params.sourceGeneration || 0);
  if (!sourceGeneration) {
    const HygieneAppRollup = (
      await import("../../models/dataHygiene/HygieneAppRollup.js")
    ).default;
    const agg = await HygieneAppRollup.aggregate([
      { $match: { tenantId } },
      { $group: { _id: null, maxGen: { $max: "$sourceGeneration" } } },
    ]);
    sourceGeneration = agg[0]?.maxGen || 0;
  }

  return enqueueHygieneJob({
    kind: "ASSEMBLE_TENANT_SUMMARY",
    tenantId,
    applicationId: null,
    widgetId: null,
    sourceGeneration,
    reason: params.reason,
    scheduledFor: params.scheduledFor,
  });
}

/**
 * Atomic claim of next due job.
 */
export async function claimNextHygieneJob(leaseMs = 5 * 60 * 1000) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const lockedBy = workerId();

  return HygieneJob.findOneAndUpdate(
    {
      status: "PENDING",
      nextRunAt: { $lte: now },
    },
    {
      $set: {
        status: "PROCESSING",
        processingStartedAt: now,
        leaseExpiresAt,
        lockedBy,
      },
      $inc: { attempts: 1 },
    },
    { sort: { nextRunAt: 1, createdAt: 1 }, new: true },
  );
}

/**
 * Recover jobs whose lease expired (crash / stalled worker).
 */
export async function recoverStaleHygieneJobs(staleMs) {
  const cutoff = new Date(
    Date.now() - (staleMs || Number(process.env.HYGIENE_JOB_STALE_MS) || 10 * 60 * 1000),
  );
  const r = await HygieneJob.updateMany(
    {
      status: "PROCESSING",
      $or: [
        { leaseExpiresAt: { $lt: new Date() } },
        { leaseExpiresAt: null, processingStartedAt: { $lt: cutoff } },
      ],
    },
    {
      $set: { status: "PENDING", nextRunAt: new Date() },
      $unset: { processingStartedAt: 1, leaseExpiresAt: 1, lockedBy: 1 },
    },
  );
  if (r.modifiedCount) {
    hygieneLog("job_stale_recovered", { count: r.modifiedCount });
  }
  return r.modifiedCount || 0;
}

export async function finalizeHygieneJobSuccess(job) {
  await HygieneJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "DONE",
      completedAt: new Date(),
      lastError: undefined,
    },
    $unset: { processingStartedAt: 1, leaseExpiresAt: 1, lockedBy: 1 },
  });
  hygieneMetricInc("hygiene.job.done");
}

export async function finalizeHygieneJobFailure(job, errorMessage) {
  const attempts = job.attempts || 1;
  const maxAttempts = job.maxAttempts || 5;
  const msg = String(errorMessage || "unknown").slice(0, 1000);

  if (attempts >= maxAttempts) {
    await HygieneJob.findByIdAndUpdate(job._id, {
      $set: {
        status: "DEAD",
        lastError: msg,
        completedAt: new Date(),
      },
      $unset: { processingStartedAt: 1, leaseExpiresAt: 1, lockedBy: 1 },
    });
    hygieneMetricInc("hygiene.job.dead");
    hygieneLog("job_dead", {
      jobId: String(job._id),
      kind: job.kind,
      attempts,
      error: msg,
    });
    return;
  }

  const delay = getHygieneRetryDelayMs(attempts);
  await HygieneJob.findByIdAndUpdate(job._id, {
    $set: {
      status: "PENDING",
      nextRunAt: new Date(Date.now() + delay),
      lastError: msg,
    },
    $unset: { processingStartedAt: 1, leaseExpiresAt: 1, lockedBy: 1 },
  });
  hygieneMetricInc("hygiene.job.retry");
}

/**
 * Queue depth / age for health.
 */
export async function getHygieneJobQueueStats() {
  const now = new Date();
  const [pending, processing, failed, dead, oldest] = await Promise.all([
    HygieneJob.countDocuments({ status: "PENDING" }),
    HygieneJob.countDocuments({ status: "PROCESSING" }),
    HygieneJob.countDocuments({ status: "FAILED" }),
    HygieneJob.countDocuments({ status: "DEAD" }),
    HygieneJob.findOne({ status: "PENDING" })
      .sort({ nextRunAt: 1 })
      .select("nextRunAt createdAt kind tenantId")
      .lean(),
  ]);

  const oldestAgeMs = oldest?.createdAt
    ? now.getTime() - new Date(oldest.createdAt).getTime()
    : 0;

  return {
    pending,
    processing,
    failed,
    dead,
    oldestPendingAgeMs: oldestAgeMs,
    oldestPending: oldest
      ? {
          kind: oldest.kind,
          tenantId: String(oldest.tenantId),
          nextRunAt: oldest.nextRunAt,
        }
      : null,
  };
}
