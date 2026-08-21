import {
  deriveFindingSignals,
  resolvePrimaryFindingType,
} from "../../constants/findingSignals.js";
import {
  conditionMatchesFinding,
  normalizePolicyConditions,
} from "../../constants/policyConditions.js";

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, unknown: 0 };

/** Risk assigned when no enabled policy matches a finding. */
const NOT_DEFINED_RISK = "not defined";

/**
 * Strip policy-assigned fields so discovery facts can be re-evaluated.
 * @param {object} finding
 */
export function toDiscoveryFinding(finding) {
  if (!finding || typeof finding !== "object") return finding;
  const {
    riskLevel: _r,
    severity: _s,
    matchedPolicyId: _mp,
    matchedPolicyName: _mn,
    matchedPolicyKey: _mk,
    recommendation: _rec,
    policyEvaluatedAt: _pe,
    ...rest
  } = finding;
  return rest;
}

/**
 * @param {object} finding
 * @param {Set<string>} signals
 * @param {object} policy
 */
function policyMatchesFinding(finding, signals, policy) {
  const conditions = normalizePolicyConditions(policy.conditions || []);
  if (!conditions.length) return false;

  const signalSet = signals instanceof Set ? signals : new Set(signals);
  const mode = String(policy.conditionMode || "AND").toUpperCase();

  if (mode === "OR") {
    return conditions.some((c) => conditionMatchesFinding(finding, signalSet, c));
  }
  return conditions.every((c) => conditionMatchesFinding(finding, signalSet, c));
}

/**
 * Evaluate a single discovery finding against policies.
 * @param {object} finding
 * @param {object[]} policies
 * @returns {object}
 */
export function evaluateFinding(finding, policies) {
  const discovery = toDiscoveryFinding(finding);
  const signals = deriveFindingSignals(discovery);
  const signalSet = new Set(signals);
  const findingType = resolvePrimaryFindingType({ ...discovery, findingSignals: signals });
  const enabled = (policies || []).filter((p) => p.enabled !== false);

  let best = null;
  for (const policy of enabled) {
    if (!policyMatchesFinding(discovery, signalSet, policy)) continue;
    const rank = SEVERITY_RANK[String(policy.riskLevel || "").toLowerCase()] ?? 0;
    const bestRank = best
      ? SEVERITY_RANK[String(best.riskLevel || "").toLowerCase()] ?? 0
      : -1;
    if (!best || rank > bestRank) best = policy;
  }

  const evaluatedAt = new Date().toISOString();

  if (!best) {
    return {
      ...discovery,
      findingType,
      findingSignals: signals,
      riskLevel: NOT_DEFINED_RISK,
      severity: NOT_DEFINED_RISK,
      matchedPolicyId: null,
      matchedPolicyKey: null,
      matchedPolicyName: "",
      recommendation: "",
      policyEvaluatedAt: evaluatedAt,
    };
  }

  const riskLevel = String(best.riskLevel || "medium").toLowerCase();
  return {
    ...discovery,
    findingType,
    findingSignals: signals,
    riskLevel,
    severity: riskLevel,
    matchedPolicyId: best._id ? String(best._id) : best.id || null,
    matchedPolicyKey: best.policyKey || null,
    matchedPolicyName: best.name,
    recommendation: best.recommendation || best.description || "",
    policyEvaluatedAt: evaluatedAt,
  };
}

/**
 * @param {object[]} findings
 * @param {object[]} policies
 * @returns {object[]}
 */
export function evaluateFindings(findings, policies) {
  return (findings || []).map((f) => evaluateFinding(f, policies));
}

export { SEVERITY_RANK, NOT_DEFINED_RISK };
