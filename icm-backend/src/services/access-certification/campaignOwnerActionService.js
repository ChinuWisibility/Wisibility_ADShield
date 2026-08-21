import Application from "../../models/application/Application.js";
import Campaign from "../../models/certification/Campaign.js";
import User from "../../models/platform/User.js";
import {
  finalizeAllPendingForCampaign,
} from "./certificationDecisionService.js";

/**
 * Resolve who should receive the expiry / owner-action email.
 * Priority: application owner email, then campaign creator email.
 */
export async function resolveCampaignOwnerContact(campaign) {
  if (!campaign) return null;

  let applicationName = campaign.applicationName || null;

  if (campaign.applicationId) {
    const app = await Application.findById(campaign.applicationId)
      .select("ownerEmail owner name")
      .lean();
    if (app) {
      applicationName = app.name || applicationName;
      const ownerEmail = String(app.ownerEmail || "")
        .trim()
        .toLowerCase();
      if (ownerEmail) {
        return {
          email: ownerEmail,
          name: app.owner || ownerEmail,
          applicationName,
          source: "application_owner",
        };
      }
    }
  }

  if (campaign.createdBy) {
    const user = await User.findById(campaign.createdBy)
      .select("email firstName lastName")
      .lean();
    const email = String(user?.email || "")
      .trim()
      .toLowerCase();
    if (email) {
      const name =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        email;
      return {
        email,
        name,
        applicationName,
        source: "campaign_creator",
      };
    }
  }

  return null;
}

export async function extendCampaign(campaign, { newDueDate, userId } = {}) {
  let nextDue;
  if (newDueDate) {
    nextDue = new Date(newDueDate);
    if (isNaN(nextDue.getTime())) {
      throw new Error("Invalid newDueDate");
    }
  } else {
    const base = campaign.dueDate || new Date();
    nextDue = new Date(base);
    nextDue.setDate(nextDue.getDate() + 7);
  }

  campaign.dueDate = nextDue;
  if (["EndPhase", "Closed"].includes(campaign.status)) {
    campaign.status = "Active";
  }
  campaign.ownerAction = "EXTEND";
  campaign.ownerActionEmailSentAt = undefined;

  campaign.history = [
    ...(campaign.history || []),
    {
      at: new Date(),
      by: userId || "owner",
      action: "owner_extended",
      newDueDate: campaign.dueDate,
    },
  ];
  if (userId) campaign.updatedBy = userId;
  await campaign.save();
  return campaign;
}

export async function closeCampaignApproveRemaining(
  campaign,
  { userId, actorEmail, metadata } = {},
) {
  const campaignId = campaign._id;
  const { affectedCount } = await finalizeAllPendingForCampaign({
    campaignId,
    disposition: "APPROVE_ALL",
    actorId: userId,
    actorEmail,
    metadata,
  });

  const fresh = await Campaign.findById(campaignId);
  if (!fresh) throw new Error("Campaign not found");

  fresh.status = "Closed";
  fresh.endDate = new Date();
  fresh.ownerAction = "CLOSE";
  fresh.history = [
    ...(fresh.history || []),
    {
      at: new Date(),
      by: userId || actorEmail || "owner",
      action: "owner_closed",
      pendingApproved: affectedCount,
    },
  ];
  if (userId) fresh.updatedBy = userId;
  await fresh.save();

  return { campaign: fresh, pendingResolved: affectedCount };
}

export async function finalizePendingForCampaign(
  campaignId,
  disposition,
  { userId, actorEmail, metadata } = {},
) {
  return finalizeAllPendingForCampaign({
    campaignId,
    disposition,
    actorId: userId,
    actorEmail,
    metadata,
  });
}
