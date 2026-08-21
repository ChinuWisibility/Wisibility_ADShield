/**
 * Graph engine observability — stage timings, counters, memory snapshots.
 */
const metricsStore = new Map();

export function createGraphMetrics(scopeKey) {
  const metrics = {
    scopeKey,
    startedAt: Date.now(),
    edgeBuildMs: 0,
    adjacencyCacheMs: 0,
    graphLoadMs: 0,
    analyzeMs: 0,
    traversalCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    invalidationCount: 0,
    edgeUpserts: 0,
    edgeDeletes: 0,
    nodeCounts: { users: 0, groups: 0 },
    edgeCounts: {},
    memoryUsageMb: 0,
    stages: {},
  };
  metricsStore.set(scopeKey, metrics);
  return metrics;
}

export function recordStage(metrics, stage, ms) {
  if (!metrics) return;
  metrics.stages[stage] = ms;
}

export function incrementMetric(metrics, key, delta = 1) {
  if (!metrics) return;
  metrics[key] = (metrics[key] || 0) + delta;
}

export function snapshotMemory(metrics) {
  if (!metrics) return;
  const mem = process.memoryUsage();
  metrics.memoryUsageMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
  return metrics.memoryUsageMb;
}

export function finalizeMetrics(metrics) {
  if (!metrics) return null;
  metrics.totalMs = Date.now() - metrics.startedAt;
  snapshotMemory(metrics);
  return { ...metrics };
}

export function getMetrics(scopeKey) {
  return metricsStore.get(scopeKey) || null;
}

export function msSince(start) {
  return Date.now() - start;
}
