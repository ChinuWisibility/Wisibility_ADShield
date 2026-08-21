export const IAM_ORPHAN_REVIEW_PIPELINE = [
  {
    id: "decision",
    label: "Remediate decision",
    shortLabel: "Decision",
    description: "Remediation started from Data Hygiene or Orphan Accounts.",
  },
  {
    id: "enqueue",
    label: "Queue task",
    shortLabel: "Queued",
    description: "Queue record created — workflow starts on scheduler pickup.",
  },
  {
    id: "scheduler",
    label: "Scheduler pickup",
    shortLabel: "Scheduler",
    description: "Scheduler picked up the task and marked it in progress.",
  },
  {
    id: "workflow",
    label: "Workflow execution",
    shortLabel: "Workflow",
    description: "Workflow running — IAM notified, reminders scheduled, awaiting decision.",
  },
  {
    id: "complete",
    label: "IAM decision recorded",
    shortLabel: "Complete",
    description: "IAM decision recorded — task completed.",
  },
];

/** Condensed steps for remediate confirmation modal (queue → scheduler → workflow). */
export const IAM_ORPHAN_QUEUE_MODAL_PIPELINE = [
  { label: "Queued", hint: "Queue record created — status New" },
  { label: "Scheduler", hint: "Remediation scheduler tenant interval" },
  { label: "Workflow execution", hint: "IAM review workflow runs on pickup" },
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

/** 0-based index of the active pipeline stage for an IAM orphan queue task. */
export function resolveIamOrphanReviewPipelineIndex(task) {
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

  return 1;
}

import { attachPipelineStageTiming } from "./pipelineStageTiming";

export function buildIamOrphanReviewPipelineStages(task) {
  const activeIndex = resolveIamOrphanReviewPipelineIndex(task);
  const failed = task?.status === "FAILED";

  const stages = IAM_ORPHAN_REVIEW_PIPELINE.map((stage, index) => {
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
