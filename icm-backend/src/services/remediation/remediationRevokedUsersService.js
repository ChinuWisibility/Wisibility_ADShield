import mongoose from "mongoose";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Campaign from "../../models/certification/Campaign.js";
import { asObjectId } from "../../controllers/access-certification/certificationControllerHelpers.js";

function buildItemKey(reviewItemId, entitlementName) {
  return `${String(reviewItemId)}::${String(entitlementName || "").trim()}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aggregate revoked entitlements from review_items across multiple campaigns.
 * Source of truth: entitlementDecisions.status === "REVOKED"
 */
export async function aggregateRevokedEntitlements({
  campaignIds = [],
  page = 1,
  limit = 25,
  search = "",
  applicationName = "",
  campaignName = "",
  entitlementName = "",
  sortBy = "itemName",
  sortDir = "asc",
} = {}) {
  const ids = campaignIds.map(asObjectId).filter(Boolean);
  if (!ids.length) {
    return { items: [], total: 0, page, limit, pages: 0 };
  }

  const cap = Math.min(200, Math.max(1, Number(limit) || 25));
  const pg = Math.max(1, Number(page) || 1);
  const skip = (pg - 1) * cap;

  const sortFieldMap = {
    itemName: "itemName",
    itemEmail: "itemEmail",
    applicationName: "applicationName",
    entitlementName: "entitlementName",
    campaignName: "campaignName",
    reviewedAt: "reviewedAt",
    reviewerName: "reviewerName",
  };
  const sortField = sortFieldMap[sortBy] || "itemName";
  const sortOrder = String(sortDir).toLowerCase() === "desc" ? -1 : 1;

  const postProjectMatch = {};
  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    postProjectMatch.$or = [
      { itemName: rx },
      { itemEmail: rx },
      { applicationName: rx },
      { entitlementName: rx },
      { campaignName: rx },
    ];
  }
  if (applicationName) {
    postProjectMatch.applicationName = new RegExp(
      escapeRegex(applicationName),
      "i",
    );
  }
  if (campaignName) {
    postProjectMatch.campaignName = new RegExp(escapeRegex(campaignName), "i");
  }
  if (entitlementName) {
    postProjectMatch.entitlementName = new RegExp(
      escapeRegex(entitlementName),
      "i",
    );
  }

  const basePipeline = [
    { $match: { campaignId: { $in: ids } } },
    {
      $unwind: {
        path: "$entitlementDecisions",
        preserveNullAndEmptyArrays: false,
      },
    },
    { $match: { "entitlementDecisions.status": "REVOKED" } },
    {
      $lookup: {
        from: Campaign.collection.name,
        localField: "campaignId",
        foreignField: "_id",
        as: "campaignDoc",
      },
    },
    {
      $unwind: {
        path: "$campaignDoc",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        reviewItemId: "$_id",
        userId: 1,
        itemName: { $ifNull: ["$itemName", "Unknown User"] },
        itemEmail: { $ifNull: ["$itemEmail", ""] },
        applicationId: 1,
        applicationName: {
          $ifNull: [
            "$itemApplicationName",
            "$campaignDoc.applicationName",
            "Unknown Application",
          ],
        },
        entitlementName: "$entitlementDecisions.entitlementName",
        accessDetails: { $ifNull: ["$itemAccessDetails", []] },
        manager: { $ifNull: ["$itemManager", ""] },
        reviewerEmail: { $ifNull: ["$reviewerEmail", ""] },
        reviewerName: { $ifNull: ["$reviewerName", ""] },
        reviewedAt: {
          $ifNull: ["$entitlementDecisions.reviewedAt", "$reviewedAt"],
        },
        campaignId: 1,
        campaignName: { $ifNull: ["$campaignDoc.name", ""] },
        remediationRequired: {
          $ifNull: ["$entitlementDecisions.remediationRequired", false],
        },
      },
    },
  ];

  if (Object.keys(postProjectMatch).length) {
    basePipeline.push({ $match: postProjectMatch });
  }

  const [countResult, rows] = await Promise.all([
    ReviewItem.aggregate([...basePipeline, { $count: "total" }]),
    ReviewItem.aggregate([
      ...basePipeline,
      { $sort: { [sortField]: sortOrder, reviewItemId: 1, entitlementName: 1 } },
      { $skip: skip },
      { $limit: cap },
    ]),
  ]);

  const total = countResult[0]?.total || 0;
  const items = rows.map((row) => ({
    ...row,
    reviewItemId: String(row.reviewItemId),
    campaignId: String(row.campaignId),
    applicationId: row.applicationId ? String(row.applicationId) : "",
    itemKey: buildItemKey(row.reviewItemId, row.entitlementName),
    status: "PENDING",
  }));

  return {
    items,
    total,
    page: pg,
    limit: cap,
    pages: Math.ceil(total / cap) || 0,
  };
}

export async function countRevokedEntitlementsForCampaign(campaignId) {
  const cId = asObjectId(campaignId);
  if (!cId) return 0;

  const result = await ReviewItem.aggregate([
    { $match: { campaignId: cId } },
    { $unwind: "$entitlementDecisions" },
    { $match: { "entitlementDecisions.status": "REVOKED" } },
    { $count: "total" },
  ]);
  return result[0]?.total || 0;
}

export { buildItemKey };
