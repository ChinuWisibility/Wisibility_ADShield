import { pollAtForPhase, parseReminderPhasesMs } from "./orphanReminderPhases.js";

const STEP_LABELS = {
  UncorrelatedAccountIAMDecision: "Trigger — IAM review started",
  GetOrphanContext: "Load orphan account context",
  OrphanReminderSchedule: "Configure reminder schedule",
  SendEmail: "Send IAM notification email",
  WaitForIAMDecision: "Park workflow — awaiting portal decision",
  IamDecisionTaken: "IAM decision taken?",
  EndSuccess: "Complete — decision recorded",
  EndWaiting: "Still awaiting IAM decision",
};

function phasesMsFromExecution(execution) {
  const labels = execution?.reminderPhases;
  if (Array.isArray(labels) && labels.length) {
    return parseReminderPhasesMs(labels.join(","));
  }
  return parseReminderPhasesMs("1h,3h,6h,12h");
}

/** Human-readable bullets for execution list cards. */
export function deriveIamOrphanStatusBullets(run, execution = {}, tasks = []) {
  const bullets = [];
  const steps = run?.steps || [];
  const decisionRecorded = (tasks || []).some(
    (t) => t.taskName === "IAM_ORPHAN_DECISION" && t.status === "COMPLETED",
  );

  for (const s of steps) {
    if (s.status === "WAITING" && s.type === "WaitForIAMDecision") {
      if (!decisionRecorded) bullets.push("Awaiting IAM decision in portal");
      continue;
    }
    if (s.status === "SUCCESS") {
      bullets.push(s.label || STEP_LABELS[s.type] || s.type);
    } else if (s.status === "FAILED") {
      bullets.push(`Failed: ${s.label || s.type}`);
    }
  }

  const sent = execution.reminderPhaseIndex ?? 0;
  const phases = execution.reminderPhases || [];
  if (sent > 0 && phases.length) {
    bullets.push(`Reminders sent: ${sent}/${phases.length}`);
  }
  if (execution.status === "WAITING" && execution.nextPollAt) {
    bullets.push(`Next reminder check: ${new Date(execution.nextPollAt).toLocaleString()}`);
  }
  if (run?.status === "SUCCESS" || execution.status === "COMPLETED") {
    bullets.push("Workflow completed");
  } else if (run?.status === "FAILED" || execution.status === "FAILED") {
    bullets.push("Workflow failed");
  }

  return bullets.length ? bullets : ["Queued"];
}

/**
 * Full tracing timeline for IAM orphan executions (canvas steps + scheduler + decision).
 */
export function buildIamOrphanProgressTrace(execution, runs = [], tasks = []) {
  const trace = [];
  const startedAt = execution?.startedAt || execution?.createdAt;

  trace.push({
    id: "queued",
    label: "Workflow queued",
    type: "system",
    status: "SUCCESS",
    at: startedAt,
    detail: execution?.workflowName || "Uncorrelated Account — IAM Decision",
  });

  // Hoist decision task lookup so we can use it while building the step trace.
  const decisionTask = (tasks || []).find((t) => t.taskName === "IAM_ORPHAN_DECISION");
  const decisionCompleted = decisionTask?.status === "COMPLETED";

  const allSteps = runs.flatMap((r) => r.steps || []);
  for (const s of allSteps) {
    // WaitForIAMDecision stays WAITING in the run record even after the workflow resumes.
    // Once a decision task is recorded as COMPLETED, mark this step as completed too.
    const status =
      s.type === "WaitForIAMDecision" && s.status === "WAITING" && decisionCompleted
        ? "SUCCESS"
        : s.status;
    trace.push({
      id: s.stepId || s.type,
      label: s.label || STEP_LABELS[s.type] || s.type,
      type: s.type,
      status,
      branch: s.branch || null,
      at: s.completedAt || s.startedAt,
      detail: stepDetailLine(s),
    });
  }

  const reminderTasks = (tasks || [])
    .filter((t) => t.taskName === "IAM_ORPHAN_REMINDER")
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

  for (const t of reminderTasks) {
    trace.push({
      id: `task-reminder-${t._id}`,
      label: "Background scheduler — reminder email",
      type: "IAM_ORPHAN_REMINDER",
      status: t.status === "COMPLETED" ? "SUCCESS" : t.status === "FAILED" ? "FAILED" : "RUNNING",
      at: t.startedAt,
      detail: t.detail || t.errorMessage || null,
    });
  }

  if (decisionTask) {
    trace.push({
      id: `task-decision-${decisionTask._id}`,
      label: "IAM decision recorded",
      type: "IAM_ORPHAN_DECISION",
      status: decisionTask.status === "COMPLETED" ? "SUCCESS" : "FAILED",
      at: decisionTask.startedAt,
      detail: decisionTask.detail || null,
    });
  }

  if (execution?.status === "WAITING" && execution?.waitReason === "IAM_DECISION") {
    const phasesMs = phasesMsFromExecution(execution);
    const labels = execution.reminderPhases?.length
      ? execution.reminderPhases
      : phasesMs.map((ms) => `${Math.round(ms / 3600000)}h`);
    const sent = execution.reminderPhaseIndex ?? 0;
    const workflowStart = execution.startedAt || execution.createdAt || new Date();

    for (let i = sent; i < labels.length; i++) {
      const at = pollAtForPhase(workflowStart, i, phasesMs);
      const isNext = i === sent;
      trace.push({
        id: `pending-reminder-${i}`,
        label: `Scheduled reminder ${i + 1}/${labels.length} (${labels[i]})`,
        type: "scheduler",
        status: isNext ? "WAITING" : "PENDING",
        at,
        detail: isNext && execution.nextPollAt
          ? `Due around ${new Date(execution.nextPollAt).toLocaleString()}`
          : at
            ? `Planned for ${new Date(at).toLocaleString()}`
            : null,
      });
    }

    if (!decisionTask) {
      trace.push({
        id: "checkpoint-decision",
        label: "Resume checkpoint — IAM Decision Taken?",
        type: "IamDecisionTaken",
        status: "WAITING",
        at: null,
        detail: "Workflow resumes when IAM submits a decision via the portal",
      });
    }
  }

  return trace;
}

function stepDetailLine(step) {
  if (step.output?.error) return String(step.output.error);
  if (step.type === "OrphanReminderSchedule" && step.output?.scheduleLabel) {
    return `Schedule: ${step.output.scheduleLabel}`;
  }
  if (step.type === "OrphanReminderSchedule" && step.output?.nextPollAt) {
    return `First reminder at ${new Date(step.output.nextPollAt).toLocaleString()}`;
  }
  if (step.type === "SendEmail" && step.output?.subject) {
    return `Email: ${step.output.subject}`;
  }
  if (step.type === "IamDecisionTaken" && step.branch) {
    return step.branch === "true" ? "Decision present" : "Still waiting";
  }
  if (step.branch) return `Branch: ${step.branch}`;
  return null;
}

export function mergeIamOrphanStepStatuses(existing = [], run, execution, tasks = []) {
  const bullets = deriveIamOrphanStatusBullets(run, execution, tasks);
  const base = Array.isArray(existing) ? existing.filter((b) => b !== "Queued") : [];
  const merged = [...base];
  for (const b of bullets) {
    if (!merged.includes(b)) merged.push(b);
  }
  return merged.length ? merged : ["Queued"];
}
