/** Timing / percentile helpers. */

export function percentile(sortedAscending, p) {
  if (!sortedAscending.length) return null;
  const index = Math.min(
    sortedAscending.length - 1,
    Math.ceil((p / 100) * sortedAscending.length) - 1,
  );
  return sortedAscending[Math.max(0, index)];
}

export function summarizeSamples(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  if (!sorted.length) {
    return { samples: 0, minMs: null, p50Ms: null, p95Ms: null, maxMs: null, meanMs: null };
  }
  const mean = sorted.reduce((sum, n) => sum + n, 0) / sorted.length;
  return {
    samples: sorted.length,
    minMs: Number(sorted[0].toFixed(2)),
    p50Ms: Number(percentile(sorted, 50).toFixed(2)),
    p95Ms: Number(percentile(sorted, 95).toFixed(2)),
    maxMs: Number(sorted.at(-1).toFixed(2)),
    meanMs: Number(mean.toFixed(2)),
  };
}

export async function timeLabel(label, fn) {
  const t0 = process.hrtime.bigint();
  const heap0 = process.memoryUsage().heapUsed;
  try {
    const result = await fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
      label,
      ok: true,
      ms: Math.round(ms),
      heapDeltaMb: Math.round(((process.memoryUsage().heapUsed - heap0) / 1024 / 1024) * 100) / 100,
      ...result,
    };
  } catch (err) {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    return {
      label,
      ok: false,
      ms: Math.round(ms),
      error: err?.message || String(err),
      rows: 0,
      total: null,
      payloadBytes: 0,
    };
  }
}

export async function sampleAsync(fn, { warmups = 2, samples = 8 } = {}) {
  for (let i = 0; i < warmups; i += 1) await fn();
  const times = [];
  let last;
  for (let i = 0; i < samples; i += 1) {
    const t0 = process.hrtime.bigint();
    last = await fn();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { latency: summarizeSamples(times), last };
}
