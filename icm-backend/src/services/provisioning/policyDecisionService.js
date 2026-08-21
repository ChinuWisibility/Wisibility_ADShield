/**
 * Pure Policy Decision / Birthright Engine.
 *
 * It calculates desired access only. It does not inspect actual access, create
 * requests/tasks, run workflows, invoke connectors, or mutate any model.
 */

import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import Entitlement from "../../models/access/Entitlement.js";
import Role from "../../models/access/Role.js";
import ProvisioningPolicy from "../../models/provisioning/ProvisioningPolicy.js";
import {
  evaluateIdentityProvisioningRule,
  loadEnabledIdentityProvisioningRules,
} from "./identityProvisioningRuleService.js";

const ACCOUNT_REQUIRED_ACTIONS = new Set(["ENSURE_ACCOUNT", "ENABLE_ACCOUNT"]);
const ACCOUNT_DISABLED_ACTIONS = new Set(["DISABLE_ACCOUNT"]);
const ENTITLEMENT_ACTIONS = new Set(["ENSURE_ENTITLEMENT", "REMOVE_ENTITLEMENT"]);
const SUPPORTED_ACTIONS = new Set([
  ...ACCOUNT_REQUIRED_ACTIONS,
  ...ACCOUNT_DISABLED_ACTIONS,
  ...ENTITLEMENT_ACTIONS,
]);

function toOid(value) {
  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function comparePriority(a, b) {
  return (
    (a.priority ?? 100) - (b.priority ?? 100) ||
    String(a.name || "").localeCompare(String(b.name || "")) ||
    String(a._id || "").localeCompare(String(b._id || ""))
  );
}

function entitlementKey(entitlement) {
  return String(
    entitlement?._id ||
      entitlement?.entitlementId ||
      entitlement?.id ||
      entitlement?.value ||
      entitlement?.entitlementName ||
      entitlement?.name ||
      "",
  );
}

function publicEntitlement(entitlement) {
  return {
    entitlementId: entitlement?._id ? String(entitlement._id) : undefined,
    name:
      entitlement?.entitlementName ||
      entitlement?.displayName ||
      entitlement?.name ||
      entitlement?.value ||
      undefined,
    value: entitlement?.value || undefined,
  };
}

function publicApplication(application) {
  return {
    applicationId: String(application._id),
    applicationName: application.name,
    accountRequired: false,
    accountDisabled: false,
    attributes: {},
    entitlements: [],
    removeEntitlements: [],
    sources: [],
  };
}

function addSource(target, source) {
  if (
    !target.sources.some(
      (existing) =>
        existing.kind === source.kind &&
        existing.policyId === source.policyId &&
        existing.ruleId === source.ruleId,
    )
  ) {
    target.sources.push(source);
  }
}

function mergeAttributes(target, attributes = {}) {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return;
  // Lower numeric priority wins. Rules/policies are processed in that order,
  // so first non-null value is deterministic and never overwritten.
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null) continue;
    if (!Object.prototype.hasOwnProperty.call(target.attributes, key)) {
      target.attributes[key] = value;
    }
  }
}

function addEntitlement(target, collectionName, entitlement) {
  const key = entitlementKey(entitlement);
  if (!key) return;
  if (!target[collectionName]._keys) {
    Object.defineProperty(target[collectionName], "_keys", {
      value: new Set(),
      enumerable: false,
    });
  }
  if (target[collectionName]._keys.has(key)) return;
  target[collectionName]._keys.add(key);
  target[collectionName].push(publicEntitlement(entitlement));
}

function addAction(target, action, source, entitlementsById, entitlementsByName, rolesById) {
  const type = String(action?.type || "").toUpperCase();
  if (!SUPPORTED_ACTIONS.has(type)) return;

  addSource(target, source);
  if (ACCOUNT_REQUIRED_ACTIONS.has(type)) target.accountRequired = true;
  if (ACCOUNT_DISABLED_ACTIONS.has(type)) {
    target.accountDisabled = true;
    target.accountRequired = false;
  }
  mergeAttributes(target, action.attributes);

  const collection = type === "REMOVE_ENTITLEMENT" ? "removeEntitlements" : "entitlements";
  if (ENTITLEMENT_ACTIONS.has(type)) {
    for (const id of asArray(action.entitlementIds)) {
      const found = entitlementsById.get(String(id));
      if (found) addEntitlement(target, collection, found);
    }
    for (const name of asArray(action.entitlementNames || action.entitlements)) {
      const found = entitlementsByName.get(String(name).toLowerCase());
      if (found) addEntitlement(target, collection, found);
    }
    // Keep a declared catalog-independent desired entitlement visible until
    // the catalog is populated. It remains a decision, never a target write.
    for (const name of asArray(action.entitlementNames || action.entitlements)) {
      if (!entitlementsByName.has(String(name).toLowerCase())) {
        addEntitlement(target, collection, { entitlementName: String(name) });
      }
    }
  }

  for (const roleId of asArray(action.roleIds)) {
    const role = rolesById.get(String(roleId));
    if (!role) continue;
    for (const roleEntitlement of role.entitlements || []) {
      const id = roleEntitlement.entitlement;
      const named = roleEntitlement.entitlementName;
      const found =
        (id && entitlementsById.get(String(id))) ||
        (named && entitlementsByName.get(String(named).toLowerCase())) ||
        roleEntitlement;
      addEntitlement(target, "entitlements", found);
    }
  }
}

function lifecycleTypeFromContext(context = {}) {
  return String(
    context.lifecycleType || context.lifecycleEvent?.lifecycleType || context.lifecycleEvent?.eventType || "JOINER",
  ).toUpperCase();
}

function policyApplies(policy, identity, lifecycleType, profileId) {
  if (!policy?.isActive) return false;
  if (policy.triggerEvent && String(policy.triggerEvent).toUpperCase() !== lifecycleType) {
    return false;
  }
  if (policy.profileId && String(policy.profileId) !== String(profileId || identity.identityProfileId || "")) {
    return false;
  }
  return true;
}

async function loadInputs({ tenantId, identity, context, inputs = {} }) {
  const tenantOid = toOid(tenantId);
  if (!tenantOid) throw new Error("Valid tenantId is required for policy evaluation");
  if (!identity?._id) throw new Error("identity._id is required for policy evaluation");
  if (identity.tenantId && String(identity.tenantId) !== String(tenantOid)) {
    throw new Error("Identity tenantId does not match policy evaluation tenantId");
  }

  const [
    rules,
    policies,
    applications,
    entitlements,
    roles,
  ] = await Promise.all([
    inputs.rules ?? loadEnabledIdentityProvisioningRules(tenantOid),
    inputs.policies ??
      ProvisioningPolicy.find({ tenantId: tenantOid, isActive: true })
        .sort({ priority: 1, policyName: 1, createdAt: 1 })
        .lean(),
    inputs.applications ??
      Application.find({ tenantId: tenantOid, status: "active" })
        .select("_id name tenantId status")
        .lean(),
    inputs.entitlements ??
      Entitlement.find({ tenantId: tenantOid, isActive: true })
        .select("_id entitlementName name displayName value applicationId tenantId")
        .lean(),
    inputs.roles ??
      Role.find({ tenantId: tenantOid, isActive: true, status: "active" })
        .select("_id name entitlements tenantId")
        .lean(),
  ]);

  // Defense in depth: injected data is also tenant-scoped.
  const belongsToTenant = (doc) =>
    doc?.tenantId != null && String(doc.tenantId) === String(tenantOid);
  return {
    tenantOid,
    rules: (rules || []).filter(belongsToTenant).filter((rule) => rule.enabled !== false),
    policies: (policies || []).filter(belongsToTenant).filter((policy) => policy.isActive !== false),
    applications: (applications || []).filter(belongsToTenant).filter((app) => app.status === "active"),
    entitlements: (entitlements || []).filter(belongsToTenant).filter((e) => e.isActive !== false),
    roles: (roles || []).filter(belongsToTenant).filter((role) => role.isActive !== false),
    context,
  };
}

/**
 * Evaluate tenant-scoped policy/rules into deterministic desired access.
 *
 * `inputs` is optional dependency injection for tests/simulation. No code path
 * in this service performs provisioning, connector calls, or actual-access reads.
 */
export async function evaluateDesiredAccess(identity, context = {}, inputs = {}) {
  const tenantId = context.tenantId || identity?.tenantId;
  const loaded = await loadInputs({ tenantId, identity, context, inputs });
  const lifecycleType = lifecycleTypeFromContext(context);
  const applicationsById = new Map(
    loaded.applications.map((application) => [String(application._id), application]),
  );
  const entitlementsById = new Map(
    loaded.entitlements.map((entitlement) => [String(entitlement._id), entitlement]),
  );
  const entitlementsByName = new Map();
  for (const entitlement of loaded.entitlements) {
    for (const name of [
      entitlement.entitlementName,
      entitlement.name,
      entitlement.displayName,
      entitlement.value,
    ]) {
      if (name) entitlementsByName.set(String(name).toLowerCase(), entitlement);
    }
  }
  const rolesById = new Map(loaded.roles.map((role) => [String(role._id), role]));
  const byApplication = new Map();
  const matchedRules = [];
  const matchedPolicies = [];

  const ensureTarget = (applicationId) => {
    const app = applicationsById.get(String(applicationId));
    if (!app) return null; // reject cross-tenant/inactive/nonexistent apps
    const key = String(app._id);
    if (!byApplication.has(key)) byApplication.set(key, publicApplication(app));
    return byApplication.get(key);
  };

  // Joiner rules express birthright grants. A LEAVER must not inherit a
  // grant merely because the authoritative snapshot still has department/
  // location values; explicit LEAVER ProvisioningPolicies can instead express
  // desired disabled/empty state for a future Delta Engine.
  const candidateRules = lifecycleType === "LEAVER" ? [] : loaded.rules;
  for (const rule of [...candidateRules].sort(comparePriority)) {
    const decision = evaluateIdentityProvisioningRule(identity, rule);
    if (!decision.matched) continue;
    matchedRules.push({
      ruleId: String(rule._id),
      ruleName: rule.name,
      priority: rule.priority ?? 100,
      matchedConditions: decision.matchedConditions,
    });
    for (const action of rule.actions || []) {
      const target = ensureTarget(action.applicationId);
      if (!target) continue;
      addAction(
        target,
        action,
        { kind: "IDENTITY_PROVISIONING_RULE", ruleId: String(rule._id), ruleName: rule.name },
        entitlementsById,
        entitlementsByName,
        rolesById,
      );
    }
  }

  for (const policy of [...loaded.policies].sort(comparePriority)) {
    if (!policyApplies(policy, identity, lifecycleType, context.profileId)) continue;
    matchedPolicies.push({
      policyId: String(policy._id),
      policyName: policy.policyName,
      priority: policy.priority ?? 100,
      triggerEvent: policy.triggerEvent || null,
    });
    const actions =
      policy.actions?.length > 0
        ? policy.actions
        : (policy.applications || []).map((applicationId) => ({
            type: "ENSURE_ACCOUNT",
            applicationId,
          }));
    for (const action of actions) {
      const target = ensureTarget(action.applicationId);
      if (!target) continue;
      addAction(
        target,
        action,
        { kind: "PROVISIONING_POLICY", policyId: String(policy._id), policyName: policy.policyName },
        entitlementsById,
        entitlementsByName,
        rolesById,
      );
    }
  }

  const applications = [...byApplication.values()]
    .map((application) => ({
      ...application,
      entitlements: [...application.entitlements].sort((a, b) =>
        String(a.name || a.entitlementId).localeCompare(String(b.name || b.entitlementId)),
      ),
      removeEntitlements: [...application.removeEntitlements].sort((a, b) =>
        String(a.name || a.entitlementId).localeCompare(String(b.name || b.entitlementId)),
      ),
      sources: [...application.sources].sort((a, b) =>
        `${a.kind}:${a.ruleName || a.policyName || ""}`.localeCompare(
          `${b.kind}:${b.ruleName || b.policyName || ""}`,
        ),
      ),
    }))
    .sort((a, b) => a.applicationName.localeCompare(b.applicationName) || a.applicationId.localeCompare(b.applicationId));

  return {
    identityId: String(identity._id),
    tenantId: String(loaded.tenantOid),
    lifecycleType,
    lifecycleEventId:
      context.lifecycleEventId || context.lifecycleEvent?._id
        ? String(context.lifecycleEventId || context.lifecycleEvent?._id)
        : null,
    jmlCorrelationId:
      context.jmlCorrelationId || context.lifecycleEvent?.jmlCorrelationId || null,
    applications,
    matchedRules,
    matchedPolicies,
    metadata: {
      evaluationMode: "DESIRED_ACCESS_ONLY",
      actualAccessRead: false,
      targetWrites: false,
      provisioningTasksCreated: false,
    },
  };
}

/**
 * Existing Joiner compatibility adapter.
 * Converts only desired ENSURE_ACCOUNT requirements to the existing caller's
 * action shape; it intentionally does not create a request/task or invoke a
 * connector.
 */
export function desiredAccessToEnsureAccountActions(desiredAccess) {
  return (desiredAccess?.applications || [])
    .filter((application) => application.accountRequired && !application.accountDisabled)
    .map((application) => ({
      applicationId: application.applicationId,
      applicationName: application.applicationName,
      attributes: application.attributes,
      entitlements: application.entitlements,
      ruleId: application.sources.find((source) => source.ruleId)?.ruleId,
      ruleName: application.sources.find((source) => source.ruleName)?.ruleName,
      source: "POLICY_DECISION_COMPAT",
    }));
}

