/**
 * Joiner workflow start / approval resume — uses remediation workflow engine.
 * Approval is always required for Joiner MVP (no approvalRequired branching).
 */

import { randomUUID } from "crypto";
import env from "../../config/env.js";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";

export const JOINER_WORKFLOW_NAME = "Joiner Provision — Approval";

async function resolveJoinerWorkflowDefinition(tenantId) {
  if (tenantId) {
    const tenantWorkflow = await RemediationWorkflowDefinition.findOne({
      tenantId: String(tenantId),
      name: JOINER_WORKFLOW_NAME,
    }).lean();
    if (tenantWorkflow) return tenantWorkflow;
    const taggedTenantWorkflow = await RemediationWorkflowDefinition.findOne({
      tenantId: String(tenantId),
      tags: "JOINER",
    }).lean();
    if (taggedTenantWorkflow) return taggedTenantWorkflow;
  }

  const byName = await RemediationWorkflowDefinition.findOne({
    name: JOINER_WORKFLOW_NAME,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
  if (byName) return byName;

  return RemediationWorkflowDefinition.findOne({
    enabled: true,
    tags: "JOINER",
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
}

/**
 * Start Joiner approval workflow for a provisioning request.
 */
export async function startJoinerWorkflow({
  tenantId,
  identityId,
  applicationId,
  applicationName,
  provisioningRequestId,
  ruleId,
  ruleName,
  jmlCorrelationId,
}) {
  const def = await resolveJoinerWorkflowDefinition(tenantId);
  if (!def) {
    console.warn(
      "[joiner] WORKFLOW_MISSING — Joiner template not seeded; request left PENDING approval via API",
    );
    return { executionId: null, warning: "JOINER_WORKFLOW_NOT_SEEDED" };
  }

  const executionId = randomUUID();
  const workflowId = String(def._id || def.id);
  const triggerPayload = {
    joiner: true,
    identityId: String(identityId),
    applicationId: String(applicationId),
    applicationName: applicationName || null,
    provisioningRequestId: String(provisioningRequestId),
    ruleId: ruleId ? String(ruleId) : null,
    ruleName: ruleName || null,
    jmlCorrelationId: jmlCorrelationId || null,
    approvalDecision: null,
  };

  await RemediationWorkflowExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    executionId,
    eventType: "JOINER",
    eventName: `Joiner ${applicationName || applicationId}`,
    workflowId,
    workflowName: def.name,
    applicationName: applicationName || null,
    eventOwner: "joiner",
    status: "RUNNING",
    triggerPayload,
    checkpointNodeId: "checkDecision",
    startedAt: new Date(),
  });

  console.log(
    "[joiner] WORKFLOW_STARTED",
    JSON.stringify({
      executionId,
      provisioningRequestId: String(provisioningRequestId),
      jmlCorrelationId: jmlCorrelationId || null,
    }),
  );

  runJoinerExecution(executionId).catch((err) =>
    console.warn("[joiner] workflow run failed:", err.message),
  );

  return { executionId, workflowId };
}

export async function runJoinerExecution(executionId, { resume = false } = {}) {
  const execution = await RemediationWorkflowExecution.findOne({ executionId });
  if (!execution) throw new Error(`Joiner execution not found: ${executionId}`);

  const workflow = await getWorkflowById(execution.workflowId, execution.tenantId);
  if (!workflow) throw new Error(`Joiner workflow definition missing: ${execution.workflowId}`);

  execution.status = "RUNNING";
  await execution.save();

  const adapter = createIgaAdapter({
    tenantId: execution.tenantId,
    executedBy: execution.eventOwner || "joiner",
    executionId,
  });

  const startNodeId = resume
    ? execution.checkpointNodeId || "checkDecision"
    : undefined;

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
  execution.waitReason = status === "WAITING" ? "JOINER_APPROVAL" : undefined;
  execution.checkpointNodeId =
    status === "WAITING"
      ? "checkDecision"
      : execution.checkpointNodeId || "checkDecision";
  execution.error = run.error || undefined;
  if (status === "COMPLETED" || status === "FAILED") {
    execution.completedAt = new Date();
  }
  await execution.save();

  return run;
}

/**
 * Record approval/rejection and resume Joiner workflow.
 */
/** @deprecated Prefer decideLifecycleApproval — kept for harness/back-compat with atomic claim. */
export async function decideJoinerApproval(args) {
  const { decideLifecycleApproval } = await import("./lifecycleWorkflowService.js");
  return decideLifecycleApproval(args);
}
