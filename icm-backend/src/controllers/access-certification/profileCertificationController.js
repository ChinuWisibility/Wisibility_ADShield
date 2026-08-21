import mongoose from "mongoose";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import Identity from "../../models/identity/Identity.js";
import Campaign from "../../models/certification/Campaign.js";
import { AppError } from "../../middleware/errorHandler.js";
import { resolveCertificationAccessTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { buildIdentityScope, buildManagerScope } from "../../services/access-certification/profileCertificationScopeService.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function normalizeText(value) {
  const s = String(value ?? "").trim();
  return s || "";
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const listIdentityProfilesForCertification = async (req, res, next) => {
  try {
    const tenantId = await resolveCertificationAccessTenantId(req);
    if (!tenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const profiles = await IdentityProfile.find({ tenantId })
      .select("_id name description sourceApplicationId hrmsSourceId isActive")
      .sort({ name: 1 })
      .lean();

    return res.json({ success: true, data: profiles || [] });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /identity-profiles/:profileId/managers
 *
 * Returns all managers who have direct reports in the given identity profile,
 * with directReportsCount and riskCount (identities with riskScore >= 70).
 *
 * Uses in-memory grouping of projected Identity docs to avoid a live $group
 * aggregation — safe for typical IGA scale (≤50k identities per profile).
 */
export const getManagersForIdentityProfile = async (req, res, next) => {
  try {
    const tenantId = await resolveCertificationAccessTenantId(req);
    if (!tenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const profileId = asObjectId(req.params.profileId);
    if (!profileId) {
      throw new AppError("Invalid identity profile id", 400, "VALIDATION_ERROR");
    }

    const profile = await IdentityProfile.findOne({ _id: profileId, tenantId })
      .select("_id")
      .lean();
    if (!profile) {
      throw new AppError("Identity Profile not found", 404, "NOT_FOUND");
    }

    // 1. Load all identities in this profile (projected — only manager-related fields)
    const identities = await Identity.find({ tenantId, identityProfileId: profileId })
      .select("_id managerId managerEmail department riskScore")
      .lean();

    // 2. Group by managerId in-memory
    const RISK_THRESHOLD = 70;
    /** @type {Map<string, { managerId: string, department: string, directReportsCount: number, riskCount: number }>} */
    const managerMap = new Map();

    for (const identity of identities) {
      if (!identity.managerId) continue;
      const key = String(identity.managerId);
      if (!managerMap.has(key)) {
        managerMap.set(key, {
          managerId:          key,
          department:         identity.department || "",
          directReportsCount: 0,
          riskCount:          0,
        });
      }
      const entry = managerMap.get(key);
      entry.directReportsCount += 1;
      if ((identity.riskScore || 0) >= RISK_THRESHOLD) entry.riskCount += 1;
    }

    if (managerMap.size === 0) {
      return res.json({ success: true, data: [] });
    }

    // 3. Batch-lookup manager display names + emails
    const managerIds = [...managerMap.keys()];
    const managerDocs = await Identity.find({ _id: { $in: managerIds } })
      .select("_id displayName firstName lastName email")
      .lean();

    // 4. Merge and return
    const data = managerDocs.map((m) => {
      const entry = managerMap.get(String(m._id)) || {};
      return {
        managerId:          String(m._id),
        managerName:        m.displayName
                              || [m.firstName, m.lastName].filter(Boolean).join(" ").trim()
                              || "",
        managerEmail:       m.email || "",
        department:         entry.department         || "",
        directReportsCount: entry.directReportsCount || 0,
        riskCount:          entry.riskCount          || 0,
      };
    }).sort((a, b) => a.managerName.localeCompare(b.managerName));

    return res.json({ success: true, data });
  } catch (err) {
    return next(err);
  }
};

/**
 * GET /campaigns/:campaignId/readiness
 *
 * Pre-activation readiness report for PROFILE-scope campaigns.
 * Returns coverage metrics: managerCoveragePercent, emailCoveragePercent,
 * managerMissing, emailMissing, and total scope counts.
 *
 * Shown to admins in CampaignReadinessModal before they activate the campaign.
 */
export const checkCampaignReadiness = async (req, res, next) => {
  try {
    const tenantId = await resolveCertificationAccessTenantId(req);
    if (!tenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const campaignId = asObjectId(req.params.campaignId);
    if (!campaignId) {
      throw new AppError("Invalid campaign id", 400, "VALIDATION_ERROR");
    }

    const campaign = await Campaign.findOne({ _id: campaignId, tenantId }).lean();
    if (!campaign) {
      throw new AppError("Campaign not found", 404, "NOT_FOUND");
    }

    const category = String(campaign.category || "").toUpperCase();
    if (!["IDENTITY", "MANAGER"].includes(category)) {
      throw new AppError(
        "Readiness check is only available for PROFILE IDENTITY and MANAGER certifications",
        400,
        "UNSUPPORTED_CATEGORY",
      );
    }

    const { readinessSummary } = await (
      category === "IDENTITY"
        ? buildIdentityScope(campaign, tenantId)
        : buildManagerScope(campaign, tenantId)
    );

    const total = readinessSummary.totalIdentities || 1; // avoid divide-by-zero

    return res.json({
      success: true,
      data: {
        totalIdentities:        readinessSummary.totalIdentities,
        totalReviewItems:       readinessSummary.totalEntitlements,
        managerResolved:        readinessSummary.managerResolved,
        managerMissing:         readinessSummary.managerMissing,
        emailMissing:           readinessSummary.emailMissing,
        backupReviewerEmail:    campaign.backupManagerReviewerEmail || null,
        managerCoveragePercent: Math.round((readinessSummary.managerResolved / total) * 100),
        emailCoveragePercent:   Math.round(
          ((readinessSummary.totalIdentities - readinessSummary.emailMissing) / total) * 100,
        ),
      },
    });
  } catch (err) {
    return next(err);
  }
};

export const getIdentitiesForIdentityProfileCertification = async (
  req,
  res,
  next,
) => {
  try {
    const tenantId = await resolveCertificationAccessTenantId(req);
    if (!tenantId) {
      throw new AppError(
        "Tenant not found for the current user",
        403,
        "TENANT_REQUIRED",
      );
    }

    const profileId = asObjectId(req.params.id);
    if (!profileId) {
      throw new AppError("Invalid identity profile id", 400, "VALIDATION_ERROR");
    }

    const profile = await IdentityProfile.findOne({ _id: profileId, tenantId })
      .select("_id")
      .lean();
    if (!profile) {
      throw new AppError("Identity Profile not found", 404, "NOT_FOUND");
    }

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(500, Math.max(10, Number(req.query.limit || 200)));
    const skip = (page - 1) * limit;
    const qText = normalizeText(req.query.q);
    const identityFilter = String(req.query.identityFilter || "ALL")
      .trim()
      .toUpperCase();

    const filter = {
      tenantId,
      identityProfileId: profileId,
    };

    if (identityFilter === "NHI") {
      filter.$or = [
        ...(Array.isArray(filter.$or) ? filter.$or : []),
        { isNHI: true },
        { identityType: { $in: ["nhi", "service"] } },
      ];
    } else if (identityFilter === "CONTRACTOR") {
      filter.identityType = "contractor";
    }

    if (qText) {
      const re = new RegExp(escapeRegex(qText), "i");
      const search = [
        { displayName: re },
        { email: re },
        { department: re },
        { title: re },
        { manager: re },
        { managerEmail: re },
        { employeeId: re },
      ];
      if (Array.isArray(filter.$or) && filter.$or.length > 0) {
        // If identityFilter already populated $or (e.g. NHI), preserve it.
        filter.$and = [{ $or: filter.$or }, { $or: search }];
        delete filter.$or;
      } else {
        filter.$or = search;
      }
    }

    const [rows, total] = await Promise.all([
      Identity.find(filter)
        .select(
          "_id displayName firstName lastName email employeeId department title manager managerId managerEmail managerEmployeeId lifecycleState identityType isActive isNHI",
        )
        .sort({ displayName: 1, email: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Identity.countDocuments(filter),
    ]);

    const managerIds = new Set();
    const managerEmployeeIds = new Set();
    for (const r of rows || []) {
      if (r?.managerId) managerIds.add(String(r.managerId));
      const me = String(r?.managerEmployeeId || "").trim();
      if (!r?.managerId && me) managerEmployeeIds.add(me);
    }

    const [managerDocs, managerEmpDocs] = await Promise.all([
      managerIds.size
        ? Identity.find({ tenantId, _id: { $in: [...managerIds] } })
            .select("_id displayName firstName lastName")
            .lean()
        : [],
      managerEmployeeIds.size
        ? Identity.find({
            tenantId,
            employeeId: { $in: [...managerEmployeeIds] },
          })
            .select("_id employeeId displayName firstName lastName")
            .lean()
        : [],
    ]);

    const managerNameById = new Map();
    for (const m of managerDocs || []) {
      const name =
        m?.displayName || [m?.firstName, m?.lastName].filter(Boolean).join(" ");
      if (m?._id && name) managerNameById.set(String(m._id), name);
    }
    const managerNameByEmployeeId = new Map();
    for (const m of managerEmpDocs || []) {
      const emp = String(m?.employeeId || "").trim();
      const name =
        m?.displayName || [m?.firstName, m?.lastName].filter(Boolean).join(" ");
      if (emp && name) managerNameByEmployeeId.set(emp, name);
    }

    const data = (rows || []).map((i) => {
      const identityType = String(i.identityType || "").toLowerCase();
      const mgrName =
        (i?.managerId
          ? managerNameById.get(String(i.managerId))
          : managerNameByEmployeeId.get(String(i?.managerEmployeeId || "").trim())) ||
        i.manager ||
        "";
      return {
        id: String(i._id),
        name: i.displayName || [i.firstName, i.lastName].filter(Boolean).join(" ") || "",
        email: i.email || "",
        title: i.title || "",
        department: i.department || "",
        manager: mgrName,
        managerName: mgrName,
        managerEmail: i.managerEmail || "",
        status: i.isActive === false ? "inactive" : "active",
        lifecycleState: i.lifecycleState || "",
        identityType: i.identityType || "",
        isNHI: Boolean(i.isNHI || identityType === "nhi" || identityType === "service"),
        isContractor: Boolean(identityType === "contractor"),
        employeeId: i.employeeId || "",
      };
    });

    return res.json({
      success: true,
      data,
      meta: {
        page,
        limit,
        total,
        hasMore: skip + data.length < total,
      },
    });
  } catch (err) {
    return next(err);
  }
};
