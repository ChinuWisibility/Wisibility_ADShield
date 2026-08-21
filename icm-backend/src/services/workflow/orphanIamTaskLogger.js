import TaskExecution from "../../models/compliance/TaskExecution.js";

/**
 * Records auditable task rows for IAM orphan workflow activity (trigger, reminders, decisions).
 * Mirrors certification reminder tracking so operators can see what ran and when.
 */
export async function logOrphanIamTask({
  tenantId = null,
  taskName,
  taskType = "SCHEDULED",
  status = "COMPLETED",
  orphanId = null,
  executionId = null,
  accountName = null,
  applicationName = null,
  detail = null,
  errorMessage = null,
  recordsProcessed = null,
  startedAt = new Date(),
  completedAt = null,
  durationMs = null,
  createdBy = null,
}) {
  const done = completedAt || (status !== "RUNNING" ? new Date() : null);
  const duration =
    durationMs != null
      ? durationMs
      : done && startedAt
        ? done.getTime() - new Date(startedAt).getTime()
        : null;

  return TaskExecution.create({
    tenantId: tenantId || undefined,
    taskName,
    taskType,
    status,
    orphanId: orphanId ? String(orphanId) : null,
    executionId: executionId ? String(executionId) : null,
    accountName: accountName || null,
    applicationName: applicationName || null,
    detail: detail || null,
    errorMessage: errorMessage || null,
    recordsProcessed,
    startedAt,
    completedAt: done,
    durationMs: duration,
    lockedBy: executionId ? String(executionId) : null,
    createdBy: createdBy || undefined,
  });
}

export async function updateOrphanIamTask(taskId, patch) {
  if (!taskId) return null;
  return TaskExecution.updateOne({ _id: taskId }, { $set: patch });
}
