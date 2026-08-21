/**
 * Certification Revoke — Enterprise workflow reference.
 * Mirrors icm-backend/src/workflows/templates/cert-revoke-flow.json
 */

import { attachWorkflowStageTiming } from "./workflowStageTiming";

export const ENTERPRISE_ACCESS_REVOKE_MODEL = {
  name: "Certification Revoke - Enterprise",
  tagline: "Queue-first remediation with provisioning, ITSM tracking, and audit evidence.",
  principles: [
    "Revoke click only records the decision and enqueues work — it does not run the workflow immediately.",
    "The remediation scheduler picks up new queue tasks and starts the mapped workflow.",
    "The workflow never deletes IGA state directly — it queues provisioning and verifies removal.",
    "ITSM tickets are created and tracked until closed; access is re-verified before completion.",
  ],
};

export const ENTERPRISE_WORKFLOW_STEPS = [
  {
    id: "signoff",
    shortLabel: "Sign-off",
    label: "Certification signed off",
    description: "Reviewer decision is Revoke with full certification context.",
  },
  {
    id: "verify",
    shortLabel: "Verify",
    label: "Verify access state",
    description: "Read-only check against live entitlement view.",
  },
  {
    id: "provision",
    shortLabel: "Provision",
    label: "Queue provisioning",
    description: "Provisioning request enqueued to remove entitlement.",
  },
  {
    id: "itsm",
    shortLabel: "ITSM",
    label: "ITSM ticket",
    description: "High-priority ticket for IAM with portal link.",
  },
  {
    id: "wait",
    shortLabel: "Monitor",
    label: "Monitor & re-verify",
    description: "Waits for provisioning and ticket closure.",
  },
  {
    id: "notify",
    shortLabel: "Notify",
    label: "Notifications & audit",
    description: "User/manager notified or IAM escalated on failure.",
  },
  {
    id: "complete",
    shortLabel: "Done",
    label: "Certification revoked",
    description: "Queue completes; entitlement moves to Revoked.",
  },
];

export const QUEUE_TO_ENTERPRISE_STEP = {
  NEW: "signoff",
  IN_PROGRESS: "verify",
  WAITING: "wait",
  COMPLETED: "complete",
  FAILED: "notify",
};

/** MVP Option 2 — mirrors access-revoke-option2-flow.json */
export const OPTION2_WORKFLOW_STEPS = [
  {
    id: "signoff",
    shortLabel: "Sign-off",
    label: "Certification signed off",
    description: "Reviewer decision is Revoke with full certification context.",
  },
  {
    id: "ticket",
    shortLabel: "Ticket",
    label: "Create internal ticket",
    description: "Internal ticket with user, manager, app, and entitlement context.",
  },
  {
    id: "notifyUser",
    shortLabel: "User",
    label: "Notify user",
    description: "Email the identity that access is being revoked.",
  },
  {
    id: "notifyManager",
    shortLabel: "Manager",
    label: "Notify manager",
    description: "Email the manager that reportee access was revoked.",
  },
  {
    id: "emailCheck",
    shortLabel: "Verify",
    label: "Email sent successfully?",
    description: "Notification must queue successfully before completing the task.",
  },
  {
    id: "complete",
    shortLabel: "Done",
    label: "Queue completed",
    description: "Queue task marked complete; certification moves to Revoked.",
  },
];

/** Dual notify template — mirrors access-revoke-dual-notify-flow.json */
export const DUAL_NOTIFY_WORKFLOW_STEPS = [
  {
    id: "signoff",
    shortLabel: "Sign-off",
    label: "Certification signed off",
    description: "Reviewer decision is Revoke with full certification context.",
  },
  {
    id: "ticket",
    shortLabel: "Ticket",
    label: "Create internal ticket",
    description: "Internal ticket with revoke context for IAM.",
  },
  {
    id: "notifyUser",
    shortLabel: "User",
    label: "Notify user",
    description: "Send email to the identity.",
  },
  {
    id: "notifyManager",
    shortLabel: "Manager",
    label: "Notify manager",
    description: "Send email to the manager.",
  },
  {
    id: "emailCheck",
    shortLabel: "Verify",
    label: "Verify both emails queued",
    description: "Compare Strings on user and manager notification steps.",
  },
  {
    id: "closeTicket",
    shortLabel: "Close",
    label: "Close ticket",
    description: "Close the internal ticket on success.",
  },
  {
    id: "complete",
    shortLabel: "Done",
    label: "Queue completed",
    description: "Queue task marked complete with audit evidence.",
  },
];

/** Option 1 — human closes ticket via ITSM poll */
export const OPTION1_WORKFLOW_STEPS = [
  {
    id: "signoff",
    shortLabel: "Sign-off",
    label: "Certification signed off",
    description: "Reviewer decision is Revoke with full certification context.",
  },
  {
    id: "ticket",
    shortLabel: "Ticket",
    label: "Create internal ticket",
    description: "Ticket stays open until IAM closes it in ITSM.",
  },
  {
    id: "notify",
    shortLabel: "Notify",
    label: "Optional notifications",
    description: "User and/or manager emails when configured.",
  },
  {
    id: "wait",
    shortLabel: "Poll",
    label: "Wait for ticket closure",
    description: "Scheduler polls Get Ticket until status is CLOSED.",
  },
  {
    id: "complete",
    shortLabel: "Done",
    label: "Queue completed",
    description: "Queue task marked complete after ticket closes.",
  },
];

const ACCESS_REVOKE_GUIDE_PROFILES = {
  enterprise: {
    steps: ENTERPRISE_WORKFLOW_STEPS,
    resolveStep: resolveEnterpriseWorkflowStep,
    timingVariant: "access-revoke",
  },
  option2: {
    steps: OPTION2_WORKFLOW_STEPS,
    resolveStep: resolveOption2WorkflowStep,
    timingVariant: "access-revoke-option2",
  },
  "dual-notify": {
    steps: DUAL_NOTIFY_WORKFLOW_STEPS,
    resolveStep: resolveDualNotifyWorkflowStep,
    timingVariant: "access-revoke-option2",
  },
  option1: {
    steps: OPTION1_WORKFLOW_STEPS,
    resolveStep: resolveOption1WorkflowStep,
    timingVariant: "access-revoke-option1",
  },
};

function runStepTypes(task) {
  return (task?.workflowContext?.runSteps || [])
    .map((s) => String(s.type || s.stepId || s.label || "").toLowerCase())
    .join(" ");
}

function workflowHasStarted(task) {
  return Boolean(
    task?.executionStartedAt ||
      task?.workflowContext?.executionStartedAt ||
      (task?.workflowContext?.runSteps || []).length > 0 ||
      (task?.stepLog || []).some((s) =>
        String(s?.label || "")
          .toLowerCase()
          .includes("workflow started"),
      ),
  );
}

/** Pick enterprise vs Option 2 / dual-notify / Option 1 based on mapped workflow. */
export function resolveAccessRevokeGuideProfile(task) {
  const name = String(task?.workflowName || "").toLowerCase();
  const types = runStepTypes(task);

  if (
    types.includes("verifyaccessremoved") ||
    types.includes("revokeaccess") ||
    types.includes("endwaiting")
  ) {
    return "enterprise";
  }
  if (types.includes("closeticket") && types.includes("comparestrings")) {
    return "dual-notify";
  }
  if (types.includes("getticket") && !types.includes("verifyaccessremoved")) {
    return "option1";
  }

  if (name.includes("dual notify")) return "dual-notify";
  if (name.includes("option 1") || name.includes("human closes")) return "option1";
  if (name.includes("option 2") || name.includes("automated")) return "option2";
  if (name.includes("enterprise") && !name.includes("option")) return "enterprise";

  // Custom notify-style flows default to MVP steps — not the full provisioning reference.
  return "option2";
}

function resolveMvpWorkflowStep(task, stepOrder, failedStepId = "emailCheck") {
  if (!task) return stepOrder[0];
  if (task.status === "COMPLETED") return stepOrder[stepOrder.length - 1];
  if (task.status === "FAILED") return failedStepId;

  if (!workflowHasStarted(task)) {
    // Decision recorded; workflow canvas steps are still pending scheduler pickup.
    return stepOrder[0];
  }

  const types = runStepTypes(task);
  const ordered = stepOrder.slice(1);
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const id = ordered[i];
    const keys = MVP_STEP_NODE_HINTS[id] || [];
    if (keys.some((k) => types.includes(String(k).toLowerCase()))) {
      return id;
    }
  }

  if (task.status === "IN_PROGRESS") return ordered[0] || stepOrder[1];
  if (task.status === "WAITING") return "wait";

  return stepOrder[0];
}

const MVP_STEP_NODE_HINTS = {
  ticket: ["createticket", "create ticket"],
  notifyUser: ["sendemail", "notify user", "emailuser"],
  notifyManager: ["notify manager", "emailmanager"],
  notify: ["sendemail", "notify"],
  emailCheck: ["comparestrings", "email sent"],
  closeTicket: ["closeticket", "close ticket"],
  wait: ["getticket", "wait", "poll"],
  complete: ["endsuccess", "updatequeuetask", "auditlog", "complete queue"],
};

export function resolveOption2WorkflowStep(task) {
  return resolveMvpWorkflowStep(
    task,
    OPTION2_WORKFLOW_STEPS.map((s) => s.id),
    "emailCheck",
  );
}

export function resolveDualNotifyWorkflowStep(task) {
  return resolveMvpWorkflowStep(
    task,
    DUAL_NOTIFY_WORKFLOW_STEPS.map((s) => s.id),
    "emailCheck",
  );
}

export function resolveOption1WorkflowStep(task) {
  return resolveMvpWorkflowStep(
    task,
    OPTION1_WORKFLOW_STEPS.map((s) => s.id),
    "wait",
  );
}

function buildProfileWorkflowStages(task, profileKey) {
  const profile = ACCESS_REVOKE_GUIDE_PROFILES[profileKey] || ACCESS_REVOKE_GUIDE_PROFILES.option2;
  const activeId = profile.resolveStep(task);
  const activeIndex = profile.steps.findIndex((s) => s.id === activeId);
  const failed = task?.status === "FAILED";
  const started = workflowHasStarted(task);

  const stages = profile.steps.map((step, index) => {
    let state = "upcoming";

    if (!started && step.id === "signoff") {
      state = "done";
    } else if (!started) {
      state = "upcoming";
    } else if (index < activeIndex) {
      state = "done";
    } else if (index === activeIndex) {
      state = failed && (step.id === "emailCheck" || step.id === "wait" || step.id === "notify")
        ? "failed"
        : "active";
    } else if (task?.status === "COMPLETED") {
      state = "done";
    }

    return { ...step, state };
  });

  return attachWorkflowStageTiming(stages, task, profile.timingVariant);
}

/** Routes to enterprise or MVP guides based on the mapped workflow name / run steps. */
export function buildAccessRevokeWorkflowStages(task) {
  const profileKey = resolveAccessRevokeGuideProfile(task);
  if (profileKey === "enterprise") {
    return buildEnterpriseWorkflowStages(task);
  }
  return buildProfileWorkflowStages(task, profileKey);
}

export function resolveEnterpriseWorkflowStep(task) {
  if (!task) return "signoff";
  if (task.status === "COMPLETED") return "complete";
  if (task.status === "FAILED") return "notify";

  const log = (task.stepLog || []).map((s) => String(s.label || "").toLowerCase()).join(" ");
  if (task.status === "WAITING" || log.includes("workflow waiting")) return "wait";
  if (log.includes("workflow started")) {
    if (log.includes("ticket") || log.includes("itsm")) return "itsm";
    return "provision";
  }
  if (task.status === "IN_PROGRESS") return "verify";

  return QUEUE_TO_ENTERPRISE_STEP[task.status] || "signoff";
}

export function buildEnterpriseWorkflowStages(task) {
  const activeId = resolveEnterpriseWorkflowStep(task);
  const activeIndex = ENTERPRISE_WORKFLOW_STEPS.findIndex((s) => s.id === activeId);
  const failed = task?.status === "FAILED";

  const stages = ENTERPRISE_WORKFLOW_STEPS.map((step, index) => {
    let state = "upcoming";
    if (index < activeIndex) state = "done";
    else if (index === activeIndex) {
      state = failed && step.id === "notify" ? "failed" : "active";
    } else if (task?.status === "COMPLETED") {
      state = "done";
    }
    return { ...step, state };
  });

  return attachWorkflowStageTiming(stages, task, "access-revoke");
}
