/**
 * Single source of truth for ISC-style step configuration (IGA-aligned).
 * Maps prototype workflow fields → Wisibility ReviewItem / provisioningPayload / RemediationTicket.
 */

export const TRIGGER_OUTPUT_SCHEMA = {
  decision: "Revoke",
  identityId: "(ReviewItem.userId)",
  identityName: "(ReviewItem display name)",
  firstName: "(first name)",
  lastName: "(last name)",
  identityEmail: "(ReviewItem.itemEmail)",
  managerEmail: "(ReviewItem.itemManagerEmail)",
  managerName: "(ReviewItem.itemManager)",
  applicationId: "(ReviewItem.applicationId)",
  applicationName: "(ReviewItem.itemApplicationName)",
  entitlementId: "(provisioningPayload.entitlementId)",
  entitlementName: "(provisioningPayload.entitlementName)",
  campaignId: "(Campaign._id)",
  campaignName: "(Campaign.name)",
  reviewItemId: "(ReviewItem._id)",
  reviewerName: "(ReviewItem.reviewerName)",
  reviewerEmail: "(ReviewItem.reviewerEmail)",
  reviewDate: "(decision reviewedAt)",
  comment: "(decision comment)",
  provisioningAction: "REMOVE_ENTITLEMENT",
};

/** Official trigger output for IAM_ORPHAN_REVIEW (queue-built at runtime). */
export const ORPHAN_TRIGGER_OUTPUT_SCHEMA = {
  orphanId: "(OrphanAccount._id)",
  accountName: "(OrphanAccount.accountName)",
  applicationId: "(OrphanAccount.applicationId)",
  applicationName: "(Application.name)",
  riskLevel: "(OrphanAccount.riskLevel — LOW/MEDIUM/HIGH/CRITICAL)",
  detectedAt: "(OrphanAccount.detectedAt — ISO date)",
  status: "(OrphanAccount.status — OPEN/UNDER_REVIEW/…)",
};

/** Added to $.trigger after IAM submits a portal decision (workflow resume). */
export const ORPHAN_POST_DECISION_TRIGGER_SCHEMA = {
  iamDecision: "(ASSIGN | DELETE | DISABLE | IGNORE)",
  decisionSource: "(email source label, e.g. initial-action-email or reminder-phase-2)",
  decisionStepId: "(workflow node id that sent the email)",
  decisionStepLabel: "(human step label, e.g. Send Action Email)",
  decisionEmailJobId: "(notification job id when available)",
  decisionRecordedAt: "(ISO timestamp)",
  decisionRecordedBy: "(iam-portal or user email)",
};

/** Runtime config exposed to all workflow steps ($.config.*). */
export const WORKFLOW_CONFIG_SCHEMA = {
  workflowFromEmail: "(WORKFLOW_FROM_EMAIL / SMTP user)",
  iamTeamEmail: "(IAM_TEAM_EMAIL — ITSM / escalation inbox)",
  reviewerEmail: "(REVIEWER_EMAIL — any reviewer: IAM team, manager, owner, or custom inbox)",
  portalBaseUrl: "(FRONTEND_URL — identity portal links)",
  orphanIamPortalUrl: "(Tokenized no-login IAM review link — /orphan-iam-review?token=…)",
  reviewPortalUrl: "(Per-email review portal link — use in Send Email when trigger has orphanId; tracks step/source in token)",
};

export const TRIGGER_IGA_FIELDS = [
  { path: "identityId", igaRef: "ReviewItem.userId / provisioningPayload.identityId" },
  { path: "identityEmail", igaRef: "ReviewItem.itemEmail" },
  { path: "identityName", igaRef: "ReviewItem snapshot display name" },
  { path: "managerName", igaRef: "ReviewItem.itemManager" },
  { path: "managerEmail", igaRef: "ReviewItem.itemManagerEmail" },
  { path: "entitlementId", igaRef: "provisioningPayload.entitlementId" },
  { path: "entitlementName", igaRef: "provisioningPayload.entitlementName / ReviewItem.itemName" },
  { path: "applicationName", igaRef: "ReviewItem.itemApplicationName" },
  { path: "decision", igaRef: "ReviewItem.decision (Revoked)" },
  { path: "reviewerName", igaRef: "ReviewItem.reviewerName" },
  { path: "reviewDate", igaRef: "ReviewItem entitlement decision reviewedAt" },
  { path: "comment", igaRef: "ReviewItem entitlement decision comment" },
  { path: "campaignName", igaRef: "Campaign.name" },
  { path: "reviewItemId", igaRef: "ReviewItem._id" },
  { path: "provisioningAction", igaRef: "ReviewItem.provisioningAction" },
];

const TRIGGER_IGA_MAP = Object.fromEntries(
  TRIGGER_IGA_FIELDS.map((f) => [f.path, f.igaRef]),
);

export const EMAIL_PRESETS = {
  userRevoked: {
    label: "Notify user — access revoked",
    config: {
      to: "$.trigger.identityEmail",
      from: "$.config.workflowFromEmail",
      subject: "Access Revoked: {{$.trigger.entitlementName}} on {{$.trigger.applicationName}}",
      body: "Hello {{$.trigger.identityName}},\n\nYour access \"{{$.trigger.entitlementName}}\" on {{$.trigger.applicationName}} was revoked per certification campaign {{$.trigger.campaignName}}.\n\nIf you believe this is an error, contact your manager or IAM team.",
    },
  },
  managerNotify: {
    label: "Notify manager — reportee revoked",
    config: {
      to: "$.trigger.managerEmail",
      from: "$.config.workflowFromEmail",
      subject: "Reportee Access Revoked: {{$.trigger.identityName}}",
      body: "Manager,\n\n{{$.trigger.identityName}} had \"{{$.trigger.entitlementName}}\" revoked on {{$.trigger.applicationName}} following certification {{$.trigger.campaignName}}.",
    },
  },
  iamEscalation: {
    label: "IAM escalation — provisioning failed",
    config: {
      to: "$.config.iamTeamEmail",
      from: "$.config.workflowFromEmail",
      subject: "Access Revocation Failed — {{$.trigger.identityName}}",
      body: "IAM Team,\n\nAccess revocation failed after certification sign-off.\n\nUser: {{$.trigger.identityName}}\nApplication: {{$.trigger.applicationName}}\nAccess: {{$.trigger.entitlementName}}\nCampaign: {{$.trigger.campaignName}}\n\nAccess still present after provisioning. Manual remediation required.\n\nPortal: {{$.steps.verify.portalLink}}\n\nInvestigate identity profile, account details, provisioning activity, and certification history.",
    },
  },
  iamAccessStillPresent: {
    label: "IAM — access still present after revoke check",
    config: {
      to: "$.config.iamTeamEmail",
      from: "$.config.workflowFromEmail",
      subject: "Certification revoke — access still present: {{$.trigger.identityName}}",
      body: "IAM Team,\n\nA reviewer revoked access in certification, but the entitlement is still present in IGA.\n\nUser: {{$.trigger.identityName}}\nApplication: {{$.trigger.applicationName}}\nAccess: {{$.trigger.entitlementName}}\nCampaign: {{$.trigger.campaignName}}\n\nManual remediation required.\n\nIdentity portal: {{$.steps.verify.portalLink}}",
    },
  },
  iamOrphanReview: {
    label: "IAM — orphan account review request",
    config: {
      to: "$.config.iamTeamEmail",
      from: "$.config.workflowFromEmail",
      subject: "IAM Review Required: {{$.trigger.accountName}} on {{$.trigger.applicationName}}",
      body: "IAM Team,\n\nAn uncorrelated (orphan) account requires your decision.\n\nAccount: {{$.trigger.accountName}}\nApplication: {{$.trigger.applicationName}}\nRisk Level: {{$.trigger.riskLevel}}\nDetected At: {{$.trigger.detectedAt}}\n\nPlease review and take one of the following actions:\n- ASSIGN: Link this account to an existing identity\n- DELETE: Remove the account from the system\n- DISABLE: Disable the account\n- IGNORE: Mark as false positive\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    },
  },
  iamOrphanReminder: {
    label: "IAM — orphan account review reminder",
    config: {
      to: "$.config.iamTeamEmail",
      from: "$.config.workflowFromEmail",
      subject: "Reminder: IAM Review Pending — {{$.trigger.accountName}}",
      body: "IAM Team,\n\nThis is a reminder that the following orphan account is still awaiting your decision.\n\nAccount: {{$.trigger.accountName}}\nApplication: {{$.trigger.applicationName}}\nRisk Level: {{$.trigger.riskLevel}}\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    },
  },
  reviewRequest: {
    label: "Any reviewer — orphan account review request",
    config: {
      to: "$.config.reviewerEmail",
      from: "$.config.workflowFromEmail",
      subject: "Review Required: {{$.trigger.accountName}} on {{$.trigger.applicationName}}",
      body: "Hello,\n\nAn uncorrelated (orphan) account requires your decision.\n\nAccount: {{$.trigger.accountName}}\nApplication: {{$.trigger.applicationName}}\nRisk Level: {{$.trigger.riskLevel}}\nDetected At: {{$.trigger.detectedAt}}\n\nPlease review and take one of the following actions:\n- ASSIGN: Link this account to an existing identity\n- DELETE: Remove the account from the system\n- DISABLE: Disable the account\n- IGNORE: Mark as false positive\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    },
  },
  reviewReminder: {
    label: "Any reviewer — orphan account review reminder",
    config: {
      to: "$.config.reviewerEmail",
      from: "$.config.workflowFromEmail",
      subject: "Reminder: Review Pending — {{$.trigger.accountName}}",
      body: "Hello,\n\nThis is a reminder that the following orphan account is still awaiting your decision.\n\nAccount: {{$.trigger.accountName}}\nApplication: {{$.trigger.applicationName}}\nRisk Level: {{$.trigger.riskLevel}}\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    },
  },
};

export const TICKET_PRESETS = {
  accessRevokePopulate: {
    label: "Access Revoke — populate from trigger",
    config: {
      provider: "internal",
      title: "Access Revoke: {{$.trigger.identityName}} — {{$.trigger.entitlementName}}",
      priority: "MEDIUM",
      assignedTeam: "Identity Team",
      identityName: "$.trigger.identityName",
      identityEmail: "$.trigger.identityEmail",
      managerName: "$.trigger.managerName",
      managerEmail: "$.trigger.managerEmail",
      applicationName: "$.trigger.applicationName",
      entitlementName: "$.trigger.entitlementName",
      reviewerName: "$.trigger.reviewerName",
      reviewDate: "$.trigger.reviewDate",
      comments: "$.trigger.comment",
      description:
        "Access \"{{$.trigger.entitlementName}}\" on {{$.trigger.applicationName}} is being revoked for {{$.trigger.identityName}} (manager {{$.trigger.managerName}}) per certification {{$.trigger.campaignName}}. Reviewer: {{$.trigger.reviewerName}}.",
    },
  },
  certRevokeFailed: {
    label: "Cert revoke provisioning failed",
    config: {
      provider: "internal",
      title: "Cert Revoke Failed: {{$.trigger.identityName}} — {{$.trigger.entitlementName}}",
      priority: "HIGH",
      assignee: "{{$.config.iamTeamEmail}}",
      description:
        "Certification decision was Revoke but entitlement still present. Portal: {{$.steps.verify.portalLink}}",
    },
  },
};

/** Ticket provider options — Internal ships today; others are placeholders. */
const TICKET_PROVIDER_OPTIONS = [
  { value: "internal", label: "Internal (app database)", implemented: true },
  { value: "servicenow", label: "ServiceNow (coming soon)", implemented: false },
  { value: "jira", label: "Jira (coming soon)", implemented: false },
  { value: "rest", label: "REST API (coming soon)", implemented: false },
  { value: "email", label: "Email-to-helpdesk (coming soon)", implemented: false },
];

const TICKET_STATUS_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "PENDING", label: "Pending" },
  { value: "CLOSED", label: "Closed" },
];

export const AUDIT_PRESETS = {
  certRevokeSuccess: {
    label: "Certification revoke — success",
    config: {
      action: "CERTIFICATION_REVOKE_WORKFLOW",
      outcome: "SUCCESS",
      message:
        "Certification revoke successfully enforced.\n\nIdentity: {{$.trigger.identityName}}\nEntitlement: {{$.trigger.entitlementName}}\nCertification: {{$.trigger.reviewItemId}}\n\nVerification Result: Access Removed\n\nWorkflow Outcome: Success",
    },
  },
  certRevokeFailure: {
    label: "Certification revoke — failure",
    config: {
      action: "CERTIFICATION_REVOKE_WORKFLOW",
      outcome: "FAILURE",
      message:
        "Certification revoke failed.\n\nIdentity: {{$.trigger.identityName}}\nEntitlement: {{$.trigger.entitlementName}}\nCertification: {{$.trigger.reviewItemId}}\n\nRetry Attempts: {{$.steps.retryLoop.iteration}}\n\nVerification Result: Access Still Present\n\nIAM team notified for manual remediation.\n\nWorkflow Outcome: Failure",
    },
  },
};

const SCHEDULER_DELAY_UNITS = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
];

const COMPARE_NUMBER_OPERATORS = [
  { value: ">", label: ">" },
  { value: "<", label: "<" },
  { value: ">=", label: ">=" },
  { value: "<=", label: "<=" },
  { value: "==", label: "==" },
  { value: "!=", label: "!=" },
];

export const STEP_CONFIG_CATALOG = {
  CertificationSignedOff: {
    category: "trigger",
    title: "Certification Signed Off",
    help: "Fires when a reviewer signs off a certification item. The certification decision is the governance outcome — this workflow does not re-approve.",
    defaultConfig: {
      filterDecision: "Revoke",
      advancedFilter: "",
      description: "Only run when certification decision is Revoke.",
    },
    hasAdvanced: true,
    fields: [
      {
        key: "filterDecision",
        label: "Trigger when decision is",
        type: "select",
        required: false,
        options: [
          { value: "Revoke", label: "Revoke" },
          { value: "", label: "Any decision (not recommended)" },
        ],
        igaRef: "ReviewItem.decision",
        help: "Live runs honor this filter. Test workflow ignores filter and uses test JSON.",
        section: "basic",
      },
      {
        key: "advancedFilter",
        label: "Advanced JSONPath filter",
        type: "textarea",
        required: false,
        placeholder: "$.trigger.decision == 'Revoke'",
        help: "Optional raw filter (ISC advanced mode). Test mode does not apply filters.",
        section: "advanced",
      },
    ],
    outputSchema: TRIGGER_OUTPUT_SCHEMA,
    igaFields: TRIGGER_IGA_FIELDS,
  },

  UncorrelatedAccountIAMDecision: {
    category: "trigger",
    title: "Uncorrelated Account — IAM Decision",
    help: "Official IAM orphan trigger (IAM_ORPHAN_REVIEW). Fires when IAM review is started from Data Hygiene → queue → scheduler. Portal decisions: ASSIGN, DELETE, DISABLE, IGNORE.",
    defaultConfig: { description: "Run when IAM review is initiated for an uncorrelated account." },
    hasAdvanced: false,
    fields: [],
    outputSchema: {
      ...ORPHAN_TRIGGER_OUTPUT_SCHEMA,
      ...ORPHAN_POST_DECISION_TRIGGER_SCHEMA,
    },
    igaFields: [
      { path: "orphanId", igaRef: "OrphanAccount._id" },
      { path: "accountName", igaRef: "OrphanAccount.accountName" },
      { path: "applicationName", igaRef: "OrphanAccount.applicationId.name" },
      { path: "riskLevel", igaRef: "OrphanAccount.riskLevel" },
      { path: "detectedAt", igaRef: "OrphanAccount.detectedAt" },
    ],
  },

  GetOrphanContext: {
    category: "action",
    title: "Get Orphan Context",
    help: "Loads orphan account, application, and enriched identity fields (email, display name) for email templates.",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      orphanId: "Orphan account ID",
      accountName: "Account display name",
      applicationName: "Target application name",
      userEmail: "Enriched identity email (if available)",
      userDisplayName: "Enriched display name",
      userEmployeeId: "Enriched employee ID",
      userUsername: "Enriched username",
      correlationKey: "Correlation key used for matching",
      riskLevel: "Risk level (LOW/MEDIUM/HIGH/CRITICAL)",
      detectedAt: "When the orphan was detected (ISO date)",
    },
    igaFields: [],
  },

  OrphanReminderSchedule: {
    category: "action",
    title: "Reminder Schedule",
    help: "Configure once: reminder phases (e.g. 1h,3h,6h,12h). The background scheduler sends reminders at these intervals while waiting for a decision — works for any reviewer (IAM team, manager, business owner, etc.).",
    defaultConfig: {
      reminderPhases: "1h,3h,6h,12h",
      checkpointNodeId: "checkDecision",
    },
    fields: [
      {
        key: "reminderPhases",
        label: "Reminder phases",
        type: "text",
        required: false,
        placeholder: "1h,3h,6h,12h",
        help: "Comma-separated offsets from workflow start (h=hours, m=minutes, d=days).",
        section: "basic",
      },
      {
        key: "checkpointNodeId",
        label: "Resume checkpoint node ID",
        type: "text",
        required: false,
        placeholder: "checkDecision",
        section: "advanced",
      },
    ],
    outputSchema: {
      scheduleLabel: "Human-readable schedule (e.g. 1h, 3h, 6h, 12h)",
      nextPollAt: "First reminder poll time (ISO date)",
      checkpointNodeId: "Node ID to resume on IAM decision",
    },
    igaFields: [],
  },

  IamDecisionTaken: {
    category: "operator",
    title: "Decision Taken?",
    help: "Branches Yes when any reviewer submitted a decision via the portal; No while still waiting. Works for IAM team, manager, business owner, or any email recipient.",
    defaultConfig: {
      branchLabelTrue: "Decision taken",
      branchLabelFalse: "Still waiting",
    },
    fields: [
      {
        key: "branchLabelTrue",
        label: "Yes branch label",
        type: "text",
        required: false,
        section: "basic",
      },
      {
        key: "branchLabelFalse",
        label: "No branch label",
        type: "text",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: {
      decision: "ASSIGN | DELETE | DISABLE | IGNORE — the decision recorded by the reviewer",
      iamDecision: "ASSIGN | DELETE | DISABLE | IGNORE (alias for backward compatibility)",
      decided: "true when a decision was recorded",
    },
    igaFields: [],
  },

  StartGovernanceReview: {
    category: "action",
    title: "Create Uncorrelated Account Record",
    help: "Legacy — initiates governance review (use Get Orphan Context in new flows).",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      orphanId: "The orphan account ID passed from the trigger",
      governanceStarted: "true when review was successfully started",
    },
    igaFields: [],
  },

  AssignIAMTeam: {
    category: "action",
    title: "Assign Reviewer",
    help: "Sets the orphan account status to UNDER_REVIEW and records which team or person is responsible for the decision. Works for any reviewer — IAM team, manager, business owner, or any custom label.",
    defaultConfig: { reviewerLabel: "IAM Team" },
    fields: [
      {
        key: "reviewerLabel",
        label: "Reviewer label",
        type: "text",
        required: false,
        placeholder: "IAM Team",
        help: "Who is being asked to decide (e.g. IAM Team, Manager, Business Owner). Stored on the orphan record for audit.",
        section: "basic",
      },
    ],
    outputSchema: {
      orphanId: "The orphan account ID",
      reviewerLabel: "Label of the assigned reviewer (e.g. IAM Team, Manager)",
      reviewerAssigned: "true when the assignment was recorded",
      iamTeamAssigned: "true when the assignment was recorded (alias for backward compatibility)",
    },
    igaFields: [],
  },

  SchedulerCheck: {
    category: "action",
    title: "Decision Check",
    help: "Checks if a decision has been recorded. If not, sends a reminder email to the configured reviewer (IAM team, manager, or anyone). Branches: true = decision received, false = still waiting (reminder sent).",
    defaultConfig: {
      to: "$.config.reviewerEmail",
      from: "$.config.workflowFromEmail",
      subject: "Reminder: Review pending — {{$.trigger.accountName}}",
      body: "Hello,\n\nThis is an automated reminder. The orphan account {{$.trigger.accountName}} on {{$.trigger.applicationName}} is still awaiting your decision.\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    },
    fields: [
      {
        key: "to",
        label: "Reminder to",
        type: "text",
        required: false,
        allowVariable: true,
        placeholder: "$.config.reviewerEmail",
        help: "Who receives the reminder — any email or variable (e.g. $.config.iamTeamEmail, $.trigger.managerEmail).",
        section: "basic",
      },
      { key: "subject", label: "Reminder subject", type: "text", required: false, allowVariable: true, section: "basic" },
      { key: "body", label: "Reminder body", type: "textarea", required: false, allowVariable: true, section: "basic" },
    ],
    outputSchema: {
      orphanId: "The orphan account ID",
      hasDecision: "true if a decision has already been recorded",
      reminderSent: "true if a reminder email was sent (no decision yet)",
    },
    igaFields: [],
  },

  WaitForIAMDecision: {
    category: "action",
    title: "Wait for Decision",
    help: "Pauses the workflow until someone records a decision via the review portal link from the email step (Assign / Delete / Disable / Ignore). Works for any reviewer — IAM team, manager, business owner, or anyone you send the email to. Rename the step label on the canvas to match your audience (e.g. 'Wait for Manager Decision').",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      orphanId: "The orphan account ID",
      waitingForDecision: "true when workflow is suspended",
    },
    igaFields: [],
  },

  JoinerDetected: {
    category: "trigger",
    title: "Joiner Detected",
    help: "Starts when a Joiner provisioning request is created after HRMS/lifecycle insert and rule match.",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      provisioningRequestId: "The Joiner provisioning request ID",
      identityId: "The joiner identity ID",
      applicationId: "Target application ID",
      approvalDecision: "APPROVED | REJECTED once recorded",
    },
    infoOnly: true,
  },

  WaitForJoinerApproval: {
    category: "action",
    title: "Wait for Joiner Approval",
    help: "Pauses until an approver records APPROVED or REJECTED on the Joiner provisioning request.",
    defaultConfig: {
      checkpointNodeId: "checkDecision",
    },
    fields: [
      {
        key: "checkpointNodeId",
        label: "Checkpoint node id",
        type: "text",
        required: false,
        section: "basic",
        help: "Node id to resume after approval (usually checkDecision).",
      },
    ],
    outputSchema: {
      waitingForApproval: "true while suspended",
      approvalDecision: "APPROVED | REJECTED when available",
      provisioningRequestId: "Joiner request ID",
    },
    igaFields: [],
  },

  CheckJoinerDecision: {
    category: "operator",
    title: "Check Joiner Decision",
    help: "Branches on Joiner approval decision (APPROVED vs REJECTED).",
    defaultConfig: {
      branchLabelTrue: "Approved",
      branchLabelFalse: "Rejected",
    },
    fields: [
      {
        key: "branchLabelTrue",
        label: "Approved branch label",
        type: "text",
        required: false,
        section: "basic",
      },
      {
        key: "branchLabelFalse",
        label: "Rejected branch label",
        type: "text",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: {
      approvalDecision: "APPROVED | REJECTED",
      approved: "true when APPROVED",
    },
    igaFields: [],
  },

  ProvisionJoinerAccount: {
    category: "action",
    title: "Provision Joiner Account",
    help: "After approval, compiles the Provisioning Plan and ADD_ACCOUNT task for the connector worker.",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      planId: "Compiled provisioning plan ID",
      taskId: "Created ADD_ACCOUNT task ID",
      provisioningRequestId: "Joiner request ID",
    },
    igaFields: [],
  },

  RejectJoinerRequest: {
    category: "action",
    title: "Reject Joiner Request",
    help: "Cancels the Joiner provisioning request without creating an executable task.",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      provisioningRequestId: "Cancelled Joiner request ID",
      rejected: "true when rejection is recorded",
    },
    igaFields: [],
  },

  RecordIAMDecision: {
    category: "action",
    title: "Read Decision",
    help: "Reads the decision recorded on the orphan account by any reviewer (IAM team, manager, or anyone) and passes it to downstream operators (e.g. Decision = Delete?).",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      orphanId: "The orphan account ID",
      decision: "ASSIGN | DELETE | DISABLE | IGNORE — the decision recorded by the reviewer",
      iamDecision: "ASSIGN | DELETE | DISABLE | IGNORE (alias for backward compatibility)",
      decisionRecorded: "true when a decision was found",
    },
    igaFields: [],
  },

  GetCertificationItem: {
    category: "action",
    title: "Get Certification Item",
    help: "Reads the signed-off review item from the trigger payload. No access inventory scan — uses the single certified item only.",
    defaultConfig: {},
    fields: [],
    outputSchema: {
      reviewItem: { ...TRIGGER_OUTPUT_SCHEMA },
      identity: {
        id: "(identityId)",
        displayName: "(identityName)",
        email: "(identityEmail)",
        managerEmail: "(managerEmail)",
        managerName: "(managerName)",
      },
    },
    infoOnly: true,
  },

  CompareStrings: {
    category: "operator",
    title: "Compare Strings",
    help: "Branches workflow on string equality. Connect each labeled handle to the next step.",
    defaultConfig: {
      left: "$.trigger.decision",
      right: "Revoke",
      branchLabelTrue: "Yes",
      branchLabelFalse: "No",
    },
    presets: [
      {
        id: "emailSent",
        label: "Email sent?",
        config: {
          left: "$.steps.<sendEmailStepId>.queued",
          right: "true",
          branchLabelTrue: "Sent",
          branchLabelFalse: "Failed",
        },
      },
      {
        id: "decisionRevoke",
        label: "Decision = Revoke",
        config: {
          left: "$.trigger.decision",
          right: "Revoke",
          branchLabelTrue: "Yes",
          branchLabelFalse: "No",
        },
      },
      {
        id: "accessStillPresent",
        label: "Access still present?",
        config: {
          left: "$.steps.verify.stillPresent",
          right: "true",
          branchLabelTrue: "Still present",
          branchLabelFalse: "Removed",
        },
      },
    ],
    fields: [
      {
        key: "left",
        label: "First value",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.<emailStep>.queued or $.trigger.decision",
        igaRef: "Prior step output or trigger field — see guidance above",
        section: "basic",
      },
      {
        key: "right",
        label: "Second value",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "Revoke",
        section: "basic",
      },
      {
        key: "branchLabelTrue",
        label: "Yes branch label",
        type: "text",
        required: false,
        placeholder: "Yes",
        help: "Label on the left/green connector when condition is true (e.g. Still present).",
        section: "basic",
      },
      {
        key: "branchLabelFalse",
        label: "No branch label",
        type: "text",
        required: false,
        placeholder: "No",
        help: "Label on the right/red connector when condition is false (e.g. Removed).",
        section: "basic",
      },
    ],
    outputSchema: { left: "Revoke", right: "Revoke", match: true },
  },

  CompareNumbers: {
    category: "operator",
    title: "Compare Numbers",
    help: "Branches workflow on numeric comparison (e.g. loop iteration vs retry threshold). Connect each labeled handle to the next step.",
    defaultConfig: {
      left: "$.steps.retryLoop.iteration",
      operator: ">",
      right: 4,
      branchLabelTrue: "Escalate To IAM",
      branchLabelFalse: "Retry Again",
    },
    presets: [
      {
        id: "retryLimitExceeded",
        label: "Retry limit exceeded",
        config: {
          left: "$.steps.retryLoop.iteration",
          operator: ">",
          right: 4,
          branchLabelTrue: "Escalate To IAM",
          branchLabelFalse: "Retry Again",
        },
      },
    ],
    fields: [
      {
        key: "left",
        label: "First value",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.retryLoop.iteration",
        help: "Numeric workflow variable (e.g. loop iteration count).",
        section: "basic",
      },
      {
        key: "operator",
        label: "Comparison operator",
        type: "select",
        required: true,
        options: COMPARE_NUMBER_OPERATORS,
        section: "basic",
      },
      {
        key: "right",
        label: "Second value",
        type: "number",
        required: true,
        help: "Literal threshold to compare against (e.g. max retry count).",
        section: "basic",
      },
      {
        key: "branchLabelTrue",
        label: "Yes branch label",
        type: "text",
        required: false,
        placeholder: "Escalate To IAM",
        help: "Label when comparison is true (e.g. threshold exceeded).",
        section: "basic",
      },
      {
        key: "branchLabelFalse",
        label: "No branch label",
        type: "text",
        required: false,
        placeholder: "Retry Again",
        help: "Label when comparison is false (e.g. continue retry).",
        section: "basic",
      },
    ],
    outputSchema: { left: 1, right: 4, operator: ">", match: true },
  },

  Loop: {
    category: "operator",
    title: "Loop",
    help: "Tracks remediation verification attempts and exposes an iteration counter for downstream steps. Re-enter this step on subsequent workflow runs to increment the counter (not via in-graph back-edges).",
    defaultConfig: {
      maxIterations: 10,
      iterationVariableName: "iteration",
    },
    presets: [
      {
        id: "retryVerification",
        label: "Retry verification loop",
        config: {
          maxIterations: 10,
          iterationVariableName: "iteration",
        },
      },
    ],
    fields: [
      {
        key: "maxIterations",
        label: "Maximum iterations",
        type: "number",
        required: true,
        min: 1,
        help: "Safety cap on verification retries (minimum 1).",
        section: "basic",
      },
      {
        key: "iterationVariableName",
        label: "Iteration variable name",
        type: "text",
        required: false,
        placeholder: "iteration",
        help: "Name exposed to downstream steps via $.steps.<nodeId>.<name>.",
        section: "basic",
      },
      {
        key: "outputPreview",
        label: "Output variable preview",
        type: "readonly",
        computed: "loopOutput",
        help: "JSONPath downstream steps can reference for the current iteration.",
        section: "basic",
      },
    ],
    outputSchema: { iteration: 1, maxIterations: 10 },
  },

  VerifyDataType: {
    category: "operator",
    title: "Verify Data Type",
    help: "Checks whether a field exists or is empty. Use with Yes/No branches.",
    defaultConfig: {
      field: "$.steps.verify.stillPresent",
      check: "notExists",
    },
    fields: [
      {
        key: "field",
        label: "Field to check",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.verify.stillPresent",
        section: "basic",
      },
      {
        key: "check",
        label: "Check type",
        type: "select",
        required: true,
        options: [
          { value: "exists", label: "Exists" },
          { value: "notExists", label: "Does not exist / is false" },
        ],
        section: "basic",
      },
    ],
    outputSchema: { field: false, check: "notExists", match: true },
  },

  RevokeAccess: {
    category: "action",
    title: "Revoke Access",
    help: "Removes the certified entitlement only (from trigger / provisioning payload). Does not evaluate all user access.",
    defaultConfig: {
      identityId: "$.trigger.identityId",
      entitlementId: "$.trigger.entitlementId",
      entitlementName: "$.trigger.entitlementName",
    },
    fields: [
      {
        key: "identityId",
        label: "Identity",
        type: "text",
        required: true,
        allowVariable: true,
        igaRef: "provisioningPayload.identityId",
        section: "basic",
      },
      {
        key: "entitlementId",
        label: "Entitlement ID",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "provisioningPayload.entitlementId",
        section: "basic",
      },
      {
        key: "entitlementName",
        label: "Entitlement name",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "provisioningPayload.entitlementName",
        section: "basic",
      },
      {
        key: "provisioningActionHint",
        label: "Provisioning action (IGA)",
        type: "readonly",
        value: "REMOVE_ENTITLEMENT",
        igaRef: "ReviewItem.provisioningAction",
        section: "basic",
      },
    ],
    outputSchema: {
      identityId: "(identityId)",
      entitlementId: "(entitlementId)",
      success: true,
      removedCount: 1,
    },
  },

  VerifyAccessRemoved: {
    category: "action",
    title: "Verify Access Removed",
    help: "After revoke, checks whether the certified entitlement still exists. Connect once to a Compare Strings step (e.g. Access Still Present?) for success/failure branches.",
    defaultConfig: {
      identityId: "$.trigger.identityId",
      entitlementId: "$.trigger.entitlementId",
      entitlementName: "$.trigger.entitlementName",
    },
    fields: [
      {
        key: "identityId",
        label: "Identity",
        type: "text",
        required: true,
        allowVariable: true,
        igaRef: "provisioningPayload.identityId",
        section: "basic",
      },
      {
        key: "entitlementId",
        label: "Entitlement ID",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "provisioningPayload.entitlementId",
        section: "basic",
      },
      {
        key: "entitlementName",
        label: "Entitlement name",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "provisioningPayload.entitlementName",
        section: "basic",
      },
    ],
    outputSchema: {
      verificationStatus: "STILL_PRESENT | REMOVED | VERIFICATION_FAILED",
      stillPresent: false,
      verified: true,
      verificationReason: null,
      portalLink: "{{$.config.portalBaseUrl}}/identities/(identityId)",
    },
  },

  SendEmail: {
    category: "action",
    title: "Send Email",
    help: "Sends email via the configured notification channel. For IAM orphan triggers, set includeReviewPortal to embed a unique portal link via {{$.config.reviewPortalUrl}} (tracks which email/step opened the review).",
    defaultConfig: {
      to: "$.trigger.identityEmail",
      from: "$.config.workflowFromEmail",
      subject: "Access Revoked: {{$.trigger.entitlementName}} on {{$.trigger.applicationName}}",
      body: "Hello {{$.trigger.identityName}},\n\nYour access \"{{$.trigger.entitlementName}}\" on {{$.trigger.applicationName}} was revoked per certification campaign {{$.trigger.campaignName}}.\n\nIf you believe this is an error, contact your manager or IAM team.",
      includeReviewPortal: true,
    },
    presets: [
      { id: "userRevoked", ...EMAIL_PRESETS.userRevoked },
      { id: "managerNotify", ...EMAIL_PRESETS.managerNotify },
      { id: "iamEscalation", ...EMAIL_PRESETS.iamEscalation },
      { id: "iamAccessStillPresent", ...EMAIL_PRESETS.iamAccessStillPresent },
      { id: "iamOrphanReview", ...EMAIL_PRESETS.iamOrphanReview },
      { id: "iamOrphanReminder", ...EMAIL_PRESETS.iamOrphanReminder },
      { id: "reviewRequest", ...EMAIL_PRESETS.reviewRequest },
      { id: "reviewReminder", ...EMAIL_PRESETS.reviewReminder },
    ],
    fields: [
      {
        key: "includeReviewPortal",
        label: "Embed review portal link",
        type: "toggle",
        required: false,
        help: "When the trigger includes orphanId, auto-injects {{$.config.reviewPortalUrl}} for this email step (token tracks step + source).",
        section: "basic",
      },
      {
        key: "reviewPortalSource",
        label: "Review portal source label",
        type: "text",
        required: false,
        placeholder: "initial-action-email",
        help: "Optional audit label stored on the portal token when IAM decides (e.g. reminder-phase-2).",
        section: "basic",
      },
      {
        key: "to",
        label: "Recipient",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.trigger.identityEmail",
        igaRef: "ReviewItem.itemEmail or managerEmail",
        section: "basic",
      },
      {
        key: "from",
        label: "From",
        type: "text",
        required: false,
        allowVariable: true,
        section: "basic",
      },
      {
        key: "subject",
        label: "Subject",
        type: "text",
        required: true,
        allowVariable: true,
        supportsInline: true,
        section: "basic",
      },
      {
        key: "body",
        label: "Message body",
        type: "textarea",
        required: true,
        allowVariable: true,
        supportsInline: true,
        section: "basic",
      },
    ],
    outputSchema: {
      emailId: "(id)",
      emailJobId: "(job id)",
      reviewPortalUrl: "(per-step portal link when orphanId present)",
      reviewPortalSource: "(audit source label)",
      to: "(recipient)",
      subject: "(subject)",
      queued: true,
    },
  },

  CreateTicket: {
    category: "action",
    title: "Create Ticket",
    help: "Creates a remediation ticket in the selected provider. Basic fields define the ticket summary; Advanced stores user/manager/reviewer context on the ticket record. Use the preset to fill both tabs from the trigger.",
    tabHints: {
      basic:
        "Required: Title and Description. Provider, Priority, and Assigned team are optional routing fields.",
      advanced:
        "Optional context fields stored on the ticket. Leave blank to auto-fill from the trigger at runtime.",
    },
    defaultConfig: {
      provider: "internal",
      title: "",
      description: "",
      priority: "MEDIUM",
      assignedTeam: "Identity Team",
    },
    presets: [
      { id: "accessRevokePopulate", ...TICKET_PRESETS.accessRevokePopulate },
      { id: "certRevokeFailed", ...TICKET_PRESETS.certRevokeFailed },
    ],
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        required: false,
        options: TICKET_PROVIDER_OPTIONS,
        help: "Only Internal is live today. Other selections are saved in the workflow but run as Internal until that integration ships.",
        section: "basic",
      },
      {
        key: "title",
        label: "Title",
        type: "text",
        required: true,
        allowVariable: true,
        supportsInline: true,
        igaRef: "WorkflowTicket.title",
        section: "basic",
      },
      {
        key: "priority",
        label: "Priority",
        type: "select",
        required: false,
        options: [
          { value: "HIGH", label: "High" },
          { value: "MEDIUM", label: "Medium" },
          { value: "LOW", label: "Low" },
        ],
        igaRef: "WorkflowTicket.priority",
        section: "basic",
      },
      {
        key: "assignedTeam",
        label: "Assigned team",
        type: "text",
        required: false,
        allowVariable: true,
        help: "Optional — which team queue owns this ticket in the internal tracker (e.g. Identity Team). Not the same as Assignee.",
        section: "basic",
      },
      {
        key: "description",
        label: "Description",
        type: "textarea",
        required: true,
        allowVariable: true,
        supportsInline: true,
        placeholder: "User {{$.trigger.identityName}} access to {{$.trigger.applicationName}} revoked",
        igaRef: "WorkflowTicket.description",
        section: "basic",
      },
      {
        key: "identityEmail",
        label: "User email",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "ReviewItem.itemEmail",
        section: "advanced",
      },
      {
        key: "managerName",
        label: "Manager name",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "ReviewItem.itemManager",
        section: "advanced",
      },
      {
        key: "managerEmail",
        label: "Manager email",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "ReviewItem.itemManagerEmail",
        section: "advanced",
      },
      {
        key: "reviewerName",
        label: "Reviewer",
        type: "text",
        required: false,
        allowVariable: true,
        igaRef: "ReviewItem.reviewerName",
        section: "advanced",
      },
      {
        key: "reviewDate",
        label: "Review date",
        type: "text",
        required: false,
        allowVariable: true,
        section: "advanced",
      },
      {
        key: "comments",
        label: "Comments",
        type: "textarea",
        required: false,
        allowVariable: true,
        supportsInline: true,
        igaRef: "decision comment",
        section: "advanced",
      },
    ],
    hasAdvanced: true,
    outputSchema: {
      ticketId: "TKT-000001",
      provider: "internal",
      status: "NEW",
      title: "...",
    },
  },

  GetTicket: {
    category: "action",
    title: "Get Ticket",
    help: "Reads the current status/owner of a ticket (used by human-in-the-loop flows to poll until CLOSED).",
    defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        required: false,
        options: TICKET_PROVIDER_OPTIONS,
        section: "basic",
      },
      {
        key: "ticketId",
        label: "Ticket ID",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.createTicket.ticketId",
        section: "basic",
      },
    ],
    outputSchema: { ticketId: "TKT-000001", status: "CLOSED", closed: true },
  },

  UpdateTicket: {
    category: "action",
    title: "Update Ticket",
    help: "Updates ticket fields (status, priority, assignee, comments).",
    defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        required: false,
        options: TICKET_PROVIDER_OPTIONS,
        section: "basic",
      },
      {
        key: "ticketId",
        label: "Ticket ID",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.createTicket.ticketId",
        section: "basic",
      },
      {
        key: "status",
        label: "Status",
        type: "select",
        required: false,
        options: [{ value: "", label: "(unchanged)" }, ...TICKET_STATUS_OPTIONS],
        section: "basic",
      },
      {
        key: "assignee",
        label: "Assignee",
        type: "text",
        required: false,
        allowVariable: true,
        section: "basic",
      },
      {
        key: "comments",
        label: "Comments",
        type: "textarea",
        required: false,
        allowVariable: true,
        supportsInline: true,
        section: "basic",
      },
    ],
    outputSchema: { ticketId: "TKT-000001", status: "IN_PROGRESS" },
  },

  CloseTicket: {
    category: "action",
    title: "Close Ticket",
    help: "Closes the ticket with an optional resolution note.",
    defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        required: false,
        options: TICKET_PROVIDER_OPTIONS,
        section: "basic",
      },
      {
        key: "ticketId",
        label: "Ticket ID",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.steps.createTicket.ticketId",
        section: "basic",
      },
      {
        key: "resolution",
        label: "Resolution",
        type: "textarea",
        required: false,
        allowVariable: true,
        supportsInline: true,
        placeholder: "Access revoked and confirmed.",
        section: "basic",
      },
    ],
    outputSchema: { ticketId: "TKT-000001", status: "CLOSED" },
  },

  UpdateQueueTask: {
    category: "action",
    title: "Update Queue Task",
    help: "Sets the remediation queue task status from the canvas (e.g. COMPLETED). The certification is finalized as REVOKED when the workflow ends successfully.",
    defaultConfig: { status: "COMPLETED" },
    fields: [
      {
        key: "status",
        label: "Queue status",
        type: "select",
        required: true,
        options: [
          { value: "COMPLETED", label: "Completed" },
          { value: "WAITING", label: "Waiting" },
          { value: "IN_PROGRESS", label: "In Progress" },
          { value: "FAILED", label: "Failed" },
        ],
        section: "basic",
      },
    ],
    outputSchema: { updated: true, status: "COMPLETED" },
  },

  Switch: {
    category: "operator",
    title: "Switch",
    help: "Branches on a field value. Add cases (value → branch); connect each branch handle. Falls back to the default branch when no case matches.",
    defaultConfig: { field: "$.trigger.decision", defaultBranch: "default" },
    fields: [
      {
        key: "field",
        label: "Field to switch on",
        type: "text",
        required: true,
        allowVariable: true,
        placeholder: "$.trigger.decision",
        section: "basic",
      },
      {
        key: "defaultBranch",
        label: "Default branch label",
        type: "text",
        required: false,
        placeholder: "default",
        section: "basic",
      },
    ],
    outputSchema: { value: "(field value)", branch: "(matched case)", matched: true },
  },

  AuditLog: {
    category: "action",
    title: "Audit Log",
    help: "Records governance evidence for certification remediation workflows and auditors.",
    defaultConfig: {
      action: "CERTIFICATION_REVOKE_WORKFLOW",
      outcome: "SUCCESS",
      message: "Certification revoke enforced for {{$.trigger.identityName}} / {{$.trigger.entitlementName}}",
    },
    presets: [
      { id: "certRevokeSuccess", ...AUDIT_PRESETS.certRevokeSuccess },
      { id: "certRevokeFailure", ...AUDIT_PRESETS.certRevokeFailure },
    ],
    fields: [
      {
        key: "action",
        label: "Action code",
        type: "text",
        required: true,
        placeholder: "CERTIFICATION_REVOKE_WORKFLOW",
        help: "Required governance action identifier for audit records.",
        section: "basic",
      },
      {
        key: "outcome",
        label: "Outcome",
        type: "select",
        required: false,
        options: [
          { value: "SUCCESS", label: "Success" },
          { value: "FAILURE", label: "Failure" },
          { value: "WARNING", label: "Warning" },
        ],
        allowVariable: true,
        section: "basic",
      },
      {
        key: "message",
        label: "Audit message",
        type: "textarea",
        required: false,
        rows: 8,
        allowVariable: true,
        supportsInline: true,
        placeholder: "Identity: {{$.trigger.identityName}}\nEntitlement: {{$.trigger.entitlementName}}",
        help: "Supports template variables: {{$.trigger.identityName}}, {{$.trigger.entitlementName}}, {{$.trigger.reviewItemId}}, {{$.steps.retryLoop.iteration}}",
        section: "basic",
      },
    ],
    outputSchema: { auditId: "audit-1", action: "CERT_REVOKE_SUCCESS", outcome: "SUCCESS" },
  },

  Scheduler: {
    category: "action",
    title: "Scheduler",
    help: "Pauses workflow execution and resumes later at a configured step (e.g. wait then re-verify access removal).",
    defaultConfig: {
      scheduleType: "relativeDelay",
      delayValue: 1,
      delayUnit: "hours",
      resumeWorkflow: true,
      nextStepId: "",
    },
    presets: [
      {
        id: "wait5Hours",
        label: "Wait 5 hours then re-verify",
        config: {
          scheduleType: "relativeDelay",
          delayValue: 5,
          delayUnit: "hours",
          resumeWorkflow: true,
          nextStepId: "",
        },
      },
    ],
    fields: [
      {
        key: "scheduleType",
        label: "Schedule type",
        type: "select",
        required: true,
        options: [{ value: "relativeDelay", label: "Relative delay" }],
        section: "basic",
      },
      {
        key: "delayValue",
        label: "Delay value",
        type: "number",
        required: true,
        min: 1,
        help: "Must be greater than 0.",
        section: "basic",
        visibleWhen: { scheduleType: "relativeDelay" },
      },
      {
        key: "delayUnit",
        label: "Delay unit",
        type: "select",
        required: true,
        options: SCHEDULER_DELAY_UNITS,
        section: "basic",
        visibleWhen: { scheduleType: "relativeDelay" },
      },
      {
        key: "resumeWorkflow",
        label: "Resume workflow",
        type: "toggle",
        required: false,
        help: "When enabled, workflow resumes automatically after the delay expires.",
        section: "basic",
      },
      {
        key: "nextStepId",
        label: "Next step",
        type: "stepSelect",
        required: false,
        help: "Workflow step to execute when the delay expires.",
        section: "basic",
        visibleWhen: { resumeWorkflow: true },
      },
      {
        key: "schedulePreview",
        label: "Schedule preview",
        type: "readonly",
        computed: "schedulerPreview",
        section: "basic",
        visibleWhen: { scheduleType: "relativeDelay" },
      },
    ],
    outputSchema: {
      scheduled: true,
      resumeAt: "(ISO timestamp)",
      nextStepId: "(node id)",
    },
  },

  EndSuccess: {
    category: "operator",
    title: "End Step — Success",
    help: "Terminates this branch as successful. No outgoing connections.",
    defaultConfig: { description: "" },
    fields: [
      {
        key: "description",
        label: "End description",
        type: "textarea",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: { ended: true, status: "SUCCESS" },
  },

  EndFailure: {
    category: "operator",
    title: "End Step — Failure",
    help: "Terminates this branch as failed (e.g. after IAM escalation).",
    defaultConfig: { description: "" },
    fields: [
      {
        key: "description",
        label: "End description",
        type: "textarea",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: { ended: true, status: "FAILURE" },
  },

  EndWaiting: {
    category: "operator",
    title: "End Step — Still Waiting",
    help: "Parks this branch while IAM decision is still pending (used after reminder checks).",
    defaultConfig: { waitReason: "IAM_DECISION", description: "" },
    fields: [
      {
        key: "description",
        label: "End description",
        type: "textarea",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: { ended: true, status: "WAITING" },
  },

  CatalogStub: {
    category: "action",
    title: "ISC catalog step",
    help: "Placed for workflow design. Demo runtime skips execution; use executable steps (blue in palette) to test flows.",
    defaultConfig: { catalogLabel: "", catalogCategory: "action", description: "" },
    fields: [
      {
        key: "description",
        label: "Notes",
        type: "textarea",
        required: false,
        section: "basic",
      },
    ],
    outputSchema: { designOnly: true },
  },
};

export function getStepDefinition(stepType) {
  return STEP_CONFIG_CATALOG[stepType] || null;
}

export function getDefaultConfig(stepType) {
  const def = getStepDefinition(stepType);
  if (!def) return {};
  return JSON.parse(JSON.stringify(def.defaultConfig || {}));
}

export function mergeConfigWithDefaults(stepType, existingConfig = {}) {
  const defaults = getDefaultConfig(stepType);
  const raw = existingConfig || {};
  const keys = Object.keys(raw);

  // Brand-new step with no saved config — apply full defaults once.
  if (keys.length === 0) {
    return { ...defaults };
  }

  // Respect explicit clears ("") and user edits; only backfill keys never set.
  const merged = { ...raw };
  for (const [key, defaultVal] of Object.entries(defaults)) {
    if (merged[key] === undefined) {
      merged[key] = defaultVal;
    }
  }
  return merged;
}

export function getOutputSchema(stepType, nodeId) {
  const def = getStepDefinition(stepType);
  return def?.outputSchema || {};
}

const TRIGGER_STEP_TYPES = new Set(["CertificationSignedOff", "UncorrelatedAccountIAMDecision"]);

/** Walk workflow graph from trigger for variable picker ordering */
export function getPriorStepsInOrder(nodes, edges, currentStepId) {
  const trigger = nodes.find((n) => TRIGGER_STEP_TYPES.has(n.data?.stepType));
  if (!trigger) return [];

  const outMap = {};
  edges.forEach((e) => {
    if (!outMap[e.source]) outMap[e.source] = [];
    outMap[e.source].push({ to: e.target, branch: e.data?.branch });
  });

  const ordered = [];
  const visited = new Set();

  function walk(id) {
    if (!id || visited.has(id) || id === currentStepId) return;
    visited.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node && node.id !== currentStepId) {
      ordered.push(node);
    }
    const outs = outMap[id] || [];
    outs.forEach((o) => walk(o.to));
  }

  walk(trigger.id);
  return ordered.filter((n) => n.id !== currentStepId);
}

const SCHEDULER_UNIT_LABELS = {
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

/** Whether a catalog field should render given current config (visibleWhen). */
export function isFieldVisible(field, config = {}) {
  const when = field.visibleWhen;
  if (!when || typeof when !== "object") return true;
  return Object.entries(when).every(([key, expected]) => {
    const actual = config[key];
    if (expected === true) return actual !== false && actual !== "false";
    if (expected === false) return actual === false || actual === "false";
    return actual === expected;
  });
}

/** Dynamic display for readonly computed fields in the properties panel. */
export function computeFieldDisplayValue(field, config = {}, node = {}) {
  if (field.computed === "loopOutput") {
    const varName = String(config.iterationVariableName || "iteration").trim() || "iteration";
    return `$.steps.${node.id}.${varName}`;
  }
  if (field.computed === "schedulerPreview") {
    const delayValue = Number(config.delayValue);
    if (!delayValue || delayValue <= 0) return "Enter a delay value greater than 0";
    const unit = SCHEDULER_UNIT_LABELS[config.delayUnit] || config.delayUnit || "Hours";
    return `Workflow will resume in ${delayValue} ${unit}`;
  }
  return field.value ?? config[field.key] ?? "";
}

function validateNumberField(field, val, label, errors) {
  if (val === "" || val == null) {
    if (field.required) errors.push(`${label}: ${field.label} is required`);
    return;
  }
  const num = Number(val);
  if (Number.isNaN(num)) {
    errors.push(`${label}: ${field.label} must be a number`);
    return;
  }
  if (field.min != null && num < field.min) {
    errors.push(`${label}: ${field.label} must be at least ${field.min}`);
  }
  if (field.max != null && num > field.max) {
    errors.push(`${label}: ${field.label} must be at most ${field.max}`);
  }
}

export function validateStepConfig(stepType, label, config = {}) {
  if (stepType === "CatalogStub") return [];
  const def = getStepDefinition(stepType);
  if (!def) return [];
  const errors = [];
  const stepLabel = label || stepType;

  for (const field of def.fields || []) {
    if (!isFieldVisible(field, config)) continue;
    if (field.type === "readonly") continue;

    const val = config[field.key];

    if (field.type === "number") {
      validateNumberField(field, val, stepLabel, errors);
      continue;
    }

    if (field.type === "stepSelect") {
      const resumeOn = config.resumeWorkflow !== false && config.resumeWorkflow !== "false";
      if (field.key === "nextStepId" && resumeOn && field.required !== false) {
        if (val == null || String(val).trim() === "") {
          errors.push(`${stepLabel}: ${field.label} is required when resume workflow is enabled`);
        }
      }
      continue;
    }

    if (!field.required) continue;
    if (val == null || String(val).trim() === "") {
      errors.push(`${stepLabel}: ${field.label} is required`);
    }
  }

  if (stepType === "CompareNumbers") {
    const right = config.right;
    if (right !== "" && right != null && Number.isNaN(Number(right))) {
      errors.push(`${stepLabel}: Second value must be a number`);
    }
  }

  if (stepType === "Scheduler") {
    const delay = Number(config.delayValue);
    if (!Number.isNaN(delay) && delay <= 0) {
      errors.push(`${stepLabel}: Delay value must be greater than 0`);
    }
    const resumeOn = config.resumeWorkflow !== false && config.resumeWorkflow !== "false";
    if (resumeOn && !String(config.nextStepId || "").trim()) {
      errors.push(`${stepLabel}: Next step is required when resume workflow is enabled`);
    }
  }

  return errors;
}

export function validateAllNodeConfigs(nodes) {
  const errors = [];
  for (const node of nodes) {
    const t = node.data?.stepType;
    const label = node.data?.label || t;
    errors.push(...validateStepConfig(t, label, node.data?.config || {}));
  }
  return errors;
}

/**
 * Context-aware variable hints for the builder variable picker (ISC-style).
 * Filters and highlights paths based on the step being configured and the field.
 */
export function getFieldVariableHints(stepType, fieldKey) {
  const fk = String(fieldKey || "").toLowerCase();

  if (stepType === "SendEmail" || stepType === "SchedulerCheck") {
    if (fk === "to") {
      return {
        recommended: [
          "$.config.reviewerEmail",
          "$.trigger.identityEmail",
          "$.trigger.managerEmail",
          "$.config.iamTeamEmail",
        ],
        filter: (p) =>
          /email/i.test(p.path) ||
          /iamteam/i.test(p.path) ||
          /reviewer/i.test(p.path) ||
          p.path.startsWith("$.config."),
      };
    }
    if (fk === "from") {
      return {
        recommended: ["$.config.workflowFromEmail"],
        filter: (p) => p.path.startsWith("$.config.") || /from/i.test(p.path),
      };
    }
    if (fk === "subject" || fk === "body") {
      return {
        recommended: [
          "$.trigger.identityName",
          "$.trigger.entitlementName",
          "$.trigger.applicationName",
          "$.trigger.campaignName",
          "$.steps.verify.portalLink",
        ],
        filter: () => true,
      };
    }
  }

  if (stepType === "CreateTicket") {
    if (fk === "assignee" || fk === "assignedteam") {
      return {
        recommended: ["$.config.iamTeamEmail"],
        filter: (p) => /email|team/i.test(p.path) || p.path.startsWith("$.config."),
      };
    }
    if (fk === "identityemail") {
      return { recommended: ["$.trigger.identityEmail"], filter: (p) => /email/i.test(p.path) };
    }
    if (fk === "manageremail") {
      return { recommended: ["$.trigger.managerEmail"], filter: (p) => /email/i.test(p.path) };
    }
    if (fk === "managername") {
      return { recommended: ["$.trigger.managerName"], filter: () => true };
    }
    if (["title", "description", "comments"].includes(fk)) {
      return {
        recommended: [
          "$.trigger.identityName",
          "$.trigger.managerName",
          "$.trigger.entitlementName",
          "$.trigger.applicationName",
          "$.trigger.reviewerName",
        ],
        filter: () => true,
      };
    }
  }

  if (["GetTicket", "UpdateTicket", "CloseTicket"].includes(stepType) && fk === "ticketid") {
    return {
      recommended: ["$.steps.createTicket.ticketId"],
      filter: (p) => /ticket/i.test(p.path) || p.path.startsWith("$.steps."),
    };
  }

  if (stepType === "CompareNumbers" && fk === "left") {
    return {
      recommended: ["$.steps.retryLoop.iteration"],
      filter: (p) => /iteration/i.test(p.path) || p.path.startsWith("$.steps."),
    };
  }

  if (stepType === "CompareStrings" && fk === "left") {
    return {
      recommended: [
        "$.trigger.decision",
        "$.trigger.iamDecision",
      ],
      filter: (p) =>
        p.path.startsWith("$.steps.")
        || p.path.startsWith("$.trigger.")
        || /queued|decision|stillpresent/i.test(p.path),
    };
  }

  if (stepType === "CompareStrings" && fk === "right") {
    return {
      recommended: ["true", "Revoke"],
      filter: () => true,
    };
  }

  if (stepType === "AuditLog" && fk === "message") {
    return {
      recommended: [
        "$.trigger.identityName",
        "$.trigger.entitlementName",
        "$.trigger.reviewItemId",
        "$.steps.retryLoop.iteration",
      ],
      filter: () => true,
    };
  }

  return { recommended: [], filter: () => true };
}

/**
 * Default JSONPath when a field is in "Choose Variable" mode (auto-fill on select / clear).
 */
export function getDefaultVariablePath(
  stepType,
  fieldKey,
  { nodeLabel = "", nodeId, nodes = [], edges = [] } = {},
) {
  const fk = String(fieldKey || "").toLowerCase();
  const label = String(nodeLabel || "").toLowerCase();

  if (stepType === "CompareStrings" && fk === "left" && nodeId) {
    const prior = getPriorStepsInOrder(nodes, edges, nodeId);
    const sendEmails = prior.filter((n) => n.data?.stepType === "SendEmail");
    const email = sendEmails[sendEmails.length - 1];
    if (email) return `$.steps.${email.id}.queued`;
    if (label.includes("email") || label.includes("sent")) {
      const lastEmail = [...nodes]
        .filter((n) => n.data?.stepType === "SendEmail" && n.id !== nodeId)
        .sort((a, b) => (b.position?.y || 0) - (a.position?.y || 0))[0];
      if (lastEmail) return `$.steps.${lastEmail.id}.queued`;
    }
    return "$.trigger.decision";
  }

  if (stepType === "CompareStrings" && fk === "right") {
    if (label.includes("email") || label.includes("sent")) return "true";
    return "Revoke";
  }

  if (stepType === "SendEmail") {
    if (fk === "to") {
      if (label.includes("iam")) return "$.config.iamTeamEmail";
      if (label.includes("manager")) return "$.trigger.managerEmail";
      if (label.includes("reviewer") || label.includes("review")) return "$.config.reviewerEmail";
      return "$.trigger.identityEmail";
    }
    if (fk === "from") return "$.config.workflowFromEmail";
  }

  if (stepType === "SchedulerCheck" && fk === "to") {
    return "$.config.reviewerEmail";
  }

  if (stepType === "CreateTicket") {
    if (fk === "assignee") return "$.config.iamTeamEmail";
    if (fk === "identityemail") return "$.trigger.identityEmail";
    if (fk === "manageremail") return "$.trigger.managerEmail";
    if (fk === "managername") return "$.trigger.managerName";
  }

  if (["GetTicket", "UpdateTicket", "CloseTicket"].includes(stepType) && fk === "ticketid") {
    return "$.steps.createTicket.ticketId";
  }

  if (stepType === "CompareNumbers" && fk === "left") {
    return "$.steps.retryLoop.iteration";
  }

  const hints = getFieldVariableHints(stepType, fieldKey);
  return hints.recommended?.[0] || "";
}

/** True when value is empty or a broken partial JSONPath (e.g. lone "$"). */
export function isIncompleteVariableValue(val) {
  const s = String(val ?? "").trim();
  if (!s) return true;
  if (s === "$") return true;
  if (s.startsWith("$") && s.length < 4) return true;
  return false;
}

/** Build variable list for one prior step or the trigger. */
export function buildStepVariablePaths(selectedOption) {
  if (!selectedOption) return [];

  if (selectedOption.id === "trigger") {
    const triggerDef = getStepDefinition(selectedOption.stepType);
    const schema = triggerDef?.outputSchema || TRIGGER_OUTPUT_SCHEMA;
    const igaMap = {};
    for (const row of triggerDef?.igaFields || []) {
      if (row.path) igaMap[row.path] = row.igaRef;
    }
    return flattenVariableSchema(schema, "$.trigger", igaMap);
  }

  const def = getStepDefinition(selectedOption.stepType);
  const schema = def?.outputSchema || {};
  const prefix = `$.steps.${selectedOption.id}`;
  return flattenVariableSchema(schema, prefix, {});
}

function flattenVariableSchema(obj, prefix, igaMap = {}) {
  const paths = [];
  if (obj == null || typeof obj !== "object") return paths;
  for (const [key, val] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    const igaRef = igaMap[key];
    if (val != null && typeof val === "object" && !Array.isArray(val)) {
      paths.push(...flattenVariableSchema(val, path, igaMap));
    } else {
      paths.push({ path, label: key, sample: val, igaRef });
    }
  }
  return paths;
}

export function buildConfigVariablePaths() {
  return flattenVariableSchema(WORKFLOW_CONFIG_SCHEMA, "$.config", {});
}
