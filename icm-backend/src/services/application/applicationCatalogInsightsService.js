/**
 * Application-scoped catalog insight APIs (read-only), mirroring the Identity
 * catalog insight service (identityCatalogInsightsService.js) for consistency.
 */

import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Campaign from "../../models/certification/Campaign.js";

const IN_PROGRESS_CAMPAIGN_STATUSES = [
  "ACTIVE",
  "IN_PROGRESS",
  "RUNNING",
  "OPEN",
  "ENDPHASE",
  "DECISIONPENDING",
];

function toObjectId(value) {
  if (!value) return null;
  const s = String(value);
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

async function loadApplicationForCertifications(applicationId) {
  const appOid = toObjectId(applicationId);
  if (!appOid) {
    const err = new Error("Invalid application ID");
    err.statusCode = 400;
    throw err;
  }
  const application = await Application.findById(appOid).select("tenantId name").lean();
  if (!application) {
    const err = new Error("Application not found");
    err.statusCode = 404;
    throw err;
  }
  return application;
}

/**
 * GET /applications/:id/certifications
 * Campaigns and review items scoped to this application via their direct
 * `applicationId` field (both ReviewItem and Campaign carry it natively).
 */
export async function buildApplicationCertificationInsights(applicationId) {
  const application = await loadApplicationForCertifications(applicationId);
  const appOid = application._id;
  const tenantOid = toObjectId(application.tenantId);

  const scopeMatch = {
    applicationId: appOid,
    ...(tenantOid ? { tenantId: tenantOid } : {}),
  };

  const [items, campaigns] = await Promise.all([
    ReviewItem.find(scopeMatch).sort({ updatedAt: -1 }).limit(200).lean(),
    Campaign.find(scopeMatch)
      .select(
        "name status dueDate endDate startDate category certificationScope completionPercentage totalItems completedItems pendingItems",
      )
      .sort({ createdAt: -1 })
      .limit(25)
      .lean(),
  ]);

  const campaignById = new Map(campaigns.map((c) => [String(c._id), c]));

  let pending = 0;
  let approved = 0;
  let exception = 0;
  let completed = 0;
  let revoked = 0;
  let inProgress = 0;

  const mappedItems = items.map((item) => {
    const status = String(item.status || "PENDING").toUpperCase();
    if (status === "PENDING" || status === "DELEGATED") pending += 1;
    else if (status === "APPROVED") { approved += 1; completed += 1; }
    else if (status === "EXCEPTION") { exception += 1; completed += 1; }
    else if (status === "REVOKED" || status === "REVOKE_IN_PROGRESS") revoked += 1;

    const campaign = campaignById.get(String(item.campaignId));
    const campaignStatus = String(campaign?.status || "").toUpperCase();
    if (IN_PROGRESS_CAMPAIGN_STATUSES.includes(campaignStatus) && status === "PENDING") {
      inProgress += 1;
    }

    const campaignId = item.campaignId ? String(item.campaignId) : null;
    return {
      id: String(item._id),
      campaignId,
      campaignName: campaign?.name || "Campaign",
      itemName: item.itemName || item.entitlementSnapshot?.entitlementName || "Review item",
      userId: item.userId || null,
      status,
      decision: item.decision || null,
      reviewer: item.reviewerName || item.reviewerEmail || null,
      dueDate: campaign?.dueDate || campaign?.endDate || null,
      reviewedAt: item.reviewedAt || null,
      createdAt: item.createdAt || null,
      deepLink: campaignId
        ? `/governance/certifications/access?campaignId=${encodeURIComponent(campaignId)}`
        : "/governance/certifications/access",
    };
  });

  return {
    applicationId: String(appOid),
    summary: {
      total: items.length,
      pending,
      inProgress,
      approved,
      exception,
      completed,
      revoked,
    },
    items: mappedItems,
    campaigns: campaigns.map((c) => ({
      id: String(c._id),
      name: c.name,
      status: c.status || null,
      category: c.category || null,
      certificationScope: c.certificationScope || null,
      startDate: c.startDate || null,
      dueDate: c.dueDate || c.endDate || null,
      completionPercentage: c.completionPercentage ?? null,
      totalItems: c.totalItems ?? null,
      completedItems: c.completedItems ?? null,
      pendingItems: c.pendingItems ?? null,
      deepLink: `/governance/certifications/access?campaignId=${encodeURIComponent(String(c._id))}`,
    })),
    deepLink: "/governance/certifications/access",
  };
}
