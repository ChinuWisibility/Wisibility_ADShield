/**
 * Policy condition parsing, validation, and threshold matching.
 * Signal conditions: DISABLED_USER, INACTIVE_USER, …
 * Threshold conditions: INACTIVE_OVER:90, NESTED_DEPTH_OVER:5, MEMBER_COUNT_OVER:1000
 */

/** @typedef {{ kind: 'signal', signal: string }} SignalCondition */
/** @typedef {{ kind: 'threshold', type: string, value: number }} ThresholdCondition */

export const THRESHOLD_CONDITION_TYPES = {
  INACTIVE_OVER: {
    label: "Inactive over",
    unit: "days",
    defaultValue: 90,
    min: 1,
    max: 3650,
  },
  NESTED_DEPTH_OVER: {
    label: "Nested depth over",
    unit: "levels",
    defaultValue: 5,
    min: 2,
    max: 64,
  },
  MEMBER_COUNT_OVER: {
    label: "Member count over",
    unit: "members",
    defaultValue: 100,
    min: 1,
    max: 1_000_000,
  },
};

/** Maps legacy hardcoded threshold tokens to dynamic form. */
const LEGACY_THRESHOLD_MAP = {
  INACTIVE_OVER_90_DAYS: "INACTIVE_OVER:90",
  INACTIVE_OVER_180_DAYS: "INACTIVE_OVER:180",
  NESTED_DEPTH_OVER_5: "NESTED_DEPTH_OVER:5",
  MEMBER_COUNT_OVER_1000: "MEMBER_COUNT_OVER:1000",
};

const THRESHOLD_TOKEN_RE = /^([A-Z_]+):(\d+)$/;

/**
 * @param {string} token
 * @returns {string}
 */
export function normalizePolicyCondition(token) {
  const raw = String(token || "").trim();
  if (!raw) return raw;
  if (LEGACY_THRESHOLD_MAP[raw]) return LEGACY_THRESHOLD_MAP[raw];
  const m = raw.match(THRESHOLD_TOKEN_RE);
  if (m && THRESHOLD_CONDITION_TYPES[m[1]]) {
    return `${m[1]}:${parseInt(m[2], 10)}`;
  }
  return raw;
}

/**
 * @param {string[]} conditions
 * @returns {string[]}
 */
export function normalizePolicyConditions(conditions) {
  return (conditions || []).map(normalizePolicyCondition).filter(Boolean);
}

/**
 * @param {string} type
 * @param {number} value
 * @returns {string}
 */
export function encodeThresholdCondition(type, value) {
  const n = parseInt(String(value), 10);
  if (!THRESHOLD_CONDITION_TYPES[type] || !Number.isFinite(n)) {
    throw new Error("Invalid threshold condition.");
  }
  return `${type}:${n}`;
}

/**
 * @param {string} token
 * @returns {SignalCondition|ThresholdCondition|null}
 */
export function parsePolicyCondition(token) {
  const normalized = normalizePolicyCondition(token);
  if (!normalized) return null;

  const m = normalized.match(THRESHOLD_TOKEN_RE);
  if (m && THRESHOLD_CONDITION_TYPES[m[1]]) {
    return {
      kind: "threshold",
      type: m[1],
      value: parseInt(m[2], 10),
    };
  }

  return { kind: "signal", signal: normalized };
}

/**
 * @param {string} token
 * @param {Set<string>} knownSignals
 * @returns {boolean}
 */
export function isValidPolicyCondition(token, knownSignals) {
  const parsed = parsePolicyCondition(token);
  if (!parsed) return false;
  if (parsed.kind === "threshold") {
    const spec = THRESHOLD_CONDITION_TYPES[parsed.type];
    return (
      Boolean(spec) &&
      Number.isFinite(parsed.value) &&
      parsed.value >= spec.min &&
      parsed.value <= spec.max
    );
  }
  return knownSignals.has(parsed.signal);
}

/**
 * @param {object} finding
 * @returns {number|null}
 */
export function getInactiveDays(finding) {
  const meta = finding?.evidence || finding?.metadata || {};
  if (meta.inactiveDays != null) {
    const n = parseInt(String(meta.inactiveDays), 10);
    if (Number.isFinite(n)) return n;
  }
  const status = String(finding?.status || "");
  const inactiveMatch = status.match(/inactive_(\d+)d/i);
  if (inactiveMatch) return parseInt(inactiveMatch[1], 10);
  const dormantMatch = status.match(/dormant_privileged_(\d+)d/i);
  if (dormantMatch) return parseInt(dormantMatch[1], 10);
  return null;
}

/**
 * @param {object} finding
 * @returns {number|null}
 */
export function getNestedDepth(finding) {
  const meta = finding?.evidence || finding?.metadata || {};
  const fromMeta = meta.nestedDepth ?? meta.maxDepth;
  if (fromMeta != null) {
    const n = parseInt(String(fromMeta), 10);
    if (Number.isFinite(n)) return n;
  }
  const statusMatch = String(finding?.status || "").match(/max_depth_(\d+)/i);
  if (statusMatch) return parseInt(statusMatch[1], 10);
  return null;
}

/**
 * @param {object} finding
 * @returns {number|null}
 */
export function getMemberCount(finding) {
  const meta = finding?.evidence || finding?.metadata || {};
  if (meta.memberCount != null) {
    const n = parseInt(String(meta.memberCount), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * @param {object} finding
 * @param {string} type
 * @returns {number|null}
 */
export function getThresholdMetric(finding, type) {
  switch (type) {
    case "INACTIVE_OVER":
      return getInactiveDays(finding);
    case "NESTED_DEPTH_OVER":
      return getNestedDepth(finding);
    case "MEMBER_COUNT_OVER":
      return getMemberCount(finding);
    default:
      return null;
  }
}

/**
 * @param {object} finding
 * @param {string[]} signals
 * @param {string} conditionToken
 * @returns {boolean}
 */
export function conditionMatchesFinding(finding, signals, conditionToken) {
  const parsed = parsePolicyCondition(conditionToken);
  if (!parsed) return false;

  if (parsed.kind === "signal") {
    return signals.has(parsed.signal);
  }

  const actual = getThresholdMetric(finding, parsed.type);
  if (actual == null || !Number.isFinite(actual)) return false;
  return actual >= parsed.value;
}

/**
 * @param {string[]} signalCatalog
 */
export function listPolicyConditionCatalog(signalCatalog) {
  return {
    signals: [...signalCatalog].sort(),
    thresholdTypes: Object.entries(THRESHOLD_CONDITION_TYPES).map(([type, spec]) => ({
      type,
      label: spec.label,
      unit: spec.unit,
      defaultValue: spec.defaultValue,
      min: spec.min,
      max: spec.max,
    })),
  };
}
