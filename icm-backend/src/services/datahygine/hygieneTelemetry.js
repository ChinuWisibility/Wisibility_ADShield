/**
 * Lightweight structured telemetry for Data Hygiene V2.
 * Logs JSON lines; counters are process-local (aggregated via log shippers).
 */

const LOG_PREFIX = "[hygieneTelemetry]";

/** @type {Map<string, number>} */
const counters = new Map();

function bump(key, n = 1) {
  counters.set(key, (counters.get(key) || 0) + n);
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
export function hygieneLog(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  try {
    console.info(LOG_PREFIX, JSON.stringify(payload));
  } catch {
    console.info(LOG_PREFIX, event, fields);
  }
}

/**
 * @param {string} name
 * @param {number} [n]
 */
export function hygieneMetricInc(name, n = 1) {
  bump(name, n);
}

/**
 * Record a duration metric without logging (avoids noisy per-request terminal spam).
 * @param {string} name
 * @param {number} ms
 */
export function hygieneTiming(name, ms) {
  bump(`${name}.count`, 1);
  bump(`${name}.msTotal`, Math.max(0, Math.round(ms)));
}

/**
 * Snapshot of process-local counters (for health / debug).
 * @returns {Record<string, number>}
 */
export function getHygieneMetricsSnapshot() {
  return Object.fromEntries(counters.entries());
}
