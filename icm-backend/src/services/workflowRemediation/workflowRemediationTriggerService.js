import { v4 as uuidv4 } from "uuid";
import ReviewItem from "../../models/certification/ReviewItem.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import Application from "../../models/application/Application.js";
import TaskExecution from "../../models/compliance/TaskExecution.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import env from "../../config/env.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_QUEUE_STATUS,
} from "../../constants/workflowRemediation.js";
import { getWorkflowById, getEnabledWorkflows } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";
import { enqueueRevokeExecution } from "../workflow/workflowDispatcher.js";
import { issueOrphanIamPortalUrl } from "../workflow/orphanIamPortalTokenService.js";
import { deriveIamOrphanStatusBullets } from "../workflow/orphanIamProgressTrace.js";
import {
  appendAudit,
  getEventDetail,
} from "./workflowRemediationEventService.js";

const TRIGGERABLE_STATUSES = new Set([
  WORKFLOW_REMEDIATION_QUEUE_STATUS.PENDING,
  WORKFLOW_REMEDIATION_QUEUE_STATUS.WITH_TICKET,
  WORKFLOW_REMEDIATION_QUEUE_STATUS.VALIDATED,
]);

const TRIGGER_TYPE_BY_EVENT = {
  [WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS]: "CertificationSignedOff",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT]: "UncorrelatedAccountIAMDecision",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER]: "MissingManagerDetected",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT]: "DormantAccountDetected",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION]: "SodViolationDetected",
};

async function triggerOrphanExecution({
  tenantId,
  orphan,
  workflow,
  actor = "system",
}) {
  const app = orphan.applicationId
    ? await Application.findById(orphan.applicationId).select("name").lean()
    : null;

  const triggerPayload = {
    orphanId: String(orphan._id),
    accountName: orphan.accountName,
    applicationId: orphan.applicationId ? String(orphan.applicationId) : null,
    applicationName: app?.name || null,
    riskLevel: orphan.riskLevel || "HIGH",
    detectedAt: orphan.detectedAt,
    status: orphan.status,
  };

  const executionId = uuidv4();
  const taskRecord = await TaskExecution.create({
    tenantId: tenantId ?? null,
    taskName: "IAM_ORPHAN_REVIEW",
    taskType: "TRIGGERED",
    status: "RUNNING",
    startedAt: new Date(),
    lockedBy: executionId,
    orphanId: String(orphan._id),
    executionId,
    accountName: orphan.accountName,
    applicationName: app?.name || null,
    detail: "Workflow triggered from remediation queue",
    createdBy: actor,
  });

  await RemediationWorkflowExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    executionId,
    eventType: "IAM_ORPHAN_REVIEW",
    eventName: orphan.accountName,
    orphanId: String(orphan._id),
    workflowId: workflow.id,
    workflowName: workflow.name,
    applicationId: orphan.applicationId ? String(orphan.applicationId) : null,
    eventOwner: actor,
    status: "PENDING",
    stepStatuses: ["Queued"],
    triggerPayload,
    startedAt: new Date(),
  });

  await OrphanAccount.updateOne(
    { _id: orphan._id },
    {
      $set: {
        workflowExecutionId: executionId,
        workflowStatus: "PENDING",
        currentStepLabel: "Queued",
      },
    },
  );

  const wfDef = await getWorkflowById(workflow.id, tenantId);
  const orphanIamPortalUrl = issueOrphanIamPortalUrl({
    orphanId: String(orphan._id),
    executionId,
    tenantId,
  });

  setImmediate(async () => {
    try {
      const adapter = createIgaAdapter({
        tenantId,
        executedBy: actor,
        executionId,
      });
      const result = await executeWorkflow(
        repairWorkflowDefinition(wfDef),
        { trigger: triggerPayload },
        {
          adapter,
          tenantId,
          executionId,
          mode: "LIVE",
          persist: true,
          portalBaseUrl: env.frontendUrl,
          orphanIamPortalUrl,
          workflowFromEmail: env.workflow.fromEmail,
        },
      );
      const finalStatus =
        result.status === "SUCCESS"
          ? "COMPLETED"
          : result.status === "WAITING"
            ? "WAITING_IAM"
            : "FAILED";
      const execPatch = {
        status: finalStatus === "WAITING_IAM" ? "WAITING" : finalStatus,
        runId: result.runId,
      };
      if (finalStatus === "WAITING_IAM") {
        execPatch.waitReason = "IAM_DECISION";
        execPatch.checkpointNodeId = "checkDecision";
      }
      if (finalStatus === "COMPLETED") {
        execPatch.completedAt = new Date();
        execPatch.waitReason = null;
        execPatch.checkpointNodeId = null;
        execPatch.nextPollAt = null;
      }
      const execAfter = await RemediationWorkflowExecution.findOne({ executionId })
        .select("nextPollAt reminderPhases reminderPhaseIndex startedAt")
        .lean();
      execPatch.stepStatuses = deriveIamOrphanStatusBullets(result, {
        ...execAfter,
        ...execPatch,
      });
      execPatch.currentStepLabel =
        (result.steps || []).slice(-1)[0]?.label ||
        (finalStatus === "WAITING_IAM" ? "Awaiting IAM Decision" : "Workflow finished");
      await RemediationWorkflowExecution.updateOne({ executionId }, { $set: execPatch });
      await TaskExecution.updateOne(
        { _id: taskRecord._id },
        {
          $set: {
            status: finalStatus === "WAITING_IAM" ? "COMPLETED" : finalStatus,
            completedAt: new Date(),
            durationMs: Date.now() - taskRecord.startedAt,
            detail:
              finalStatus === "WAITING_IAM"
                ? "IAM notified · awaiting decision"
                : finalStatus === "FAILED"
                  ? "Workflow failed"
                  : "Workflow finished",
          },
        },
      );
      if (finalStatus === "WAITING_IAM") {
        await OrphanAccount.updateOne(
          { _id: orphan._id },
          { $set: { workflowStatus: "WAITING_IAM", currentStepLabel: "Awaiting IAM Decision" } },
        );
      } else if (finalStatus === "COMPLETED") {
        await OrphanAccount.updateOne(
          { _id: orphan._id },
          {
            $set: {
              workflowStatus: "COMPLETED",
              currentStepLabel: "Workflow Complete",
              nextCheckAt: null,
            },
          },
        );
      } else if (finalStatus === "FAILED") {
        await OrphanAccount.updateOne(
          { _id: orphan._id },
          { $set: { workflowStatus: "FAILED", currentStepLabel: "Workflow Failed" } },
        );
      }
    } catch (err) {
      console.error("[workflowRemediationTrigger] orphan execution failed:", err.message);
      await OrphanAccount.updateOne(
        { _id: orphan._id },
        { $set: { workflowStatus: "FAILED", currentStepLabel: "Workflow Error" } },
      );
      await TaskExecution.updateOne(
        { _id: taskRecord._id },
        { $set: { status: "FAILED", errorMessage: err.message, completedAt: new Date() } },
      );
    }
  });

  return { executionId, taskId: String(taskRecord._id) };
}

export async function triggerWorkflowForEvent(tenantId, eventId, workflowId, actor = "system") {
  const { event, items } = await getEventDetail(eventId, tenantId);

  if (!TRIGGERABLE_STATUSES.has(event.queueStatus)) {
    throw new AppError(
      `Cannot trigger workflow while event is in status ${event.queueStatus}`,
      400,
    );
  }

  const workflowIdToUse = workflowId || event.selectedWorkflowId || event.workflowId;
  let workflow = workflowIdToUse ? await getWorkflowById(workflowIdToUse, tenantId) : null;

  if (!workflow && !event.selectedWorkflowId) {
    const triggerType = TRIGGER_TYPE_BY_EVENT[event.eventType];
    const enabled = triggerType ? await getEnabledWorkflows(tenantId, triggerType) : [];
    workflow = enabled[0] || null;
  }

  if (!workflow) {
    throw new AppError(
      event.selectedWorkflowId
        ? "Selected workflow is no longer available"
        : "No workflow found for this event type",
      422,
    );
  }

  const executionIds = [];

  if (event.eventType === WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS) {
    for (const item of items) {
      const reviewItemId = item.sourceRef || item.metadata?.reviewItemId;
      if (!reviewItemId) continue;
      const ri = await ReviewItem.findById(reviewItemId).lean();
      if (!ri) continue;
      const exec = await enqueueRevokeExecution({
        tenantId,
        workflowId: workflow.id,
        reviewItem: ri,
        entitlementName: item.entitlementName || null,
        campaignName: event.campaignName || "",
        eventOwner: actor,
      });
      if (exec?.executionId) executionIds.push(exec.executionId);
    }
  } else if (event.eventType === WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT) {
    for (const item of items) {
      const orphanId = item.sourceRef || item.metadata?.orphanId;
      if (!orphanId) continue;
      const orphan = await OrphanAccount.findById(orphanId).lean();
      if (!orphan) continue;
      const result = await triggerOrphanExecution({
        tenantId,
        orphan,
        workflow,
        actor,
      });
      if (result?.executionId) executionIds.push(result.executionId);
    }
  } else {
    const triggerPayload = {
      eventId: event.eventId,
      eventType: event.eventType,
      applicationId: event.applicationId,
      applicationName: event.applicationName,
      subjects: items.map((i) => ({
        userId: i.userId,
        accountId: i.accountId,
        identityName: i.identityName,
        entitlementName: i.entitlementName,
      })),
      metadata: event.metadata,
    };

    const executionId = uuidv4();
    await RemediationWorkflowExecution.create({
      tenantId: tenantId ? String(tenantId) : null,
      executionId,
      eventType: event.eventType,
      eventName: event.applicationName || event.eventType,
      workflowId: workflow.id,
      workflowName: workflow.name,
      applicationId: event.applicationId,
      applicationName: event.applicationName,
      eventOwner: actor,
      status: "PENDING",
      stepStatuses: ["Queued"],
      triggerPayload,
      startedAt: new Date(),
    });

    const wfDef = await getWorkflowById(workflow.id, tenantId);
    setImmediate(async () => {
      try {
        const adapter = createIgaAdapter({
          tenantId,
          executedBy: actor,
          executionId,
        });
        await executeWorkflow(
          repairWorkflowDefinition(wfDef),
          { trigger: triggerPayload },
          {
            adapter,
            tenantId,
            executionId,
            mode: "LIVE",
            persist: true,
          },
        );
      } catch (err) {
        console.error("[workflowRemediationTrigger] generic execution failed:", err.message);
      }
    });
    executionIds.push(executionId);
  }

  if (!executionIds.length) {
    throw new AppError("No executions could be started for this event", 422);
  }

  await WorkflowRemediationEvent.updateOne(
    { eventId },
    {
      $set: {
        queueStatus: WORKFLOW_REMEDIATION_QUEUE_STATUS.VALIDATED,
        workflowId: workflow.id,
        workflowName: workflow.name,
        "metadata.executionIds": executionIds,
      },
    },
  );

  await appendAudit(eventId, "WORKFLOW_TRIGGERED", actor, {
    workflowId: workflow.id,
    workflowName: workflow.name,
    executionIds,
  });

  return {
    eventId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    executionIds,
  };
}

/**
 * Immediately launch a workflow for an existing WRQ event.
 * Auto-resolves the best workflow if workflowId is not specified.
 * This bypasses the scheduler polling delay — enterprise edition feature.
 */
export async function immediatelyLaunchEvent(tenantId, eventId, { workflowId, actor = "system" } = {}) {
  const { event } = await getEventDetail(eventId, tenantId);

  if (!TRIGGERABLE_STATUSES.has(event.queueStatus)) {
    throw new AppError(
      `Cannot launch: event is in status ${event.queueStatus}`,
      400,
    );
  }

  const resolvedWorkflowId =
    workflowId || event.selectedWorkflowId || event.workflowId;

  let wfId = resolvedWorkflowId;
  if (!wfId) {
    const triggerType = TRIGGER_TYPE_BY_EVENT[event.eventType];
    const enabled = triggerType ? await getEnabledWorkflows(tenantId, triggerType) : [];
    wfId = enabled[0]?.id || null;
  }

  if (!wfId) {
    throw new AppError(
      "No workflow available to launch for this event type. Configure or select a workflow first.",
      422,
    );
  }

  const result = await triggerWorkflowForEvent(tenantId, eventId, wfId, actor);

  await appendAudit(eventId, "IMMEDIATE_LAUNCH", actor, {
    workflowId: result.workflowId,
    workflowName: result.workflowName,
    executionIds: result.executionIds,
  });

  return {
    ...result,
    launchMode: "immediate",
  };
}
