/**
 * CertificationSignedOff trigger shapes for workflow testing.
 * Live runs are built from ReviewItem via workflowDispatcher — not from this file.
 */

const BASE_FIELDS = {
  decision: "Revoke",
  identityEmail: "user@example.com",
  managerEmail: "manager@example.com",
  managerName: "Test Manager",
  applicationId: "test-app-id",
  applicationName: "Test Application",
  entitlementId: "test-entitlement-id",
  entitlementName: "Test Entitlement",
  campaignId: "test-campaign-id",
  campaignName: "Test Certification Campaign",
  reviewItemId: "test-review-item-id",
  provisioningAction: "REMOVE_ENTITLEMENT",
  nativeIdentity: "testuser@example.com",
};

const ORPHAN_BASE_FIELDS = {
  orphanId: "test-orphan-id",
  accountName: "svc_orphan_acme",
  applicationId: "test-app-id",
  applicationName: "Acme SaaS",
  riskLevel: "HIGH",
  detectedAt: new Date().toISOString(),
  status: "OPEN",
};

/** Empty shape — documents required fields; will fail verification if run as-is. */
export function getEmptyTriggerTemplate() {
  return {
    decision: "Revoke",
    identityId: "",
    identityName: "",
    identityEmail: "",
    managerEmail: "",
    managerName: "",
    applicationId: "",
    applicationName: "",
    entitlementId: "",
    entitlementName: "",
    campaignId: "",
    campaignName: "",
    reviewItemId: "",
    provisioningAction: "REMOVE_ENTITLEMENT",
    nativeIdentity: "",
  };
}

/** Default test payload — access still present (routes to Notify IAM Team). */
export function getTriggerTemplate() {
  return {
    ...BASE_FIELDS,
    identityId: "test-identity-id",
    identityName: "Test User",
    simulateAccessRemoved: false,
  };
}

/** Access confirmed removed in demo adapter (routes to Notify User). */
export function getRemovedAccessTriggerTemplate() {
  return {
    ...BASE_FIELDS,
    identityId: "test-identity-id",
    identityName: "Test User",
    simulateAccessRemoved: true,
  };
}

export function getSampleTriggerScenarios() {
  return {
    stillPresent: {
      label: "Access still present",
      description: "Entitlement exists on identity — expect Notify IAM Team branch.",
      trigger: getTriggerTemplate(),
    },
    removed: {
      label: "Access removed",
      description: "Entitlement absent from identity — expect Notify User branch.",
      trigger: getRemovedAccessTriggerTemplate(),
    },
    empty: {
      label: "Empty (invalid)",
      description: "Missing identifiers — expect verification failure, not Removed branch.",
      trigger: getEmptyTriggerTemplate(),
    },
  };
}

/** Official IAM orphan trigger — matches queue-built payload from OrphanAccount. */
export function getOrphanIamTriggerTemplate() {
  return { ...ORPHAN_BASE_FIELDS };
}

/** Simulates portal resume after IAM chose DELETE (post-decision trigger fields). */
export function getOrphanIamDecisionTriggerTemplate(decision = "DELETE") {
  return {
    ...ORPHAN_BASE_FIELDS,
    iamDecision: decision,
    decisionSource: "initial-action-email",
    decisionStepId: "sendEmail",
    decisionStepLabel: "Send Action Email",
    decisionEmailJobId: "test-email-job-id",
    decisionRecordedAt: new Date().toISOString(),
    decisionRecordedBy: "iam-portal",
  };
}

export function getOrphanIamSampleScenarios() {
  return {
    newReview: {
      label: "New orphan review",
      description: "Standard trigger when IAM review starts from Data Hygiene.",
      trigger: getOrphanIamTriggerTemplate(),
    },
    portalAssign: {
      label: "Portal decision — Assign",
      description: "Resume path after IAM links account to an identity.",
      trigger: getOrphanIamDecisionTriggerTemplate("ASSIGN"),
    },
    portalDelete: {
      label: "Portal decision — Delete",
      description: "Resume path after IAM removes the orphan account.",
      trigger: getOrphanIamDecisionTriggerTemplate("DELETE"),
    },
    portalDisable: {
      label: "Portal decision — Disable",
      description: "Resume path after IAM disables the account.",
      trigger: getOrphanIamDecisionTriggerTemplate("DISABLE"),
    },
    portalIgnore: {
      label: "Portal decision — Ignore",
      description: "Resume path after IAM marks false positive.",
      trigger: getOrphanIamDecisionTriggerTemplate("IGNORE"),
    },
  };
}

/** @deprecated use getTriggerTemplate */
export function getSampleTrigger() {
  return getTriggerTemplate();
}

export const SAMPLE_TRIGGER_KEYS = ["template", "scenarios", "emptyTemplate"];

export const ORPHAN_IAM_SAMPLE_TRIGGER_KEYS = [
  "orphanIamTemplate",
  "orphanIamScenarios",
];
