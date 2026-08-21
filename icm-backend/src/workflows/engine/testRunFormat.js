const EXECUTION_STATUSES = new Set([
  "SUCCESS",
  "FAILED",
  "RUNNING",
  "PENDING",
  "SKIPPED",
  "CANCELLED",
]);

function normalizeStepStatus(status) {
  if (status === "FAILURE") return "FAILED";
  if (status === "WAITING") return "RUNNING";
  if (EXECUTION_STATUSES.has(status)) return status;
  return "FAILED";
}

export function normalizeExecutionStep(step) {
  const status = normalizeStepStatus(step?.status);
  const error =
    step?.error ||
    (status === "FAILED" ? step?.output?.error : undefined) ||
    undefined;

  let executionTime = step?.executionTime ?? step?.durationMs ?? undefined;
  if (executionTime == null && step?.startedAt && step?.completedAt) {
    const ms = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) executionTime = ms;
  }

  return {
    stepId: step.stepId,
    label: step.label,
    stepType: step.type,
    status,
    executionTime,
    error,
    stackTrace: step.stackTrace || step.output?.stackTrace || undefined,
    input: step.input,
    output: step.output,
    branch: step.branch ?? undefined,
  };
}

/**
 * Enrich a workflow run result with test-runner debugging fields.
 */
export function formatTestRunResult(runResult) {
  const executionSteps = (runResult.steps || []).map(normalizeExecutionStep);
  const failedStep =
    executionSteps.find((s) => s.stepId === runResult.failedStepId) ||
    executionSteps.find((s) => s.status === "FAILED");

  const rootError =
    runResult.error ||
    failedStep?.error ||
    (runResult.validationErrors?.length ? runResult.validationErrors.join("; ") : undefined);

  return {
    ...runResult,
    success: runResult.status === "SUCCESS",
    failedStepId: runResult.failedStepId || failedStep?.stepId,
    failedStepLabel: runResult.failedStepLabel || failedStep?.label,
    error: rootError,
    executionSteps,
  };
}
