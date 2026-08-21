import Campaign from "../../models/certification/Campaign.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import EmailDeliveryLog from "../../models/email/EmailDeliveryLog.js";
import { assertTenantForCampaign } from "../../utils/access-certification/certificationTenantScope.js";
import { buildCampaignReminderStatusByReviewer } from "../../services/email/campaignReminderStatusService.js";
import { buildTenantScopedCampaignFilter } from "../../services/email/tenantCampaignFilter.js";

export async function getCampaignReminders(req, res) {
  try {
    const campaignId = req.params.id;
    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const campaign = await Campaign.findById(campaignId).lean();
    if (!campaign)
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });

    return res.json({
      success: true,
      data: {
        campaignId,
        status: campaign.status,
        dueDate: campaign.dueDate,
        reminderFrequency: campaign.reminderFrequency,
        escalationConfig: campaign.escalationConfig,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function getCampaignReminderLog(req, res) {
  try {
    const campaignId = req.params.id;
    const campaign = await assertTenantForCampaign(req, campaignId, {
      notFound: true,
    });

    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.max(Number(req.query.limit || 50), 1);
    const type = String(req.query.type || "")
      .toUpperCase()
      .trim();

    const filter = buildTenantScopedCampaignFilter(campaignId, campaign?.tenantId);
    // Tenant access enforced via assertTenantForCampaign above.
    if (type) {
      // Model enum: STANDARD | ESCALATION | EXPIRY
      if (type === "ESCALATION") filter.reminderType = "ESCALATION";
      else if (type === "EXPIRY") filter.reminderType = "EXPIRY";
      else if (type === "STANDARD") filter.reminderType = "STANDARD";
    }

    const [items, total] = await Promise.all([
      CampaignReminderLog.find(filter)
        .sort({ sentAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      CampaignReminderLog.countDocuments(filter),
    ]);

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        const deliveryLog = await EmailDeliveryLog.findOne({
          campaignId: item.campaignId,
          recipientEmail: item.recipientEmail,
          emailType:
            item.reminderType === "ESCALATION"
              ? "ESCALATION"
              : item.reminderType === "EXPIRY"
                ? "EXPIRY"
                : "REMINDER",
        })
          .sort({ deliveredAt: -1 })
          .lean();
        return {
          ...item,
          providerMessageId: deliveryLog?.providerMessageId || null,
          provider: deliveryLog?.provider || null,
          deliveryError: deliveryLog?.errorMessage || null,
        };
      }),
    );

    return res.json({
      success: true,
      data: {
        items: enrichedItems,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

/**
 * Per-reviewer reminder status summary for campaign details UI (B21).
 */
export async function getCampaignReminderStatus(req, res) {
  try {
    const campaignId = req.params.id;
    await assertTenantForCampaign(req, campaignId, {
      notFound: true,
    });

    const campaign = await Campaign.findById(campaignId)
      .select(
        "tenantId reminderFrequency dueDate history reviewersAssigned backupManagerReviewerEmail",
      )
      .lean();

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    const byReviewerResult = await buildCampaignReminderStatusByReviewer(
      campaignId,
      campaign.tenantId,
      campaign,
    );

    return res.json({
      success: true,
      data: {
        campaignId,
        reminderFrequency: campaign.reminderFrequency,
        byReviewer: byReviewerResult.byReviewer,
        campaignSummary: byReviewerResult.campaignSummary,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
