/**
 * Identity Provisioning Rule evaluation — reuses discovery condition operators.
 */

import mongoose from "mongoose";
import IdentityProvisioningRule from "../../models/provisioning/IdentityProvisioningRule.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import { evaluateCondition } from "../discoveryEvaluationService.js";
import { buildIdentityCreateSchema } from "../identity/identityCreateSchemaService.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function resolveIdentityField(identity, field) {
  if (!field || !identity) return undefined;
  if (Object.prototype.hasOwnProperty.call(identity, field)) return identity[field];
  if (identity.attributes && typeof identity.attributes === "object") {
    if (Object.prototype.hasOwnProperty.call(identity.attributes, field)) {
      return identity.attributes[field];
    }
  }
  const parts = String(field).split(".");
  let cur = identity;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

/**
 * Evaluate one rule against an identity document.
 * @returns {{ matched: boolean, matchedConditions: object[] }}
 */
export function evaluateIdentityProvisioningRule(identity, rule) {
  if (
    rule?.identityProfileId
    && String(identity?.identityProfileId || "") !== String(rule.identityProfileId)
  ) {
    return { matched: false, matchedConditions: [] };
  }
  const conditions = rule?.conditions || [];
  if (!conditions.length) return { matched: false, matchedConditions: [] };

  const results = [];
  const matchedConditions = [];
  for (const cond of conditions) {
    const fieldValue = resolveIdentityField(identity, cond.field);
    const passed = evaluateCondition(
      fieldValue,
      cond.operator || "equals",
      cond.value,
      Boolean(cond.caseSensitive),
    );
    results.push(passed);
    if (passed) {
      matchedConditions.push({
        field: cond.field,
        operator: cond.operator,
        value: cond.value,
        fieldValue: fieldValue == null ? null : String(fieldValue),
      });
    }
  }

  const logic = (rule.conditionLogic || "AND").toUpperCase();
  const matched =
    logic === "OR" ? results.some(Boolean) : results.every(Boolean);

  return { matched, matchedConditions };
}

/**
 * Load enabled rules for tenant (cached caller-side for bulk).
 */
export async function loadEnabledIdentityProvisioningRules(tenantId) {
  const tid = toOid(tenantId) || tenantId;
  return IdentityProvisioningRule.find({ tenantId: tid, enabled: true })
    .sort({ priority: 1, createdAt: 1 })
    .lean();
}

/**
 * Match identity to all enabled rules; return ENSURE_ACCOUNT actions (deduped by applicationId).
 */
export function collectEnsureAccountActions(identity, rules) {
  const byApp = new Map();
  const matches = [];

  for (const rule of rules || []) {
    const { matched, matchedConditions } = evaluateIdentityProvisioningRule(identity, rule);
    if (!matched) continue;
    matches.push({
      ruleId: String(rule._id),
      ruleName: rule.name,
      matchedConditions,
    });
    for (const action of rule.actions || []) {
      if (action.type !== "ENSURE_ACCOUNT" || !action.applicationId) continue;
      const appKey = String(action.applicationId);
      if (!byApp.has(appKey)) {
        byApp.set(appKey, {
          applicationId: action.applicationId,
          ruleId: rule._id,
          ruleName: rule.name,
        });
      }
    }
  }

  return {
    matches,
    ensureAccounts: [...byApp.values()],
  };
}

export async function listIdentityProvisioningRules(tenantId) {
  const tid = toOid(tenantId) || tenantId;
  return IdentityProvisioningRule.find({ tenantId: tid }).sort({ priority: 1, name: 1 }).lean();
}

export async function createIdentityProvisioningRule(tenantId, body, userId) {
  const tid = toOid(tenantId);
  if (!tid) throw new Error("Invalid tenantId");
  const profileId = await validateRuleProfileAndConditions(
    tid,
    body.identityProfileId,
    body.conditions,
  );
  return IdentityProvisioningRule.create({
    tenantId: tid,
    identityProfileId: profileId,
    name: body.name,
    description: body.description,
    enabled: body.enabled !== false,
    priority: body.priority ?? 100,
    conditionLogic: body.conditionLogic || "AND",
    conditions: body.conditions || [],
    actions: body.actions || [],
    createdBy: userId || undefined,
    updatedBy: userId || undefined,
  });
}

export async function updateIdentityProvisioningRule(tenantId, ruleId, body, userId) {
  const tid = toOid(tenantId);
  const rid = toOid(ruleId);
  if (!tid || !rid) throw new Error("Invalid id");
  const $set = { updatedBy: userId || undefined };
  if (body.identityProfileId !== undefined || body.conditions !== undefined) {
    let selectedProfileId = body.identityProfileId;
    if (selectedProfileId === undefined) {
      const existing = await IdentityProvisioningRule.findOne({
        _id: rid,
        tenantId: tid,
      })
        .select("identityProfileId")
        .lean();
      selectedProfileId = existing?.identityProfileId;
    }
    $set.identityProfileId = await validateRuleProfileAndConditions(
      tid,
      selectedProfileId,
      body.conditions,
    );
  }
  for (const key of [
    "name",
    "description",
    "enabled",
    "priority",
    "conditionLogic",
    "conditions",
    "actions",
  ]) {
    if (body[key] !== undefined) $set[key] = body[key];
  }
  return IdentityProvisioningRule.findOneAndUpdate(
    { _id: rid, tenantId: tid },
    { $set },
    { new: true },
  ).lean();
}

export async function deleteIdentityProvisioningRule(tenantId, ruleId) {
  const tid = toOid(tenantId);
  const rid = toOid(ruleId);
  if (!tid || !rid) throw new Error("Invalid id");
  return IdentityProvisioningRule.deleteOne({ _id: rid, tenantId: tid });
}

async function validateRuleProfileAndConditions(tenantId, profileId, conditions = []) {
  const pid = toOid(profileId);
  if (!pid) throw new Error("Valid identityProfileId is required");
  const profile = await IdentityProfile.findOne({ _id: pid, tenantId }).lean();
  if (!profile) throw new Error("Identity Profile not found for this tenant");
  const availableFields = new Set(
    buildIdentityCreateSchema(profile).fields.map((field) => field.key),
  );
  const invalidFields = (conditions || [])
    .map((condition) => String(condition?.field || "").trim())
    .filter((field) => field && !availableFields.has(field));
  if (invalidFields.length) {
    throw new Error(
      `Condition fields are not mapped by the selected Identity Profile: ${[
        ...new Set(invalidFields),
      ].join(", ")}`,
    );
  }
  return pid;
}
