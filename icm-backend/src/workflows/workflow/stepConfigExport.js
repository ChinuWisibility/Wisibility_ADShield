/**
 * Backend mirror of the step config catalog for the builder API.
 * IGA field mapping documents how each trigger field maps to ReviewItem /
 * provisioningPayload so the same workflow works for any application (SAP, AD, …).
 */
export const STEP_CONFIG_CATALOG_EXPORT = {
  igaMapping: [
    { path: "identityId", igaRef: "ReviewItem.userId / provisioningPayload.identityId" },
    { path: "identityEmail", igaRef: "ReviewItem.itemEmail" },
    { path: "managerName", igaRef: "ReviewItem.itemManager" },
    { path: "managerEmail", igaRef: "ReviewItem.itemManagerEmail" },
    { path: "entitlementId", igaRef: "provisioningPayload.entitlementId" },
    { path: "entitlementName", igaRef: "provisioningPayload.entitlementName / ReviewItem.itemName" },
    { path: "applicationName", igaRef: "ReviewItem.itemApplicationName" },
    { path: "decision", igaRef: "ReviewItem.decision (Revoked)" },
    { path: "reviewerName", igaRef: "ReviewItem.reviewerName" },
    { path: "reviewDate", igaRef: "ReviewItem entitlement decision reviewedAt" },
    { path: "comment", igaRef: "ReviewItem entitlement decision comment" },
    { path: "reviewItemId", igaRef: "ReviewItem._id" },
    { path: "provisioningAction", igaRef: "ReviewItem.provisioningAction" },
  ],
  stepTypes: {
    CertificationSignedOff: {
      category: "trigger",
      requiredFields: [],
      defaultConfig: { filterDecision: "Revoke", advancedFilter: "" },
    },
    RevokeAccess: {
      category: "action",
      requiredFields: ["identityId"],
      defaultConfig: {
        identityId: "$.trigger.identityId",
        entitlementId: "$.trigger.entitlementId",
        entitlementName: "$.trigger.entitlementName",
      },
    },
    SendEmail: {
      category: "action",
      requiredFields: ["to", "subject", "body"],
    },
    CompareStrings: {
      category: "operator",
      requiredFields: ["left", "right"],
      defaultConfig: { left: "$.trigger.decision", right: "Revoke" },
    },
    CompareNumbers: {
      category: "operator",
      requiredFields: ["left", "operator", "right"],
      defaultConfig: {
        left: "$.steps.retryLoop.iteration",
        operator: ">",
        right: 4,
      },
    },
    Loop: {
      category: "operator",
      requiredFields: ["maxIterations"],
      defaultConfig: { maxIterations: 10, iterationVariableName: "iteration" },
    },
    Scheduler: {
      category: "action",
      requiredFields: ["scheduleType", "delayValue", "delayUnit"],
      defaultConfig: {
        scheduleType: "relativeDelay",
        delayValue: 1,
        delayUnit: "hours",
        resumeWorkflow: true,
      },
    },
    CreateTicket: {
      category: "action",
      requiredFields: ["title", "description"],
      defaultConfig: { provider: "internal", priority: "MEDIUM" },
    },
    GetTicket: {
      category: "action",
      requiredFields: [],
      defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    },
    UpdateTicket: {
      category: "action",
      requiredFields: [],
      defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    },
    CloseTicket: {
      category: "action",
      requiredFields: [],
      defaultConfig: { provider: "internal", ticketId: "$.steps.createTicket.ticketId" },
    },
    UpdateQueueTask: {
      category: "action",
      requiredFields: [],
      defaultConfig: { status: "COMPLETED" },
    },
    Switch: {
      category: "operator",
      requiredFields: ["field"],
      defaultConfig: { field: "$.trigger.decision", cases: [], defaultBranch: "default" },
    },
    VerifyAccessRemoved: {
      category: "action",
      requiredFields: ["identityId"],
    },
    AuditLog: { category: "action", requiredFields: ["action"] },
    GetCertificationItem: { category: "action", requiredFields: [], infoOnly: true },
    VerifyDataType: { category: "operator", requiredFields: ["field", "check"] },
    EndSuccess: { category: "operator", requiredFields: [] },
    EndFailure: { category: "operator", requiredFields: [] },
    EndWaiting: { category: "operator", requiredFields: [] },
    UncorrelatedAccountIAMDecision: { category: "trigger", requiredFields: [] },
    GetOrphanContext: { category: "action", requiredFields: [] },
    OrphanReminderSchedule: {
      category: "action",
      requiredFields: [],
      defaultConfig: { reminderPhases: "1h,3h,6h,12h", checkpointNodeId: "checkDecision" },
    },
    WaitForIAMDecision: { category: "action", requiredFields: [] },
    IamDecisionTaken: {
      category: "operator",
      requiredFields: [],
      defaultConfig: {
        branchLabelTrue: "Decision taken",
        branchLabelFalse: "Still waiting",
      },
    },
  },
};
