import WorkflowTaskQueue from "../../models/workflowTaskQueue/WorkflowTaskQueue.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import { WORKFLOW_TASK_STATUS } from "../../constants/workflowTaskQueue.js";

/**
 * When IAM action-email SMTP fails permanently, stop the remediation event at Notify.
 * Do not leave the queue task WAITING / "awaiting IAM decision".
 */
export async function failRemediationOnWorkflowEmailDelivery({
  executionId,
  recipientEmail,
  errorMessage,
  orphanId,
} = {}) {
  if (!executionId) return { updated: false };

  const now = new Date();
  const shortError = String(errorMessage || "SMTP delivery failed").split("\n")[0].slice(0, 400);
  const label = `Email delivery failed → ${recipientEmail || "recipient"}`;

  const task = await WorkflowTaskQueue.findOne({
    executionId: String(executionId),
    status: {
      $in: [
        WORKFLOW_TASK_STATUS.WAITING,
        WORKFLOW_TASK_STATUS.IN_PROGRESS,
        WORKFLOW_TASK_STATUS.NEW,
      ],
    },
  })
    .select("taskId orphanId status")
    .lean();

  if (task) {
    await WorkflowTaskQueue.updateOne(
      { taskId: task.taskId },
      {
        $set: {
          status: WORKFLOW_TASK_STATUS.FAILED,
          failureReason: shortError,
        },
        $push: {
          stepLog: {
            label,
            status: "FAILED",
            at: now,
            detail: shortError,
          },
        },
      },
    );
  }

  await RemediationWorkflowExecution.updateOne(
    {
      executionId: String(executionId),
      status: { $in: ["WAITING", "RUNNING", "PENDING"] },
    },
    {
      $set: {
        status: "FAILED",
        waitReason: null,
        checkpointNodeId: null,
        nextPollAt: null,
        currentStepLabel: "Email delivery failed",
        error: shortError,
        completedAt: now,
      },
    },
  );

  const oid = orphanId || task?.orphanId;
  if (oid) {
    await OrphanAccount.updateOne(
      {
        _id: oid,
        workflowStatus: { $in: ["WAITING_IAM", "IN_PROGRESS", "PENDING"] },
      },
      {
        $set: {
          workflowStatus: "FAILED",
          currentStepLabel: "Email delivery failed",
          nextCheckAt: null,
        },
      },
    );
  }

  return { updated: Boolean(task) };
}
