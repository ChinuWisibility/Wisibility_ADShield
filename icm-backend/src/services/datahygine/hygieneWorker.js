import os from "os";
import DistributedLock from "../../models/scheduler/DistributedLock.js";
import Application from "../../models/application/Application.js";
import {
  claimNextHygieneJob,
  recoverStaleHygieneJobs,
  finalizeHygieneJobSuccess,
  finalizeHygieneJobFailure,
  enqueueAssembleTenantSummary,
  getHygieneJobQueueStats,
} from "./hygieneJobService.js";
import {
  markHygieneRollupBuilt,
  markHygieneRollupFailed,
  markHygieneRollupProcessing,
  getTenantHygieneFreshness,
} from "./hygieneRollupService.js";
import {
  hygieneLog,
  hygieneTiming,
  hygieneMetricInc,
  getHygieneMetricsSnapshot,
} from "./hygieneTelemetry.js";
import {
  recomputeDataHygieneSummary,
  DATA_HYGIENE_SUMMARY_VERSION,
} from "./dataHygieneSummaryCacheService.js";
import DataHygieneTenantSummary from "../../models/dataHygiene/DataHygieneTenantSummary.js";

const LOG_PREFIX = "[HygieneWorker]";
const LOCK_KEY = "hygiene_worker_poll";
const BATCH_SIZE = Number(process.env.HYGIENE_WORKER_BATCH_SIZE || 5);
const POLL_INTERVAL_MS = Number(process.env.HYGIENE_WORKER_POLL_MS || 15_000);
const LOCK_TTL_MS = Number(process.env.HYGIENE_WORKER_LOCK_TTL_MS || 25_000);
const LEASE_MS = Number(process.env.HYGIENE_JOB_LEASE_MS || 5 * 60 * 1000);

let workerInterval = null;
let processing = false;
let pollCount = 0;

async function withPollLock(fn) {
  const lockedBy = `${os.hostname()}:${process.pid}`;
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
  try {
    await DistributedLock.create({
      _id: LOCK_KEY,
      lockedBy,
      lockedAt: new Date(),
      expiresAt,
    });
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
  try {
    await fn();
    return true;
  } finally {
    await DistributedLock.findByIdAndDelete(LOCK_KEY).catch(() => {});
  }
}

async function processRecomputeAppWidget(job) {
  const tenantId = job.tenantId;
  const applicationId = job.applicationId;
  const widgetId = job.widgetId;
  const sourceGeneration = job.sourceGeneration || 0;

  if (!tenantId || !applicationId || !widgetId) {
    throw new Error("RECOMPUTE_APP_WIDGET missing scope");
  }

  await markHygieneRollupProcessing({ tenantId, applicationId, widgetId });

  const app = await Application.findById(applicationId)
    .select("_id name authoritativeSource tenantId")
    .lean();
  if (!app) {
    await markHygieneRollupBuilt({
      tenantId,
      applicationId,
      widgetId,
      sourceGeneration,
      count: 0,
      enqueueAssemble: false,
    });
    return { hitCount: 0, skipped: "app_missing" };
  }

  let hitCount = 0;
  let predicateVersion = 0;

  if (widgetId === "managerMismatches") {
    const mod = await import("./applicationManagerMismatchSidecar.js");
    const r = await mod.rebuildManagerMismatchSidecarForApplication(tenantId, app, {
      sourceGeneration,
      skipAssemble: true,
    });
    hitCount = r?.hitCount || 0;
    predicateVersion = mod.MANAGER_MISMATCH_PREDICATE_VERSION;
  } else if (widgetId === "statusMismatches") {
    if (app.authoritativeSource) {
      hitCount = 0;
      const mod = await import("./applicationStatusMismatchSidecar.js");
      predicateVersion = mod.STATUS_MISMATCH_PREDICATE_VERSION;
      await markHygieneRollupBuilt({
        tenantId,
        applicationId,
        widgetId,
        sourceGeneration,
        count: 0,
        predicateVersion,
        enqueueAssemble: false,
      });
      return { hitCount: 0, skipped: "authoritative" };
    }
    const mod = await import("./applicationStatusMismatchSidecar.js");
    const r = await mod.rebuildStatusMismatchSidecarForApplication(tenantId, app, {
      sourceGeneration,
      skipAssemble: true,
    });
    hitCount = r?.hitCount || 0;
    predicateVersion = mod.STATUS_MISMATCH_PREDICATE_VERSION;
  } else if (widgetId === "inactiveUsersWithAccess") {
    const { rebuildInactiveAccessSidecarFromLiveUsers } = await import(
      "./applicationUserInactiveAccessSidecar.js"
    );
    const r = await rebuildInactiveAccessSidecarFromLiveUsers({
      applicationId,
      tenantId,
      sourceGeneration,
      skipAssemble: true,
    });
    hitCount = r?.hitCount || 0;
    const mod = await import("./applicationUserInactiveAccessSidecar.js");
    predicateVersion = mod.INACTIVE_ACCESS_PREDICATE_VERSION;
  } else {
    throw new Error(`Unsupported widgetId for recompute: ${widgetId}`);
  }

  await markHygieneRollupBuilt({
    tenantId,
    applicationId,
    widgetId,
    sourceGeneration,
    count: hitCount,
    predicateVersion,
    enqueueAssemble: false,
  });

  return { hitCount };
}

async function processAssembleTenantSummary(job) {
  const tenantId = job.tenantId;
  const t0 = Date.now();

  // Prefer waiting: if dirty widget jobs still pending for this generation, requeue briefly.
  const HygieneJob = (await import("../../models/dataHygiene/HygieneJob.js")).default;
  const pendingWidgets = await HygieneJob.countDocuments({
    tenantId,
    kind: "RECOMPUTE_APP_WIDGET",
    status: { $in: ["PENDING", "PROCESSING"] },
    sourceGeneration: { $lte: job.sourceGeneration || 0 },
  });
  if (pendingWidgets > 0 && (job.attempts || 1) < 3) {
    // Soft defer — throw to retry with backoff so widgets finish first.
    const err = new Error(`waiting_for_${pendingWidgets}_widget_jobs`);
    err.code = "HYGIENE_ASSEMBLE_DEFER";
    throw err;
  }

  const payload = await recomputeDataHygieneSummary(tenantId);
  const freshness = await getTenantHygieneFreshness(tenantId);

  if (payload && typeof payload === "object") {
    payload.freshness = freshness;
    const computedAt = payload?.computedAt ? new Date(payload.computedAt) : new Date();
    await DataHygieneTenantSummary.findOneAndUpdate(
      { tenantId },
      {
        $set: {
          payload,
          computedAt,
          version: DATA_HYGIENE_SUMMARY_VERSION,
          freshness,
        },
      },
      { upsert: true },
    );
  }

  hygieneTiming("hygiene.assemble", Date.now() - t0);

  return { freshnessStatus: freshness?.status };
}

async function processJob(job) {
  const t0 = Date.now();
  hygieneLog("job_start", {
    jobId: String(job._id),
    kind: job.kind,
    tenantId: String(job.tenantId),
    applicationId: job.applicationId ? String(job.applicationId) : null,
    widgetId: job.widgetId,
    sourceGeneration: job.sourceGeneration,
    attempts: job.attempts,
  });

  try {
    let result;
    if (job.kind === "RECOMPUTE_APP_WIDGET" || job.kind === "BACKFILL_WIDGET") {
      result = await processRecomputeAppWidget(job);
      await enqueueAssembleTenantSummary({
        tenantId: job.tenantId,
        reason: `after_${job.widgetId}`,
        sourceGeneration: job.sourceGeneration,
      });
    } else if (job.kind === "ASSEMBLE_TENANT_SUMMARY") {
      result = await processAssembleTenantSummary(job);
    } else {
      throw new Error(`Unknown job kind: ${job.kind}`);
    }

    await finalizeHygieneJobSuccess(job);
    hygieneTiming("hygiene.job.duration", Date.now() - t0);
    return result;
  } catch (err) {
    const msg = err?.message || String(err);
    if (job.kind === "RECOMPUTE_APP_WIDGET" && job.applicationId && job.widgetId) {
      await markHygieneRollupFailed({
        tenantId: job.tenantId,
        applicationId: job.applicationId,
        widgetId: job.widgetId,
        error: msg,
        sourceGeneration: job.sourceGeneration,
      }).catch(() => {});
    }
    await finalizeHygieneJobFailure(job, msg);
    hygieneMetricInc("hygiene.job.failed");
    hygieneTiming("hygiene.job.duration", Date.now() - t0);
    throw err;
  }
}

async function processHygieneJobBatch() {
  if (processing) return;
  processing = true;
  try {
    for (let i = 0; i < BATCH_SIZE; i++) {
      const job = await claimNextHygieneJob(LEASE_MS);
      if (!job) break;
      try {
        await processJob(job);
      } catch (err) {
        console.error(LOG_PREFIX, "job failed", job._id, err?.message || err);
      }
    }
  } finally {
    processing = false;
  }
}

async function logHealthIfDue() {
  pollCount += 1;
  if (pollCount % 20 !== 0) return;
  try {
    const stats = await getHygieneJobQueueStats();
    const metrics = getHygieneMetricsSnapshot();
    // Skip idle health logs to keep the terminal quiet — only log when there is
    // actual queue activity, a failure, or recorded metrics.
    const hasActivity =
      (stats.pending || 0) > 0 ||
      (stats.processing || 0) > 0 ||
      (stats.failed || 0) > 0 ||
      (stats.dead || 0) > 0 ||
      Object.keys(metrics).length > 0;
    if (!hasActivity) return;
    hygieneLog("worker_health", { ...stats, metrics });
  } catch (err) {
    console.warn(LOG_PREFIX, "health log failed", err?.message || err);
  }
}

/**
 * Start durable hygiene worker (multi-instance safe via DistributedLock + job lease).
 */
export function startHygieneWorker() {
  if (workerInterval) return;

  console.log(
    LOG_PREFIX,
    "Starting — poll interval:",
    POLL_INTERVAL_MS / 1000,
    "seconds",
  );

  recoverStaleHygieneJobs()
    .then(() =>
      withPollLock(() => processHygieneJobBatch()),
    )
    .catch((err) => console.error(LOG_PREFIX, "startup error", err?.message || err));

  workerInterval = setInterval(() => {
    void withPollLock(async () => {
      await recoverStaleHygieneJobs();
      await processHygieneJobBatch();
      await logHealthIfDue();
    }).catch((err) => console.error(LOG_PREFIX, "poll error", err?.message || err));
  }, POLL_INTERVAL_MS);
}
