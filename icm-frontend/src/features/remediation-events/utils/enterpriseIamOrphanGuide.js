/**
 * IAM Orphan Review — Enterprise workflow reference.
 * Mirrors icm-backend/src/workflows/templates/iam-orphan-review-flow.json
 */

/** Official fixed trigger for IAM_ORPHAN_REVIEW workflows (one per workflow, set at create). */
export const OFFICIAL_ORPHAN_TRIGGER = {
  type: "UncorrelatedAccountIAMDecision",
  label: "Uncorrelated Account — IAM Decision",
  event: "IAM_ORPHAN_REVIEW",
  tag: "IAM_ORPHAN_REVIEW",
  firedWhen:
    "User starts IAM review from Data Hygiene / Orphan Accounts → queue task → scheduler runs workflow.",
};

/** Enterprise portal decisions (also enforced on /orphan-iam-review). */
export const IAM_PORTAL_DECISIONS = [
  {
    id: "ASSIGN",
    label: "Assign",
    enterpriseMeaning: "Link the orphan account to the correct identity in IGA (correlate).",
    typicalNextSteps: [
      "Open identity correlation / manual link UI",
      "Queue correlate-account provisioning",
      "Mark orphan REMEDIATED",
      "Notify account owner or app owner",
    ],
  },
  {
    id: "DELETE",
    label: "Delete",
    enterpriseMeaning: "Remove the account from the target application (high risk — irreversible).",
    typicalNextSteps: [
      "Queue delete-account provisioning to connector",
      "Verify account removed on next aggregation",
      "Mark orphan REMEDIATED",
      "Audit with ticket reference",
    ],
  },
  {
    id: "DISABLE",
    label: "Disable",
    enterpriseMeaning: "Disable login/access without deleting the account record.",
    typicalNextSteps: [
      "Queue disable-account on target system",
      "Re-verify disabled state",
      "Mark orphan REMEDIATED or UNDER_REVIEW until confirmed",
    ],
  },
  {
    id: "IGNORE",
    label: "Ignore",
    enterpriseMeaning: "Accepted risk / false positive — no remediation action on target.",
    typicalNextSteps: [
      "Mark orphan FALSE_POSITIVE",
      "Stop reminders",
      "Optional audit note for auditors",
    ],
  },
];

/** What the official template does today after a portal decision (MVP). */
export const POST_DECISION_MVP_FLOW = [
  "Workflow resumes at IAM Decision Taken? (Yes branch)",
  "Switch routes on $.trigger.iamDecision (ASSIGN / DELETE / DISABLE / IGNORE)",
  "Audit log records decision + email source (decisionSource, decisionStepLabel)",
  "Update Queue Task → COMPLETED",
  "End Success",
];

/** Full enterprise target (compose on canvas after Switch). */
export const POST_DECISION_ENTERPRISE_TARGET = [
  "ASSIGN → correlate / assign identity steps + provisioning",
  "DELETE → Revoke Access or target delete provisioning + verify",
  "DISABLE → disable account provisioning + verify",
  "IGNORE → update orphan status FALSE_POSITIVE (no connector action)",
  "All paths → Audit + optional Create Ticket + Update Queue Task",
];

export const ENTERPRISE_IAM_ORPHAN_MODEL = {
  name: "Uncorrelated Account — IAM Decision",
  tagline: "Queue-first IAM review with email notifications, scheduled reminders, and portal decision.",
  principles: [
    "Remediate click only flags the account and enqueues work — it does not run the workflow immediately.",
    "The remediation scheduler picks up new queue tasks and starts the mapped workflow.",
    "IAM team receives an action email with a per-email review portal link (no login).",
    "Reminder emails run on schedule (1h, 3h, 6h, 12h) until IAM records a decision.",
    "Portal decisions are ASSIGN, DELETE, DISABLE, or IGNORE — the workflow Switch routes post-decision automation.",
  ],
};

export const ENTERPRISE_IAM_ORPHAN_STEPS = [
  {
    id: "trigger",
    shortLabel: "Trigger",
    label: "Uncorrelated account flagged",
    description: "Account flagged from Data Hygiene or Orphan Accounts.",
  },
  {
    id: "context",
    shortLabel: "Context",
    label: "Get orphan context",
    description: "Loads email, application, and detection metadata.",
  },
  {
    id: "reminders",
    shortLabel: "Schedule",
    label: "Reminder schedule",
    description: "Sets reminder phases (1h, 3h, 6h, 12h).",
  },
  {
    id: "email",
    shortLabel: "Notify",
    label: "Send action email",
    description: "IAM team receives portal link (no login).",
  },
  {
    id: "wait",
    shortLabel: "Wait",
    label: "Wait for IAM decision",
    description: "Paused until IAM records a decision.",
  },
  {
    id: "complete",
    shortLabel: "Done",
    label: "Decision recorded",
    description: "Decision captured and task completed.",
  },
];

export const IAM_ORPHAN_QUEUE_TO_STEP = {
  NEW: "trigger",
  IN_PROGRESS: "context",
  WAITING: "wait",
  COMPLETED: "complete",
  FAILED: "email",
};

export function resolveEnterpriseIamOrphanStep(task) {
  if (!task) return "trigger";
  if (task.status === "COMPLETED") return "complete";
  if (task.status === "FAILED") return "email";

  const log = (task.stepLog || []).map((s) => String(s.label || "").toLowerCase()).join(" ");
  if (task.status === "WAITING" || log.includes("workflow waiting")) return "wait";
  if (log.includes("workflow started")) {
    if (log.includes("email") || log.includes("notify")) return "email";
    return "reminders";
  }
  if (task.status === "IN_PROGRESS") return "context";

  return IAM_ORPHAN_QUEUE_TO_STEP[task.status] || "trigger";
}

import { attachWorkflowStageTiming } from "./workflowStageTiming";

export function buildEnterpriseIamOrphanStages(task) {
  const activeId = resolveEnterpriseIamOrphanStep(task);
  const activeIndex = ENTERPRISE_IAM_ORPHAN_STEPS.findIndex((s) => s.id === activeId);
  const failed = task?.status === "FAILED";
  const actionEmail = task?.workflowContext?.actionEmail || null;
  const emailDeliveryFailed =
    actionEmail &&
    (actionEmail.status === "FAILED" ||
      (actionEmail.status === "PENDING" && Number(actionEmail.attempts || 0) > 0 && actionEmail.lastError));

  const stages = ENTERPRISE_IAM_ORPHAN_STEPS.map((step, index) => {
    let state = "upcoming";
    if (index < activeIndex) state = "done";
    else if (index === activeIndex) {
      state = failed && step.id === "email" ? "failed" : "active";
    } else if (task?.status === "COMPLETED") {
      state = "done";
    }

    // Async SMTP can fail after the SendEmail step already reported SUCCESS.
    if (step.id === "email" && emailDeliveryFailed) {
      state = "failed";
      const err = String(actionEmail.lastError || "SMTP delivery failed").split("\n")[0];
      return {
        ...step,
        state,
        description: `Email queued to ${actionEmail.to || "IAM team"} but delivery failed.`,
        hint: err,
      };
    }

    if (step.id === "email" && actionEmail?.status === "SENT") {
      return {
        ...step,
        state: index <= activeIndex || task?.status === "WAITING" || task?.status === "COMPLETED" ? "done" : state,
        hint: `Delivered to ${actionEmail.to}`,
      };
    }

    if (step.id === "email" && actionEmail?.status === "PENDING" && !actionEmail.lastError) {
      return {
        ...step,
        state: index < activeIndex ? "done" : state,
        hint: `Queued for ${actionEmail.to || "IAM team"} — waiting for email worker`,
      };
    }

    return { ...step, state };
  });

  return attachWorkflowStageTiming(stages, task, "iam-orphan-review");
}
