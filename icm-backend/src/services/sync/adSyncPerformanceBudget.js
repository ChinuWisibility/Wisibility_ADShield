/**
 * AD Sync Performance Budget — shared constants for the performance program.
 * Optimizations must move toward these targets without sacrificing correctness.
 */
export const AD_SYNC_PERFORMANCE_BUDGET = Object.freeze({
  runtimeMsByUserScale: Object.freeze({
    5_000: 2 * 60 * 1000,
    50_000: 10 * 60 * 1000,
    100_000: 30 * 60 * 1000,
  }),
  /** Peak RSS must remain under this fraction of available heap / max old space. */
  maxRssFractionOfHeap: 0.75,
  /**
   * Decision matrix: a stage is eligible for optimization only if measured
   * contribution exceeds this percent for runtime, CPU, memory, Mongo I/O,
   * LDAP time, or graph processing.
   */
  optimizationEligibilityThresholdPct: 5,
  principles: Object.freeze({
    correctnessOverSpeed: true,
    rejectCorrectnessTradeoffs: true,
    mongodb: Object.freeze([
      "Avoid unnecessary writes",
      "Avoid rewriting unchanged documents",
      "Minimize collection scans",
      "Prefer incremental updates over full rewrites",
    ]),
    ldap: Object.freeze([
      "Fetch every object only once",
      "Eliminate duplicate LDAP requests where possible",
      "Preserve paging and correctness",
    ]),
    identityGraph: Object.freeze([
      "Never rebuild the complete graph unless explicitly required",
      "Prefer incremental edge updates when correctness can be guaranteed",
    ]),
    correlation: Object.freeze(["Prefer delta-only processing whenever possible"]),
    derivedApplications: Object.freeze([
      "Never repeat expensive work already computed for the source application",
    ]),
    memory: Object.freeze([
      "Peak RSS never exceed 75% of available heap",
      "Avoid unnecessary object duplication",
      "Avoid loading entire datasets into memory unless unavoidable",
    ]),
  }),
});

/**
 * @param {number} userCount
 * @returns {number|null} budget wall-clock ms, or null if scale unknown
 */
export function runtimeBudgetMsForUserCount(userCount) {
  const n = Number(userCount) || 0;
  if (n <= 5_000) return AD_SYNC_PERFORMANCE_BUDGET.runtimeMsByUserScale[5_000];
  if (n <= 50_000) return AD_SYNC_PERFORMANCE_BUDGET.runtimeMsByUserScale[50_000];
  if (n <= 100_000) return AD_SYNC_PERFORMANCE_BUDGET.runtimeMsByUserScale[100_000];
  // Above 100k: linear extrapolation from 100k budget (guidance only).
  return Math.round(
    (AD_SYNC_PERFORMANCE_BUDGET.runtimeMsByUserScale[100_000] * n) / 100_000,
  );
}

/**
 * @param {number} peakRssMb
 * @param {number} availableHeapMb
 */
export function isWithinMemoryBudget(peakRssMb, availableHeapMb) {
  if (!availableHeapMb || availableHeapMb <= 0) return null;
  return (
    peakRssMb / availableHeapMb <= AD_SYNC_PERFORMANCE_BUDGET.maxRssFractionOfHeap
  );
}
