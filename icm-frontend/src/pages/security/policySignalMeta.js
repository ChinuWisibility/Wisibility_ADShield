import { FINDING_TYPE_LABELS } from "./findingTypeMeta";

/** Maps legacy hardcoded threshold tokens to dynamic form. */
const LEGACY_THRESHOLD_MAP = {
  INACTIVE_OVER_90_DAYS: "INACTIVE_OVER:90",
  INACTIVE_OVER_180_DAYS: "INACTIVE_OVER:180",
  NESTED_DEPTH_OVER_5: "NESTED_DEPTH_OVER:5",
  MEMBER_COUNT_OVER_1000: "MEMBER_COUNT_OVER:1000",
};

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

const THRESHOLD_TOKEN_RE = /^([A-Z_]+):(\d+)$/;

/** Labels for boolean signal tokens. */
export const POLICY_CONDITION_LABELS = {
  ...FINDING_TYPE_LABELS,
  PRIVILEGED_USER: "Privileged user",
  DORMANT_PRIVILEGED_USER: "Dormant privileged user",
  TOXIC_PRIVILEGE_COMBINATION: "Toxic privilege combination",
  EXCESSIVE_PRIVILEGES: "Excessive privileges",
  PRIVILEGE_ESCALATION_PATH: "Privilege escalation path",
  REVERSIBLE_ENCRYPTION_ENABLED: "Reversible encryption enabled",
  SMARTCARD_NOT_REQUIRED: "Smartcard not required",
  MISSING_OS_INFORMATION: "Missing OS information",
  UNSUPPORTED_OS: "Unsupported OS",
  SERVER_IN_WRONG_OU: "Server in wrong OU",
  DUPLICATE_SPN: "Duplicate SPN",
  COMPUTER_WITHOUT_OWNER: "Computer without owner",
  ASREP_ROASTABLE_USER: "AS-REP roastable user",
  PREAUTH_DISABLED: "Pre-authentication disabled",
  SPN_MISCONFIGURATION: "SPN misconfiguration",
  CONSTRAINED_DELEGATION: "Constrained delegation",
  RBCD_CONFIGURED: "RBCD configured",
  // DELEGATION_EXPOSURE: "Delegation exposure", // disabled — Delegation Exposure Summary
  GROUP_WITHOUT_OWNER: "Group without owner",
  NESTED_GROUP: "Nested group",
  UNUSED_GROUP: "Unused group",
  ORPHAN_GROUP: "Orphan group",
  CIRCULAR_GROUP_MEMBERSHIP: "Circular group membership",
  DUPLICATE_GROUP: "Duplicate group",
  NESTED_PRIVILEGED_ACCESS: "Nested privileged access",
  ORPHAN_SID: "Orphan SID",
  SID_HISTORY_RISK: "SID history risk",
  FOREIGN_SECURITY_PRINCIPAL: "Foreign security principal",
  UNKNOWN_SID_BINDING: "Unknown SID binding",
  BROKEN_ACL: "Broken ACL",
};

export function normalizeConditionToken(token) {
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
 * @param {string} token
 * @returns {{ kind: 'signal', signal: string } | { kind: 'threshold', type: string, value: number }}
 */
export function parseConditionToken(token) {
  const normalized = normalizeConditionToken(token);
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

export function isThresholdCondition(token) {
  return parseConditionToken(token).kind === "threshold";
}

export function policyConditionLabel(token) {
  if (!token) return "";
  const parsed = parseConditionToken(token);
  if (parsed.kind === "threshold") {
    const spec = THRESHOLD_CONDITION_TYPES[parsed.type];
    if (spec) {
      return `${spec.label} > ${parsed.value} ${spec.unit}`;
    }
  }
  return (
    POLICY_CONDITION_LABELS[parsed.signal] ||
    parsed.signal.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * @param {string[]} conditions
 */
export function splitPolicyConditions(conditions) {
  const signals = [];
  const thresholds = [];
  for (const raw of conditions || []) {
    const parsed = parseConditionToken(raw);
    if (parsed.kind === "threshold") thresholds.push(parsed);
    else if (parsed.signal) signals.push(parsed.signal);
  }
  return { signals, thresholds };
}

/**
 * @param {string[]} signals
 * @param {{ type: string, value: number }[]} thresholds
 */
export function mergePolicyConditions(signals, thresholds) {
  const signalTokens = (signals || []).map(String).filter(Boolean);
  const thresholdTokens = (thresholds || []).map(
    (t) => `${t.type}:${parseInt(String(t.value), 10)}`,
  );
  return [...new Set([...signalTokens, ...thresholdTokens])];
}

export const RISK_LEVEL_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "critical", label: "Critical" },
];
