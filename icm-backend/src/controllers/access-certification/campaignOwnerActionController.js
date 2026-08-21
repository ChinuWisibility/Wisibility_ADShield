import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import {
  asObjectId,
  getUserId,
  assertTenantForCampaign,
} from "./certificationControllerHelpers.js";
import { auditMetadataFromRequest } from "../../utils/auditMetadata.js";
import {
  extendCampaign,
  closeCampaignApproveRemaining,
  finalizePendingForCampaign,
} from "../../services/access-certification/campaignOwnerActionService.js";

export async function updateOwnerAction(req, res) {
  try {
    const { action, newDueDate } = req.body;
    const normalizedAction = String(action || "").toUpperCase();
    const userId = getUserId(req);
    const campaign = await Campaign.findById(req.params.id);

    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    await assertTenantForCampaign(req, req.params.id, { notFound: true });

    if (!["CLOSE", "EXTEND"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "action must be EXTEND or CLOSE",
      });
    }

    const metadata = auditMetadataFromRequest(req);
    const actorEmail = req.user?.email;

    if (normalizedAction === "CLOSE") {
      // WIS-019: closing with items still pending force-approves them —
      // require the caller to explicitly acknowledge that instead of it
      // happening silently as a side effect of "close".
      const pendingCount = await ReviewItem.countDocuments({
        campaignId: campaign._id,
        status: "PENDING",
      });
      if (pendingCount > 0 && req.body?.confirmForceApprove !== true) {
        return res.status(409).json({
          success: false,
          code: "PENDING_ITEMS_REQUIRE_CONFIRMATION",
          message:
            `${pendingCount} item(s) in this campaign are still pending review. ` +
            "Closing now will auto-approve all of them. Resend this request with " +
            '"confirmForceApprove": true to proceed, or complete the reviews first.',
          pendingCount,
        });
      }

      const { campaign: updated, pendingResolved } =
        await closeCampaignApproveRemaining(campaign, {
          userId,
          actorEmail,
          metadata,
        });
      return res.json({
        success: true,
        data: { ...updated.toObject(), pendingResolved },
      });
    }

    const updated = await extendCampaign(campaign, { newDueDate, userId });
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function ownerFinalizePending(req, res) {
  try {
    const campaignId = asObjectId(req.params.id);
    if (!campaignId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid campaign id" });
    }

    await assertTenantForCampaign(req, campaignId, { notFound: true });

    const action = String(req.body?.action || "").toUpperCase();
    if (!["APPROVE_ALL", "REVOKE_ALL"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'action must be "APPROVE_ALL" or "REVOKE_ALL"',
      });
    }

    const userId = getUserId(req);
    const { campaign, affectedCount } = await finalizePendingForCampaign(
      campaignId,
      action,
      {
        userId,
        actorEmail: req.user?.email,
        metadata: auditMetadataFromRequest(req),
      },
    );

    return res.json({
      success: true,
      data: {
        campaign,
        pendingResolved: affectedCount,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
}
