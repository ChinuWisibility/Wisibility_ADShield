import Application from "../models/application/Application.js";
import { fetchAdDirectory, normalizeAdConfig } from "./adLdapService.js";
import { syncSourceApplicationAndDerivedFromDirectory } from "./adDirectorySyncService.js";
import {
  appendAdSyncStageTiming,
  patchAdSyncJob,
} from "./adSyncJobService.js";
import { buildIngestSubstageTimings } from "./sync/identitySyncBackground.js";
import {
  buildProfilerSummary,
  buildRuntimeAttribution,
  createAdSyncProfiler,
  heapUsedMb,
  noteMemory,
  rankStagesByDuration,
} from "./sync/adSyncProfiler.js";
import {
  AD_SYNC_PERFORMANCE_BUDGET,
  runtimeBudgetMsForUserCount,
} from "./sync/adSyncPerformanceBudget.js";
import {
  resolveUserSearchFilterForSyncScope,
  normalizeAdSyncScope,
} from "../utils/adSyncScope.js";

/** @type {Set<string>} */
const inFlightJobIds = new Set();

/**
 * @param {string} stage
 * @param {number} startedMs
 * @param {object} [counts]
 * @param {ReturnType<typeof createAdSyncProfiler>|null} [profiler]
 * @param {{ cpuMs?: number, heapBeforeMb?: number }} [extra]
 */
async function recordStage(jobId, stage, startedMs, counts = {}, profiler = null, extra = {}) {
  const endedMs = Date.now();
  const ms = endedMs - startedMs;
  noteMemory(profiler);
  const timing = {
    stage,
    ms,
    counts,
    memoryMb: heapUsedMb(),
    startedAt: new Date(startedMs).toISOString(),
    endedAt: new Date(endedMs).toISOString(),
    heapAfterMb: heapUsedMb(),
    peakHeapMb: profiler?.peakHeapMb,
    peakRssMb: profiler?.peakRssMb,
    cpuMs: extra.cpuMs ?? null,
    heapBeforeMb: extra.heapBeforeMb ?? null,
  };
  await appendAdSyncStageTiming(jobId, timing);
  if (profiler) {
    profiler.stages.push(timing);
  }
  console.info(
    `[ad-sync:${jobId}] stage=${stage} durationMs=${ms} memoryMb=${heapUsedMb()} cpuMs=${extra.cpuMs ?? "n/a"} counts=${JSON.stringify(counts)}`,
  );
  return ms;
}

/**
 * @param {string} jobId
 * @param {string} phase
 * @param {number} percent
 * @param {string} message
 * @param {ReturnType<typeof createAdSyncProfiler>|null} [profiler]
 */
async function reportProgress(jobId, phase, percent, message, profiler = null) {
  const t0 = Date.now();
  await patchAdSyncJob(jobId, {
    status: "running",
    phase,
    percent: Math.min(100, Math.max(0, Math.round(percent))),
    message,
  });
  if (profiler) {
    profiler.progressUpdateMs += Date.now() - t0;
    profiler.progressUpdateCount += 1;
  }
}

/**
 * Run full AD sync pipeline for a persisted job (non-blocking HTTP worker).
 * Profiling only — does not change sync business logic.
 * @param {string} jobId
 */
export async function runAdSyncPipeline(jobId) {
  if (inFlightJobIds.has(jobId)) return;
  inFlightJobIds.add(jobId);

  const profiler = createAdSyncProfiler();
  let application = null;
  try {
    const job = await patchAdSyncJob(jobId, {
      status: "running",
      phase: "starting",
      percent: 1,
      message: "Starting AD sync…",
      startedAt: new Date(),
    });
    if (!job) return;

    application = await Application.findById(job.applicationId);
    if (!application) {
      throw new Error("Application not found");
    }

    const cfg = normalizeAdConfig({
      ...(application.connectionConfig?.ad || {}),
      ...(job.syncConfig || {}),
      bindPassword:
        job.syncConfig?.bindPassword ||
        application.connectionConfig?.ad?.bindPassword,
    });
    const syncScope = normalizeAdSyncScope(job.syncConfig?.syncScope);
    const userSearchFilter = resolveUserSearchFilterForSyncScope(syncScope);
    cfg.userSearchFilter = userSearchFilter;
    cfg.userSearchFilters = [userSearchFilter];

    if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
      throw new Error(
        "Incomplete AD configuration. Save LDAP URL, base DN, and bind DN on the application first.",
      );
    }

    const maxUsers = Math.min(
      Math.max(parseInt(job.syncConfig?.maxUsers, 10) || cfg.maxUsers, 1),
      50000,
    );
    const maxGroups = Math.min(
      Math.max(parseInt(job.syncConfig?.maxGroups, 10) || cfg.maxGroups, 1),
      50000,
    );
    const syncGroups =
      job.syncConfig?.syncGroups !== false &&
      job.syncConfig?.syncGroups !== "false";

    await reportProgress(
      jobId,
      "ldap_fetch",
      8,
      "Fetching directory from Active Directory…",
      profiler,
    );
    const ldapStart = Date.now();
    const ldapHeapBefore = heapUsedMb();
    const ldapCpu0 = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;
    const directory = await fetchAdDirectory(cfg, {
      maxUsers,
      maxGroups,
      syncGroups,
      pageSize: cfg.pageSize || 1000,
    });
    let ldapCpuMs = null;
    if (ldapCpu0 && typeof process.cpuUsage === "function") {
      const c = process.cpuUsage(ldapCpu0);
      ldapCpuMs = Math.round((c.user + c.system) / 1000);
    }
    const ldapProfile = directory?.profile || {};
    await recordStage(
      jobId,
      "ldap_fetch",
      ldapStart,
      {
        ...(directory?.counts || {}),
        ...ldapProfile,
      },
      profiler,
      { cpuMs: ldapCpuMs, heapBeforeMb: ldapHeapBefore },
    );

    // Split observation stages (same work already done inside fetchAdDirectory).
    await appendAdSyncStageTiming(jobId, {
      stage: "normalization",
      ms:
        (ldapProfile.normalizeUsersMs || 0) +
        (ldapProfile.normalizeGroupsMs || 0) +
        (ldapProfile.normalizeComputersMs || 0),
      counts: {
        users: directory?.counts?.users,
        groups: directory?.counts?.groups,
        computers: directory?.counts?.computers,
        note: "CPU time within ldap_fetch wall clock (parallel with LDAP I/O)",
      },
      memoryMb: heapUsedMb(),
    });
    await appendAdSyncStageTiming(jobId, {
      stage: "membership_indexing",
      ms: ldapProfile.membershipIndexMs || 0,
      counts: {
        membershipEdges: ldapProfile.membershipEdges,
        mapEnrichMs: ldapProfile.mapEnrichMs,
        note: "CPU time within ldap_fetch wall clock",
      },
      memoryMb: heapUsedMb(),
    });

    await reportProgress(
      jobId,
      "ingesting",
      30,
      `Ingesting ${directory?.counts?.users ?? 0} user(s)…`,
      profiler,
    );
    const ingestStart = Date.now();
    const ingestHeapBefore = heapUsedMb();
    const ingestCpu0 = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;
    const { source, derived, pipelineMetrics, derivedAppsMs, ingestDetail } =
      await syncSourceApplicationAndDerivedFromDirectory(
        application,
        directory,
        {
          syncGroups,
          onProgress: (phase, percent, message) =>
            reportProgress(jobId, phase, percent, message, profiler),
        },
      );
    let ingestCpuMs = null;
    if (ingestCpu0 && typeof process.cpuUsage === "function") {
      const c = process.cpuUsage(ingestCpu0);
      ingestCpuMs = Math.round((c.user + c.system) / 1000);
    }

    const substageTimings = buildIngestSubstageTimings(pipelineMetrics, derivedAppsMs);

    // Persist per-ingest stages from pipelineMetrics for ranking.
    for (const stage of pipelineMetrics?.stages || []) {
      if (!stage?.label || stage.label === "hash-delta" || stage.label === "reconciliation-stages") {
        continue;
      }
      await appendAdSyncStageTiming(jobId, {
        stage: stage.label,
        ms: stage.ms || 0,
        counts: {
          ...(stage.counts || {}),
          edgesAdded: stage.edgesAdded,
          edgesRemoved: stage.edgesRemoved,
          edgeCount: stage.edgeCount,
          upserted: stage.upserted,
          deleted: stage.deleted,
          inserted: stage.inserted,
          skipped: stage.skipped,
          usersProcessed: stage.usersProcessed,
          groupsProcessed: stage.groupsProcessed,
        },
        memoryMb: stage.heapAfterMb ?? heapUsedMb(),
        cpuMs: stage.cpuMs,
        startedAt: stage.startedAt,
        endedAt: stage.endedAt,
      });
    }

    if (pipelineMetrics?.stages) {
      const reconDetail = pipelineMetrics.stages.find(
        (s) => s.label === "reconciliation-stages",
      );
      if (reconDetail) {
        await appendAdSyncStageTiming(jobId, {
          stage: "reconciliation_detail",
          ms: reconDetail.ms || 0,
          counts: reconDetail.counts || {},
          memoryMb: heapUsedMb(),
        });
      }
      const hashDelta = pipelineMetrics.stages.find((s) => s.label === "hash-delta");
      if (hashDelta) {
        await appendAdSyncStageTiming(jobId, {
          stage: "hash_delta",
          ms: 0,
          counts: hashDelta.counts || {},
          memoryMb: heapUsedMb(),
        });
      }
    }

    await recordStage(
      jobId,
      "ingest_pipeline",
      ingestStart,
      {
        users: source?.summary?.liveRows,
        entitlements: source?.entitlementsSynced,
        aggregations: source?.accountAggregationsUpserted,
        aggregationsSkipped: source?.accountAggregationsSkipped,
        hashOptimized: source?.hashOptimized,
        pipelineMetrics: pipelineMetrics?.totals,
        ingestSubtimings: substageTimings,
        derivedOk: derived.filter((d) => !d.skipped && !d.error).length,
        derivedTotal: derived.length,
      },
      profiler,
      { cpuMs: ingestCpuMs, heapBeforeMb: ingestHeapBefore },
    );

    await appendAdSyncStageTiming(jobId, {
      stage: "ingest_subtimings",
      ms: 0,
      counts: substageTimings,
      memoryMb: heapUsedMb(),
    });

    // Iteration 0: persist every exclusive ingest leaf + runtime attribution.
    const detailSnapshot = ingestDetail || pipelineMetrics?.detailTracker?.snapshot?.();
    const exclusiveSpans = (detailSnapshot?.spans || []).filter(
      (s) => s.exclusive !== false && (s.ms || 0) > 0,
    );
    await appendAdSyncStageTiming(jobId, {
      stage: "ingest_detail",
      ms: exclusiveSpans.reduce((n, s) => n + (s.ms || 0), 0),
      counts: {
        spanCount: detailSnapshot?.spans?.length || 0,
        exclusiveSpanCount: exclusiveSpans.length,
        spans: detailSnapshot?.spans || [],
      },
      memoryMb: heapUsedMb(),
      peakHeapMb: detailSnapshot?.peakHeapMb,
      peakRssMb: detailSnapshot?.peakRssMb,
    });

    await reportProgress(jobId, "finalizing", 95, "Finalizing sync metadata…", profiler);
    const finalizeStart = Date.now();
    await recordStage(jobId, "finalize", finalizeStart, {}, profiler);

    await appendAdSyncStageTiming(jobId, {
      stage: "progress_updates",
      ms: profiler.progressUpdateMs,
      counts: {
        progressUpdateCount: profiler.progressUpdateCount,
        note: "Cumulative Mongo findOneAndUpdate time for job progress patches",
      },
      memoryMb: heapUsedMb(),
    });

    await appendAdSyncStageTiming(jobId, {
      stage: "background_work_scheduled",
      ms: 0,
      counts: {
        note: "Correlation stats, identity entitlement sync, snapshot retention — fire-and-forget after main path",
      },
      memoryMb: heapUsedMb(),
    });

    const wallMs =
      job.startedAt != null ? Date.now() - new Date(job.startedAt).getTime() : null;

    // Attribution uses non-overlapping leaves only:
    // - ldap_fetch (full LDAP wall)
    // - exclusive ingest detail spans (not parents)
    // - progress_updates + finalize
    // Excludes: ingest_pipeline aggregate, normalization/membership splits of LDAP,
    //           ingest_subtimings, hash_delta, background, exclusive:false parents.
    const attributionSpans = [
      {
        name: "ldap_fetch",
        ms: profiler.stages.find((s) => s.stage === "ldap_fetch")?.ms || 0,
      },
      ...exclusiveSpans,
      {
        name: "progress_updates",
        ms: profiler.progressUpdateMs || 0,
        documentsProcessed: profiler.progressUpdateCount || 0,
        mongoWrites: profiler.progressUpdateCount || 0,
      },
      {
        name: "finalize",
        ms: profiler.stages.find((s) => s.stage === "finalize")?.ms || 0,
      },
    ];
    const runtimeAttribution = buildRuntimeAttribution({
      wallMs: wallMs || 0,
      exclusiveSpans: attributionSpans,
      topLevel: [
        {
          name: "ldap_fetch",
          ms: profiler.stages.find((s) => s.stage === "ldap_fetch")?.ms || 0,
        },
        {
          name: "ingest_pipeline",
          ms: profiler.stages.find((s) => s.stage === "ingest_pipeline")?.ms || 0,
        },
      ],
    });

    await appendAdSyncStageTiming(jobId, {
      stage: "runtime_attribution",
      ms: runtimeAttribution.unknownMs,
      counts: runtimeAttribution,
      memoryMb: heapUsedMb(),
    });

    console.info(
      `[ad-sync:${jobId}] attribution accountedPct=${runtimeAttribution.accountedPct}% unknownPct=${runtimeAttribution.unknownPct}% unknownMs=${runtimeAttribution.unknownMs} complete=${runtimeAttribution.attributionComplete}`,
    );

    // Reload timings for bottleneck ranking.
    const { getAdSyncJobForApplication } = await import("./adSyncJobService.js");
    const latest = await getAdSyncJobForApplication(jobId, String(application._id));
    const profilerSummary = buildProfilerSummary(profiler, latest?.stageTimings || []);
    const ranked = rankStagesByDuration(latest?.stageTimings || profiler.stages);
    const userCount = source?.summary?.liveRows ?? directory?.counts?.users ?? 0;
    const budgetMs = runtimeBudgetMsForUserCount(userCount);
    const performanceBudgetStatus = {
      userCount,
      budgetMs,
      wallMs,
      withinRuntimeBudget:
        wallMs != null && budgetMs != null ? wallMs <= budgetMs : null,
      maxRssFractionOfHeap: AD_SYNC_PERFORMANCE_BUDGET.maxRssFractionOfHeap,
      peakRssMb: profiler.peakRssMb,
      optimizationEligibilityThresholdPct:
        AD_SYNC_PERFORMANCE_BUDGET.optimizationEligibilityThresholdPct,
      principles: AD_SYNC_PERFORMANCE_BUDGET.principles,
    };

    const derivedOk = derived.filter((d) => !d.skipped && !d.error).length;
    const result = {
      count: source.summary.liveRows,
      directoryCounts: source.directoryCounts,
      directoryProfile: directory?.profile || null,
      entitlementsSynced: source.entitlementsSynced,
      summary: {
        ...source.summary,
        reconciliation: source.reconciliation,
        runId: source.runId,
      },
      reconciliation: source.reconciliation,
      runId: source.runId,
      accountAggregationsUpserted: source.accountAggregationsUpserted,
      derivedApplicationsRefreshed: derived,
      profilerSummary,
      bottleneckRanking: ranked.slice(0, 10),
      ingestSubtimings: substageTimings,
      ingestDetail: detailSnapshot,
      runtimeAttribution,
      performanceBudgetStatus,
    };

    const message = `Imported ${source.summary.liveRows} user(s) and ${source.entitlementsSynced} AD group(s); ${source.accountAggregationsUpserted} account(s) in identity cube. Refreshed ${derivedOk} derived application(s).`;

    await patchAdSyncJob(jobId, {
      status: "completed",
      phase: "completed",
      percent: 100,
      message,
      result,
      completedAt: new Date(),
    });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`[ad-sync:${jobId}] failed:`, err);
    await patchAdSyncJob(jobId, {
      status: "failed",
      phase: "failed",
      percent: 100,
      message: msg,
      error: msg,
      completedAt: new Date(),
      result: {
        profilerSummary: buildProfilerSummary(profiler),
      },
    });
  } finally {
    inFlightJobIds.delete(jobId);
  }
}

/**
 * @param {string} jobId
 */
export function scheduleAdSyncJobRun(jobId) {
  setImmediate(() => {
    runAdSyncPipeline(jobId).catch((err) => {
      console.error(`[ad-sync:${jobId}] unhandled pipeline error:`, err);
    });
  });
}
