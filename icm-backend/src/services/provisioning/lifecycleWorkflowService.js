/**
 * Lifecycle CREATE/UPDATE/DISABLE workflows — same graph engine as Joiner/remediation.
 */

import { randomUUID } from "crypto";
import env from "../../config/env.js";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";

export const LIFECYCLE_WORKFLOW_NAMES = Object.freeze({
  JOINER: "Joiner Provision — Approval",
  CREATE: "Lifecycle CREATE Account — Approval",
  UPDATE: "Lifecycle UPDATE Account — Approval",
  DISABLE: "Lifecycle DISABLE Account — Approval",
});

function workflowNameFor({ requestType, operationType }) {
  if (requestType === "JOINER" || operationType === "ADD_ACCOUNT") {
    return LIFECYCLE_WORKFLOW_NAMES.JOINER;
  }
  if (requestType === "MOVER" || operationType === "UPDATE_ACCOUNT") {
    return LIFECYCLE_WORKFLOW_NAMES.UPDATE;
  }
  if (requestType === "LEAVER" || operationType === "DISABLE") {
    return LIFECYCLE_WORKFLOW_NAMES.DISABLE;
  }
  return LIFECYCLE_WORKFLOW_NAMES.UPDATE;
}

async function resolveWorkflowDefinition(name, tenantId) {
  if (tenantId) {
    const tenantWorkflow = await RemediationWorkflowDefinition.findOne({
      name,
      tenantId: String(tenantId),
    }).lean();
    if (tenantWorkflow) return tenantWorkflow;
  }

  const byName = await RemediationWorkflowDefinition.findOne({
    name,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
  if (byName) return byName;

  // Fallback: Joiner template for CREATE-compatible graphs
  if (name !== LIFECYCLE_WORKFLOW_NAMES.JOINER) {
    if (tenantId) {
      const tenantJoinerWorkflow = await RemediationWorkflowDefinition.findOne({
        name: LIFECYCLE_WORKFLOW_NAMES.JOINER,
        tenantId: String(tenantId),
      }).lean();
      if (tenantJoinerWorkflow) return tenantJoinerWorkflow;
    }
    return RemediationWorkflowDefinition.findOne({
      name: LIFECYCLE_WORKFLOW_NAMES.JOINER,
      $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
    }).lean();
  }
  return null;
}

export async function startLifecycleProvisionWorkflow({
  tenantId,
  identityId,
  applicationId,
  applicationName,
  provisioningRequestId,
  requestType,
  operationType,
  jmlCorrelationId,
  ruleId,
  ruleName,
  triggerExtras = {},
}) {
  const name = workflowNameFor({ requestType, operationType });
  const def = await resolveWorkflowDefinition(name, tenantId);
  if (!def) {
    console.warn(
      "[lifecycle] WORKFLOW_MISSING — template not seeded; approval via API still works",
      name,
    );
    return { executionId: null, warning: "LIFECYCLE_WORKFLOW_NOT_SEEDED" };
  }

  const executionId = randomUUID();
  const workflowId = String(def._id || def.id);
  const eventType =
    requestType === "JOINER"
      ? "JOINER"
      : requestType === "LEAVER"
        ? "LEAVER"
        : requestType === "MOVER"
          ? "MOVER"
          : "LIFECYCLE";

  const triggerPayload = {
    lifecycle: true,
    joiner: requestType === "JOINER",
    identityId: String(identityId),
    applicationId: String(applicationId),
    applicationName: applicationName || null,
    provisioningRequestId: String(provisioningRequestId),
    requestType,
    operationType,
    jmlCorrelationId: jmlCorrelationId || null,
    ruleId: ruleId ? String(ruleId) : null,
    ruleName: ruleName || null,
    approvalDecision: null,
    workflowTriggeredAt: new Date().toISOString(),
    ...triggerExtras,
  };

  await RemediationWorkflowExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    executionId,
    eventType,
    eventName: `${requestType} ${operationType} ${applicationName || applicationId}`,
    workflowId,
    workflowName: def.name,
    applicationName: applicationName || null,
    identityId: String(identityId),
    eventOwner: "lifecycle",
    status: "RUNNING",
    triggerPayload,
    checkpointNodeId: "checkDecision",
    startedAt: new Date(),
    provisioningRequestId: String(provisioningRequestId),
  });

  console.log(
    "[lifecycle] WORKFLOW_STARTED",
    JSON.stringify({
      executionId,
      requestType,
      operationType,
      provisioningRequestId: String(provisioningRequestId),
      jmlCorrelationId: jmlCorrelationId || null,
      note: "WORKFLOW_TRIGGERED (not target provisioning success)",
    }),
  );

  runLifecycleExecution(executionId).catch((err) =>
    console.warn("[lifecycle] workflow run failed:", err.message),
  );

  return { executionId, workflowId };
}

export async function runLifecycleExecution(executionId, { resume = false } = {}) {
  const execution = await RemediationWorkflowExecution.findOne({ executionId });
  if (!execution) throw new Error(`Lifecycle execution not found: ${executionId}`);

  const workflow = await getWorkflowById(execution.workflowId, execution.tenantId);
  if (!workflow) throw new Error(`Lifecycle workflow definition missing: ${execution.workflowId}`);

  execution.status = "RUNNING";
  await execution.save();

  const adapter = createIgaAdapter({
    tenantId: execution.tenantId,
    executedBy: execution.eventOwner || "lifecycle",
    executionId,
  });

  const startNodeId = resume ? execution.checkpointNodeId || "checkDecision" : undefined;

  const run = await executeWorkflow(
    repairWorkflowDefinition(workflow),
    { trigger: execution.triggerPayload || {} },
    {
      adapter,
      tenantId: execution.tenantId,
      mode: "LIVE",
      executionId,
      persist: true,
      portalBaseUrl: env.frontendUrl,
      startNodeId,
    },
  );

  let status;
  if (run.status === "SKIPPED") status = "SKIPPED";
  else if (run.status === "SUCCESS") status = "COMPLETED";
  else if (run.status === "WAITING") status = "WAITING";
  else if (run.status === "FAILED" || run.status === "FAILURE") status = "FAILED";
  else status = execution.status;

  execution.status = status;
  execution.waitReason =
    status === "WAITING"
      ? "LIFECYCLE_APPROVAL"
      : undefined;
  execution.checkpointNodeId =
    status === "WAITING" ? "checkDecision" : execution.checkpointNodeId || "checkDecision";
  execution.error = run.error || undefined;
  if (status === "COMPLETED" || status === "FAILED") {
    execution.completedAt = new Date();
  }
  await execution.save();
  return run;
}

/**
 * Record approval/rejection and resume lifecycle workflow (CREATE/UPDATE/DISABLE).
 */
export async function decideLifecycleApproval({
  provisioningRequestId,
  decision,
  decidedBy,
  tenantId,
}) {
  const normalized = String(decision || "").toUpperCase();
  if (!["APPROVED", "REJECTED"].includes(normalized)) {
    return { ok: false, error: "decision must be APPROVED or REJECTED", status: 400 };
  }

  const ProvisioningRequest = (await import("../../models/provisioning/ProvisioningRequest.js"))
    .default;
  const existing = await ProvisioningRequest.findById(provisioningRequestId).lean();
  if (!existing) return { ok: false, error: "Provisioning request not found", status: 404 };
  if (tenantId && existing.tenantId && String(existing.tenantId) !== String(tenantId)) {
    return { ok: false, error: "Tenant mismatch", status: 403 };
  }

  const claimSet = { approvalStatus: normalized };
  if (normalized === "REJECTED") {
    claimSet.status = "CANCELLED";
    claimSet.completedAt = new Date();
  } else {
    claimSet.status = "APPROVED";
    claimSet.approvedAt = new Date();
    if (decidedBy) claimSet.approvedBy = decidedBy;
  }
  if (decidedBy) claimSet.updatedBy = decidedBy;

  // Atomic claim: only one concurrent approval/rejection wins
  const claimed = await ProvisioningRequest.findOneAndUpdate(
    {
      _id: provisioningRequestId,
      approvalStatus: "PENDING",
      status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
    },
    { $set: claimSet },
    { new: true },
  );
  if (!claimed) {
    return {
      ok: false,
      error: `Request approvalStatus is ${existing.approvalStatus}`,
      status: 409,
    };
  }

  const executionId = claimed.metadata?.workflowExecutionId;
  if (!executionId) {
    if (normalized === "APPROVED") {
      if (claimed.metadata?.genericPlan && claimed.metadata?.planId) {
        const { materializeProvisioningTasks } = await import(
          "./taskMaterializationService.js"
        );
        const materialized = await materializeProvisioningTasks({
          planId: claimed.metadata.planId,
          approvedBy: decidedBy,
          tenantId,
        });
        return { ok: true, mode: "direct-generic", ...materialized };
      }
      const { compileLifecyclePlanAndTask } = await import("./lifecycleProvisioningService.js");
      const compiled = await compileLifecyclePlanAndTask({
        provisioningRequestId,
        approvedBy: decidedBy,
      });
      return { ok: true, mode: "direct", ...compiled };
    }
    return {
      ok: true,
      mode: "direct",
      success: true,
      provisioningRequestId: String(claimed._id),
    };
  }

  await RemediationWorkflowExecution.updateOne(
    { executionId },
    {
      $set: {
        "triggerPayload.approvalDecision": normalized,
        "triggerPayload.decidedBy": decidedBy ? String(decidedBy) : undefined,
      },
    },
  );

  console.log(
    "[lifecycle] APPROVAL",
    JSON.stringify({
      executionId,
      decision: normalized,
      provisioningRequestId,
      jmlCorrelationId: claimed.metadata?.jmlCorrelationId,
    }),
  );

  await runLifecycleExecution(executionId, { resume: true });
  return { ok: true, mode: "workflow", executionId, decision: normalized };
}
