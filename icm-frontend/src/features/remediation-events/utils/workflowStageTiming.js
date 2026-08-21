import { formatQueueDate } from "./queueTaskDisplay";

const IAM_NODE_MAP = {
  trigger: ["UncorrelatedAccountIAMDecision", "trigger"],
  context: ["GetOrphanContext", "getContext"],
  reminders: ["OrphanReminderSchedule", "reminderSchedule"],
  email: ["SendEmail", "sendEmail"],
  wait: ["WaitForIAMDecision", "waitForDecision", "checkDecision"],
  complete: ["IamDecisionTaken", "EndSuccess", "endSuccess"],
};

const ACCESS_REVOKE_NODE_MAP = {
  signoff: ["CertificationSignedOff", "trigger"],
  verify: ["VerifyAccessRemoved", "GetCertificationItem", "verify"],
  provision: ["RevokeAccess", "revoke"],
  itsm: ["CreateTicket", "ticket"],
  wait: ["EndWaiting", "wait"],
  notify: ["SendEmail", "AuditLog", "notify"],
  complete: ["EndSuccess", "endSuccess"],
};

const ACCESS_REVOKE_OPTION2_NODE_MAP = {
  signoff: ["CertificationSignedOff", "trigger"],
  ticket: ["CreateTicket", "createTicket", "ticket"],
  notifyUser: ["Notify User", "emailUser", "SendEmail"],
  notifyManager: ["Notify Manager", "emailManager"],
  emailCheck: ["CompareStrings", "emailSent", "Email Sent"],
  closeTicket: ["CloseTicket", "closeTicket"],
  notify: ["SendEmail", "notify"],
  wait: ["GetTicket", "Wait", "poll"],
  complete: ["UpdateQueueTask", "AuditLog", "EndSuccess", "endSuccess"],
};

function findStepAt(task, fragments = []) {
  const log = task?.stepLog || [];
  for (const fragment of fragments) {
    const needle = String(fragment || "").toLowerCase();
    const hit = log.find((s) => String(s?.label || "").toLowerCase().includes(needle));
    if (hit?.at) return hit.at;
  }
  return null;
}

function formatAt(value) {
  if (!value) return null;
  return formatQueueDate(value);
}

function findRunStep(steps, stageId, nodeMap) {
  const keys = nodeMap[stageId] || [];
  for (const key of keys) {
    const hit = steps.find(
      (s) =>
        s.type === key ||
        s.stepId === key ||
        String(s.label || "")
          .toLowerCase()
          .includes(String(key).toLowerCase()),
    );
    if (hit) return hit;
  }
  return null;
}

function pickRunTimestamp(runStep, fallback) {
  if (!runStep) return fallback;
  return runStep.completedAt || runStep.startedAt || fallback;
}

function statusLabelForRunStep(runStep, state) {
  if (!runStep) {
    if (state === "active") return "In progress";
    return "Started";
  }
  if (runStep.status === "WAITING") return "Paused";
  if (runStep.status === "SUCCESS") return "Completed";
  if (runStep.status === "FAILED") return "Failed";
  if (runStep.status === "RUNNING") return "Running";
  return "Started";
}

function buildIamStageTiming(stageId, task, state) {
  const ctx = task?.workflowContext || {};
  const steps = ctx.runSteps || [];
  const runStep = findRunStep(steps, stageId, IAM_NODE_MAP);

  switch (stageId) {
    case "trigger":
      return {
        timestamp: pickRunTimestamp(runStep, ctx.executionStartedAt || findStepAt(task, ["workflow started"])),
        timestampLabel: statusLabelForRunStep(runStep, state),
      };
    case "context":
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: statusLabelForRunStep(runStep, state),
      };
    case "reminders":
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: statusLabelForRunStep(runStep, state),
        hint:
          runStep?.output?.scheduleLabel ||
          (runStep?.output?.nextPollAt
            ? `First reminder · ${formatAt(runStep.output.nextPollAt)}`
            : null),
      };
    case "email":
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: statusLabelForRunStep(runStep, state),
        hint: runStep?.output?.subject ? `Email · ${runStep.output.subject}` : null,
      };
    case "wait":
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: runStep?.status === "WAITING" || state === "active" ? "Paused" : "Started",
        hint: ctx.nextPollAt
          ? `Next reminder check · ${formatAt(ctx.nextPollAt)}`
          : ctx.reminderPhases?.length
            ? `Reminders ${ctx.reminderPhaseIndex ?? 0}/${ctx.reminderPhases.length} sent`
            : null,
      };
    case "complete":
      return {
        timestamp: pickRunTimestamp(runStep, ctx.completedAt || task?.completedAt),
        timestampLabel: "Finished",
      };
    default:
      return {};
  }
}

function buildAccessRevokeStageTiming(stageId, task, state) {
  const ctx = task?.workflowContext || {};
  const steps = ctx.runSteps || [];
  const runStep = findRunStep(steps, stageId, ACCESS_REVOKE_NODE_MAP);

  switch (stageId) {
    case "signoff":
      return {
        timestamp: task?.context?.reviewedAt || pickRunTimestamp(runStep, null),
        timestampLabel: "Signed off",
      };
    case "complete":
      return {
        timestamp: pickRunTimestamp(runStep, ctx.completedAt || task?.completedAt),
        timestampLabel: "Finished",
      };
    case "wait":
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: runStep?.status === "WAITING" ? "Monitoring" : statusLabelForRunStep(runStep, state),
        hint: findStepAt(task, ["workflow waiting", "itsm"]) ? "ITSM ticket open" : null,
      };
    default:
      return {
        timestamp: pickRunTimestamp(runStep, stageId === "verify" ? ctx.executionStartedAt : null),
        timestampLabel: statusLabelForRunStep(runStep, state),
        hint: runStep?.output?.ticketId ? `Ticket · ${runStep.output.ticketId}` : null,
      };
  }
}

function buildAccessRevokeMvpStageTiming(stageId, task, state, nodeMap) {
  const ctx = task?.workflowContext || {};
  const steps = ctx.runSteps || [];
  const runStep = findRunStep(steps, stageId, nodeMap);

  switch (stageId) {
    case "signoff":
      return {
        timestamp: task?.context?.reviewedAt || pickRunTimestamp(runStep, null),
        timestampLabel: "Signed off",
      };
    case "complete":
      return {
        timestamp: pickRunTimestamp(runStep, ctx.completedAt || task?.completedAt),
        timestampLabel: "Finished",
      };
    case "wait":
      return {
        timestamp: pickRunTimestamp(runStep, ctx.nextPollAt || null),
        timestampLabel: runStep?.status === "WAITING" ? "Polling" : statusLabelForRunStep(runStep, state),
        hint: ctx.nextPollAt ? `Next poll · ${formatAt(ctx.nextPollAt)}` : null,
      };
    default:
      return {
        timestamp: pickRunTimestamp(runStep, null),
        timestampLabel: statusLabelForRunStep(runStep, state),
        hint: runStep?.output?.ticketId ? `Ticket · ${runStep.output.ticketId}` : null,
      };
  }
}

export function attachWorkflowStageTiming(stages, task, variant = "iam-orphan-review") {
  const buildTiming = (() => {
    if (variant === "access-revoke") return buildAccessRevokeStageTiming;
    if (variant === "access-revoke-option2" || variant === "access-revoke-option1") {
      return (stageId, t, state) =>
        buildAccessRevokeMvpStageTiming(stageId, t, state, ACCESS_REVOKE_OPTION2_NODE_MAP);
    }
    return buildIamStageTiming;
  })();

  return stages.map((stage) => {
    const timing = buildTiming(stage.id, task, stage.state);
    const formatted = timing.timestamp ? formatAt(timing.timestamp) : null;

    return {
      ...stage,
      ...timing,
      formattedTime: formatted,
      timeDisplay: formatted
        ? `${timing.timestampLabel} · ${formatted}`
        : timing.hint || null,
    };
  });
}
