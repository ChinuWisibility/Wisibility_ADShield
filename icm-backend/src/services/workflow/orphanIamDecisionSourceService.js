import RemediationAuditLog from "../../models/remediation/RemediationAuditLog.js";

/** Resolve email job / audit ids when the portal token only carried step metadata. */
export async function enrichDecisionSource(decisionSource = {}, { tenantId } = {}) {
  const out = { ...decisionSource };
  if (out.emailJobId && out.emailAuditId) return out;
  if (!out.stepId) return out;

  const filter = {
    action: "NOTIFY",
    "newValue.stepId": out.stepId,
  };
  if (tenantId) filter.tenantId = String(tenantId);
  if (out.executionId) filter["newValue.executionId"] = String(out.executionId);

  const log = await RemediationAuditLog.findOne(filter).sort({ performedAt: -1 }).lean();
  if (!log) return out;

  if (!out.emailAuditId && log._id) out.emailAuditId = String(log._id);
  if (!out.emailJobId && log.newValue?.emailJobId) {
    out.emailJobId = String(log.newValue.emailJobId);
  }
  return out;
}

export function decisionSourceToTriggerFields(decisionSource = {}, decidedBy = "iam-portal") {
  const decidedAt = new Date().toISOString();
  return {
    decisionSource: decisionSource.source || null,
    decisionStepId: decisionSource.stepId || null,
    decisionStepLabel: decisionSource.stepLabel || null,
    decisionEmailJobId: decisionSource.emailJobId || null,
    decisionEmailAuditId: decisionSource.emailAuditId || null,
    decisionRecordedAt: decidedAt,
    decisionRecordedBy: decidedBy,
  };
}
