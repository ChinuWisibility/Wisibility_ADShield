/**
 * JML transaction correlation ID — one ID for the full chain:
 * LifecycleEvent → Request → Workflow → Plan → Task → Result → Verification → Audit
 */

import { randomUUID } from "crypto";

/**
 * @param {Date} [at]
 * @returns {string} e.g. JML-20260816-a1b2c3d4e5f6
 */
export function createJmlCorrelationId(at = new Date()) {
  const d = at instanceof Date ? at : new Date(at);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12);
  return `JML-${y}${m}${day}-${suffix}`;
}

export function isJmlCorrelationId(value) {
  return /^JML-\d{8}-[a-f0-9]{8,}$/i.test(String(value || "").trim());
}
