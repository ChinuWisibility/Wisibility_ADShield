import env from "../../config/env.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import WorkflowTaskQueue from "../../models/workflowTaskQueue/WorkflowTaskQueue.js";
import {
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_TASK_STATUS,
} from "../../constants/workflowTaskQueue.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";
import { logOrphanIamTask } from "./orphanIamTaskLogger.js";
import { mergeIamOrphanStepStatuses } from "./orphanIamProgressTrace.js";
import { issueOrphanIamPortalUrl } from "./orphanIamPortalTokenService.js";
import { resolveIamCheckpointNodeId } from "./iamCheckpointNode.js";
import {
  enrichDecisionSource,
  decisionSourceToTriggerFields,
} from "./orphanIamDecisionSourceService.js";

const IAM_DECISIONS = new Set(["ASSIGN", "DELETE", "DISABLE", "IGNORE"]);

/**
 * Queue-first IAM orphan runs park on WorkflowTaskQueue without always having a
 * RemediationWorkflowExecution row. Resolve (or backfill) the waiting execution
 * so portal decisions can resume the workflow and clear the remediation event.
 */
async function resolveWaitingIamExecution({ orphanId, preferredExecutionId, tenantId, orphan }) {
  const oid = String(orphanId);

  if (preferredExecutionId) {
    const byExecId = await RemediationWorkflowExecution.findOne({
      executionId: String(preferredExecutionId),
      status: "WAITING",
    }).lean();
    if (byExecId) return byExecId;
  }

  const byOrphan = await RemediationWorkflowExecution.findOne({
    orphanId: oid,
    status: "WAITING",
  })
    .sort({ startedAt: -1 })
    .lean();
  if (byOrphan) return byOrphan;

  let queueTask = null;
  if (preferredExecutionId) {
    queueTask = await WorkflowTaskQueue.findOne({
      executionId: String(preferredExecutionId),
      status: WORKFLOW_TASK_STATUS.WAITING,
    }).lean();
  }
  if (!queueTask) {
    queueTask = await WorkflowTaskQueue.findOne({
      orphanId: oid,
      action: WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
      status: WORKFLOW_TASK_STATUS.WAITING,
    })
      .sort({ dateOfEntry: -1 })
      .lean();
  }
  if (!queueTask?.executionId || !queueTask.workflowId) return null;

  const existing = await RemediationWorkflowExecution.findOne({
    executionId: queueTask.executionId,
  }).lean();

  const triggerPayload =
    existing?.triggerPayload ||
    queueTask.context?.trigger ||
    {
      orphanId: oid,
      accountName: orphan?.accountName || null,
      applicationName: queueTask.applicationName || null,
      riskLevel: orphan?.riskLevel || "HIGH",
    };

  if (existing) {
    if (existing.status !== "WAITING" || !existing.orphanId) {
      await RemediationWorkflowExecution.updateOne(
        { executionId: queueTask.executionId },
        {
          $set: {
            status: "WAITING",
            waitReason: "IAM_DECISION",
            orphanId: oid,
            workflowId: existing.workflowId || queueTask.workflowId,
            workflowName: existing.workflowName || queueTask.workflowName,
            triggerPayload,
            runId: existing.runId || queueTask.runId || null,
          },
        },
      );
      return {
        ...existing,
        status: "WAITING",
        waitReason: "IAM_DECISION",
        orphanId: oid,
        workflowId: existing.workflowId || queueTask.workflowId,
        workflowName: existing.workflowName || queueTask.workflowName,
        triggerPayload,
        runId: existing.runId || queueTask.runId || null,
      };
    }
    return existing;
  }

  await RemediationWorkflowExecution.create({
    tenantId: queueTask.tenantId
      ? String(queueTask.tenantId)
      : tenantId
        ? String(tenantId)
        : null,
    executionId: queueTask.executionId,
    eventType: "IAM_ORPHAN_REVIEW",
    eventName: orphan?.accountName || queueTask.taskName,
    orphanId: oid,
    workflowId: queueTask.workflowId,
    workflowName: queueTask.workflowName,
    applicationName: queueTask.applicationName || triggerPayload.applicationName || null,
    eventOwner: queueTask.createdBy || "scheduler",
    status: "WAITING",
    waitReason: "IAM_DECISION",
    checkpointNodeId: "checkDecision",
    triggerPayload,
    runId: queueTask.runId || null,
    startedAt: queueTask.executionStartedAt || queueTask.dateOfEntry || new Date(),
  });

  return RemediationWorkflowExecution.findOne({ executionId: queueTask.executionId }).lean();
}

export async function recordOrphanIamDecisionAndResume({
  orphanId,
  decision,
  tenantId,
  decidedBy,
  decisionSource: decisionSourceInput,
}) {
  if (!IAM_DECISIONS.has(decision)) {
    return { ok: false, error: "Invalid decision. Use ASSIGN, DELETE, DISABLE, or IGNORE.", status: 400 };
  }

  const orphan = await OrphanAccount.findById(orphanId);
  if (!orphan) return { ok: false, error: "Orphan account not found", status: 404 };

  if (orphan.workflowStatus !== "WAITING_IAM") {
    return {
      ok: false,
      error: `Account is not awaiting IAM decision (status: ${orphan.workflowStatus || "none"})`,
      status: 400,
    };
  }

  if (orphan.iamDecision && orphan.iamDecision !== decision) {
    return {
      ok: false,
      error: `Decision already recorded as ${orphan.iamDecision}`,
      status: 409,
    };
  }

  const decisionSource = await enrichDecisionSource(decisionSourceInput || {}, { tenantId });
  const decidedAt = new Date();
  const alreadyDecided = Boolean(orphan.iamDecision);

  if (!alreadyDecided) {
    orphan.iamDecision = decision;
    orphan.status = "UNDER_REVIEW";
    orphan.iamDecisionMeta = {
      stepId: decisionSource.stepId || undefined,
      stepLabel: decisionSource.stepLabel || undefined,
      source: decisionSource.source || undefined,
      emailJobId: decisionSource.emailJobId || undefined,
      emailAuditId: decisionSource.emailAuditId || undefined,
      executionId: decisionSource.executionId || undefined,
      decidedAt,
      decidedBy: decidedBy || "iam-portal",
    };
    await orphan.save();
  }

  const preferredExecutionId =
    decisionSource.executionId || orphan.iamDecisionMeta?.executionId || orphan.workflowExecutionId || null;

  const execution = await resolveWaitingIamExecution({
    orphanId,
    preferredExecutionId,
    tenantId,
    orphan,
  });

  if (!execution?.executionId) {
    await logOrphanIamTask({
      tenantId: tenantId || null,
      taskName: "IAM_ORPHAN_DECISION",
      taskType: "TRIGGERED",
      status: "COMPLETED",
      orphanId,
      accountName: orphan.accountName,
      detail: `IAM decision recorded: ${decision} (no waiting workflow to resume)`,
      recordsProcessed: 1,
    });
    return { ok: true, resumed: false, message: "Decision saved; no waiting workflow execution to resume." };
  }

  const workflow = await getWorkflowById(execution.workflowId, tenantId);
  if (!workflow) {
    return { ok: false, error: "Workflow definition not found for execution", status: 404 };
  }

  const resumeNodeId = resolveIamCheckpointNodeId(workflow, execution.checkpointNodeId);
  if (!resumeNodeId) {
    return {
      ok: false,
      error:
        "Workflow has no IAM decision checkpoint (add an “IAM Decision Taken?” operator and link the “Decision taken” branch to your post-decision steps).",
      status: 422,
    };
  }

  const triggerPayload = {
    ...(execution.triggerPayload || {}),
    iamDecision: decision,
    orphanId: String(orphanId),
    ...decisionSourceToTriggerFields(decisionSource, decidedBy),
  };

  const adapter = createIgaAdapter({
    tenantId,
    executedBy: decidedBy || "iam-portal",
    executionId: execution.executionId,
  });

  const result = await executeWorkflow(
    repairWorkflowDefinition(workflow),
    { trigger: triggerPayload },
    {
      adapter,
      tenantId,
      executionId: execution.executionId,
      mode: "LIVE",
      persist: true,
      startNodeId: resumeNodeId,
      portalBaseUrl: env.frontendUrl,
      orphanIamPortalUrl: issueOrphanIamPortalUrl({
        orphanId,
        executionId: execution.executionId,
        tenantId,
      }),
      workflowFromEmail: env.workflow?.fromEmail,
    },
  );

  const finalStatus =
    result.status === "SUCCESS"
      ? "COMPLETED"
      : result.status === "WAITING"
        ? "WAITING_IAM"
        : "FAILED";

  const execUpdate = {
    status: result.status === "WAITING" ? "WAITING" : finalStatus,
    triggerPayload,
    runId: result.runId,
    stepStatuses: mergeIamOrphanStepStatuses(execution.stepStatuses, result, {
      ...execution,
      status: result.status === "WAITING" ? "WAITING" : finalStatus,
    }),
    currentStepLabel:
      finalStatus === "COMPLETED"
        ? `IAM decision: ${decision}`
        : (result.steps || []).slice(-1)[0]?.label || "Workflow resumed",
  };
  if (finalStatus === "COMPLETED") {
    execUpdate.waitReason = null;
    execUpdate.checkpointNodeId = null;
    execUpdate.nextPollAt = null;
    execUpdate.completedAt = new Date();
  }

  await RemediationWorkflowExecution.updateOne(
    { executionId: execution.executionId },
    { $set: execUpdate },
  );

  const orphanUpdate = {
    workflowStatus: finalStatus === "WAITING_IAM" ? "WAITING_IAM" : finalStatus,
    currentStepLabel:
      finalStatus === "COMPLETED"
        ? `IAM decision: ${decision}`
        : finalStatus === "WAITING_IAM"
          ? "Awaiting IAM Decision"
          : "Workflow Failed",
  };
  if (finalStatus === "COMPLETED") {
    orphanUpdate.nextCheckAt = null;
    orphanUpdate.reminderPhaseIndex = 0;
  }

  await OrphanAccount.updateOne({ _id: orphanId }, { $set: orphanUpdate });

  // Sync the queue task status so the UI reflects the actual workflow outcome.
  // The queue task was set to WAITING when WaitForIAMDecision paused — update it now.
  const queueTaskStatus =
    finalStatus === "COMPLETED"
      ? WORKFLOW_TASK_STATUS.COMPLETED
      : finalStatus === "FAILED"
        ? WORKFLOW_TASK_STATUS.FAILED
        : WORKFLOW_TASK_STATUS.WAITING;

  const queueTaskUpdate = {
    $set: { status: queueTaskStatus },
    $push: {
      stepLog: {
        label:
          finalStatus === "COMPLETED"
            ? `Decision: ${decision} — workflow completed`
            : finalStatus === "FAILED"
              ? `Decision: ${decision} — workflow failed`
              : `Decision: ${decision} — still awaiting follow-up`,
        status: queueTaskStatus,
        at: new Date(),
      },
    },
  };
  if (finalStatus === "COMPLETED") {
    queueTaskUpdate.$set.completedAt = new Date();
    queueTaskUpdate.$set.runId = result.runId || execution.runId || null;
  }

  let queueUpdated = await WorkflowTaskQueue.updateOne(
    { executionId: execution.executionId },
    queueTaskUpdate,
  );
  if (!queueUpdated.matchedCount) {
    await WorkflowTaskQueue.updateOne(
      { orphanId: String(orphanId), status: WORKFLOW_TASK_STATUS.WAITING },
      queueTaskUpdate,
    );
  }

  await logOrphanIamTask({
    tenantId: tenantId || execution.tenantId,
    taskName: "IAM_ORPHAN_DECISION",
    taskType: "TRIGGERED",
    status: finalStatus === "FAILED" ? "FAILED" : "COMPLETED",
    orphanId,
    executionId: execution.executionId,
    accountName: orphan.accountName,
    applicationName: execution.applicationName || execution.triggerPayload?.applicationName,
    detail:
      finalStatus === "COMPLETED"
        ? `IAM decision recorded: ${decision} via ${decisionSource.source || decisionSource.stepLabel || "portal"} · workflow completed`
        : finalStatus === "WAITING_IAM"
          ? `IAM decision recorded: ${decision} via ${decisionSource.source || "portal"} · still awaiting follow-up`
          : `IAM decision recorded: ${decision} · workflow resume failed`,
    recordsProcessed: 1,
  });

  return {
    ok: true,
    resumed: true,
    executionId: execution.executionId,
    resultStatus: result.status,
    decisionSource,
  };
}

/**
 * Heal queue-first IAM orphan tasks where a portal decision was saved but the
 * wait step never resumed (missing RemediationWorkflowExecution bridge).
 */
export async function healStuckIamOrphanDecision({ orphanId, tenantId, executionId } = {}) {
  if (!orphanId) return { healed: false, reason: "missing_orphan" };
  const orphan = await OrphanAccount.findById(orphanId)
    .select("iamDecision workflowStatus workflowExecutionId iamDecisionMeta")
    .lean();
  if (!orphan?.iamDecision || orphan.workflowStatus !== "WAITING_IAM") {
    return { healed: false, reason: "not_stuck" };
  }
  const result = await recordOrphanIamDecisionAndResume({
    orphanId,
    decision: orphan.iamDecision,
    tenantId,
    decidedBy: "system-heal",
    decisionSource: {
      source: orphan.iamDecisionMeta?.source || "system-heal",
      executionId: executionId || orphan.workflowExecutionId || orphan.iamDecisionMeta?.executionId || null,
    },
  });
  return {
    healed: Boolean(result.ok && result.resumed),
    result,
  };
}
