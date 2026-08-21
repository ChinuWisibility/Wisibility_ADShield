/**
 * AD Sync profiling helpers — observation only.
 * Does not change sync business logic; used to populate AdSyncJob.stageTimings.
 */

export function heapUsedMb() {
  return Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10;
}

export function rssMb() {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

/**
 * @returns {{
 *   stages: object[],
 *   peakHeapMb: number,
 *   peakRssMb: number,
 *   progressUpdateMs: number,
 *   progressUpdateCount: number,
 *   startedAt: number,
 * }}
 */
export function createAdSyncProfiler() {
  return {
    stages: [],
    peakHeapMb: heapUsedMb(),
    peakRssMb: rssMb(),
    progressUpdateMs: 0,
    progressUpdateCount: 0,
    startedAt: Date.now(),
  };
}

/**
 * @param {ReturnType<typeof createAdSyncProfiler>} profiler
 */
export function noteMemory(profiler) {
  if (!profiler) return;
  const heap = heapUsedMb();
  const rss = rssMb();
  if (heap > profiler.peakHeapMb) profiler.peakHeapMb = heap;
  if (rss > profiler.peakRssMb) profiler.peakRssMb = rss;
}

/**
 * Time an async stage and append to profiler.stages.
 * @template T
 * @param {ReturnType<typeof createAdSyncProfiler>|null} profiler
 * @param {string} stage
 * @param {() => Promise<T>} fn
 * @param {object} [extraCounts]
 * @returns {Promise<T>}
 */
export async function profileStage(profiler, stage, fn, extraCounts = {}) {
  const startedAt = Date.now();
  const heapBeforeMb = heapUsedMb();
  const cpu0 = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;

  let error = null;
  let result;
  try {
    result = await fn();
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const endedAt = Date.now();
    const ms = endedAt - startedAt;
    const heapAfterMb = heapUsedMb();
    noteMemory(profiler);

    let cpuMs = null;
    if (cpu0 && typeof process.cpuUsage === "function") {
      const cpu1 = process.cpuUsage(cpu0);
      cpuMs = Math.round((cpu1.user + cpu1.system) / 1000);
    }

    const resultCounts =
      result && typeof result === "object" && !Array.isArray(result)
        ? extractResultCounts(result)
        : {};

    const entry = {
      stage,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      ms,
      heapBeforeMb,
      heapAfterMb,
      heapDeltaMb: Math.round((heapAfterMb - heapBeforeMb) * 10) / 10,
      peakHeapMb: profiler?.peakHeapMb ?? heapAfterMb,
      peakRssMb: profiler?.peakRssMb ?? rssMb(),
      cpuMs,
      counts: { ...resultCounts, ...extraCounts },
      error: error ? String(error.message || error) : undefined,
    };

    if (profiler) profiler.stages.push(entry);
  }

  return result;
}

/**
 * Pull known numeric/metric fields from stage return values without inventing data.
 * @param {object} result
 */
function extractResultCounts(result) {
  const out = {};
  const keys = [
    "users",
    "groups",
    "computers",
    "edgeCount",
    "upserted",
    "deleted",
    "inserted",
    "skipped",
    "edgesAdded",
    "edgesRemoved",
    "matchCount",
    "usersProcessed",
    "groupsProcessed",
    "groupNodes",
    "privilegedGroups",
    "graphVersion",
    "pageCount",
    "userPages",
    "groupPages",
    "computerPages",
    "ldapBinds",
    "membershipEdges",
    "bulkWriteOps",
    "documentsWritten",
    "mongoQueries",
  ];
  for (const k of keys) {
    if (typeof result[k] === "number") out[k] = result[k];
  }
  if (result.counts && typeof result.counts === "object") {
    for (const [k, v] of Object.entries(result.counts)) {
      if (typeof v === "number" && out[k] == null) out[k] = v;
    }
  }
  if (result.edgeCounts && typeof result.edgeCounts === "object") {
    out.edgeCountsByType = result.edgeCounts;
  }
  if (result.timings && typeof result.timings === "object") {
    out.graphInternalTimings = summarizeGraphTimings(result.timings);
  }
  if (result.profile && typeof result.profile === "object") {
    Object.assign(out, flattenProfile(result.profile));
  }
  return out;
}

function summarizeGraphTimings(timings) {
  const pick = [
    "edgeBuildMs",
    "bulkWriteMs",
    "adjacencyCacheMs",
    "preloadMs",
    "traversalCount",
  ];
  const out = {};
  for (const k of pick) {
    if (typeof timings[k] === "number") out[k] = timings[k];
  }
  return out;
}

function flattenProfile(profile) {
  const out = {};
  for (const [k, v] of Object.entries(profile)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Rank profiler stages by duration for bottleneck reports.
 * @param {Array<{ stage: string, ms?: number, counts?: object, memoryMb?: number, heapAfterMb?: number, cpuMs?: number }>} stages
 * @param {number} [totalMs]
 */
export function rankStagesByDuration(stages, totalMs) {
  const list = (stages || [])
    .filter((s) => typeof s.ms === "number" && s.ms > 0 && s.stage !== "ingest_subtimings")
    .map((s) => ({ ...s }));

  const sum =
    typeof totalMs === "number" && totalMs > 0
      ? totalMs
      : list.reduce((n, s) => n + (s.ms || 0), 0) || 1;

  return list
    .sort((a, b) => (b.ms || 0) - (a.ms || 0))
    .map((s, i) => ({
      rank: i + 1,
      stage: s.stage,
      ms: s.ms,
      pctOfTotal: Math.round(((s.ms || 0) / sum) * 1000) / 10,
      memoryMb: s.heapAfterMb ?? s.memoryMb ?? null,
      cpuMs: s.cpuMs ?? null,
      counts: s.counts || null,
    }));
}

/**
 * Build a flat summary suitable for AdSyncJob.result.profilerSummary.
 */
export function buildProfilerSummary(profiler, stageTimings = []) {
  const ranked = rankStagesByDuration([
    ...(profiler?.stages || []),
    ...(stageTimings || []),
  ]);
  return {
    totalMs: profiler ? Date.now() - profiler.startedAt : null,
    peakHeapMb: profiler?.peakHeapMb ?? null,
    peakRssMb: profiler?.peakRssMb ?? null,
    progressUpdateMs: profiler?.progressUpdateMs ?? 0,
    progressUpdateCount: profiler?.progressUpdateCount ?? 0,
    stageCount: ranked.length,
    topBottlenecks: ranked.slice(0, 10),
    rankedStages: ranked,
  };
}

/**
 * Fine-grained ingest attribution tracker (Iteration 0 — measurement only).
 */
export function createIngestDetailTracker(label = "ingest") {
  const spans = [];
  let peakHeapMb = heapUsedMb();
  let peakRssMb = rssMb();

  function touchMem() {
    const h = heapUsedMb();
    const r = rssMb();
    if (h > peakHeapMb) peakHeapMb = h;
    if (r > peakRssMb) peakRssMb = r;
  }

  /**
   * @template T
   * @param {string} name
   * @param {(counters: { documentsProcessed: number, mongoReads: number, mongoWrites: number }) => Promise<T>|T} fn
   * @param {object} [meta]
   * @returns {Promise<T>}
   */
  async function span(name, fn, meta = {}) {
    const startedAt = Date.now();
    const heapBeforeMb = heapUsedMb();
    const cpu0 = typeof process.cpuUsage === "function" ? process.cpuUsage() : null;
    let result;
    let error;
    const counters = {
      documentsProcessed: meta.documentsProcessed ?? 0,
      mongoReads: meta.mongoReads ?? 0,
      mongoWrites: meta.mongoWrites ?? 0,
    };
    try {
      result = await fn(counters);
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const endedAt = Date.now();
      touchMem();
      let cpuMs = null;
      if (cpu0 && typeof process.cpuUsage === "function") {
        const cpu1 = process.cpuUsage(cpu0);
        cpuMs = Math.round((cpu1.user + cpu1.system) / 1000);
      }
      const heapAfterMb = heapUsedMb();
      const fromResult =
        result && typeof result === "object" && !Array.isArray(result)
          ? {
              documentsProcessed:
                counters.documentsProcessed ||
                result.documentsProcessed ||
                result.edgeCount ||
                result.upserted ||
                result.inserted ||
                result.usersProcessed ||
                0,
              mongoReads: counters.mongoReads || result.mongoReads || 0,
              mongoWrites:
                counters.mongoWrites ||
                result.mongoWrites ||
                result.upserted ||
                result.deleted ||
                result.inserted ||
                0,
            }
          : counters;

      spans.push({
        name,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        ms: endedAt - startedAt,
        cpuMs,
        heapBeforeMb,
        heapAfterMb,
        heapDeltaMb: Math.round((heapAfterMb - heapBeforeMb) * 10) / 10,
        peakHeapMb,
        peakRssMb,
        documentsProcessed: fromResult.documentsProcessed || 0,
        mongoReads: fromResult.mongoReads || 0,
        mongoWrites: fromResult.mongoWrites || 0,
        exclusive: meta.exclusive !== false,
        parent: meta.parent || null,
        extra: meta.extra || undefined,
        error: error ? String(error.message || error) : undefined,
      });
    }
  }

  function recordSync(name, ms, meta = {}) {
    touchMem();
    const now = Date.now();
    spans.push({
      name,
      startedAt: new Date(now - (ms || 0)).toISOString(),
      endedAt: new Date(now).toISOString(),
      ms: ms || 0,
      cpuMs: meta.cpuMs ?? null,
      heapBeforeMb: heapUsedMb(),
      heapAfterMb: heapUsedMb(),
      heapDeltaMb: 0,
      peakHeapMb,
      peakRssMb,
      documentsProcessed: meta.documentsProcessed || 0,
      mongoReads: meta.mongoReads || 0,
      mongoWrites: meta.mongoWrites || 0,
      exclusive: meta.exclusive !== false,
      parent: meta.parent || null,
      extra: meta.extra || undefined,
    });
  }

  function snapshot() {
    return {
      label,
      peakHeapMb,
      peakRssMb,
      spans: [...spans],
    };
  }

  return { span, recordSync, snapshot, get spans() { return spans; } };
}

/**
 * Attribute wall time from exclusive leaf spans. Target: unknownPct < 2.
 */
export function buildRuntimeAttribution({ wallMs, exclusiveSpans = [], topLevel = [] }) {
  const wall = Math.max(0, Number(wallMs) || 0);
  const exclusive = (exclusiveSpans || []).filter((s) => (s.ms || 0) > 0);
  const accountedMs = exclusive.reduce((n, s) => n + (s.ms || 0), 0);
  const unknownMs = Math.max(0, wall - accountedMs);
  const unknownPct = wall > 0 ? Math.round((unknownMs / wall) * 1000) / 10 : 0;
  const ranked = [...exclusive]
    .sort((a, b) => (b.ms || 0) - (a.ms || 0))
    .map((s, i) => ({
      rank: i + 1,
      name: s.name,
      ms: s.ms,
      pctOfWall: wall > 0 ? Math.round(((s.ms || 0) / wall) * 1000) / 10 : 0,
      documentsProcessed: s.documentsProcessed ?? null,
      mongoReads: s.mongoReads ?? null,
      mongoWrites: s.mongoWrites ?? null,
      cpuMs: s.cpuMs ?? null,
    }));

  return {
    wallMs: wall,
    accountedMs,
    accountedPct: wall > 0 ? Math.round((accountedMs / wall) * 1000) / 10 : 0,
    unknownMs,
    unknownPct,
    attributionComplete: unknownPct < 2,
    topLevel,
    rankedExclusiveSpans: ranked,
    spanCount: exclusive.length,
  };
}

