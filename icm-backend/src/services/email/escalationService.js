import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import CertificationEscalation from "../../models/certification/CertificationEscalation.js";
import CertificationReviewerAssignment from "../../models/certification/CertificationReviewerAssignment.js";
import * as escalationReminder from "./templates/escalationReminder.js";
import { enqueueCertificationEmail } from "./emailJobService.js";

/**
 * Auto-escalate overdue reviewers and enqueue escalation emails (B10).
 */
export async function runAutoEscalations() {
  const now = new Date();

  const pastDueCampaignIds = await Campaign.distinct("_id", {
    status: { $in: ["Active", "DecisionPending", "EndPhase"] },
    dueDate: { $lt: now },
  });
  if (pastDueCampaignIds.length > 0) {
    await CertificationReviewerAssignment.updateMany(
      {
        campaignId: { $in: pastDueCampaignIds },
        pendingCount: { $gt: 0 },
        assignmentStatus: "ACTIVE",
      },
      { $set: { assignmentStatus: "OVERDUE" } },
    ).catch((e) =>
      console.error("[EscalationService] OVERDUE marking failed:", e.message),
    );
  }

  const campaigns = await Campaign.find({
    status: { $in: ["Active", "DecisionPending"] },
    "escalationConfig.enabled": true,
    "escalationConfig.escalateAfterDays": { $gt: 0 },
    "escalationConfig.escalateTo": { $exists: true },
  });

  for (const campaign of campaigns) {
    const cfg = campaign.escalationConfig || {};
    const escalateAfterMs =
      (cfg.escalateAfterDays || 7) * 24 * 60 * 60 * 1000;
    const escalateTo = String(cfg.escalateTo || "")
      .trim()
      .toLowerCase();

    if (!escalateTo) continue;

    const pendingItems = await ReviewItem.find({
      campaignId: campaign._id,
      status: "PENDING",
    }).lean();

    const pendingByReviewer = {};
    for (const ri of pendingItems) {
      const email = String(ri.reviewerEmail || "").toLowerCase();
      const assignedAt = ri.createdAt
        ? new Date(ri.createdAt)
        : campaign.startDate || campaign.createdAt;
      if (
        email &&
        assignedAt &&
        now - new Date(assignedAt) >= escalateAfterMs
      ) {
        if (!pendingByReviewer[email]) pendingByReviewer[email] = [];
        pendingByReviewer[email].push(ri.itemId);
      }
    }

    for (const [originalEmail, itemIds] of Object.entries(pendingByReviewer)) {
      const existing = await CertificationEscalation.findOne({
        campaignId: campaign._id,
        originalReviewerId: originalEmail,
        escalatedToId: escalateTo,
        resolvedAt: { $exists: false },
      }).lean();
      if (existing) continue;

      try {
        await CertificationEscalation.create({
          campaignId: campaign._id,
          originalReviewerId: originalEmail,
          escalatedToId: escalateTo,
          escalationReason: "NO_RESPONSE",
          escalatedAt: now,
        });

        const { subject, html } = await escalationReminder.render({
          reviewerName: escalateTo,
          campaignName: campaign.name,
          campaignId: campaign._id.toString(),
          dueDate: campaign.dueDate,
          pendingCount: itemIds.length,
        });

        await enqueueCertificationEmail({
          type: "ESCALATION",
          campaignId: campaign._id,
          tenantId: campaign.tenantId,
          recipientEmail: escalateTo,
          subject,
          html,
          metadata: { originalReviewerEmail: originalEmail },
        });

        await CertificationReviewerAssignment.updateOne(
          { campaignId: campaign._id, reviewerEmail: originalEmail },
          { $set: { assignmentStatus: "ESCALATED" } },
        ).catch(() => {});

        console.log(
          `[EscalationService] Auto-escalated ${itemIds.length} items from ${originalEmail} → ${escalateTo} in campaign '${campaign.name}'`,
        );
      } catch (e) {
        console.error(
          `[EscalationService] Escalation failed for campaign '${campaign.name}':`,
          e.message,
        );
      }
    }
  }
}
