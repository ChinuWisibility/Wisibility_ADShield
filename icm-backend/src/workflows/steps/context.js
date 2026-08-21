import env from "../../config/env.js";
import { resolveIamTeamEmail } from "../../services/system/iamTeamEmailService.js";

/**
 * Build the run context for a workflow execution.
 * The adapter abstracts the side-effecting world (identity lookup, revoke,
 * verify, email, ticket, audit). Test runs pass a sandbox adapter; live runs
 * pass the IGA adapter. The engine and handlers never change between modes.
 */
export function normalizeTrigger(input) {
  const t = input?.trigger || input || {};
  return {
    ...t,
    _type: t._type || t.type,
    type: t.type || t._type || "CertificationSignedOff",
    decision: t.decision || "Revoke",
    identityId: t.identityId,
    identityName: t.identityName,
    identityEmail: t.identityEmail,
    managerEmail: t.managerEmail,
    managerName: t.managerName,
    applicationId: t.applicationId,
    applicationName: t.applicationName,
    entitlementId: t.entitlementId,
    entitlementName: t.entitlementName,
    campaignId: t.campaignId,
    campaignName: t.campaignName,
    reviewItemId: t.reviewItemId,
    provisioningAction: t.provisioningAction,
    orphanId: t.orphanId,
    accountName: t.accountName,
    riskLevel: t.riskLevel,
    detectedAt: t.detectedAt,
    iamDecision: t.iamDecision,
    decisionSource: t.decisionSource,
    decisionStepId: t.decisionStepId,
    decisionStepLabel: t.decisionStepLabel,
    decisionEmailJobId: t.decisionEmailJobId,
    decisionEmailAuditId: t.decisionEmailAuditId,
    decisionRecordedAt: t.decisionRecordedAt,
    decisionRecordedBy: t.decisionRecordedBy,
  };
}

export async function buildRunContext(triggerInput, options = {}) {
  const adapter = options.adapter || null;
  const trigger = normalizeTrigger(triggerInput);

  const identity =
    adapter && typeof adapter.getIdentity === "function"
      ? adapter.getIdentity(trigger.identityId)
      : null;
  if (identity && !trigger.identityEmail) {
    trigger.identityEmail = identity.email;
    trigger.identityName = trigger.identityName || identity.displayName || identity.name;
    trigger.managerEmail = trigger.managerEmail || identity.managerEmail;
    trigger.managerName = trigger.managerName || identity.managerName;
  }

  const iamTeamEmail =
    String(options.iamTeamEmail || "").trim() ||
    (await resolveIamTeamEmail(options.tenantId));

  return {
    trigger,
    adapter,
    config: {
      portalBaseUrl: options.portalBaseUrl || env.frontendUrl,
      orphanIamPortalUrl: options.orphanIamPortalUrl || "",
      reviewPortalUrl: options.reviewPortalUrl || options.orphanIamPortalUrl || "",
      iamTeamEmail,
      workflowFromEmail: options.workflowFromEmail || env.workflow.fromEmail || "",
      executionId: options.executionId || null,
      tenantId: options.tenantId ?? null,
      mode: options.mode || "LIVE",
    },
  };
}
