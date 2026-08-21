import CampaignAuditLog from "../../models/certification/CampaignAuditLog.js";
import { resolveCampaignTenantId } from "./campaignReminderLogService.js";

/**
 * Immutable audit record for certification email lifecycle events.
 */
export async function recordCertificationEmailAudit({
  campaignId,
  tenantId,
  eventType,
  emailType,
  recipientEmail,
  emailJobId,
  actorType = "SYSTEM",
  actorId,
  details,
}) {
  if (!campaignId || !eventType) return null;

  const resolvedTenantId =
    tenantId ?? (await resolveCampaignTenantId(campaignId));

  return CampaignAuditLog.create({
    tenantId: resolvedTenantId || undefined,
    campaignId,
    eventType,
    emailType: emailType || undefined,
    recipientEmail: recipientEmail
      ? String(recipientEmail).trim().toLowerCase()
      : undefined,
    emailJobId: emailJobId || undefined,
    actorType,
    actorId: actorId || undefined,
    details: details || undefined,
  }).catch((err) => {
    console.warn("[CampaignAuditLog] write failed:", err.message);
    return null;
  });
}
