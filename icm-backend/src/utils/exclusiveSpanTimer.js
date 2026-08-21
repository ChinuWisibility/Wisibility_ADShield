/**
 * Exclusive wall-clock spans for reconciliation attribution.
 * Measurement only — does not alter business behaviour.
 */

export function createExclusiveSpanTimer(label = "root") {
  const spans = [];
  const startTotal = process.hrtime.bigint();

  async function span(name, fn) {
    const t0 = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      spans.push({ name, ms: Math.round(ms * 1000) / 1000 });
    }
  }

  function record(name, ms) {
    spans.push({ name, ms: Math.round(Number(ms) * 1000) / 1000 });
  }

  function snapshot() {
    const totalMs = Number(process.hrtime.bigint() - startTotal) / 1e6;
    const accounted = spans.reduce((s, x) => s + x.ms, 0);
    return {
      label,
      spans: [...spans],
      totalMs: Math.round(totalMs * 1000) / 1000,
      accountedMs: Math.round(accounted * 1000) / 1000,
      unaccountedMs: Math.round((totalMs - accounted) * 1000) / 1000,
    };
  }

  return { span, record, snapshot, spans };
}

export function mergeExclusiveSpans(...parts) {
  const spans = [];
  for (const part of parts) {
    if (!part) continue;
    if (Array.isArray(part)) spans.push(...part);
    else if (Array.isArray(part.spans)) spans.push(...part.spans);
  }
  return spans;
}
