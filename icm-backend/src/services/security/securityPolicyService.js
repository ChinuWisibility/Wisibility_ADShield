import SecurityPolicy from "../../models/security/SecurityPolicy.js";
import { DEFAULT_SECURITY_POLICIES } from "../../constants/defaultSecurityPolicies.js";
import { ALL_POLICY_SIGNALS } from "../../constants/findingSignals.js";
import {
  isValidPolicyCondition,
  listPolicyConditionCatalog,
  normalizePolicyConditions,
} from "../../constants/policyConditions.js";

const RISK_LEVELS = new Set(["low", "medium", "high", "critical"]);
const CONDITION_MODES = new Set(["AND", "OR"]);

function normalizeScope(scope = {}) {
  return {
    tenantId: scope.tenantId ? String(scope.tenantId) : null,
    applicationId: scope.applicationId ? String(scope.applicationId) : null,
  };
}

function buildScopeQuery(scope) {
  const { tenantId, applicationId } = normalizeScope(scope);
  const orClauses = [{ builtIn: true, tenantId: null, applicationId: null }];
  if (tenantId) orClauses.push({ tenantId, applicationId: null });
  if (applicationId) orClauses.push({ applicationId });
  return { $or: orClauses };
}

function serializePolicy(doc) {
  if (!doc) return null;
  const row = doc.toObject ? doc.toObject() : doc;
  return {
    ...row,
    id: String(row._id),
  };
}

function validatePolicyInput(body, { partial = false } = {}) {
  const errors = [];
  if (!partial || body.name != null) {
    if (!String(body.name || "").trim()) errors.push("Policy name is required.");
  }
  if (!partial || body.riskLevel != null) {
    const rl = String(body.riskLevel || "").toLowerCase();
    if (!RISK_LEVELS.has(rl)) errors.push("Invalid risk level.");
  }
  if (!partial || body.conditions != null) {
    if (!Array.isArray(body.conditions) || !body.conditions.length) {
      errors.push("At least one condition is required.");
    } else {
      const knownSignals = new Set(ALL_POLICY_SIGNALS);
      const invalid = body.conditions.filter(
        (c) => !isValidPolicyCondition(String(c), knownSignals),
      );
      if (invalid.length) errors.push(`Unknown conditions: ${invalid.join(", ")}`);
    }
  }
  if (body.conditionMode != null) {
    const mode = String(body.conditionMode).toUpperCase();
    if (!CONDITION_MODES.has(mode)) errors.push("conditionMode must be AND or OR.");
  }
  return errors;
}

/**
 * Ensure platform built-in policies exist (idempotent).
 */
export async function ensureBuiltInSecurityPolicies() {
  for (const policy of DEFAULT_SECURITY_POLICIES) {
    await SecurityPolicy.findOneAndUpdate(
      { policyKey: policy.policyKey, tenantId: null, applicationId: null },
      { $set: { ...policy, tenantId: null, applicationId: null } },
      { upsert: true, new: true },
    );
  }
}

/**
 * Load enabled policies for evaluation.
 */
export async function loadSecurityPolicies(scope = {}) {
  const rows = await SecurityPolicy.find({
    ...buildScopeQuery(scope),
    enabled: { $ne: false },
  })
    .sort({ builtIn: 1, createdAt: 1 })
    .lean();
  return rows;
}

/**
 * List all policies for management UI (includes disabled).
 */
export async function listSecurityPoliciesForManagement(scope = {}) {
  const rows = await SecurityPolicy.find(buildScopeQuery(scope))
    .sort({ builtIn: -1, enabled: -1, name: 1 })
    .lean();
  return rows.map((r) => ({ ...r, id: String(r._id) }));
}

export function listAvailablePolicyConditions() {
  return listPolicyConditionCatalog(ALL_POLICY_SIGNALS);
}

/**
 * @param {import('../../models/application/Application.js').default|object} application
 */
export async function loadPoliciesForApplication(application) {
  const tenantId = application?.tenantId ? String(application.tenantId) : null;
  const applicationId = application?._id ? String(application._id) : null;
  return loadSecurityPolicies({ tenantId, applicationId });
}

export async function getSecurityPolicyById(id, scope = {}) {
  const doc = await SecurityPolicy.findById(id).lean();
  if (!doc) return null;
  const q = buildScopeQuery(scope);
  const allowed = await SecurityPolicy.findOne({ _id: id, ...q }).lean();
  return allowed ? { ...allowed, id: String(allowed._id) } : null;
}

export async function createSecurityPolicy(data, scope = {}) {
  const errors = validatePolicyInput(data);
  if (errors.length) {
    const err = new Error(errors[0]);
    err.code = "VALIDATION_ERROR";
    err.errors = errors;
    throw err;
  }

  const { tenantId, applicationId } = normalizeScope(scope);
  const doc = await SecurityPolicy.create({
    name: String(data.name).trim(),
    enabled: data.enabled !== false,
    riskLevel: String(data.riskLevel).toLowerCase(),
    conditions: normalizePolicyConditions(data.conditions),
    conditionMode: String(data.conditionMode || "AND").toUpperCase(),
    description: String(data.description || "").trim(),
    recommendation: String(data.recommendation || data.description || "").trim(),
    tenantId,
    applicationId,
    builtIn: false,
    clonedFrom: data.clonedFrom || null,
  });
  return serializePolicy(doc);
}

export async function updateSecurityPolicy(id, data, scope = {}) {
  const existing = await getSecurityPolicyById(id, scope);
  if (!existing) {
    const err = new Error("Policy not found.");
    err.code = "NOT_FOUND";
    throw err;
  }

  const errors = validatePolicyInput(data, { partial: true });
  if (errors.length) {
    const err = new Error(errors[0]);
    err.code = "VALIDATION_ERROR";
    err.errors = errors;
    throw err;
  }

  const patch = {};
  if (data.name != null) patch.name = String(data.name).trim();
  if (data.enabled != null) patch.enabled = Boolean(data.enabled);
  if (data.riskLevel != null) patch.riskLevel = String(data.riskLevel).toLowerCase();
  if (data.conditions != null) patch.conditions = normalizePolicyConditions(data.conditions);
  if (data.conditionMode != null) patch.conditionMode = String(data.conditionMode).toUpperCase();
  if (data.description != null) patch.description = String(data.description).trim();
  if (data.recommendation != null) patch.recommendation = String(data.recommendation).trim();

  const doc = await SecurityPolicy.findByIdAndUpdate(id, { $set: patch }, { new: true });
  return serializePolicy(doc);
}

export async function cloneSecurityPolicy(id, scope = {}, overrides = {}) {
  const source = await getSecurityPolicyById(id, scope);
  if (!source) {
    const err = new Error("Policy not found.");
    err.code = "NOT_FOUND";
    throw err;
  }

  return createSecurityPolicy(
    {
      name: overrides.name || `${source.name} (Copy)`,
      enabled: overrides.enabled !== false,
      riskLevel: source.riskLevel,
      conditions: normalizePolicyConditions(source.conditions || []),
      conditionMode: source.conditionMode || "AND",
      description: source.description,
      recommendation: source.recommendation || source.description,
      clonedFrom: source.policyKey || String(source._id),
    },
    scope,
  );
}

export async function deleteSecurityPolicy(id, scope = {}) {
  const existing = await getSecurityPolicyById(id, scope);
  if (!existing) {
    const err = new Error("Policy not found.");
    err.code = "NOT_FOUND";
    throw err;
  }
  await SecurityPolicy.findByIdAndDelete(id);
  return { deleted: true, id: String(id) };
}
