import { nodeExecutionsToTimelineSteps } from "../persistence/nodeExecutionStore.js";

const WORKFLOW_STATUS_MAP = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  WAITING_ITSM: "RUNNING",
  WAITING_VERIFICATION: "RUNNING",
  COMPLETED: "SUCCESS",
  FAILED: "FAILED",
  SKIPPED: "CANCELLED",
};

export function mapWorkflowStatus(status) {
  return WORKFLOW_STATUS_MAP[status] || status;
}

export function formatWorkflowExecution(execution, { nodeExecutions = [] } = {}) {
  if (!execution) return null;

  const durationMs =
    execution.durationMs ??
    (execution.startedAt && execution.completedAt
      ? new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()
      : null);

  return {
    ...execution,
    id: execution.executionId,
    status: mapWorkflowStatus(execution.status),
    rawStatus: execution.status,
    startTime: execution.startedAt || execution.createdAt,
    endTime: execution.completedAt,
    duration: durationMs,
    durationMs,
    errorMessage: execution.errorMessage || execution.error,
    runIds: execution.runIds || [],
    nodeExecutions,
    nodeTimeline: nodeExecutionsToTimelineSteps(nodeExecutions),
  };
}
