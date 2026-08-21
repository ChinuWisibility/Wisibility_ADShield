import { purgeStaleReconciliationSnapshots } from "../reconciliation/snapshotRetentionService.js";

const LOG_PREFIX = "[identity-sync-background]";

function runSafely(label, fn) {
  setImmediate(() => {
    void (async () => {
      try {
        await fn();
      } catch (err) {
        console.error(LOG_PREFIX, label, err?.message || err);
      }
    })();
  });
}

/**
 * Non-critical post-sync work: correlation stats, data hygiene summary, identity entitlement projection, snapshot retention.
 * @param {object} params
 */
export function schedulePostSyncBackgroundWork(params) {
  const {
    application,
    correlationStatsFn,
    dataHygieneStatsFn,
    snapshotRetentionFn,
    scheduleIdentitySync = true,
  } = params;

  if (correlationStatsFn) {
    runSafely("correlation-stats", correlationStatsFn);
  }

  if (dataHygieneStatsFn) {
    runSafely("data-hygiene-summary", dataHygieneStatsFn);
  } else if (application?.tenantId) {
    runSafely("data-hygiene-summary", async () => {
      const { scheduleDataHygieneSummaryRecompute } = await import(
        "../datahygine/dataHygieneSummaryCacheService.js"
      );
      scheduleDataHygieneSummaryRecompute(application.tenantId);
    });
  }

  if (application?._id && application?.tenantId) {
    runSafely("hygiene-dirty", async () => {
      const { emitHygieneDirty, DEFAULT_APP_DIRTY_WIDGETS } = await import(
        "../datahygine/hygieneRollupService.js"
      );
      await emitHygieneDirty({
        tenantId: application.tenantId,
        applicationId: application._id,
        widgetIds: [...DEFAULT_APP_DIRTY_WIDGETS],
        reason: "post_sync",
      });
    });
  }

  if (application?._id && application?.tenantId) {
    runSafely("manager-mismatch-sidecar", async () => {
      const { scheduleManagerMismatchSidecarRebuild } = await import(
        "../datahygine/applicationManagerMismatchSidecar.js"
      );
      scheduleManagerMismatchSidecarRebuild(application._id, application.tenantId, {
        skipDirtyEmit: true,
      });
    });
  }

  if (application?._id && application?.tenantId) {
    runSafely("status-mismatch-sidecar", async () => {
      const { scheduleStatusMismatchSidecarRebuild } = await import(
        "../datahygine/applicationStatusMismatchSidecar.js"
      );
      scheduleStatusMismatchSidecarRebuild(application._id, application.tenantId, {
        skipDirtyEmit: true,
      });
    });
  }

  if (scheduleIdentitySync && application?._id) {
    runSafely("identity-entitlement-sync", async () => {
      const mod = await import("../../utils/identityEntitlementSyncTrigger.js");
      mod.scheduleSyncAllForApplication(application._id);
    });
  }

  if (snapshotRetentionFn) {
    runSafely("snapshot-retention", snapshotRetentionFn);
  } else if (application?.name && application?.tenantId) {
    runSafely("snapshot-retention", async () => {
      await purgeStaleReconciliationSnapshots(application);
    });
  }
}

/**
 * @param {string} label
 * @param {() => Promise<object>} fn
 */
export async function timeSyncStage(label, fn) {
  const t0 = Date.now();
  const mu0 = process.memoryUsage().heapUsed;
  const cpu0 = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;
  const result = await fn();
  const ms = Date.now() - t0;
  const heapAfter = process.memoryUsage().heapUsed;
  const memoryMb = Math.round(((heapAfter - mu0) / 1024 / 1024) * 10) / 10;
  const heapAfterMb = Math.round((heapAfter / 1024 / 1024) * 10) / 10;
  let cpuMs = null;
  if (cpu0 && typeof process.cpuUsage === "function") {
    const cpu1 = process.cpuUsage(cpu0);
    cpuMs = Math.round((cpu1.user + cpu1.system) / 1000);
  }
  return {
    label,
    ms,
    memoryMb,
    heapAfterMb,
    cpuMs,
    startedAt: new Date(t0).toISOString(),
    endedAt: new Date().toISOString(),
    ...(result && typeof result === "object" ? result : { result }),
  };
}

export function createPipelineMetrics() {
  return {
    stages: [],
    totals: {
      unchangedAccounts: 0,
      changedAccounts: 0,
      newAccounts: 0,
      removedAccounts: 0,
      membershipChangedAccounts: 0,
      correlationEdgesAdded: 0,
      correlationEdgesRemoved: 0,
      aggregationsSkipped: 0,
      aggregationsUpserted: 0,
      aggregationSkipped: 0,
      correlationSkipped: 0,
    },
  };
}

export function recordPipelineStage(metrics, stage) {
  if (!metrics) return;
  metrics.stages.push(stage);
  if (stage.counts) {
    for (const [k, v] of Object.entries(stage.counts)) {
      if (metrics.totals[k] != null && typeof v === "number") {
        metrics.totals[k] += v;
      }
    }
  }
}

/**
 * Flatten reconciliation + ingest substage timings for AdSyncJob persistence.
 * @param {ReturnType<typeof createPipelineMetrics>} pipelineMetrics
 * @param {number} [derivedAppsMs]
 */
export function buildIngestSubstageTimings(pipelineMetrics, derivedAppsMs = 0) {
  const stages = pipelineMetrics?.stages || [];
  const recon = stages.find((s) => s.label === "reconciliation-stages")?.counts || {};
  const hashDelta = stages.find((s) => s.label === "hash-delta")?.counts || {};
  const agg = stages.find((s) => s.label === "aggregation");
  const ent = stages.find((s) => s.label === "entitlements");
  const corr = stages.find((s) => s.label === "correlation");
  const graph = stages.find((s) => s.label === "graph");
  const derived = stages.find((s) => s.label === "derived_apps");
  return {
    hashGenerateMs: typeof recon.hashGenerateMs === "number" ? recon.hashGenerateMs : null,
    hashCompareMs: typeof recon.hashCompareMs === "number" ? recon.hashCompareMs : null,
    hashPartitionMs: typeof recon.hashPartitionMs === "number" ? recon.hashPartitionMs : null,
    reconciliationMs: typeof recon.totalReconciliationMs === "number" ? recon.totalReconciliationMs : null,
    userUpsertMs: typeof recon.userUpsertMs === "number" ? recon.userUpsertMs : null,
    identitySyncStateMs:
      typeof recon.syncStatePersistMs === "number" ? recon.syncStatePersistMs : null,
    aggregationMs: typeof agg?.ms === "number" ? agg.ms : null,
    aggregationCpuMs: typeof agg?.cpuMs === "number" ? agg.cpuMs : null,
    entitlementMs: typeof ent?.ms === "number" ? ent.ms : null,
    entitlementCpuMs: typeof ent?.cpuMs === "number" ? ent.cpuMs : null,
    correlationMs: typeof corr?.ms === "number" ? corr.ms : null,
    correlationCpuMs: typeof corr?.cpuMs === "number" ? corr.cpuMs : null,
    correlationEdgesAdded: corr?.edgesAdded ?? corr?.counts?.correlationEdgesAdded ?? null,
    correlationEdgesRemoved: corr?.edgesRemoved ?? corr?.counts?.correlationEdgesRemoved ?? null,
    graphMs: typeof graph?.ms === "number" ? graph.ms : null,
    graphCpuMs: typeof graph?.cpuMs === "number" ? graph.cpuMs : null,
    graphEdgeCount: graph?.edgeCount ?? null,
    graphUpserted: graph?.upserted ?? null,
    graphDeleted: graph?.deleted ?? null,
    graphUsersProcessed: graph?.usersProcessed ?? null,
    graphGroupsProcessed: graph?.groupsProcessed ?? null,
    derivedAppsMs:
      derivedAppsMs > 0
        ? derivedAppsMs
        : typeof derived?.ms === "number"
          ? derived.ms
          : null,
    unchangedAccounts: hashDelta.unchangedAccounts ?? pipelineMetrics?.totals?.unchangedAccounts ?? null,
    changedAccounts: hashDelta.changedAccounts ?? pipelineMetrics?.totals?.changedAccounts ?? null,
    newAccounts: hashDelta.newAccounts ?? pipelineMetrics?.totals?.newAccounts ?? null,
    removedAccounts: hashDelta.removedAccounts ?? pipelineMetrics?.totals?.removedAccounts ?? null,
    membershipChangedAccounts: hashDelta.membershipChangedAccounts ?? null,
    aggregationSkipped:
      hashDelta.aggregationSkipped ??
      agg?.counts?.aggregationsSkipped ??
      pipelineMetrics?.totals?.aggregationsSkipped ??
      null,
    correlationSkipped:
      hashDelta.correlationSkipped ??
      corr?.counts?.correlationSkipped ??
      pipelineMetrics?.totals?.correlationSkipped ??
      null,
  };
}
