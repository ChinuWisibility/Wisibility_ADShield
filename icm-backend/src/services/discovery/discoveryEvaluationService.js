import { randomUUID } from "crypto";
import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import DiscoveryPolicy from "../../models/discovery/DiscoveryPolicy.js";
import DiscoveryResult from "../../models/discovery/DiscoveryResult.js";

/* ════════════════════════════════════════════════════════════════════
 * CONDITION EVALUATORS
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Evaluate a single condition against a value.
 * @param {string} fieldValue  - the actual value from the entity
 * @param {string} operator    - one of: contains, equals, startsWith, endsWith, regex, notContains, notEquals
 * @param {string} conditionValue - the target value from the condition
 * @param {boolean} caseSensitive
 * @returns {boolean}
 */
export function evaluateCondition(
  fieldValue,
  operator,
  conditionValue,
  caseSensitive = false,
) {
  if (fieldValue == null || conditionValue == null) return false;

  let fv = String(fieldValue);
  let cv = String(conditionValue);

  if (!caseSensitive) {
    fv = fv.toLowerCase();
    cv = cv.toLowerCase();
  }

  switch (operator) {
    case "contains":
      return fv.includes(cv);
    case "equals":
      return fv === cv;
    case "startsWith":
      return fv.startsWith(cv);
    case "endsWith":
      return fv.endsWith(cv);
    case "notContains":
      return !fv.includes(cv);
    case "notEquals":
      return fv !== cv;
    case "regex": {
      try {
        const flags = caseSensitive ? "" : "i";
        return new RegExp(conditionValue, flags).test(fieldValue);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Resolve a field value from an entity document.
 * Supports dot-notation for nested fields (e.g. "rawData.someField").
 */
function resolveFieldValue(entity, fieldName) {
  if (!fieldName) return undefined;
  const parts = fieldName.split(".");
  let value = entity;
  for (const part of parts) {
    if (value == null || typeof value !== "object") return undefined;
    value = value[part];
  }
  return value;
}

/** Flatten rawData onto entity for discovery policy field resolution. */
export function mergeEntityForDiscoveryEval(entity) {
  if (!entity || typeof entity !== "object") return entity;
  const merged = { ...entity };
  if (entity.rawData && typeof entity.rawData === "object") {
    for (const [key, value] of Object.entries(entity.rawData)) {
      if (!(key in merged)) merged[key] = value;
    }
  }
  return merged;
}

/* ════════════════════════════════════════════════════════════════════
 * HIERARCHICAL EVALUATION
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Evaluate all conditions for one field against an entity.
 * Returns { passed: boolean, matchedDetails: Array }
 */
function evaluateFieldCondition(entity, fieldCondition) {
  const { fieldName, conditionLogic = "OR", conditions = [] } = fieldCondition;
  if (!conditions.length) return { passed: false, matchedDetails: [] };

  const fieldValue = resolveFieldValue(entity, fieldName);
  const matchedDetails = [];
  const results = [];

  for (const cond of conditions) {
    const passed = evaluateCondition(
      fieldValue,
      cond.operator,
      cond.value,
      cond.caseSensitive,
    );
    results.push(passed);
    if (passed) {
      matchedDetails.push({
        fieldName,
        matchedValue: String(fieldValue ?? ""),
        operator: cond.operator,
        conditionValue: cond.value,
      });
    }
  }

  const passed =
    conditionLogic === "AND" ? results.every(Boolean) : results.some(Boolean);

  return { passed, matchedDetails: passed ? matchedDetails : [] };
}

/**
 * Evaluate one step: all fieldConditions combined with fieldLogic.
 */
function evaluateStep(entity, step) {
  const { fieldLogic = "OR", fieldConditions = [] } = step;
  if (!fieldConditions.length) return { passed: false, matchedDetails: [] };

  const allMatched = [];
  const results = [];

  for (const fc of fieldConditions) {
    const { passed, matchedDetails } = evaluateFieldCondition(entity, fc);
    results.push(passed);
    if (passed) allMatched.push(...matchedDetails);
  }

  const passed =
    fieldLogic === "AND" ? results.every(Boolean) : results.some(Boolean);

  return { passed, matchedDetails: passed ? allMatched : [] };
}

/**
 * Evaluate all steps combined with stepLogic.
 * @returns {{ passed: boolean, matchedDetails: Array }}
 */
export function evaluateEntity(entity, steps, stepLogic = "OR") {
  if (!steps || !steps.length) return { passed: false, matchedDetails: [] };

  const allMatched = [];
  const results = [];

  for (const step of steps) {
    const { passed, matchedDetails } = evaluateStep(entity, step);
    results.push(passed);
    if (passed) allMatched.push(...matchedDetails);
  }

  const passed =
    stepLogic === "AND" ? results.every(Boolean) : results.some(Boolean);

  return { passed, matchedDetails: passed ? allMatched : [] };
}

/* ════════════════════════════════════════════════════════════════════
 * POLICY EXECUTION
 * ════════════════════════════════════════════════════════════════════ */

/**
 * Display name resolver for user entities.
 */
function resolveUserDisplayName(doc) {
  return (
    doc.display_name ||
    doc.displayName ||
    doc.username ||
    doc.user_id ||
    doc.email ||
    doc.nativeIdentity ||
    "Unknown"
  );
}

/**
 * Display name resolver for entitlement entities.
 */
function resolveEntitlementDisplayName(doc) {
  return (
    doc.entitlement_name ||
    doc.entitlementName ||
    doc.displayName ||
    doc.name ||
    doc.entitlement_id ||
    "Unknown"
  );
}

/**
 * Unique identifier for dedup / display.
 */
function resolveEntityIdentifier(doc, entityType) {
  if (entityType === "USER") {
    return doc.user_id || doc.username || doc.email || doc.nativeIdentity || "";
  }
  return (
    doc.entitlement_id || doc.entitlementName || doc.entitlement_name || ""
  );
}

/**
 * Run evaluation for a single discovery policy.
 *
 * @param {{ scopedTenantId?: string|null }} ctx
 * @param {object} policy - lean DiscoveryPolicy document
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{ matched: number, total: number, runId: string, sampleMatches?: object[] }>}
 */
export async function runDiscoveryPolicy(ctx, policy, options = {}) {
  const { dryRun = false } = options;
  const runId = randomUUID();
  const app = await Application.findById(policy.applicationId)
    .select("name tenantId")
    .lean();
  if (!app?.name) {
    return { matched: 0, total: 0, runId, error: "Application not found" };
  }

  const isUser = policy.type === "USER";
  const Model = isUser
    ? await getDynamicUserModelForTenantId(app.name, app.tenantId)
    : await getDynamicEntitlementModelForTenantId(app.name, app.tenantId); // ENTITLEMENT & AD_GROUP both use entitlement model

  // Load all entities for this application
  let entities = await Model.find({
    applicationId: policy.applicationId,
  }).lean();
  if (entities.length === 0) {
    entities = await Model.find({}).lean();
  }

  const results = [];
  const sampleMatches = [];

  for (const entity of entities) {
    const merged = mergeEntityForDiscoveryEval(entity);

    const { passed, matchedDetails } = evaluateEntity(
      merged,
      policy.steps,
      policy.stepLogic,
    );
    if (!passed) continue;

    const displayName = isUser
      ? resolveUserDisplayName(merged)
      : resolveEntitlementDisplayName(merged);
    const identifier = resolveEntityIdentifier(merged, policy.type);
    const entityDescription =
      merged.entitlement_description ||
      merged.entitlementDescription ||
      merged.entitlement_desc ||
      merged.description ||
      merged.desc ||
      merged.summary ||
      "";

    if (dryRun) {
      sampleMatches.push({
        entityId: entity._id,
        entityDisplayName: displayName,
        entityIdentifier: identifier,
        matchedFields: matchedDetails,
      });
      continue;
    }

    results.push({
      tenantId: policy.tenantId || null,
      policyId: policy._id,
      policyName: policy.name,
      evaluationRunId: runId,
      entityType: policy.type,
      entityId: entity._id,
      applicationId: policy.applicationId,
      applicationName: policy.applicationName || app.name,
      matchedFields: matchedDetails,
      entityDisplayName: displayName,
      entityDescription,
      entityIdentifier: identifier,
      reviewStatus: "detected",
      detectedAt: new Date(),
    });
  }

  if (dryRun) {
    return {
      matched: sampleMatches.length,
      total: entities.length,
      runId,
      sampleMatches,
    };
  }

  // Persist results — preserve previous admin confirmations
  if (results.length > 0) {
    // Load previous confirmed/dismissed results for this policy
    const previousResults = await DiscoveryResult.find({
      policyId: policy._id,
      reviewStatus: { $in: ["confirmed", "dismissed"] },
    }).lean();

    // Build a map of entityId → previous reviewStatus
    const previousStatusMap = new Map();
    for (const prev of previousResults) {
      if (prev.entityId) {
        previousStatusMap.set(String(prev.entityId), {
          reviewStatus: prev.reviewStatus,
          reviewedBy: prev.reviewedBy,
          reviewedAt: prev.reviewedAt,
        });
      }
    }

    // Carry forward previous admin decisions
    for (const r of results) {
      const prev = previousStatusMap.get(String(r.entityId));
      if (prev) {
        r.reviewStatus = prev.reviewStatus;
        r.reviewedBy = prev.reviewedBy;
        r.reviewedAt = prev.reviewedAt;
      }
    }

    // Clear previous results for this policy (keep only latest run)
    await DiscoveryResult.deleteMany({ policyId: policy._id });
    // Batch insert
    await DiscoveryResult.insertMany(results, { ordered: false }).catch(
      () => {},
    );
  } else {
    // No matches — clear old results
    await DiscoveryResult.deleteMany({ policyId: policy._id });
  }

  // Update policy stats
  await DiscoveryPolicy.updateOne(
    { _id: policy._id },
    {
      $set: {
        totalMatches: results.length,
        lastEvaluatedAt: new Date(),
      },
    },
  ).catch(() => {});

  return { matched: results.length, total: entities.length, runId };
}

/**
 * Run all active discovery policies for the tenant.
 * @param {{ scopedTenantId?: string|null }} ctx
 */
export async function runAllDiscoveryPolicies(ctx) {
  const filter = {};
  if (ctx.scopedTenantId) {
    filter.tenantId = ctx.scopedTenantId;
  }

  const policies = await DiscoveryPolicy.find(filter).lean();
  const summary = { policiesEvaluated: 0, totalMatched: 0, errors: [] };

  for (const policy of policies) {
    try {
      const result = await runDiscoveryPolicy(ctx, policy);
      summary.policiesEvaluated += 1;
      summary.totalMatched += result.matched;
    } catch (err) {
      summary.errors.push({ policyId: policy._id, error: err.message });
    }
  }

  return summary;
}

/**
 * Generate next policy ID for a tenant (DISC-101, DISC-102, ...).
 */
export async function nextDiscoveryPolicyId(scopedTenantId) {
  const filter = {};
  if (scopedTenantId) filter.tenantId = scopedTenantId;

  const rows = await DiscoveryPolicy.find({
    ...filter,
    policyId: { $regex: /^DISC-\d+$/i },
  })
    .select("policyId")
    .lean();

  let max = 99;
  for (const r of rows) {
    const m = String(r.policyId || "").match(/^DISC-(\d+)$/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `DISC-${max + 1}`;
}
