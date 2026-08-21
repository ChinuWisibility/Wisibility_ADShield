export function formatDuration(ms) {
  if (ms == null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
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

function normalizeTimelineStep(step, runStepsById = {}) {
  const fallback = runStepsById[step.stepId];
  const executionTime =
    resolveStepExecutionTime(step) ?? resolveStepExecutionTime(fallback) ?? undefined;
  return { ...step, executionTime };
}

export function resolveExecutionSteps(detail) {
  if (!detail) return [];

  const runStepsById = {};
  for (const s of detail.run?.steps || []) {
    if (s?.stepId) runStepsById[s.stepId] = s;
  }

  if (Array.isArray(detail.nodeTimeline) && detail.nodeTimeline.length) {
    return detail.nodeTimeline.map((step) => normalizeTimelineStep(step, runStepsById));
  }
  if (Array.isArray(detail.run?.executionSteps) && detail.run.executionSteps.length) {
    return detail.run.executionSteps.map((step) => normalizeTimelineStep(step, runStepsById));
  }
  if (Array.isArray(detail.run?.steps) && detail.run.steps.length) {
    return detail.run.steps.map((s) =>
      normalizeTimelineStep(
        {
          stepId: s.stepId,
          label: s.label,
          stepType: s.type,
          status: s.status,
          executionTime: s.executionTime,
          durationMs: s.durationMs,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          error: s.error || s.output?.error,
          stackTrace: s.stackTrace,
          input: s.input,
          output: s.output,
          branch: s.branch,
        },
        runStepsById,
      ),
    );
  }
  return [];
}

export function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function stepStatusClass(status) {
  if (status === "SUCCESS" || status === "COMPLETED") return "step-success";
  if (status === "FAILED" || status === "FAILURE") return "step-failed";
  if (status === "WAITING" || status === "RUNNING") return "step-waiting";
  if (status === "PENDING") return "step-pending";
  return "step-neutral";
}

export function traceStatusLabel(status) {
  if (status === "SUCCESS" || status === "COMPLETED") return "Done";
  if (status === "WAITING") return "Waiting";
  if (status === "PENDING") return "Scheduled";
  if (status === "RUNNING") return "Running";
  if (status === "FAILED" || status === "FAILURE") return "Failed";
  return status || "—";
}

export function resolveProgressTrace(detail) {
  if (!detail) return [];

  if (Array.isArray(detail.progressTrace) && detail.progressTrace.length) {
    return detail.progressTrace;
  }

  const runs = detail.runs || [];
  const steps = runs.length
    ? runs.flatMap((r) => r.steps || [])
    : detail.run?.steps || [];

  return steps.map((s, idx) => ({
    id: s.stepId || `${s.type}-${idx}`,
    label: s.label || s.type,
    type: s.type,
    status: s.status,
    branch: s.branch || null,
    at: s.completedAt || s.startedAt,
    detail: s.output?.error ? String(s.output.error) : null,
  }));
}

export function latestProgressLabel(exec) {
  if (exec?.currentStepLabel) return exec.currentStepLabel;
  const bullets = exec?.stepStatuses || [];
  if (bullets.length === 0) return exec?.status === "WAITING" ? "Awaiting IAM decision" : "Queued";
  return bullets[bullets.length - 1];
}

export function formatItsmStatus(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "—";
  const labels = {
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    CLOSED: "Closed",
    COMPLETED: "Closed",
    RESOLVED: "Resolved",
    CANCELED: "Canceled",
    FAILED: "Failed",
    TICKET_CREATED: "Open",
    NOTIFIED: "Open (notified)",
    TICKET_IN_PROGRESS: "In progress",
    TICKET_CLOSED: "Closed",
  };
  return labels[s] || s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}
