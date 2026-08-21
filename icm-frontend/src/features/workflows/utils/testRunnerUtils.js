const STATUS_META = {
  SUCCESS: { label: "Success", className: "success", icon: "✓" },
  FAILED: { label: "Failed", className: "failed", icon: "!" },
  RUNNING: { label: "Running", className: "running", icon: "◐" },
  PENDING: { label: "Pending", className: "pending", icon: "○" },
  SKIPPED: { label: "Skipped", className: "skipped", icon: "—" },
  CANCELLED: { label: "Cancelled", className: "cancelled", icon: "⊘" },
};

function normalizeStatus(status) {
  if (status === "FAILURE") return "FAILED";
  if (status === "WAITING") return "RUNNING";
  return status || "PENDING";
}

export function getStepStatusMeta(status) {
  return STATUS_META[normalizeStatus(status)] || STATUS_META.PENDING;
}

export function resolveStepExecutionTime(step) {
  if (step == null) return null;
  if (step.executionTime != null && step.executionTime !== "") return Number(step.executionTime);
  if (step.durationMs != null && step.durationMs !== "") return Number(step.durationMs);
  if (step.startedAt && step.completedAt) {
    const ms = new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return null;
}

export function normalizeExecutionSteps(steps = []) {
  return steps.map((step) => {
    const status = normalizeStatus(step.status);
    const executionTime = resolveStepExecutionTime(step) ?? undefined;
    return {
      stepId: step.stepId,
      label: step.label,
      stepType: step.stepType || step.type,
      status,
      executionTime,
      error: step.error || (status === "FAILED" ? step.output?.error : undefined),
      stackTrace: step.stackTrace || step.output?.stackTrace,
      input: step.input,
      output: step.output,
      branch: step.branch,
    };
  });
}

export function resolveExecutionSteps(result) {
  if (!result) return [];
  if (Array.isArray(result.executionSteps) && result.executionSteps.length) {
    return result.executionSteps;
  }
  return normalizeExecutionSteps(result.steps || []);
}

export function formatExecutionTime(ms) {
  if (ms == null || ms === undefined || !Number.isFinite(Number(ms))) return "—";
  const value = Number(ms);
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function formatJsonBlock(value) {
  if (value == null || value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function pickDefaultStepId(executionSteps, failedStepId) {
  if (!executionSteps.length) return null;
  const failed =
    executionSteps.find((s) => s.stepId === failedStepId) ||
    executionSteps.find((s) => s.status === "FAILED");
  if (failed) return failed.stepId;
  const executed = executionSteps.find((s) => s.status !== "SKIPPED" && s.status !== "PENDING");
  return executed?.stepId || executionSteps[0].stepId;
}
