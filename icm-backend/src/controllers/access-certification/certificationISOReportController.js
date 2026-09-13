import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import CertificationEscalation from "../../models/certification/CertificationEscalation.js";
import { loadScopeRowsForCampaign } from "../../services/access-certification/certificationScopeService.js";
import { resolveUserName } from "../../utils/access-certification/certificationUserDisplay.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";
import { resolveCertificationAccessTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { getTenantConfigByTenantId } from "../../services/tenant/tenantService.js";
import {
  ISO_REPORT_ACCESS_SCOPED_CATEGORIES,
  ISO_REPORT_CAMPAIGN_SELECT_FIELDS,
  ISO_REPORT_DECISION_LIMIT_DEFAULT,
  ISO_REPORT_DECISION_LIMIT_MAX,
  ISO_REPORT_EMPTY_SUMMARY,
  ISO_REPORT_REVIEW_ITEM_SELECT,
  ISO_REPORT_SCOPE_FALLBACK_MAX_CAMPAIGNS,
  ISO_REPORT_SCOPE_FALLBACK_MAX_ROWS,
} from "../../config/certificationISOReport.config.js";

function escapeRegexLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Avoid RangeError from invalid campaign/review dates in Mongo or legacy payloads. */
function safeToISOString(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Aggregates certification campaigns + review decisions for the ISO report UI.
 */
export async function buildCertificationIsoReportData({
  userTenantId,
  applicationId,
  applicationName,
  startDate,
  endDate,
  recordLimit,
}) {
  const baseFilter = {};
  if (userTenantId) baseFilter.tenantId = userTenantId;
  if (startDate || endDate) {
    baseFilter.startDate = {};
    if (startDate) baseFilter.startDate.$gte = new Date(startDate);
    if (endDate) baseFilter.startDate.$lte = new Date(endDate);
  }

  const appIdValid =
    applicationId && mongoose.Types.ObjectId.isValid(applicationId);
  let campaignFilter = { ...baseFilter };

  let authoritativeAppName = applicationName
    ? String(applicationName).trim()
    : "";
  if (appIdValid) {
    const appDoc = await Application.findById(
      new mongoose.Types.ObjectId(applicationId),
    )
      .select("name")
      .lean();
    if (appDoc?.name) authoritativeAppName = appDoc.name;
  }

  if (appIdValid) {
    const orClauses = [
      { applicationId: new mongoose.Types.ObjectId(applicationId) },
      { applicationId: applicationId },
    ];
    if (authoritativeAppName) {
      orClauses.push({
        applicationName: {
          $regex: escapeRegexLiteral(authoritativeAppName),
          $options: "i",
        },
      });
    }
    campaignFilter.$or = orClauses;
  } else if (authoritativeAppName) {
    campaignFilter.applicationName = {
      $regex: escapeRegexLiteral(authoritativeAppName),
      $options: "i",
    };
  }

  const campaignFields = ISO_REPORT_CAMPAIGN_SELECT_FIELDS;

  let campaigns = await Campaign.find(campaignFilter)
    .select(campaignFields)
    .sort({ startDate: -1 })
    .lean();

  if (
    !campaigns.length &&
    userTenantId &&
    (appIdValid || authoritativeAppName)
  ) {
    const fallbackFilter = { ...campaignFilter };
    delete fallbackFilter.tenantId;
    campaigns = await Campaign.find(fallbackFilter)
      .select(campaignFields)
      .sort({ startDate: -1 })
      .lean();
  }

  if (!campaigns.length) {
    return {
      campaigns: [],
      decisionRecords: [],
      summary: { ...ISO_REPORT_EMPTY_SUMMARY },
    };
  }

  const campaignIds = campaigns.map((c) => c._id);

  const [reviewItemAgg, escalationAgg] = await Promise.all([
    ReviewItem.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      {
        // Derive effectiveStatus from entitlementDecisions when present.
        // The rollup always writes status="APPROVED" when all entitlements are decided,
        // so we must check entitlementDecisions to find real REVOKED counts.
        $addFields: {
          effectiveStatus: {
            $let: {
              vars: {
                eds: {
                  $cond: [
                    { $and: [{ $isArray: "$entitlementDecisions" }, { $gt: [{ $size: "$entitlementDecisions" }, 0] }] },
                    "$entitlementDecisions",
                    [],
                  ],
                },
              },
              in: {
                $cond: {
                  if: { $gt: [{ $size: "$$eds" }, 0] },
                  then: {
                    $let: {
                      vars: {
                        pendingCount: { $size: { $filter: { input: "$$eds", as: "e", cond: { $eq: ["$$e.status", "PENDING"] } } } },
                        revokedCount: { $size: { $filter: { input: "$$eds", as: "e", cond: { $eq: ["$$e.status", "REVOKED"] } } } },
                      },
                      in: {
                        $cond: [
                          { $gt: ["$$pendingCount", 0] },
                          "PENDING",
                          { $cond: [{ $gt: ["$$revokedCount", 0] }, "REVOKED", "APPROVED"] },
                        ],
                      },
                    },
                  },
                  else: "$status",
                },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: "$campaignId",
          totalItems: { $sum: 1 },
          approvedItems: {
            $sum: { $cond: [{ $eq: ["$effectiveStatus", "APPROVED"] }, 1, 0] },
          },
          revokedItems: {
            $sum: { $cond: [{ $eq: ["$effectiveStatus", "REVOKED"] }, 1, 0] },
          },
          pendingItems: {
            $sum: { $cond: [{ $eq: ["$effectiveStatus", "PENDING"] }, 1, 0] },
          },
        },
      },
    ]),
    CertificationEscalation.aggregate([
      { $match: { campaignId: { $in: campaignIds } } },
      { $group: { _id: "$campaignId", count: { $sum: 1 } } },
    ]),
  ]);

  const liveMetaMap = new Map();
  for (const r of reviewItemAgg) {
    const pct =
      r.totalItems > 0
        ? Math.round(((r.approvedItems + r.revokedItems) / r.totalItems) * 100)
        : 0;
    liveMetaMap.set(String(r._id), { ...r, completionPercentage: pct });
  }
  const escalationMap = new Map(
    escalationAgg.map((e) => [String(e._id), e.count]),
  );

  const campaignsWithNoReviewItems = campaigns.filter(
    (c) => !liveMetaMap.has(String(c._id)),
  );
  const scopeFallbackRecords = [];
  for (const c of campaignsWithNoReviewItems.slice(
    0,
    ISO_REPORT_SCOPE_FALLBACK_MAX_CAMPAIGNS,
  )) {
    if (!c.applicationName) continue;
    try {
      const { scopeData } = await loadScopeRowsForCampaign(c, {
        userTenantId,
      });
      if (scopeData.length > 0) {
        const cid = String(c._id);
        liveMetaMap.set(cid, {
          totalItems: scopeData.length,
          approvedItems: 0,
          revokedItems: 0,
          pendingItems: scopeData.length,
          completionPercentage: 0,
        });
        const isAccessCat = ISO_REPORT_ACCESS_SCOPED_CATEGORIES.includes(
          c.category,
        );
        for (const row of scopeData.slice(
          0,
          ISO_REPORT_SCOPE_FALLBACK_MAX_ROWS,
        )) {
          const accessItems =
            Array.isArray(row.displayAccess) && row.displayAccess.length > 0
              ? row.displayAccess
              : Array.isArray(row.displayGroupsLabel) &&
                  row.displayGroupsLabel.length > 0
                ? row.displayGroupsLabel
                : [];
          const rawUserId = String(row.userId || row.id || "").trim() || "—";
          const itemId =
            isAccessCat && accessItems.length > 0 ? accessItems[0] : rawUserId;
          scopeFallbackRecords.push({
            campaignId: cid,
            campaignName: c.name,
            applicationName: c.applicationName || "—",
            userId: rawUserId,
            itemId,
            accessScope: accessItems,
            itemName:
              String(row.name || row.displayName || row.userId || "").trim() ||
              "—",
            itemEmail: String(row.email || "").trim(),
            itemManager: String(row.manager || "").trim(),
            itemManagerEmail: String(row.managerEmail || "").trim(),
            itemDepartment: String(row.department || "").trim(),
            itemTitle: String(row.title || "").trim(),
            category: c.category || "—",
            reviewerEmail: "",
            reviewerName: "",
            isUnassigned: true,
            decision: "PENDING",
            status: "PENDING",
            reviewedAt: null,
            comment: "",
          });
        }
      }
    } catch (_) {
      // dynamic collection may not exist — skip
    }
  }

  const decisionRecords = await ReviewItem.find({
    campaignId: { $in: campaignIds },
  })
    .select(ISO_REPORT_REVIEW_ITEM_SELECT)
    .sort({ reviewedAt: -1 })
    .limit(recordLimit)
    .lean();

  const campaignNameMap = new Map(
    campaigns.map((c) => [String(c._id), c.name]),
  );
  const campaignAppNameMap = new Map(
    campaigns.map((c) => [String(c._id), c.applicationName || ""]),
  );
  const campaignTenantIdMap = new Map(
    campaigns.map((c) => [String(c._id), c.tenantId || null]),
  );

  const reviewerNameByEmail = new Map();
  for (const c of campaigns) {
    for (const r of c.reviewersAssigned || []) {
      const email = String(r?.email || r?.reviewerEmail || "")
        .trim()
        .toLowerCase();
      const name = String(r?.name || r?.reviewerName || "").trim();
      if (email && name) reviewerNameByEmail.set(email, name);
    }
  }

  // Build itemId → reviewerEmail fallback from campaign.currentReview for items
  // where ReviewItem.reviewerEmail was not populated at creation time.
  const campaignCurrentReviewMap = new Map();
  for (const c of campaigns) {
    if (!c.currentReview) continue;
    const cr =
      c.currentReview instanceof Map
        ? c.currentReview
        : new Map(Object.entries(c.currentReview));
    campaignCurrentReviewMap.set(String(c._id), cr);
  }

  const emailsNeedingName = new Set(
    decisionRecords
      .filter((ri) => {
        const e = (ri.reviewerEmail || "").toLowerCase();
        return (
          e &&
          !reviewerNameByEmail.has(e) &&
          (!ri.reviewerName || ri.reviewerName === ri.reviewerEmail)
        );
      })
      .map((ri) => ri.reviewerEmail.toLowerCase()),
  );
  if (emailsNeedingName.size > 0) {
    try {
      const userDocs = await mongoose
        .model("User")
        .find({ email: { $in: [...emailsNeedingName] } })
        .select("email name displayName")
        .lean();
      for (const u of userDocs) {
        const e = String(u.email || "").toLowerCase();
        const n = String(u.name || u.displayName || "").trim();
        if (e && n) reviewerNameByEmail.set(e, n);
      }
    } catch (_) {
      /* User model may not exist in all environments */
    }
  }

  const unknownRecords = decisionRecords.filter(
    (ri) => !ri.itemName || ri.itemName === "Unknown User",
  );
  const resolvedNameMap = new Map();
  if (unknownRecords.length > 0) {
    const byCampaign = new Map();
    for (const ri of unknownRecords) {
      const cid = String(ri.campaignId);
      if (!byCampaign.has(cid)) byCampaign.set(cid, []);
      byCampaign.get(cid).push(ri.userId);
    }
    for (const [cid, userIds] of byCampaign.entries()) {
      const appName = campaignAppNameMap.get(cid);
      if (!appName) continue;
      try {
        const UsersModel = await resolveMappedUserModel({
          name: appName,
          tenantId: campaignTenantIdMap.get(cid),
        });
        const validIds = userIds.filter((id) =>
          mongoose.Types.ObjectId.isValid(id),
        );
        const strIds = userIds.filter(
          (id) => !mongoose.Types.ObjectId.isValid(id),
        );
        const orClauses = [];
        if (validIds.length)
          orClauses.push({
            _id: {
              $in: validIds.map((id) => new mongoose.Types.ObjectId(id)),
            },
          });
        if (strIds.length) {
          orClauses.push({ primaryKey: { $in: strIds } });
          orClauses.push({ user_id: { $in: strIds } });
          orClauses.push({ email: { $in: strIds } });
        }
        if (!orClauses.length) continue;
        const users = await UsersModel.find({ $or: orClauses })
          .select("_id primaryKey user_id name display_name email rawData")
          .lean();
        for (const u of users) {
          const raw = u?.rawData || {};
          const resolvedName = resolveUserName(u, raw);
          if (!resolvedName || resolvedName === "Unknown User") continue;
          if (u._id)
            resolvedNameMap.set(`${cid}:${String(u._id)}`, resolvedName);
          if (u.primaryKey)
            resolvedNameMap.set(`${cid}:${u.primaryKey}`, resolvedName);
          if (u.user_id)
            resolvedNameMap.set(`${cid}:${u.user_id}`, resolvedName);
          if (u.email) resolvedNameMap.set(`${cid}:${u.email}`, resolvedName);
        }
      } catch (_) {
        /* collection may not exist */
      }
    }
  }

  const formattedRecords = decisionRecords.map((ri) => {
    const cid = String(ri.campaignId);
    const uid = ri.userId || "";
    const snapshotName =
      ri.itemName && ri.itemName !== "Unknown User" ? ri.itemName : null;
    const displayName =
      snapshotName || resolvedNameMap.get(`${cid}:${uid}`) || uid || "—";

    let rawReviewerEmail = (ri.reviewerEmail || "").toLowerCase();
    if (!rawReviewerEmail) {
      const cr = campaignCurrentReviewMap.get(cid);
      if (cr) {
        const crEntry = cr.get(String(ri.itemId)) || cr.get(String(ri.userId || ""));
        const crEmail = String(crEntry?.reviewerEmail || "").trim().toLowerCase();
        if (crEmail) rawReviewerEmail = crEmail;
      }
    }
    const isUnassigned = !rawReviewerEmail;
    const resolvedReviewerName = isUnassigned
      ? ""
      : ri.reviewerName && ri.reviewerName !== ri.reviewerEmail
        ? ri.reviewerName
        : reviewerNameByEmail.get(rawReviewerEmail) || "";

    const riCategory = ri.category || "";
    const isAccessCatRi =
      ISO_REPORT_ACCESS_SCOPED_CATEGORIES.includes(riCategory);
    const accessScope =
      Array.isArray(ri.itemAccessDetails) && ri.itemAccessDetails.length > 0
        ? ri.itemAccessDetails
        : [];
    const displayItemId =
      isAccessCatRi && accessScope.length > 0
        ? accessScope[0]
        : ri.itemId || uid || "—";

    // Derive effective status from entitlementDecisions when present.
    // The rollup always sets ReviewItem.status="APPROVED" when all entitlements are
    // decided (even if some were revoked), so we must read entitlementDecisions directly.
    let effectiveStatus = ri.status || "PENDING";
    let effectiveDecision = ri.decision || ri.status || "—";
    const eds = Array.isArray(ri.entitlementDecisions) ? ri.entitlementDecisions : [];
    if (eds.length > 0) {
      const pendingEds = eds.filter((ed) => (ed.status || "PENDING") === "PENDING");
      const revokedEds = eds.filter((ed) => ed.status === "REVOKED");
      if (pendingEds.length > 0) {
        effectiveStatus = "PENDING";
        effectiveDecision = "PENDING";
      } else if (revokedEds.length > 0) {
        effectiveStatus = "REVOKED";
        effectiveDecision = "Revoked";
      } else {
        effectiveStatus = "APPROVED";
        effectiveDecision = "Approved";
      }
    }

    return {
      campaignId: cid,
      campaignName: campaignNameMap.get(cid) || "—",
      applicationName:
        ri.itemApplicationName || campaignAppNameMap.get(cid) || "—",
      userId: uid || "—",
      itemId: displayItemId,
      accessScope,
      itemName: displayName,
      itemEmail: ri.itemEmail || "",
      itemManager: ri.itemManager || "",
      itemManagerEmail: ri.itemManagerEmail || "",
      itemTitle: ri.itemTitle || "",
      itemDepartment: ri.itemDepartment || "",
      category: riCategory || "—",
      reviewerEmail: isUnassigned ? "" : rawReviewerEmail || ri.reviewerEmail || "",
      reviewerName: resolvedReviewerName,
      isUnassigned,
      decision: effectiveDecision,
      status: effectiveStatus,
      reviewedAt: safeToISOString(ri.reviewedAt),
      comment: ri.comment || "",
    };
  });

  const allDecisionRecords = [...formattedRecords, ...scopeFallbackRecords];

  let totalCertified = 0;
  let totalRevoked = 0;
  let totalPending = 0;
  let totalEscalated = 0;
  let completionSum = 0;
  let activeCampaigns = 0;
  let completedCampaigns = 0;

  const formattedCampaigns = campaigns.map((c) => {
    const cid = String(c._id);
    const live = liveMetaMap.get(cid) || {
      totalItems: 0,
      approvedItems: 0,
      revokedItems: 0,
      pendingItems: 0,
      completionPercentage: 0,
    };
    const escalated = escalationMap.get(cid) || 0;

    totalCertified += live.approvedItems;
    totalRevoked += live.revokedItems;
    totalPending += live.pendingItems;
    totalEscalated += escalated;
    completionSum += live.completionPercentage;

    const statusLower = String(c.status || "").toLowerCase();
    if (["active", "decisionpending"].includes(statusLower))
      activeCampaigns += 1;
    if (["completed", "closed"].includes(statusLower)) completedCampaigns += 1;

    const now = new Date();
    const dueDate = c.dueDate != null ? new Date(c.dueDate) : null;
    const dueOk = dueDate && !Number.isNaN(dueDate.getTime());
    const isOverdue = Boolean(
      dueOk && dueDate < now && !["completed", "closed"].includes(statusLower),
    );

    return {
      id: cid,
      name: c.name,
      applicationName: c.applicationName || "—",
      status: c.status,
      category: c.category || "—",
      completionPercentage: live.completionPercentage,
      totalItems: live.totalItems,
      approvedItems: live.approvedItems,
      revokedItems: live.revokedItems,
      pendingItems: live.pendingItems,
      escalatedCount: escalated,
      dueDate: safeToISOString(c.dueDate),
      startDate: safeToISOString(c.startDate),
      endDate: safeToISOString(c.endDate),
      isOverdue,
    };
  });

  return {
    campaigns: formattedCampaigns,
    decisionRecords: allDecisionRecords,
    summary: {
      totalCampaigns: campaigns.length,
      activeCampaigns,
      completedCampaigns,
      totalCertified,
      totalRevoked,
      totalPending,
      totalEscalated,
      avgCompletionPct:
        campaigns.length > 0 ? Math.round(completionSum / campaigns.length) : 0,
    },
  };
}

/**
 * GET /certifications/campaigns/iso-report
 * Query: applicationId (optional if applicationName), applicationName, startDate, endDate, limit
 */
export const getCertificationISOReport = async (req, res, next) => {
  try {
    const userTenantId = await resolveCertificationAccessTenantId(req);

    const tenantConfig = await getTenantConfigByTenantId(userTenantId);
    if (tenantConfig?.features?.certification === false) {
      return res.status(403).json({
        success: false,
        message:
          "ISO report is not available: certification feature is disabled for this tenant.",
      });
    }

    const { applicationId, applicationName, startDate, endDate } = req.query;
    const recordLimit = Math.min(
      parseInt(
        req.query.limit ?? String(ISO_REPORT_DECISION_LIMIT_DEFAULT),
        10,
      ) || ISO_REPORT_DECISION_LIMIT_DEFAULT,
      ISO_REPORT_DECISION_LIMIT_MAX,
    );

    const data = await buildCertificationIsoReportData({
      userTenantId,
      applicationId,
      applicationName,
      startDate,
      endDate,
      recordLimit,
    });

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};
