/**
 * Enterprise access-revoke remediation pipeline (queue-first, scheduler-triggered).
 * Aligns with certification revoke → Global Rule Set → queue (NEW) → scheduler → workflow → REVOKED.
 */

export const ACCESS_REVOKE_PIPELINE = [
  {
    id: "decision",
    label: "Revoke decision",
    shortLabel: "Decision",
    description:
      "Manager confirms revoke on the certification review board. Entitlement status becomes Revoke in progress.",
  },
  {
    id: "enqueue",
    label: "Queue task",
    shortLabel: "Queued",
    description:
      "Global Rule Set maps ACCESS_REVOKE to a workflow. A queue record is created (status New). The workflow does not start on the revoke click.",
  },
  {
    id: "scheduler",
    label: "Scheduler pickup",
    shortLabel: "Scheduler",
    description:
      "Remediation scheduler runs on the tenant interval (minutes, hours, or days). It picks New tasks and marks them In progress.",
  },
  {
    id: "workflow",
    label: "Workflow execution",
    shortLabel: "Workflow",
    description:
      "Mapped workflow runs: create ITSM ticket with user and entitlement context, assign to queue, monitor until closed.",
  },
  {
    id: "complete",
    label: "Access revoked",
    shortLabel: "Revoked",
    description:
      "When the workflow completes, the queue task is marked Completed and the certification entitlement moves to Revoked.",
  },
];

/** Condensed steps for remediate confirmation modal (queue → scheduler → workflow). */
export const ACCESS_REVOKE_QUEUE_MODAL_PIPELINE = [
  { label: "Queued", hint: "Queue record created — status New" },
  { label: "Scheduler", hint: "Remediation scheduler tenant interval" },
  { label: "Workflow execution", hint: "Access revoke workflow runs on pickup" },
];

function hasStepLabel(task, fragment) {
  const needle = String(fragment || "").toLowerCase();
  return (task?.stepLog || []).some((s) =>
    String(s?.label || "").toLowerCase().includes(needle),
  );
}

function wasPickedUp(task) {
  return (
    hasStepLabel(task, "scheduler picked") ||
    hasStepLabel(task, "manual trigger picked") ||
    task?.context?.triggerMode === "manual"
  );
}

/** 0-based index of the active pipeline stage for a queue task. */
export function resolveAccessRevokePipelineIndex(task) {
  if (!task) return 0;

  if (task.status === "COMPLETED") return 4;
  if (task.status === "FAILED") return 3;

  if (
    task.executionStartedAt ||
    task.status === "WAITING" ||
    hasStepLabel(task, "workflow started") ||
    hasStepLabel(task, "workflow waiting")
  ) {
    return 3;
  }

  if (task.status === "IN_PROGRESS" || wasPickedUp(task)) {
    return 2;
  }

  // NEW — decision recorded and task queued; awaiting scheduler.
  return 1;
}

import { attachPipelineStageTiming } from "./pipelineStageTiming";

export function buildAccessRevokePipelineStages(task) {
  const activeIndex = resolveAccessRevokePipelineIndex(task);
  const failed = task?.status === "FAILED";

  const stages = ACCESS_REVOKE_PIPELINE.map((stage, index) => {
    let state = "upcoming";
    if (index < activeIndex) state = "done";
    else if (index === activeIndex) {
      if (failed && stage.id === "workflow") state = "failed";
      else if (task?.status === "COMPLETED" && stage.id === "complete") state = "done";
      else state = "active";
    } else if (task?.status === "COMPLETED") {
      state = "done";
    }

    return { ...stage, state };
  });

  return attachPipelineStageTiming(stages, task);
}
