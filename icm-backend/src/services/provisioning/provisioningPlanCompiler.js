/**
 * Provisioning Plan Compiler (P3).
 *
 * Access Delta → normalized, classified Provisioning Plan items.
 *
 * - Does NOT evaluate birthright policy
 * - Does NOT invoke connectors or the provisioning worker
 * - Does NOT create ProvisioningTask (approval / post-approval boundary intact)
 * - Default is simulation (dry-run); persist only when an existing request is
 *   supplied and context.dryRun === false
 * - Persisted plans that have entered execution/materialization are immutable
 *   against silent recompilation (P5 cutover hardening)
 */

import crypto from "crypto";
import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import {
  normalizeProvisioningOperation,
} from "./connectors/provisioningConnectorContract.js";
import {
  classifyProvisioningOperation,
  EXECUTION_CLASS,
} from "./provisioningCapabilityCatalog.js";

const SECRET_KEY =
  /password|passwd|secret|token|credential|apikey|api_key|privatekey|private_key|bindpassword/i;

const OPERATION_ORDER = Object.freeze({
  REMOVE_ENTITLEMENT: 10,
  ADD_ACCOUNT: 20,
  ENABLE: 25,
  UPDATE_ACCOUNT: 30,
  DISABLE: 35,
  ADD_ENTITLEMENT: 40,
  REMOVE_ACCOUNT: 50,
});

const LOCKED_PLAN_STATUSES = new Set([
  "EXECUTING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
]);

function toOid(value) {
  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

/**
 * Plans that have left the pre-approval COMPILED state must not be silently
 * overwritten by a duplicate orchestration entry.
 */
export function isProvisioningPlanLockedAgainstRecompile(plan) {
  if (!plan) return false;
  if (LOCKED_PLAN_STATUSES.has(String(plan.status || "").toUpperCase())) {
    return true;
  }
  const meta = plan.metadata || {};
  if (meta.materializedAt) return true;
  if ((meta.materializedTaskCount || 0) > 0) return true;
  if (meta.taskMaterializationDeferred === false && meta.materializedTaskCount != null) {
    return true;
  }
  return false;
}

function cleanAttributes(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SECRET_KEY.test(key) || value === undefined) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = cleanAttributes(value);
      if (Object.keys(nested).length) out[key] = nested;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function desiredByApplication(desiredAccess) {
  const map = new Map();
  for (const app of desiredAccess?.applications || []) {
    if (!app?.applicationId) continue;
    map.set(String(app.applicationId), app);
  }
  return map;
}

function entitlementDiscriminator(entitlement) {
  if (entitlement?.entitlementId != null) return `id:${entitlement.entitlementId}`;
  if (entitlement?.nativeId != null) return `native:${entitlement.nativeId}`;
  if (entitlement?.name != null) return `name:${entitlement.name}`;
  return "entitlement:unknown";
}

function itemKey(applicationId, operationType, discriminator = "account") {
  return `${String(applicationId)}|${normalizeProvisioningOperation(operationType)}|${discriminator}`;
}

/**
 * Translate Access Delta into raw plan operations (no capability classification yet).
 * RETAIN / NOOP produce no work.
 */
export function translateAccessDeltaToPlanItems(accessDelta, desiredAccess = null) {
  if (!accessDelta?.applications) return [];

  const desiredMap = desiredByApplication(desiredAccess);
  const byKey = new Map();

  const push = (item) => {
    const key = item.itemKey;
    if (byKey.has(key)) return;
    byKey.set(key, item);
  };

  for (const app of accessDelta.applications) {
    const applicationId = String(app.applicationId);
    const desired = desiredMap.get(applicationId);
    const nativeId = app.account?.actualNativeId || null;
    const desiredAttributes = cleanAttributes(desired?.attributes || {});
    const attributesChanged = cleanAttributes(app.account?.attributesChanged || {});

    const accountOp = app.account?.operation;
    if (accountOp === "ADD_ACCOUNT") {
      push({
        itemKey: itemKey(applicationId, "ADD_ACCOUNT"),
        applicationId,
        applicationName: app.applicationName || desired?.applicationName || null,
        operationType: "ADD_ACCOUNT",
        attributes: desiredAttributes,
        nativeIdentifier: nativeId,
        entitlement: null,
      });
    } else if (accountOp === "REMOVE_ACCOUNT") {
      // Prefer DISABLE when desired state explicitly wants a disabled account.
      const operationType = desired?.accountDisabled ? "DISABLE" : "REMOVE_ACCOUNT";
      push({
        itemKey: itemKey(applicationId, operationType),
        applicationId,
        applicationName: app.applicationName || desired?.applicationName || null,
        operationType,
        attributes: desiredAttributes,
        nativeIdentifier: nativeId,
        entitlement: null,
      });
    }

    if (app.account?.attributeOperation === "UPDATE_ACCOUNT") {
      push({
        itemKey: itemKey(applicationId, "UPDATE_ACCOUNT"),
        applicationId,
        applicationName: app.applicationName || desired?.applicationName || null,
        operationType: "UPDATE_ACCOUNT",
        attributes: desiredAttributes,
        attributesChanged,
        nativeIdentifier: nativeId,
        entitlement: null,
      });
    }

    for (const entitlement of app.entitlements?.add || []) {
      const disc = entitlementDiscriminator(entitlement);
      push({
        itemKey: itemKey(applicationId, "ADD_ENTITLEMENT", disc),
        applicationId,
        applicationName: app.applicationName || desired?.applicationName || null,
        operationType: "ADD_ENTITLEMENT",
        attributes: {},
        nativeIdentifier: nativeId,
        entitlement: {
          entitlementId: entitlement.entitlementId || undefined,
          nativeId: entitlement.nativeId || undefined,
          name: entitlement.name || entitlement.entitlementName || undefined,
        },
      });
    }

    for (const entitlement of app.entitlements?.remove || []) {
      const disc = entitlementDiscriminator(entitlement);
      push({
        itemKey: itemKey(applicationId, "REMOVE_ENTITLEMENT", disc),
        applicationId,
        applicationName: app.applicationName || desired?.applicationName || null,
        operationType: "REMOVE_ENTITLEMENT",
        attributes: {},
        nativeIdentifier: nativeId,
        entitlement: {
          entitlementId: entitlement.entitlementId || undefined,
          nativeId: entitlement.nativeId || undefined,
          name: entitlement.name || entitlement.entitlementName || undefined,
        },
      });
    }
  }

  return [...byKey.values()];
}

function sortPlanItems(items) {
  return [...items].sort((a, b) => {
    const oa = OPERATION_ORDER[a.operationType] ?? 99;
    const ob = OPERATION_ORDER[b.operationType] ?? 99;
    if (oa !== ob) return oa - ob;
    const appCmp = String(a.applicationId).localeCompare(String(b.applicationId));
    if (appCmp !== 0) return appCmp;
    return String(a.itemKey).localeCompare(String(b.itemKey));
  });
}

function compilationHash({
  tenantId,
  identityId,
  lifecycleEventId,
  jmlCorrelationId,
  operations,
}) {
  const payload = JSON.stringify({
    tenantId: String(tenantId),
    identityId: String(identityId),
    lifecycleEventId: lifecycleEventId ? String(lifecycleEventId) : null,
    jmlCorrelationId: jmlCorrelationId || null,
    operations: operations.map((op) => ({
      itemKey: op.itemKey,
      applicationId: op.applicationId,
      operationType: op.operationType,
      executionClass: op.executionClass,
      reasonCode: op.reasonCode,
      entitlement: op.entitlement || null,
      attributes: op.attributes || {},
      attributesChanged: op.attributesChanged || undefined,
      nativeIdentifier: op.nativeIdentifier || null,
    })),
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function loadApplicationsById(applicationIds, tenantId, injected) {
  if (injected) {
    const map = new Map();
    for (const app of injected) {
      map.set(String(app._id || app.applicationId), app);
    }
    return map;
  }
  const oids = applicationIds.map(toOid).filter(Boolean);
  if (!oids.length) return new Map();
  const q = { _id: { $in: oids } };
  if (tenantId) q.tenantId = toOid(tenantId) || tenantId;
  const rows = await Application.find(q).lean();
  return new Map(rows.map((row) => [String(row._id), row]));
}

function validateLineage({ accessDelta, identity, lifecycleEvent, context }) {
  const tenantId =
    context.tenantId ||
    accessDelta?.tenantId ||
    identity?.tenantId ||
    lifecycleEvent?.tenantId;
  const identityId =
    accessDelta?.identityId ||
    identity?._id ||
    identity?.id ||
    lifecycleEvent?.identityId;
  const lifecycleEventId =
    context.lifecycleEventId ||
    accessDelta?.lifecycleEventId ||
    lifecycleEvent?._id ||
    lifecycleEvent?.id;
  const jmlCorrelationId =
    context.jmlCorrelationId ||
    accessDelta?.jmlCorrelationId ||
    lifecycleEvent?.jmlCorrelationId;

  if (!tenantId) throw new Error("tenantId is required for plan compilation");
  if (!identityId) throw new Error("identityId is required for plan compilation");
  if (!lifecycleEventId) {
    throw new Error("lifecycleEventId is required for plan compilation");
  }
  if (!jmlCorrelationId) {
    throw new Error("jmlCorrelationId is required for plan compilation");
  }

  if (
    accessDelta?.tenantId &&
    String(accessDelta.tenantId) !== String(tenantId)
  ) {
    throw new Error("accessDelta tenantId mismatch");
  }
  if (
    accessDelta?.identityId &&
    String(accessDelta.identityId) !== String(identityId)
  ) {
    throw new Error("accessDelta identityId mismatch");
  }
  if (
    identity?.tenantId &&
    String(identity.tenantId) !== String(tenantId)
  ) {
    throw new Error("identity tenantId mismatch");
  }

  return {
    tenantId: String(tenantId),
    identityId: String(identityId),
    lifecycleEventId: String(lifecycleEventId),
    jmlCorrelationId: String(jmlCorrelationId),
  };
}

/**
 * Compile Access Delta into a normalized Provisioning Plan.
 *
 * @returns {Promise<object>} plan document shape (persisted or simulated)
 */
export async function compileProvisioningPlan({
  identity = null,
  lifecycleEvent = null,
  desiredAccess = null,
  actualAccess = null,
  accessDelta,
  context = {},
} = {}) {
  if (!accessDelta) {
    throw new Error("accessDelta is required — Plan Compiler does not re-evaluate policy");
  }

  const lineage = validateLineage({
    accessDelta,
    identity,
    lifecycleEvent,
    context,
  });

  const dryRun = context.dryRun !== false || !context.requestId;
  const persist = context.dryRun === false && Boolean(context.requestId);

  const rawItems = translateAccessDeltaToPlanItems(accessDelta, desiredAccess);
  const applicationIds = [...new Set(rawItems.map((i) => i.applicationId))];
  const applicationsById = await loadApplicationsById(
    applicationIds,
    lineage.tenantId,
    context.applications,
  );

  const ambiguousApplicationIds = [
    ...new Set(
      [
        ...(actualAccess?.metadata?.ambiguousApplicationIds || []),
        ...(context.ambiguousApplicationIds || []),
      ].map(String).filter(Boolean),
    ),
  ];

  const actualAccessMeta = {
    projectionEntitlementsAvailable:
      actualAccess?.metadata?.projectionEntitlementsAvailable,
    ambiguousAccounts:
      Boolean(context.ambiguousAccounts) ||
      Boolean(actualAccess?.metadata?.ambiguousAccounts) ||
      ambiguousApplicationIds.length > 0,
    ambiguousApplicationIds,
    source: actualAccess?.metadata?.source || accessDelta?.metadata?.actualAccessSource,
  };

  const classified = sortPlanItems(
    rawItems.map((item) => {
      const application = applicationsById.get(String(item.applicationId));
      const appAmbiguous =
        ambiguousApplicationIds.includes(String(item.applicationId)) ||
        Boolean(actualAccessMeta.ambiguousAccounts && !ambiguousApplicationIds.length);
      const classification = classifyProvisioningOperation({
        application: application
          ? { ...application, applicationId: item.applicationId }
          : { applicationId: item.applicationId },
        tenantId: lineage.tenantId,
        operationType: item.operationType,
        attributes: item.attributes,
        identity: identity || {},
        entitlement: item.entitlement,
        actualAccessMeta: {
          ...actualAccessMeta,
          // Per-app ambiguity: only block ops for the affected application.
          ambiguousAccounts: appAmbiguous,
          ambiguousApplicationIds: appAmbiguous
            ? [String(item.applicationId)]
            : [],
        },
      });

      return {
        itemKey: item.itemKey,
        planItemId: item.itemKey,
        applicationId: item.applicationId,
        applicationName: item.applicationName || application?.name || null,
        operationType: item.operationType,
        executionClass: classification.executionClass,
        reasonCode: classification.reasonCode,
        connectorFamily: classification.connectorFamily,
        capability: classification.capability,
        missingAttributes: classification.missingAttributes || undefined,
        attributes: item.attributes || {},
        attributesChanged: item.attributesChanged || undefined,
        nativeIdentifier: item.nativeIdentifier || null,
        entitlement: item.entitlement || null,
        status: classification.executionClass,
        lifecycleEventId: lineage.lifecycleEventId,
        jmlCorrelationId: lineage.jmlCorrelationId,
      };
    }),
  ).map((op, index) => ({ ...op, sequence: index }));


  const hash = compilationHash({
    ...lineage,
    operations: classified,
  });

  const applicationsSummary = [];
  const byApp = new Map();
  for (const op of classified) {
    if (!byApp.has(op.applicationId)) {
      byApp.set(op.applicationId, {
        applicationId: op.applicationId,
        applicationName: op.applicationName,
        items: [],
      });
    }
    byApp.get(op.applicationId).items.push(op);
  }
  for (const appId of [...byApp.keys()].sort()) {
    applicationsSummary.push(byApp.get(appId));
  }

  const hasBlocked = classified.some(
    (op) => op.executionClass === EXECUTION_CLASS.BLOCKED,
  );
  const hasExecutable = classified.some(
    (op) => op.executionClass === EXECUTION_CLASS.EXECUTABLE,
  );

  const planStatus = hasBlocked && !hasExecutable ? "FAILED" : "COMPILED";

  const planBody = {
    tenantId: lineage.tenantId,
    identityId: lineage.identityId,
    lifecycleEventId: lineage.lifecycleEventId,
    jmlCorrelationId: lineage.jmlCorrelationId,
    requestId: context.requestId ? String(context.requestId) : null,
    operations: classified,
    applications: applicationsSummary,
    totalOperations: classified.length,
    completedOperations: 0,
    failedOperations: 0,
    status: planStatus,
    compiledAt: new Date().toISOString(),
    compilationHash: hash,
    metadata: {
      evaluationMode: "PLAN_COMPILER",
      dryRun: !persist,
      persisted: false,
      targetWrites: false,
      provisioningTasksCreated: false,
      workflowExecuted: false,
      connectorInvoked: false,
      compilerVersion: "p3-plan-compiler-v1",
      actualAccessSource: actualAccessMeta.source || null,
      // Task uniqueness (request+app+operation) cannot yet represent multiple
      // entitlement items; materialization remains a later post-approval phase.
      taskMaterializationDeferred: true,
    },
  };

  if (!persist) {
    return planBody;
  }

  const requestOid = toOid(context.requestId);
  if (!requestOid) throw new Error("Valid requestId is required to persist a plan");

  const request = await ProvisioningRequest.findById(requestOid).lean();
  if (!request) throw new Error("ProvisioningRequest not found for plan persistence");
  if (
    request.tenantId &&
    String(request.tenantId) !== String(lineage.tenantId)
  ) {
    throw new Error("ProvisioningRequest tenant mismatch");
  }
  if (
    request.identityId &&
    String(request.identityId) !== String(lineage.identityId)
  ) {
    throw new Error("ProvisioningRequest identity mismatch");
  }

  // Race-safe upsert on unique requestId (per persistence audit).
  const existing = await ProvisioningPlan.findOne({ requestId: requestOid }).lean();
  if (existing && isProvisioningPlanLockedAgainstRecompile(existing)) {
    return {
      ...planBody,
      _id: String(existing._id),
      requestId: String(existing.requestId),
      status: existing.status,
      compiledAt: existing.compiledAt?.toISOString?.() || planBody.compiledAt,
      totalOperations: existing.totalOperations ?? planBody.totalOperations,
      operations: existing.operations || planBody.operations,
      metadata: {
        ...planBody.metadata,
        dryRun: false,
        persisted: true,
        reused: true,
        lockedAgainstRecompile: true,
      },
    };
  }
  if (existing?.compilationHash === hash) {
    return {
      ...planBody,
      _id: String(existing._id),
      requestId: String(existing.requestId),
      status: existing.status,
      compiledAt: existing.compiledAt?.toISOString?.() || planBody.compiledAt,
      metadata: {
        ...planBody.metadata,
        dryRun: false,
        persisted: true,
        reused: true,
      },
    };
  }

  const now = new Date();
  const persisted = await ProvisioningPlan.findOneAndUpdate(
    { requestId: requestOid },
    {
      $set: {
        tenantId: toOid(lineage.tenantId) || lineage.tenantId,
        identityId: toOid(lineage.identityId) || lineage.identityId,
        lifecycleEventId: lineage.lifecycleEventId,
        jmlCorrelationId: lineage.jmlCorrelationId,
        compilationHash: hash,
        operations: classified,
        totalOperations: classified.length,
        status: planStatus,
        compiledAt: now,
        metadata: {
          compilerVersion: "p3-plan-compiler-v1",
          taskMaterializationDeferred: true,
        },
      },
      $setOnInsert: {
        requestId: requestOid,
        completedOperations: 0,
        failedOperations: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return {
    ...planBody,
    _id: String(persisted._id),
    requestId: String(persisted.requestId),
    compiledAt: persisted.compiledAt?.toISOString?.() || planBody.compiledAt,
    metadata: {
      ...planBody.metadata,
      dryRun: false,
      persisted: true,
      reused: false,
      updated: Boolean(existing),
    },
  };
}
