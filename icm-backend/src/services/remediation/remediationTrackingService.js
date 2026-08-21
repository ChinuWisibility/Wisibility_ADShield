import RemediationTracking from "../../models/remediation/RemediationTracking.js";

const STAGE_FIELDS = {
  email: "emailStatus",
  manager: "managerStatus",
  itsm: "itsmStatus",
  validation: "validationStatus",
  reporting: "reportingStatus",
};

export async function initTracking({ tenantId, queueId, eventId }) {
  const existing = await RemediationTracking.findOne({ tenantId, eventId }).lean();
  if (existing) return existing;

  return RemediationTracking.create({
    tenantId: String(tenantId),
    eventId,
    queueId,
    emailStatus: { status: "PENDING" },
    managerStatus: { status: "PENDING" },
    itsmStatus: { status: "PENDING" },
    validationStatus: { status: "PENDING" },
    reportingStatus: { status: "PENDING" },
  });
}

/**
 * Certification phase: manager or external reviewer already decided access (incl. revoke)
 * before remediation ticket / ITSM steps.
 */
export async function markCertificationReviewerComplete(eventId, { completedAt } = {}) {
  return updateStage(eventId, "manager", "GRANTED", completedAt || new Date());
}

export async function updateStage(eventId, stage, status, timestamp = new Date()) {
  const field = STAGE_FIELDS[stage];
  if (!field) return null;

  return RemediationTracking.findOneAndUpdate(
    { eventId },
    { $set: { [field]: { status, at: timestamp } } },
    { new: true },
  ).lean();
}

export async function getTrackingByEventId(tenantId, eventId) {
  return RemediationTracking.findOne({ tenantId: String(tenantId), eventId }).lean();
}

export async function getTrackingByQueueId(tenantId, queueId) {
  return RemediationTracking.findOne({ tenantId: String(tenantId), queueId }).lean();
}

export { STAGE_FIELDS };
