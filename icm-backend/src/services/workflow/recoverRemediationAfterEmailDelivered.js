import WorkflowTaskQueue from "../../models/workflowTaskQueue/WorkflowTaskQueue.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import EmailJob from "../../models/email/EmailJob.js";
import { WORKFLOW_TASK_STATUS } from "../../constants/workflowTaskQueue.js";
import { resolveIamCheckpointNodeId } from "./iamCheckpointNode.js";
import { getWorkflowById } from "../../workflows/persistence/workflowStore.js";

/**
 * If action email later delivered successfully after an SMTP fail-fast,
 * park the remediation event back on Wait (awaiting IAM decision) instead
 * of leaving it Failed forever.
 */
export async function recoverRemediationAfterEmailDelivered({
  task,
  tenantId,
} = {}) {
  if (!task?.executionId) return { recovered: false, reason: "missing_execution" };
  if (task.status !== WORKFLOW_TASK_STATUS.FAILED) {
    return { recovered: false, reason: "not_failed" };
  }

  const emailJob = await EmailJob.findOne({
    type: "WORKFLOW",
    "metadata.executionId": String(task.executionId),
    status: "SENT",
  })
    .sort({ sentAt: -1, createdAt: -1 })
    .select("recipientEmail sentAt subject")
    .lean();

  if (!emailJob) return { recovered: false, reason: "email_not_sent" };

  const failure = String(task.failureReason || "").toLowerCase();
  const looksLikeEmailFailure =
    failure.includes("smtp") ||
    failure.includes("email") ||
    failure.includes("badcredentials") ||
    failure.includes("invalid login") ||
    failure.includes("send email");
  if (!looksLikeEmailFailure && task.failureReason) {
    // Still allow recovery when Notify failed and mail is now SENT.
    const hasEmailFailLog = (task.stepLog || []).some((s) =>
      /email delivery failed|send email failed|workflow failed/i.test(String(s?.label || "")),
    );
    if (!hasEmailFailLog) return { recovered: false, reason: "not_email_failure" };
  }

  const now = new Date();
  let checkpointNodeId = "checkDecision";
  try {
    const workflow = await getWorkflowById(task.workflowId, tenantId || task.tenantId);
    checkpointNodeId = resolveIamCheckpointNodeId(workflow) || checkpointNodeId;
  } catch {
    /* keep default */
  }

  await WorkflowTaskQueue.updateOne(
    { taskId: task.taskId },
    {
      $set: {
        status: WORKFLOW_TASK_STATUS.WAITING,
        failureReason: null,
      },
      $push: {
        stepLog: {
          label: `Email delivered → ${emailJob.recipientEmail} — awaiting IAM decision`,
          status: "WAITING",
          at: now,
          detail: emailJob.subject || null,
        },
      },
    },
  );

  await RemediationWorkflowExecution.updateOne(
    { executionId: String(task.executionId) },
    {
      $set: {
        status: "WAITING",
        waitReason: "IAM_DECISION",
        checkpointNodeId,
        currentStepLabel: "Awaiting IAM Decision",
        error: null,
        completedAt: null,
        nextPollAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
    },
    { upsert: false },
  );

  if (task.orphanId) {
    await OrphanAccount.updateOne(
      { _id: task.orphanId },
      {
        $set: {
          workflowStatus: "WAITING_IAM",
          currentStepLabel: "Awaiting IAM decision",
          workflowExecutionId: String(task.executionId),
        },
      },
    );
  }

  return {
    recovered: true,
    to: emailJob.recipientEmail,
    sentAt: emailJob.sentAt,
  };
}
