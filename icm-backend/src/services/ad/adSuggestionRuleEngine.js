import { evaluateCondition } from "../discovery/discoveryEvaluationService.js";

const AD_GROUP_FIELD_ALIASES = {
  groupname: "groupName",
  group_name: "groupName",
  name: "groupName",
  description: "description",
  dn: "dn",
  groupdn: "dn",
  group_dn: "dn",
};

const SUPPORTED_OPERATORS = new Set([
  "startsWith",
  "contains",
  "equals",
  "endsWith",
]);

function normalizeFieldName(fieldName) {
  const raw = String(fieldName || "").trim();
  if (!raw) return "";
  const alias = AD_GROUP_FIELD_ALIASES[raw.toLowerCase()];
  return alias || raw;
}

function resolveGroupFieldValue(group, fieldName) {
  const normalizedField = normalizeFieldName(fieldName);
  if (!group || !normalizedField) return undefined;

  switch (normalizedField) {
    case "groupName":
      return group.groupName ?? group.name ?? "";
    case "description":
      return group.description ?? "";
    case "dn":
      return group.dn ?? group.groupDN ?? "";
    default:
      return group[normalizedField];
  }
}

export function toRuleEvaluationEntity(group) {
  return {
    groupName: String(group?.groupName || group?.name || "").trim(),
    description: String(group?.description || "").trim(),
    dn: String(group?.groupDN || group?.dn || "").trim(),
  };
}

/**
 * Evaluate a single field condition against an AD group.
 * @param {object} group - LDAP group or rule entity
 * @param {{ field?: string, fieldName?: string, operator: string, value: string, caseSensitive?: boolean }} rule
 */
export function evaluateRule(group, rule) {
  if (!rule || typeof rule !== "object") return false;

  const operator = String(rule.operator || "").trim();
  if (!SUPPORTED_OPERATORS.has(operator)) return false;

  const fieldName = normalizeFieldName(rule.fieldName || rule.field);
  const fieldValue = resolveGroupFieldValue(
    group?.groupName != null || group?.groupDN != null
      ? toRuleEvaluationEntity(group)
      : group,
    fieldName,
  );

  return evaluateCondition(
    fieldValue,
    operator,
    rule.value,
    Boolean(rule.caseSensitive),
  );
}

function evaluateFieldBlock(group, fieldBlock) {
  const entity = toRuleEvaluationEntity(group);
  const fieldName = normalizeFieldName(
    fieldBlock?.fieldName || fieldBlock?.field,
  );
  const conditions = Array.isArray(fieldBlock?.conditions)
    ? fieldBlock.conditions
    : [];
  if (!fieldName || !conditions.length) return false;

  const fieldLogic = String(fieldBlock?.fieldLogic || fieldBlock?.conditionLogic || "OR").toUpperCase();
  const results = conditions.map((condition) =>
    evaluateCondition(
      resolveGroupFieldValue(entity, fieldName),
      condition?.operator,
      condition?.value,
      Boolean(condition?.caseSensitive),
    ),
  );

  return fieldLogic === "AND" ? results.every(Boolean) : results.some(Boolean);
}

function evaluateStep(group, step) {
  const fieldLogic = String(step?.fieldLogic || "OR").toUpperCase();
  const fields =
    (Array.isArray(step?.fields) && step.fields.length
      ? step.fields
      : Array.isArray(step?.fieldConditions)
        ? step.fieldConditions
        : []) || [];

  if (!fields.length) return false;

  const results = fields.map((fieldBlock) => evaluateFieldBlock(group, fieldBlock));
  return fieldLogic === "AND" ? results.every(Boolean) : results.some(Boolean);
}

/**
 * Evaluate a hierarchical rule set (steps + stepLogic) against an AD group.
 * @param {object} group
 * @param {{ stepLogic?: string, steps?: Array }} ruleSet
 * @returns {{ passed: boolean }}
 */
export function evaluateRuleSet(group, ruleSet) {
  if (!ruleSet || typeof ruleSet !== "object") {
    return { passed: false };
  }

  const steps = Array.isArray(ruleSet.steps) ? ruleSet.steps : [];
  if (!steps.length) return { passed: false };

  const stepLogic = String(ruleSet.stepLogic || "OR").toUpperCase();
  const results = steps.map((step) => evaluateStep(group, step));

  const passed =
    stepLogic === "AND" ? results.every(Boolean) : results.some(Boolean);

  return { passed };
}

export function normalizeRuleDefinitions(ruleDefinitions) {
  if (!Array.isArray(ruleDefinitions)) return [];

  return ruleDefinitions
    .map((definition) => {
      const appName = String(definition?.appName || "").trim();
      const ruleSet = definition?.ruleSet;
      if (!appName || !ruleSet || typeof ruleSet !== "object") return null;
      return { appName, ruleSet };
    })
    .filter(Boolean);
}
