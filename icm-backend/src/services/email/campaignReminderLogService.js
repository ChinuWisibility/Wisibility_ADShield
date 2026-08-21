import Campaign from "../../models/certification/Campaign.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import EmailJob from "../../models/email/EmailJob.js";
import EmailDeliveryLog from "../../models/email/EmailDeliveryLog.js";
import CampaignAuditLog from "../../models/certification/CampaignAuditLog.js";

const tenantIdByCampaignCache = new Map();

/**
 * Resolve tenantId for a campaign (cached per process).
 */
export async function resolveCampaignTenantId(campaignId) {
  if (!campaignId) return null;
  const key = String(campaignId);
  if (tenantIdByCampaignCache.has(key)) {
    return tenantIdByCampaignCache.get(key);
  }
  const campaign = await Campaign.findById(campaignId).select("tenantId").lean();
  const tenantId = campaign?.tenantId ?? null;
  tenantIdByCampaignCache.set(key, tenantId);
  return tenantId;
}

/**
 * Create a reminder log entry with tenantId always populated when available.
 */
export async function createCampaignReminderLogEntry({
  campaignId,
  tenantId,
  recipientEmail,
  reminderType,
  sentAt = new Date(),
  deliveryStatus,
}) {
  if (!campaignId || !recipientEmail || !reminderType) return null;

  const resolvedTenantId =
    tenantId ?? (await resolveCampaignTenantId(campaignId));

  return CampaignReminderLog.create({
    campaignId,
    tenantId: resolvedTenantId || undefined,
    recipientEmail: String(recipientEmail).trim().toLowerCase(),
    reminderType,
    sentAt,
    deliveryStatus,
  });
}

/**
 * Mark a reminder reservation (or create a legacy log) as SENT.
 *
 * When `reminderLogId` points at a PENDING reservation created at enqueue time,
 * it is upgraded in place to SENT with the real `sentAt`. If no reservation id is
 * supplied (legacy jobs enqueued before the reservation ledger existed), a SENT
 * log row is created so dedupe/last-sent readers still see the send.
 */
export async function markReminderLogSent({
  reminderLogId,
  campaignId,
  tenantId,
  recipientEmail,
  reminderType,
  sentAt = new Date(),
}) {
  if (reminderLogId) {
    const updated = await CampaignReminderLog.findByIdAndUpdate(
      reminderLogId,
      { $set: { deliveryStatus: "SENT", sentAt } },
      { new: true },
    );
    if (updated) return updated;
  }
  return createCampaignReminderLogEntry({
    campaignId,
    tenantId,
    recipientEmail,
    reminderType,
    sentAt,
    deliveryStatus: "SENT",
  });
}

/**
 * Mark a reminder reservation (or create a legacy log) as FAILED and release the
 * frequency window by clearing `dedupeKey`/`windowKey`, so a later legitimate
 * retry can re-reserve the same window instead of being permanently blocked.
 */
export async function markReminderLogFailed({
  reminderLogId,
  campaignId,
  tenantId,
  recipientEmail,
  reminderType,
  sentAt = new Date(),
}) {
  if (reminderLogId) {
    const updated = await CampaignReminderLog.findByIdAndUpdate(
      reminderLogId,
      {
        $set: { deliveryStatus: "FAILED", sentAt },
        $unset: { dedupeKey: 1, windowKey: 1 },
      },
      { new: true },
    );
    if (updated) return updated;
  }
  return createCampaignReminderLogEntry({
    campaignId,
    tenantId,
    recipientEmail,
    reminderType,
    sentAt,
    deliveryStatus: "FAILED",
  });
}

/**
 * Release a PENDING reservation without recording a send (e.g. the enqueue
 * succeeded but the follow-up job insert failed). Frees the window for retry.
 */
export async function releaseReminderReservation(reminderLogId) {
  if (!reminderLogId) return null;
  return CampaignReminderLog.deleteOne({
    _id: reminderLogId,
    deliveryStatus: "PENDING",
  }).catch(() => null);
}

/**
 * Backfill tenantId on legacy certification email records.
 */
export async function backfillCertificationEmailTenantIds() {
  const reminderUpdated = await backfillCollectionTenantIds(
    CampaignReminderLog,
    "CampaignReminderLog",
  );
  const jobUpdated = await backfillCollectionTenantIds(EmailJob, "EmailJob");
  const deliveryUpdated = await backfillCollectionTenantIds(
    EmailDeliveryLog,
    "EmailDeliveryLog",
  );
  const auditUpdated = await backfillCollectionTenantIds(
    CampaignAuditLog,
    "CampaignAuditLog",
  );
  const total =
    reminderUpdated + jobUpdated + deliveryUpdated + auditUpdated;
  if (total > 0) {
    console.log(
      `[CertEmail] Backfilled tenantId — reminder:${reminderUpdated} job:${jobUpdated} delivery:${deliveryUpdated} audit:${auditUpdated}`,
    );
  }
  return {
    reminderUpdated,
    jobUpdated,
    deliveryUpdated,
    auditUpdated,
    total,
  };
}

/** @deprecated Use backfillCertificationEmailTenantIds */
export async function backfillCampaignReminderLogTenantIds() {
  const result = await backfillCertificationEmailTenantIds();
  return result.reminderUpdated;
}

async function backfillCollectionTenantIds(Model, label) {
  const campaignIds = await Model.distinct("campaignId", {
    campaignId: { $exists: true, $ne: null },
    $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
  });

  let updated = 0;
  for (const campaignId of campaignIds) {
    const tenantId = await resolveCampaignTenantId(campaignId);
    if (!tenantId) continue;

    const result = await Model.updateMany(
      {
        campaignId,
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
      },
      { $set: { tenantId } },
    );
    updated += result.modifiedCount || 0;
  }

  return updated;
}

export function clearCampaignTenantIdCache() {
  tenantIdByCampaignCache.clear();
}
