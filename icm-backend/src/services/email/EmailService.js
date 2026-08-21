import { getEmailProvider } from "./providerFactory.js";
import EmailDeliveryLog from "../../models/email/EmailDeliveryLog.js";
import { resolveCampaignTenantId } from "./campaignReminderLogService.js";

/**
 * Unified email send API — all certification (and legacy) sends route through here.
 * Delivery audit is technical only; business events live in CampaignReminderLog.
 */
export default class EmailService {
  /**
   * @param {object} params
   * @param {string} params.to
   * @param {string} params.subject
   * @param {string} params.html
   * @param {object} [params.metadata]
   * @param {string} [params.metadata.emailJobId]
   * @param {string} [params.metadata.campaignId]
   * @param {string} [params.metadata.tenantId]
   * @param {string} [params.metadata.emailType]
   */
  static async send({ to, subject, html, attachments = [], metadata = {} }) {
    if (!to || !String(to).includes("@")) {
      return null;
    }

    const providerKey = String(process.env.EMAIL_PROVIDER || "smtp").toLowerCase();
    const campaignId = metadata.campaignId || undefined;
    const tenantId =
      metadata.tenantId ??
      (campaignId ? await resolveCampaignTenantId(campaignId) : null);

    const deliveryBase = {
      emailJobId: metadata.emailJobId || undefined,
      campaignId,
      tenantId: tenantId || undefined,
      recipientEmail: String(to).trim().toLowerCase(),
      emailType: metadata.emailType || "OTHER",
      provider: providerKey,
    };

    try {
      const provider = getEmailProvider();
      const info = await provider.send({ to, subject, html, attachments });

      // Delivery log is best-effort — a schema/DB write failure must not fail the send
      // or the worker will retry and duplicate messages in the recipient inbox.
      await EmailDeliveryLog.create({
        ...deliveryBase,
        deliveryStatus: "SENT",
        providerMessageId: info?.messageId || undefined,
      }).catch((logErr) => {
        console.warn("[EmailService] delivery log write failed:", logErr.message);
      });

      return info;
    } catch (err) {
      await EmailDeliveryLog.create({
        ...deliveryBase,
        deliveryStatus: "FAILED",
        errorMessage: err.message,
      }).catch(() => {});

      throw err;
    }
  }
}
