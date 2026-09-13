import { AppError } from "../../middleware/errorHandler.js";
import RemediationQueue from "../../models/remediation/RemediationQueue.js";
import RemediationQueueItem from "../../models/remediation/RemediationQueueItem.js";
import {
  getTrackingByEventId,
  markCertificationReviewerComplete,
} from "../../services/remediation/remediationTrackingService.js";

async function healRevokeAccessManagerStage(tenantId, eventId, tracking) {
  if (tracking?.managerStatus?.status !== "PENDING") return tracking;

  const queue = await RemediationQueue.findOne({
    tenantId: String(tenantId),
    eventId,
    eventType: "REVOKE_ACCESS",
  }).lean();
  if (!queue) return tracking;

  const items = await RemediationQueueItem.find({ queueId: queue._id })
    .select("metadata.reviewedAt")
    .lean();
  const latestReviewMs = items.reduce((max, row) => {
    const t = row.metadata?.reviewedAt ? new Date(row.metadata.reviewedAt).getTime() : 0;
    return Math.max(max, t);
  }, 0);

  return markCertificationReviewerComplete(eventId, {
    completedAt: latestReviewMs > 0 ? new Date(latestReviewMs) : new Date(),
  });
}

export async function getTracking(req, res, next) {
  try {
    let tracking = await getTrackingByEventId(req.scopedTenantId, req.params.eventId);
    if (!tracking) throw new AppError("Tracking record not found", 404);

    tracking =
      (await healRevokeAccessManagerStage(
        req.scopedTenantId,
        req.params.eventId,
        tracking,
      )) || tracking;

    res.json({ success: true, data: tracking });
  } catch (e) {
    next(e);
  }
}
