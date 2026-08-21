/**
 * Benchmark Registry schema — Performance Observatory target kinds.
 */

export const TARGET_KINDS = Object.freeze([
  "navigation",
  "feature",
  "action",
  "sharedApi",
]);

export const REGISTRY_VERSION = 1;

/**
 * @typedef {object} FeMeta
 * @property {boolean} [reactQuery]
 * @property {number} [mountApiCalls]
 * @property {"low"|"medium"|"high"} [duplicateRisk]
 * @property {string[]} [primaryApis]
 * @property {string} [listFieldsHint]
 * @property {{ sortBy: string, sortDir: string }} [uiSort]
 */

/**
 * @typedef {object} BenchmarkTarget
 * @property {string} id
 * @property {"navigation"|"feature"|"action"|"sharedApi"} kind
 * @property {string} name
 * @property {string} [pageId] — v2 pageBenchmarks key (navigation only)
 * @property {string} [parentId]
 * @property {string} [route]
 * @property {string} [feFile]
 * @property {string} [controller]
 * @property {string[]} [primaryApis]
 * @property {string} [metricLabel]
 * @property {FeMeta} [fe]
 * @property {string[]} [sharedApiIds]
 * @property {{ type: string, key?: string, label?: string }} [trigger]
 * @property {{ mode: string, driver?: string }} [measurement]
 * @property {object} [narrative]
 * @property {boolean} [comingSoon]
 * @property {boolean} [enabled]
 */

export function assertTarget(t, { index = "?" } = {}) {
  if (!t || typeof t !== "object") throw new Error(`Target[${index}] must be an object`);
  if (!t.id || typeof t.id !== "string") throw new Error(`Target[${index}] missing id`);
  if (!TARGET_KINDS.includes(t.kind)) {
    throw new Error(`Target ${t.id}: invalid kind ${t.kind}`);
  }
  if (!t.name) throw new Error(`Target ${t.id}: missing name`);
  if (t.kind === "navigation" && !t.pageId) {
    throw new Error(`Target ${t.id}: navigation requires pageId`);
  }
  return t;
}
