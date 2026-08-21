/**
 * Approval-gated task materialization from a compiled ProvisioningPlan.
 *
 * Only EXECUTABLE plan items become ProvisioningTask rows.
 * MANUAL / UNSUPPORTED / BLOCKED remain on the plan (never discarded silently).
 * Does NOT invoke connectors or the provisioning worker.
 */

import mongoose from "mongoose";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import Application from "../../models/application/Application.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import {
  classifyProvisioningOperation,
  EXECUTION_CLASS,
} from "./provisioningCapabilityCatalog.js";

function toOid(value) {
  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

const ACCOUNT_CREATE_OPS = new Set(["ADD_ACCOUNT", "ENABLE"]);
const TERMINAL_REQUEST_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
const TERMINAL_PLAN_STATUSES = new Set([
  "COMPLETED",
  "PARTIAL",
  "FAILED",
]);

export function preserveTerminalMaterializationStatus(status, kind) {
  const normalized = String(status || "").toUpperCase();
  const terminal =
    kind === "request" ? TERMINAL_REQUEST_STATUSES : TERMINAL_PLAN_STATUSES;
  return terminal.has(normalized);
}

function computeDependsOn(sortedExecutable, item) {
  if (item.operationType !== "ADD_ENTITLEMENT") return [];
  const prereq = sortedExecutable.find(
    (other) =>
      other.applicationId === item.applicationId &&
      ACCOUNT_CREATE_OPS.has(other.operationType) &&
      other.itemKey !== item.itemKey,
  );
  return prereq ? [prereq.itemKey] : [];
}

/**
 * Materialize executable plan items into ProvisioningTask documents.
 *
 * @returns {Promise<object>}
 */
export async function materializeProvisioningTasks({
  planId,
  workflowExecutionId,
  approvedBy,
  tenantId: tenantHint,
} = {}) {
  const planOid = toOid(planId);
  if (!planOid) {
    return { success: false, error: "Valid planId is required", status: 400 };
  }

  const plan = await ProvisioningPlan.findById(planOid);
  if (!plan) {
    return { success: false, error: "ProvisioningPlan not found", status: 404 };
  }

  const request = await ProvisioningRequest.findById(plan.requestId);
  if (!request) {
    return { success: false, error: "ProvisioningRequest not found", status: 404 };
  }

  if (tenantHint && request.tenantId && String(request.tenantId) !== String(tenantHint)) {
    return { success: false, error: "Tenant mismatch", status: 403 };
  }
  if (
    plan.tenantId &&
    request.tenantId &&
    String(plan.tenantId) !== String(request.tenantId)
  ) {
    return { success: false, error: "Plan/request tenant mismatch", status: 403 };
  }

  if (request.approvalStatus === "REJECTED" || request.status === "CANCELLED") {
    return {
      success: false,
      error: "Request rejected/cancelled — no executable tasks",
      status: 409,
    };
  }
  if (
    request.approvalStatus !== "APPROVED" &&
    request.approvalStatus !== "NOT_REQUIRED"
  ) {
    return {
      success: false,
      error: `Request not approved (approvalStatus=${request.approvalStatus})`,
      status: 409,
    };
  }

  const jmlCorrelationId =
    plan.jmlCorrelationId || request.metadata?.jmlCorrelationId || null;
  const lifecycleEventId =
    plan.lifecycleEventId || request.metadata?.lifecycleEventId || null;
  const executionId =
    workflowExecutionId ||
    request.metadata?.workflowExecutionId ||
    null;

  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const executableCandidates = operations.filter(
    (op) => op?.executionClass === EXECUTION_CLASS.EXECUTABLE && op?.itemKey,
  );

  // Defense in depth: re-classify capability against live application docs.
  const appIds = [
    ...new Set(executableCandidates.map((op) => String(op.applicationId)).filter(Boolean)),
  ];
  const apps = await Application.find({
    _id: { $in: appIds.map(toOid).filter(Boolean) },
    ...(request.tenantId ? { tenantId: request.tenantId } : {}),
  }).lean();
  const appsById = new Map(apps.map((a) => [String(a._id), a]));

  // Load identity so rematerialize attribute checks match compile-time
  // classification (plan item attributes alone may be empty for ENSURE_ACCOUNT).
  let identityDoc = {
    _id: request.identityId,
    tenantId: request.tenantId,
  };
  if (request.tenantId && request.identityId) {
    try {
      const Identity = await getDynamicIdentityModelForTenantId(request.tenantId);
      const loaded = await Identity.findById(request.identityId).lean();
      if (loaded) identityDoc = loaded;
    } catch {
      // Keep stub identity; classification may then block missing attrs.
    }
  }

  const validatedExecutable = [];
  const blockedOnRematerialize = [];
  for (const op of executableCandidates) {
    const application = appsById.get(String(op.applicationId));
    const classification = classifyProvisioningOperation({
      application,
      tenantId: request.tenantId,
      operationType: op.operationType,
      attributes: op.attributes,
      identity: {
        ...identityDoc,
        ...(op.attributes || {}),
      },
      entitlement: op.entitlement,
    });
    if (classification.executionClass !== EXECUTION_CLASS.EXECUTABLE) {
      blockedOnRematerialize.push({
        itemKey: op.itemKey,
        reasonCode: classification.reasonCode,
        executionClass: classification.executionClass,
      });
      continue;
    }
    validatedExecutable.push(op);
  }

  const sorted = [...validatedExecutable].sort((a, b) => {
    const sa = a.sequence ?? 0;
    const sb = b.sequence ?? 0;
    if (sa !== sb) return sa - sb;
    return String(a.itemKey).localeCompare(String(b.itemKey));
  });

  // Stamp sequence / dependsOn if missing (compiler may already have them)
  const withDeps = sorted.map((op, index) => ({
    ...op,
    sequence: op.sequence ?? index,
    dependsOnPlanItemIds:
      op.dependsOnPlanItemIds || computeDependsOn(sorted, op),
  }));

  const upserts = withDeps.map((op) => {
    const planItemId = String(op.itemKey);
    const applicationId = toOid(op.applicationId);
    const targetAttributes = {
      identityId: String(request.identityId),
      tenantId: request.tenantId ? String(request.tenantId) : undefined,
      applicationName: op.applicationName || undefined,
      lifecycleRequestId: String(request._id),
      joinerRequestId:
        request.requestType === "JOINER" ? String(request._id) : undefined,
      executionId: executionId || undefined,
      jmlCorrelationId: jmlCorrelationId || undefined,
      lifecycleEventId: lifecycleEventId || undefined,
      planItemId,
      nativeIdentifier: op.nativeIdentifier || undefined,
      attributes: op.attributes || {},
      attributesChanged: op.attributesChanged || undefined,
      entitlement: op.entitlement || undefined,
      executionClass: EXECUTION_CLASS.EXECUTABLE,
      genericPlan: true,
    };

    return {
      updateOne: {
        filter: { requestId: request._id, planItemId },
        update: {
          $setOnInsert: {
            planId: plan._id,
            requestId: request._id,
            applicationId,
            operationType: op.operationType,
            planItemId,
            lifecycleEventId: lifecycleEventId || undefined,
            jmlCorrelationId: jmlCorrelationId || undefined,
            dependsOnPlanItemIds: op.dependsOnPlanItemIds || [],
            sequence: op.sequence ?? 0,
            targetAttributes,
            status: "PENDING",
            nextAttemptAt: new Date(),
            retryCount: 0,
            maxRetries: 3,
            ...(approvedBy && toOid(approvedBy)
              ? { createdBy: toOid(approvedBy) }
              : {}),
          },
        },
        upsert: true,
      },
    };
  });

  let upsertResult = { upsertedCount: 0, matchedCount: 0 };
  if (upserts.length) {
    upsertResult = await ProvisioningTask.bulkWrite(upserts, { ordered: false });
  }

  const tasks = await ProvisioningTask.find({
    requestId: request._id,
    planItemId: { $in: withDeps.map((op) => String(op.itemKey)) },
  })
    .select("_id planItemId applicationId operationType status")
    .lean();

  // Re-materialization is idempotent and must not regress terminal rollup.
  if (!preserveTerminalMaterializationStatus(request.status, "request")) {
    request.status = "IN_PROGRESS";
  }
  request.approvalStatus = "APPROVED";
  request.approvedAt = request.approvedAt || new Date();
  if (approvedBy && toOid(approvedBy)) {
    request.approvedBy = toOid(approvedBy);
  }
  request.metadata = {
    ...(request.metadata || {}),
    genericPlan: true,
    planId: String(plan._id),
    materializedTaskCount: tasks.length,
    materializedAt: new Date().toISOString(),
    blockedOnRematerialize:
      blockedOnRematerialize.length > 0 ? blockedOnRematerialize : undefined,
  };
  await request.save();

  if (!preserveTerminalMaterializationStatus(plan.status, "plan")) {
    plan.status = "EXECUTING";
  }
  plan.metadata = {
    ...(plan.metadata || {}),
    materializedAt: new Date().toISOString(),
    materializedTaskCount: tasks.length,
    taskMaterializationDeferred: false,
    nonExecutablePreserved: operations
      .filter((op) => op?.executionClass && op.executionClass !== EXECUTION_CLASS.EXECUTABLE)
      .map((op) => ({
        itemKey: op.itemKey,
        executionClass: op.executionClass,
        reasonCode: op.reasonCode,
      })),
  };
  await plan.save();

  console.log(
    "[materialize] TASKS_MATERIALIZED",
    JSON.stringify({
      planId: String(plan._id),
      requestId: String(request._id),
      taskCount: tasks.length,
      upserted: upsertResult.upsertedCount || 0,
      matched: upsertResult.matchedCount || 0,
      jmlCorrelationId,
      lifecycleEventId,
      executionId,
    }),
  );

  return {
    success: true,
    planId: String(plan._id),
    provisioningRequestId: String(request._id),
    taskIds: tasks.map((t) => String(t._id)),
    tasks: tasks.map((t) => ({
      taskId: String(t._id),
      planItemId: t.planItemId,
      applicationId: String(t.applicationId),
      operationType: t.operationType,
      status: t.status,
    })),
    materializedCount: tasks.length,
    preservedNonExecutable: (plan.metadata?.nonExecutablePreserved || []).length,
    blockedOnRematerialize,
  };
}
