import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import User from "../../models/platform/User.js";
import CertificationProfile from "../../models/certification/CertificationProfile.js";
import GlobalSettings from "../../models/certification/EmailReminderSettings.js";
import { AppError } from "../../middleware/errorHandler.js";
import { resolveCertificationAccessTenantId as resolveUserTenantId } from "../../utils/access-certification/resolveCertificationAccessTenantId.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";

export function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

export const FINAL_DECISIONS_SET = new Set([
  "Approved",
  "Revoked",
  "Delegate",
  "Exception",
]);
export const PROFILE_LEVEL_SUPPORTED_CATEGORIES = new Set([
  "IDENTITY",
  "MANAGER",
  "ACCESS_ITEMS",
]);

export async function getApplicationTenantId(applicationId) {
  const appId = asObjectId(applicationId);
  if (!appId) return null;
  const app = await Application.findById(appId).select("tenantId").lean();
  return app?.tenantId || null;
}

export async function resolveCertificationUserModel(applicationName, tenantId) {
  if (!applicationName || !tenantId) {
    throw new AppError(
      "Application name and tenant are required to resolve certification users",
      400,
      "CERT_USER_MODEL_REQUIRED",
    );
  }
  return resolveMappedUserModel({ name: applicationName, tenantId });
}

export async function getTenantApplicationIds(userTenantId) {
  if (!userTenantId) return [];
  const apps = await Application.find({ tenantId: userTenantId })
    .select("_id")
    .lean();
  return (apps || []).map((a) => a._id);
}

export async function assertTenantForApplication(
  req,
  applicationId,
  { notFound = true } = {},
) {
  const userTenantId = await resolveUserTenantId(req);
  if (!userTenantId) {
    throw new AppError(
      "Tenant not found for the current user",
      403,
      "TENANT_REQUIRED",
    );
  }

  const appTenantId = await getApplicationTenantId(applicationId);
  if (!appTenantId) {
    throw new AppError("Application not found", 404, "NOT_FOUND");
  }

  const ok = String(appTenantId) === String(userTenantId);
  if (!ok) {
    throw new AppError(
      notFound ? "Application not found" : "Forbidden",
      notFound ? 404 : 403,
      "TENANT_FORBIDDEN",
    );
  }
}

export async function assertTenantForCampaign(
  req,
  campaignId,
  { notFound = true } = {},
) {
  const cId = asObjectId(campaignId);
  if (!cId) {
    throw new AppError("Invalid campaign id", 400, "VALIDATION_ERROR");
  }

  const campaign = await Campaign.findById(cId)
    .select("applicationId createdBy category")
    .lean();
  if (!campaign) {
    throw new AppError("Campaign not found", 404, "NOT_FOUND");
  }

  // Most campaigns derive tenant from applicationId -> Application.tenantId.
  // Org-wide manager campaigns may not have applicationId; in that case we derive tenant from createdBy.
  if (campaign.applicationId) {
    await assertTenantForApplication(req, campaign.applicationId, { notFound });
    return;
  }

  const userTenantId = await resolveUserTenantId(req);
  if (!userTenantId) {
    throw new AppError(
      "Tenant not found for the current user",
      403,
      "TENANT_REQUIRED",
    );
  }

  const createdByTenantId = await User.findById(campaign.createdBy)
    .select("tenantId")
    .lean()
    .then((u) => u?.tenantId || null);

  if (!createdByTenantId) {
    // If we can't resolve campaign tenant safely, deny access.
    throw new AppError(
      notFound ? "Campaign not found" : "Forbidden",
      notFound ? 404 : 403,
      "TENANT_FORBIDDEN",
    );
  }

  const ok = String(createdByTenantId) === String(userTenantId);
  if (!ok) {
    throw new AppError(
      notFound ? "Campaign not found" : "Forbidden",
      notFound ? 404 : 403,
      "TENANT_FORBIDDEN",
    );
  }
}

export async function resolveAndApplyCertificationProfileDefaults(req, payload) {
  const profileId = asObjectId(payload.certificationProfileId);
  if (!profileId) return payload;

  const userTenantId = await resolveUserTenantId(req);
  if (!userTenantId) {
    throw new AppError(
      "Tenant not found for the current user",
      403,
      "TENANT_REQUIRED",
    );
  }

  if (!PROFILE_LEVEL_SUPPORTED_CATEGORIES.has(payload.category)) {
    throw new AppError(
      "Certification profiles are only supported for Identity, Manager and Access Items categories",
      400,
      "VALIDATION_ERROR",
    );
  }

  const profile = await CertificationProfile.findOne({
    _id: profileId,
    tenantId: userTenantId,
    status: "ACTIVE",
  }).lean();

  if (!profile) {
    throw new AppError("Certification profile not found", 404, "NOT_FOUND");
  }

  if (
    Array.isArray(profile.supportedCategories) &&
    !profile.supportedCategories.includes(payload.category)
  ) {
    throw new AppError(
      `Profile does not support ${payload.category} category`,
      400,
      "VALIDATION_ERROR",
    );
  }

  if (
    profile.applicationId &&
    payload.applicationId &&
    String(profile.applicationId) !== String(payload.applicationId)
  ) {
    throw new AppError(
      "Selected certification profile is bound to a different application",
      400,
      "VALIDATION_ERROR",
    );
  }

  const isProfileLevel =
    String(payload.certificationLevel || "").toUpperCase() === "PROFILE";
  const profileCategoryNeedsApp =
    payload.category === "IDENTITY" || payload.category === "ACCESS_ITEMS";

  if (isProfileLevel && profileCategoryNeedsApp && !profile.applicationId) {
    throw new AppError(
      "Selected certification profile must be bound to an application for profile-level Identity or Access Items campaigns",
      400,
      "VALIDATION_ERROR",
    );
  }

  if (profile.applicationId) {
    payload.applicationId = profile.applicationId;
  }

  payload.certificationProfileId = profile._id;

  if (payload.category === "IDENTITY") {
    if (!payload.identityMode && profile.defaults?.identity?.identityMode) {
      payload.identityMode = profile.defaults.identity.identityMode;
    }
    if (!payload.identityFilter && profile.defaults?.identity?.identityFilter) {
      payload.identityFilter = profile.defaults.identity.identityFilter;
    }
  }

  if (payload.category === "ACCESS_ITEMS") {
    if (!payload.accessFilter && profile.defaults?.accessItems?.accessFilter) {
      payload.accessFilter = profile.defaults.accessItems.accessFilter;
    }
  }

  return payload;
}

export function getUserId(req) {
  const userId = req.user?.id;
  return userId && mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : undefined;
}

export function normalizeText(value) {
  const text = String(value || "").trim();
  return text || "";
}

export function composeUserDisplayName(user = {}) {
  const firstName = normalizeText(user.firstName);
  const lastName = normalizeText(user.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;

  const directName = normalizeText(
    user.displayName || user.name || user.reviewerName || user.createdByDisplay,
  );
  if (directName) return directName;

  return normalizeText(user.email || user.reviewerEmail);
}

export function mapReviewerAssignment(reviewer = {}) {
  const reviewerId = reviewer?.reviewerId?._id || reviewer?.reviewerId || null;
  const reviewerEmail = normalizeText(
    reviewer?.reviewerEmail || reviewer?.email || reviewer?.reviewerId?.email,
  );

  const reviewerName =
    composeUserDisplayName({
      firstName: reviewer?.reviewerId?.firstName,
      lastName: reviewer?.reviewerId?.lastName,
      email: reviewer?.reviewerId?.email || reviewerEmail,
      name: reviewer?.name || reviewer?.reviewerName,
    }) ||
    reviewerEmail ||
    "Unknown";

  return {
    ...reviewer,
    reviewerId,
    reviewerType: reviewer?.reviewerType || null,
    reviewerEmail: reviewerEmail || null,
    reviewerName,
  };
}

export async function deriveReviewersFromPendingReviewItems(campaignId) {
  const emails = await ReviewItem.distinct("reviewerEmail", {
    campaignId,
    status: "PENDING",
  });
  return emails.map((e) => ({
    email: String(e || "")
      .trim()
      .toLowerCase(),
    name: String(e || "").trim(),
  }));
}

export function computeCampaignAnalytics({
  campaign,
  scopeData,
  usersInApplication = 0,
  entitlementsInApplication = 0,
}) {
  const scoped = Array.isArray(scopeData) ? scopeData : [];
  const reviewers = Array.isArray(campaign?.reviewersAssigned)
    ? campaign.reviewersAssigned
    : [];

  const reviewerEmailSet = new Set(
    reviewers
      .map((r) =>
        normalizeText(
          r?.reviewerEmail || r?.email || r?.reviewerId?.email,
        ).toLowerCase(),
      )
      .filter(Boolean),
  );

  const userScopeSet = new Set();
  const entitlementScopeSet = new Set();
  let usersMissingReviewer = 0;

  for (const item of scoped) {
    const userKey = normalizeText(item?.userId || item?.id || item?.email);
    if (userKey) userScopeSet.add(userKey.toLowerCase());

    const targetIds = Array.isArray(item?.targetIds) ? item.targetIds : [];
    for (const t of targetIds) {
      const token = normalizeText(t);
      if (token) entitlementScopeSet.add(token.toLowerCase());
    }

    const labels = Array.isArray(item?.displayGroupsLabel)
      ? item.displayGroupsLabel
      : [];
    for (const label of labels) {
      const token = normalizeText(label);
      if (token) entitlementScopeSet.add(token.toLowerCase());
    }

    const itemReviewerEmail = normalizeText(
      item?.currentReview?.reviewerEmail ||
        item?.reviewerEmail ||
        item?.managerEmail,
    ).toLowerCase();
    const hasReviewer = Boolean(itemReviewerEmail) || reviewerEmailSet.size > 0;

    if (!hasReviewer) usersMissingReviewer++;
  }

  const usersInScope = Math.max(userScopeSet.size, scoped.length);
  const entitlementsInScope = entitlementScopeSet.size;
  const totalEntitlements = Math.max(
    Number(entitlementsInApplication) || 0,
    entitlementsInScope,
  );

  return {
    managersToEmail: reviewerEmailSet.size,
    usersInScope,
    usersMissingReviewer,
    totalEntitlements,
    entitlementsInScope,
    entitlementsNotReviewed: Math.max(
      0,
      totalEntitlements - entitlementsInScope,
    ),
    usersInApplication: Number(usersInApplication) || 0,
    scopedItems: scoped.length,
  };
}

export function normalizeCampaignApplication(campaign) {
  if (!campaign) return campaign;

  const appRef = campaign.applicationId;
  const appId = appRef?._id || appRef;
  const applicationName =
    campaign.applicationName || appRef?.name || campaign.appName || null;

  // Prefer tenant from Application, fall back to Campaign.tenantId
  const tenantRef = appRef?.tenantId || campaign.tenantId;
  const tenantId = tenantRef?._id || tenantRef || null;
  const tenantName = tenantRef?.name || campaign.tenantName || null;

  return {
    ...campaign,
    applicationId: appId,
    applicationName,
    tenantId,
    tenantName,
  };
}

export async function getOrCreateGlobalSettings(userId, tenantId) {
  const filter = tenantId
    ? { campaignId: null, tenantId }
    : { campaignId: null };
  const existing = await GlobalSettings.findOne(filter);
  if (existing) return existing;

  return GlobalSettings.create({
    ...filter,
    frequency: "WEEKLY",
    isActive: true,
    updatedBy: userId,
    updatedAt: new Date(),
  });
}

/** Access-cert PATCH /review is limited to certWrite roles; those users may not appear in reviewersAssigned. */
export function shouldSkipReviewerAssignmentForCertApi(req) {
  const role = req.user?.role;
  return role === "admin" || role === "superAdmin" || role === "certAdmin";
}
