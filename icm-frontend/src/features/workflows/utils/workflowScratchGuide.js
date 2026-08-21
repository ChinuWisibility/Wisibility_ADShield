/**
 * Documentation-only examples for empty canvas (NOT enforced workflows).
 * Palette contents come from workflow-catalog.json via API — not from this file.
 */

export const SCRATCH_TRIGGERS = [
  {
    label: "Certification Signed Off",
    type: "CertificationSignedOff",
    useFor: "Access certification / revoke remediation",
  },
  {
    label: "Uncorrelated Account — IAM Decision",
    type: "UncorrelatedAccountIAMDecision",
    useFor: "Orphan / uncorrelated account IAM review from Data Hygiene",
  },
];

export const SCRATCH_ACTIONS = {
  certification: [
    "Get Certification Item",
    "Manage Access / Revoke Access",
    "Verify Access Removed",
    "Send Email",
    "Create Ticket",
    "Audit Log",
    "Scheduler",
  ],
  iamOrphan: [
    "Get Orphan Context",
    "Orphan Reminder Schedule",
    "Assign IAM Team",
    "Wait for Portal Decision",
    "Scheduler Check",
    "Decision Received?",
    "Send Email",
    "Revoke Access",
    "Create Ticket",
    "Audit Log",
  ],
  shared: ["Send Email", "Create Ticket", "Audit Log", "Scheduler"],
};

export const SCRATCH_OPERATORS = [
  "Boolean / Compare Strings",
  "Compare Numbers",
  "Verify Data Type",
  "IAM Decision Taken?",
  "Loop",
  "End Step — Success",
  "End Step — Failure",
  "End Step — Waiting",
];

export const SCRATCH_FLOW_RECIPES = [
  {
    id: "access-revoke-dual-notify",
    remediationAction: "ACCESS_REVOKE",
    recommended: true,
    title: "Dual notify + close ticket",
    subtitle: "Verify user & manager email → close ticket or fail",
    trigger: "Certification Signed Off",
    steps: [
      { label: "Create Ticket", hint: "Access Revoke preset from trigger" },
      { label: "Notify User & Manager", hint: "Two Send Email steps" },
      { label: "Verify both queued", hint: "Compare Strings on each email step" },
      { label: "Close or fail", hint: "Close Ticket → Complete queue, or Fail queue task" },
    ],
  },
  {
    id: "access-revoke-option2",
    remediationAction: "ACCESS_REVOKE",
    title: "Automated MVP",
    subtitle: "Ticket → notify → complete queue task",
    trigger: "Certification Signed Off",
    steps: [
      { label: "Create Ticket", hint: "Map user, manager, app, entitlement from trigger" },
      { label: "Notify User", hint: "Send Email to $.trigger.identityEmail" },
      { label: "Notify Manager", hint: "Optional — $.trigger.managerEmail" },
      { label: "Complete Task", hint: "Update Queue Task → End Success" },
    ],
  },
  {
    id: "access-revoke-option1",
    remediationAction: "ACCESS_REVOKE",
    title: "Human closes ticket",
    subtitle: "Poll ticket until ITSM closes it",
    trigger: "Certification Signed Off",
    steps: [
      { label: "Create Ticket", hint: "Internal provider" },
      { label: "Notify", hint: "Optional emails" },
      { label: "Wait & Poll", hint: "Scheduler → Get Ticket → If CLOSED" },
      { label: "Complete Task", hint: "Update Queue Task → End Success" },
    ],
  },
  {
    id: "iam-orphan",
    remediationAction: "IAM_ORPHAN_REVIEW",
    recommended: true,
    title: "IAM orphan review",
    subtitle: "Assign team → wait for decision → act",
    trigger: "Uncorrelated Account — IAM Decision",
    steps: [
      { label: "Orphan Context", hint: "Load account details" },
      { label: "Assign IAM Team", hint: "Route for review" },
      { label: "Wait for Decision", hint: "Scheduler / poll" },
      { label: "Act & End", hint: "Revoke, email, or audit" },
    ],
  },
];

/** Example flows scoped to the current remediation event (documentation only). */
export function getScratchRecipesForAction(remediationAction) {
  if (!remediationAction) return SCRATCH_FLOW_RECIPES;
  return SCRATCH_FLOW_RECIPES.filter((r) => r.remediationAction === remediationAction);
}

/** Step-by-step checklist for new users building from scratch. */
export const SCRATCH_GETTING_STARTED = {
  ACCESS_REVOKE: {
    title: "Build Access Revoke from scratch",
    triggerLabel: "Certification Signed Off",
    steps: [
      {
        label: "Create workflow",
        hint: "Governance → Workflows → Create → Build Access Revoke. The trigger is fixed automatically.",
      },
      {
        label: "Add canvas steps",
        hint: "From the step library: Create Ticket → Send Email (user) → Send Email (manager) → Compare Strings → Update Queue Task → End Success.",
      },
      {
        label: "Map trigger fields",
        hint: "Use $.trigger.identityEmail, $.trigger.managerEmail, $.trigger.entitlementName in email and ticket config.",
      },
      {
        label: "Save & validate",
        hint: "Click Validate on the bottom bar. Fix any missing End Success / branch connections.",
      },
      {
        label: "Map in Global Rule Set",
        hint: "Org Admin → Global Rule Set → Access Revoke → pick your workflow → Save. New revokes use this workflow.",
      },
      {
        label: "Test",
        hint: "Use Test on the builder, or revoke one item in a certification campaign and watch the remediation queue.",
      },
    ],
    afterSave:
      "Revoke in certification only queues work — the scheduler starts your workflow. Until Global Rule Set points to your workflow, the default Option 2 template runs instead.",
  },
  IAM_ORPHAN_REVIEW: {
    title: "Build IAM Orphan Review from scratch",
    triggerLabel: "Uncorrelated Account — IAM Decision",
    steps: [
      {
        label: "Create workflow",
        hint: "Governance → Workflows → Create → Build IAM Orphan Review. Trigger is fixed to the official orphan event.",
      },
      {
        label: "Add canvas steps",
        hint: "Get Orphan Context → Orphan Reminder Schedule → Send Email (with review portal) → Wait for Portal Decision → Switch on $.trigger.iamDecision → act → Audit → Update Queue Task → End Success.",
      },
      {
        label: "Portal decisions",
        hint: "IAM reviewers choose ASSIGN, DELETE, DISABLE, or IGNORE from the email link — not certification revoke.",
      },
      {
        label: "Save & validate",
        hint: "Ensure Wait for Portal Decision and Switch branches connect to End Success or End Failure.",
      },
      {
        label: "Map in Global Rule Set",
        hint: "Org Admin → Global Rule Set → IAM Orphan Review → pick your workflow → Save.",
      },
      {
        label: "Test",
        hint: "Open Test panel — orphan sample scenarios load automatically for this trigger.",
      },
    ],
    afterSave:
      "Orphans are queued from Data Hygiene. The scheduler runs your mapped workflow — not Access Revoke steps.",
  },
};

export function getScratchGettingStarted(remediationAction) {
  if (!remediationAction) return null;
  return SCRATCH_GETTING_STARTED[remediationAction] || null;
}

/** Action names shown as hints — scoped to trigger / remediation event. */
export function getScratchActionsForAction(remediationAction) {
  if (remediationAction === "IAM_ORPHAN_REVIEW") {
    return [...SCRATCH_ACTIONS.iamOrphan, ...SCRATCH_ACTIONS.shared];
  }
  if (remediationAction === "ACCESS_REVOKE") {
    return [...SCRATCH_ACTIONS.certification, ...SCRATCH_ACTIONS.shared];
  }
  return [...SCRATCH_ACTIONS.certification, ...SCRATCH_ACTIONS.iamOrphan, ...SCRATCH_ACTIONS.shared];
}

export function getScratchOperatorsForAction(remediationAction) {
  const shared = ["Boolean / Compare Strings", "End Step — Success", "End Step — Failure"];
  if (remediationAction === "IAM_ORPHAN_REVIEW") {
    return [...shared, "IAM Decision Taken?", "Switch", "Loop"];
  }
  if (remediationAction === "ACCESS_REVOKE") {
    return [...shared, "Compare Numbers", "End Step — Waiting"];
  }
  return SCRATCH_OPERATORS;
}

/** Fields available on Create Ticket from ACCESS_REVOKE queue trigger (map in config with {{$.trigger.*}}) */
export const ACCESS_REVOKE_TICKET_FIELDS = [
  { key: "username", triggerPath: "$.trigger.identityName", label: "User Name" },
  { key: "identityEmail", triggerPath: "$.trigger.identityEmail", label: "User Email" },
  { key: "managerName", triggerPath: "$.trigger.managerName", label: "Manager Name" },
  { key: "managerEmail", triggerPath: "$.trigger.managerEmail", label: "Manager Email" },
  { key: "applicationName", triggerPath: "$.trigger.applicationName", label: "Application" },
  { key: "entitlementName", triggerPath: "$.trigger.entitlementName", label: "Entitlement" },
  { key: "reviewerName", triggerPath: "$.trigger.reviewerName", label: "Reviewer" },
  { key: "reviewDate", triggerPath: "$.trigger.reviewDate", label: "Review Date" },
  { key: "comments", triggerPath: "$.trigger.comment", label: "Comments" },
];
