import { v4 as uuidv4 } from "uuid";
import env from "../../config/env.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";
import { buildTriggerFromReviewItem } from "./workflowRevokeService.js";

export { buildTriggerFromReviewItem };

const DEFAULT_VERIFY_INTERVAL_MS = Number(
  process.env.CERT_REVOKE_VERIFY_INTERVAL_MS || 24 * 60 * 60 * 1000,
);

/** Classify failed runs for the remediation dashboard (revoke vs verify vs generic). */
export function deriveFailureReason(run) {
  if (!run || run.status !== "FAILED") return null;

  const steps = run.steps || [];
  const revoke = steps.find((s) => s.type === "RevokeAccess");
  const verify = steps.find((s) => s.type === "VerifyAccessRemoved");
  const endedFailure = steps.some((s) => s.type === "EndFailure");

  if (revoke?.status === "FAILED") {
    return {
      code: "REVOKE_FAILED",
      label: "Provisioning Request Failed",
      detail:
        revoke.output?.error ||
        "IGA could not queue the provisioning request to remove this entitlement",
    };
  }

  if (verify?.output?.verificationStatus === "VERIFICATION_FAILED") {
    return {
      code: "VERIFY_FAILED",
      label: "Access Verification Failed",
      detail:
        verify.output?.verificationReason ||
        verify.error ||
        "Could not verify entitlement removal — missing context or connector lookup failed",
    };
  }

  if (verify?.output?.stillPresent === true) {
    const hasItsmTicket = steps.some(
      (s) => s.type === "CreateTicket" && s.status === "SUCCESS",
    );
    return {
      code: "VERIFY_STILL_PRESENT",
      label: "Access Still Present",
      detail: hasItsmTicket
        ? "The entitlement is still visible on the identity account after the ITSM ticket was closed"
        : "The entitlement is still visible on the identity account — IAM was notified for manual remediation",
    };
  }

  if (endedFailure) {
    return {
      code: "WORKFLOW_FAILURE",
      label: "Remediation Failed",
      detail: run.error || "Workflow ended on the failure branch",
    };
  }

  return {
    code: "ENGINE_ERROR",
    label: "Workflow Engine Error",
    detail: run.error || "Workflow execution failed before completing",
  };
}

/** Wait reason + UI hint for parked (WAITING) runs. */
function deriveWaitMeta(run, { existingTicketId } = {}) {
  const steps = run.steps || [];
  const hasTicket =
    steps.some((s) => s.type === "CreateTicket" && s.status === "SUCCESS") ||
    Boolean(existingTicketId);
  return {
    waitReason: hasTicket ? "ITSM" : "VERIFICATION",
  };
}

function deriveStatusBullets(run) {
  if (run.status === "SKIPPED") {
    return [run.skipReason || "Skipped by trigger filter"];
  }
  const steps = run.steps || [];
  const byType = (t) => steps.filter((s) => s.type === t);
  const bullets = [];

  const verify = byType("VerifyAccessRemoved")[0];
  if (verify) {
    bullets.push(
      verify.output?.stillPresent
        ? "Access still present on identity account"
        : "Verified access removed from identity account",
    );
  }

  const revokes = byType("RevokeAccess");
  if (revokes.length) {
    const allOk = revokes.every((s) => s.status === "SUCCESS");
    bullets.push(
      allOk
        ? "Provisioning request queued to remove access"
        : "Provisioning request could not be queued",
    );
  }

  if (byType("CreateTicket").length) {
    bullets.push("ITSM ticket open — awaiting removal");
  }

  for (const s of byType("SendEmail")) {
    bullets.push(`Notified: ${s.label}`);
  }

  const failure = deriveFailureReason(run);
  if (failure) {
    bullets.push(failure.label);
  } else if (run.status === "SUCCESS") {
    bullets.push("Completed — access removed");
  } else if (run.status === "WAITING") {
    bullets.push("Waiting on provisioning / ITSM — re-verification scheduled");
  } else {
    bullets.push(run.status);
  }
  return bullets;
}

async function syncReviewItemStatus({
  reviewItemId,
  entitlementName,
  workflowId,
  executionId,
  status,
}) {
  if (!reviewItemId) return;
  try {
    const provisioningStatus =
      status === "COMPLETED" ? "EXECUTED" : status === "FAILED" ? "FAILED" : "PENDING";
    const remediationStatus =
      status === "RUNNING" ? "RUNNING" : status === "PENDING" ? "PENDING" : status;

    if (entitlementName) {
      const nameLower = entitlementName.trim().toLowerCase();
      const item = await ReviewItem.findById(reviewItemId).select("entitlementDecisions").lean();
      const idx = (item?.entitlementDecisions || []).findIndex(
        (ed) => String(ed.entitlementName || "").trim().toLowerCase() === nameLower,
      );
      if (idx === -1) return;

      const prefix = `entitlementDecisions.${idx}`;
      await ReviewItem.updateOne(
        { _id: reviewItemId },
        {
          $set: {
            [`${prefix}.remediationWorkflowId`]: workflowId,
            [`${prefix}.remediationExecutionId`]: executionId,
            [`${prefix}.remediationStatus`]: remediationStatus,
            [`${prefix}.provisioningStatus`]: provisioningStatus,
          },
        },
      );
    } else {
      await ReviewItem.updateOne(
        { _id: reviewItemId },
        {
          $set: {
            remediationWorkflowId: workflowId,
            remediationExecutionId: executionId,
            remediationStatus: remediationStatus,
            provisioningStatus: provisioningStatus,
          },
        },
      );
    }
  } catch (err) {
    console.warn("[workflowDispatcher] ReviewItem status sync failed:", err.message);
  }
}

/**
 * Create an execution row for a revoked entitlement and run it asynchronously.
 * Returns the created execution (PENDING) immediately so the API responds fast.
 */
export async function enqueueRevokeExecution({
  tenantId,
  workflowId,
  reviewItem,
  entitlementName = null,
  campaignName = "",
  eventOwner = "system",
}) {
  if (!workflowId || !reviewItem) return null;
  const workflow = await getWorkflowById(workflowId, tenantId);
  if (!workflow) return null;

  const trigger = await buildTriggerFromReviewItem(
    reviewItem,
    entitlementName,
    campaignName,
    tenantId,
  );
  const executionId = uuidv4();

  const execution = await RemediationWorkflowExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    executionId,
    eventType: "ACCESS_REVOKE",
    eventName: trigger.entitlementName || reviewItem.itemName,
    workflowId,
    workflowName: workflow.name,
    campaignId: trigger.campaignId,
    campaignName,
    reviewItemId: String(reviewItem._id),
    entitlementName: trigger.entitlementName,
    applicationId: trigger.applicationId,
    applicationName: trigger.applicationName,
    identityId: trigger.identityId,
    identityName: trigger.identityName,
    eventOwner,
    status: "PENDING",
    stepStatuses: ["Queued"],
    triggerPayload: trigger,
    startedAt: new Date(),
  });

  await syncReviewItemStatus({
    reviewItemId: reviewItem._id,
    entitlementName,
    workflowId,
    executionId,
    status: "PENDING",
  });

  // Fire-and-forget; the request does not wait for the workflow to finish.
  runExecution(executionId).catch((err) =>
    console.error("[workflowDispatcher] runExecution failed:", err.message),
  );

  return execution.toObject ? execution.toObject() : execution;
}

/**
 * Run (or resume) a single execution through the workflow engine.
 *
 * resume modes:
 *   - false        : initial run from the trigger.
 *   - "verify"     : scheduled re-verification — resume from the checkpoint (verify node).
 *                    If access is removed the run completes; if still present it stays parked.
 *   - "itsm_closed": ITSM ticket closed — resume from the checkpoint with escalation enabled,
 *                    so a still-present entitlement escalates to IAM (FAILED) instead of waiting.
 *
 * Side-effecting steps (provisioning enqueue, ticket creation) are idempotent per execution,
 * so re-runs never duplicate requests or tickets.
 */
export async function runExecution(executionId, { resume = false } = {}) {
  const execution = await RemediationWorkflowExecution.findOne({ executionId });
  if (!execution) return null;

  const workflow = await getWorkflowById(execution.workflowId, execution.tenantId);
  if (!workflow) {
    execution.status = "FAILED";
    execution.error = "Workflow definition not found";
    execution.completedAt = new Date();
    await execution.save();
    return execution;
  }
  if (workflow.enabled === false) {
    execution.status = "SKIPPED";
    execution.stepStatuses = ["Workflow disabled — execution skipped"];
    execution.completedAt = new Date();
    await execution.save();
    await syncReviewItemStatus({
      reviewItemId: execution.reviewItemId,
      entitlementName: execution.entitlementName,
      workflowId: execution.workflowId,
      executionId,
      status: "SKIPPED",
    });
    return execution;
  }

  execution.status = "RUNNING";
  execution.currentNodeId = null;
  execution.currentNodeName = null;
  await execution.save();

  const onNodeProgress = async ({ nodeId, nodeName, status }) => {
    execution.currentNodeId = nodeId;
    execution.currentNodeName = nodeName;
    execution.currentStepLabel = nodeName;
    if (status === "RUNNING") {
      execution.status = "RUNNING";
    }
    await execution.save();
  };

  await syncReviewItemStatus({
    reviewItemId: execution.reviewItemId,
    entitlementName: execution.entitlementName,
    workflowId: execution.workflowId,
    executionId,
    status: "RUNNING",
  });

  const isResume = resume === true || resume === "verify" || resume === "itsm_closed";
  const escalate = resume === "itsm_closed";
  const startNodeId = isResume ? execution.checkpointNodeId || "verify" : undefined;

  // Escalation flag is transient — it steers the run without mutating the stored trigger.
  const triggerPayload = escalate
    ? { ...execution.triggerPayload, escalateOnStillPresent: true }
    : execution.triggerPayload;

  const adapter = createIgaAdapter({
    tenantId: execution.tenantId,
    executedBy: execution.eventOwner || "system",
    executionId,
    existingTicketId: execution.ticketEventId || null,
  });

  const run = await executeWorkflow(
    repairWorkflowDefinition(workflow),
    { trigger: triggerPayload },
    {
      adapter,
      tenantId: execution.tenantId,
      mode: "LIVE",
      executionId,
      persist: true,
      portalBaseUrl: env.frontendUrl,
      startNodeId,
      onNodeProgress,
    },
  );

  const sideEffects = run.sideEffects || {};
  const createdTicket = (sideEffects.ticketIds || [])[0] || execution.ticketEventId || null;
  const provisioningRequestId =
    (sideEffects.provisioningRequestIds || [])[0] || execution.provisioningRequestId || null;

  let status;
  if (run.status === "SKIPPED") status = "SKIPPED";
  else if (run.status === "SUCCESS") status = "COMPLETED";
  else if (run.status === "WAITING") status = "WAITING_ITSM";
  else status = "FAILED";

  execution.status = status;
  execution.runId = run.runId;
  if (run.runId && !(execution.runIds || []).includes(run.runId)) {
    execution.runIds = [...(execution.runIds || []), run.runId];
  }
  execution.ticketEventId = createdTicket;
  execution.provisioningRequestId = provisioningRequestId;
  execution.stepStatuses = deriveStatusBullets(run);
  execution.currentStepLabel =
    run.failedStepLabel || (run.steps || []).slice(-1)[0]?.label || execution.currentNodeName || null;
  execution.currentNodeId = run.failedStepId || execution.currentNodeId || null;
  execution.currentNodeName = run.failedStepLabel || execution.currentNodeName || null;
  execution.error = run.error || undefined;
  execution.errorMessage = run.error || undefined;
  execution.durationMs = run.durationMs ?? null;

  const failureReason = status === "FAILED" ? deriveFailureReason(run) : null;
  execution.failureReasonCode = failureReason?.code ?? null;
  execution.failureReasonLabel = failureReason?.label ?? null;
  execution.failureReasonDetail = failureReason?.detail ?? null;

  if (status === "WAITING_ITSM") {
    const { waitReason } = deriveWaitMeta(run, { existingTicketId: execution.ticketEventId });
    execution.waitReason = waitReason;
    execution.checkpointNodeId = "verify";
    execution.pollIntervalMs = execution.pollIntervalMs || DEFAULT_VERIFY_INTERVAL_MS;
    execution.nextPollAt = new Date(Date.now() + execution.pollIntervalMs);
    if (createdTicket && !execution.itsmTicketStatus) execution.itsmTicketStatus = "OPEN";
    else if (createdTicket && execution.itsmTicketStatus === "TICKET_CREATED") {
      execution.itsmTicketStatus = "OPEN";
    }
  } else {
    // Terminal outcome — stop scheduling re-verification.
    execution.waitReason = null;
    execution.nextPollAt = null;
    execution.completedAt = new Date();
  }

  await execution.save();

  await syncReviewItemStatus({
    reviewItemId: execution.reviewItemId,
    entitlementName: execution.entitlementName,
    workflowId: execution.workflowId,
    executionId,
    status,
  });

  return execution;
}
