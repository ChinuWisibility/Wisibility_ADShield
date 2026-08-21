/**
 * Pure Access Delta Engine.
 *
 * Desired Access + Actual Access -> normalized ADD / REMOVE / RETAIN result.
 * The comparison helpers never call connectors, create requests/tasks, or
 * execute workflows. `computeAccessDelta` may optionally load Desired Access
 * and Actual Access via injectable readers without mutating targets.
 */

import { evaluateDesiredAccess } from "./policyDecisionService.js";
import { loadActualAccessForIdentity } from "./actualAccessService.js";

const SECRET_KEY = /password|passwd|secret|token|credential|apikey|api_key|privatekey|private_key|bindpassword/i;

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function cleanAttributes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key) || value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function scalar(value, { caseInsensitive = false } = {}) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return caseInsensitive ? text.toLowerCase() : text;
}

function entitlementKey(entitlement, options) {
  const normalization = { caseInsensitive: Boolean(options?.caseInsensitiveEntitlements) };
  if (entitlement?.entitlementId != null) return `id:${String(entitlement.entitlementId)}`;
  if (entitlement?._id != null) return `id:${String(entitlement._id)}`;
  if (entitlement?.nativeId != null) return `native:${scalar(entitlement.nativeId, normalization)}`;
  if (entitlement?.value != null) return `value:${scalar(entitlement.value, normalization)}`;
  return `name:${scalar(entitlement?.name || entitlement?.entitlementName || entitlement?.displayName, normalization)}`;
}

function publicEntitlement(entitlement) {
  return {
    entitlementId:
      entitlement?.entitlementId != null
        ? String(entitlement.entitlementId)
        : entitlement?._id != null
          ? String(entitlement._id)
          : undefined,
    nativeId: entitlement?.nativeId || undefined,
    name:
      entitlement?.name ||
      entitlement?.entitlementName ||
      entitlement?.displayName ||
      entitlement?.value ||
      undefined,
  };
}

function normalizeEntitlements(input, options) {
  const byKey = new Map();
  for (const entitlement of asArray(input)) {
    const key = entitlementKey(entitlement, options);
    if (key === "name:") continue;
    if (!byKey.has(key)) byKey.set(key, publicEntitlement(entitlement));
  }
  return byKey;
}

function applicationsById(applications) {
  const byId = new Map();
  for (const app of asArray(applications)) {
    if (!app?.applicationId) continue;
    const id = String(app.applicationId);
    if (!byId.has(id)) {
      byId.set(id, {
        ...app,
        applicationId: id,
        attributes: cleanAttributes(app.attributes),
        entitlements: asArray(app.entitlements),
      });
      continue;
    }
    // Normalize duplicate desired/actual app records. First account state wins;
    // entitlements and attributes union deterministically below.
    const current = byId.get(id);
    current.entitlements.push(...asArray(app.entitlements));
    current.attributes = { ...cleanAttributes(app.attributes), ...current.attributes };
    if (app.account?.exists || app.accountRequired) {
      current.account = current.account || app.account;
      current.accountRequired = current.accountRequired || app.accountRequired;
    }
  }
  return byId;
}

function compareAttributes(desiredAttributes, actualAttributes, options) {
  const changes = {};
  const desired = cleanAttributes(desiredAttributes);
  const actual = cleanAttributes(actualAttributes);
  for (const key of Object.keys(desired).sort()) {
    const desiredValue = desired[key];
    const actualValue = actual[key];
    const caseInsensitive = Boolean(options.caseInsensitiveAttributes?.includes(key));
    if (scalar(desiredValue, { caseInsensitive }) !== scalar(actualValue, { caseInsensitive })) {
      changes[key] = {
        old: actualValue == null ? null : actualValue,
        new: desiredValue == null ? null : desiredValue,
      };
    }
  }
  return changes;
}

function entitlementDelta(desired, actual, options, explicitRemoves = []) {
  const desiredByKey = normalizeEntitlements(desired, options);
  const actualByKey = normalizeEntitlements(actual, options);
  const explicitRemoveByKey = normalizeEntitlements(explicitRemoves, options);
  const add = [];
  const retain = [];
  const remove = [];

  for (const [key, entitlement] of desiredByKey) {
    // Explicit REMOVE actions win over a conflicting ENSURE in Desired.
    if (explicitRemoveByKey.has(key)) continue;
    if (actualByKey.has(key)) retain.push(entitlement);
    else add.push(entitlement);
  }
  for (const [key, entitlement] of actualByKey) {
    if (!desiredByKey.has(key) || explicitRemoveByKey.has(key)) {
      remove.push(entitlement);
    }
  }

  const sort = (values) =>
    values.sort((a, b) =>
      `${a.entitlementId || ""}:${a.nativeId || ""}:${a.name || ""}`.localeCompare(
        `${b.entitlementId || ""}:${b.nativeId || ""}:${b.name || ""}`,
      ),
    );
  return { add: sort(add), retain: sort(retain), remove: sort(remove) };
}

function appOptions(application, context) {
  return {
    // Explicit application semantics may be supplied by the caller. The engine
    // never branches on application names/families.
    caseInsensitiveEntitlements: Boolean(
      application?.comparison?.caseInsensitiveEntitlements ??
        context?.comparison?.caseInsensitiveEntitlements,
    ),
    caseInsensitiveAttributes:
      application?.comparison?.caseInsensitiveAttributes ??
      context?.comparison?.caseInsensitiveAttributes ??
      [],
  };
}

/**
 * Compare already-normalized Desired and Actual Access.
 */
export function calculateAccessDelta(desiredAccess, actualAccess, context = {}) {
  if (!desiredAccess?.tenantId || !desiredAccess?.identityId) {
    throw new Error("Desired access tenantId and identityId are required");
  }
  if (!actualAccess?.tenantId || !actualAccess?.identityId) {
    throw new Error("Actual access tenantId and identityId are required");
  }
  if (
    String(desiredAccess.tenantId) !== String(actualAccess.tenantId) ||
    String(desiredAccess.identityId) !== String(actualAccess.identityId)
  ) {
    throw new Error("Desired and actual access must belong to the same tenant and identity");
  }

  const desiredByApp = applicationsById(desiredAccess.applications);
  const actualByApp = applicationsById(actualAccess.applications);
  const applicationIds = [...new Set([...desiredByApp.keys(), ...actualByApp.keys()])].sort();
  const applications = [];

  for (const applicationId of applicationIds) {
    const desired = desiredByApp.get(applicationId);
    const actual = actualByApp.get(applicationId);
    const options = appOptions(desired || actual, context);
    const desiredAccount = Boolean(desired?.accountRequired) && !Boolean(desired?.accountDisabled);
    const actualAccount = Boolean(actual?.account?.exists ?? actual?.exists);
    let accountOperation = "NOOP";
    if (desiredAccount && !actualAccount) accountOperation = "ADD_ACCOUNT";
    else if (desiredAccount && actualAccount) accountOperation = "RETAIN_ACCOUNT";
    else if (!desiredAccount && actualAccount) accountOperation = "REMOVE_ACCOUNT";

    const actualAttributes = actual?.account?.attributes || actual?.attributes || {};
    const attributesChanged =
      desiredAccount && actualAccount
        ? compareAttributes(desired?.attributes, actualAttributes, options)
        : {};
    const attributeOperation =
      Object.keys(attributesChanged).length > 0 ? "UPDATE_ACCOUNT" : "NONE";

    applications.push({
      applicationId,
      applicationName: desired?.applicationName || actual?.applicationName || null,
      account: {
        operation: accountOperation,
        attributeOperation,
        attributesChanged,
        actualNativeId: actual?.account?.nativeId || actual?.nativeId || null,
      },
      entitlements: entitlementDelta(
        desired?.entitlements,
        actual?.entitlements,
        options,
        desired?.removeEntitlements,
      ),
    });
  }

  return {
    identityId: String(desiredAccess.identityId),
    tenantId: String(desiredAccess.tenantId),
    lifecycleType: context.lifecycleType || desiredAccess.lifecycleType || null,
    lifecycleEventId:
      context.lifecycleEventId || desiredAccess.lifecycleEventId || null,
    jmlCorrelationId:
      context.jmlCorrelationId || desiredAccess.jmlCorrelationId || null,
    applications,
    metadata: {
      evaluationMode: "ACCESS_DELTA_ONLY",
      actualAccessSource: actualAccess.metadata?.source || "CALLER_SUPPLIED",
      targetWrites: false,
      provisioningTasksCreated: false,
      workflowExecuted: false,
      connectorInvoked: false,
      persisted: false,
    },
  };
}

/**
 * Reusable Access Delta entrypoint.
 *
 * - Reuses P1.5 `evaluateDesiredAccess` for desired state
 * - Loads IGA aggregated/correlated actual access unless injected
 * - Never creates ProvisioningRequest / Plan / Task or runs workflows
 *
 * Keep Joiner's ENSURE_ACCOUNT compatibility adapter on its existing path;
 * this function is intentionally not required by Joiner execution.
 */
export async function computeAccessDelta({
  identity,
  context = {},
  inputs,
  desiredAccess,
  actualAccess,
} = {}) {
  if (!identity?._id && !desiredAccess?.identityId) {
    throw new Error("identity or desiredAccess.identityId is required");
  }

  const tenantId = context.tenantId || identity?.tenantId || desiredAccess?.tenantId;
  const identityId = identity?._id || desiredAccess?.identityId;
  if (!tenantId) throw new Error("tenantId is required for access delta");

  const desired =
    desiredAccess ||
    (await evaluateDesiredAccess(
      identity,
      {
        tenantId,
        lifecycleType: context.lifecycleType,
        lifecycleEventId: context.lifecycleEventId,
        jmlCorrelationId: context.jmlCorrelationId,
        profileId: context.profileId,
      },
      inputs,
    ));

  const actual =
    actualAccess ||
    (await loadActualAccessForIdentity({
      tenantId,
      identityId,
    }));

  return calculateAccessDelta(desired, actual, {
    lifecycleType: context.lifecycleType || desired.lifecycleType,
    lifecycleEventId: context.lifecycleEventId || desired.lifecycleEventId,
    jmlCorrelationId: context.jmlCorrelationId || desired.jmlCorrelationId,
    comparison: context.comparison,
  });
}

