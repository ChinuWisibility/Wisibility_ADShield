import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import Application from "../../models/application/Application.js";
import User from "../../models/platform/User.js";
import { AppError } from "../../middleware/errorHandler.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

export function isPlatformActor(req) {
  const role = req.user?.role;
  return role === "superAdmin" || (role === "admin" && !req.user?.tenantId);
}

export async function resolveUserTenantId(req) {
  if (isPlatformActor(req)) return null;

  const jwtTenantId = req.user?.tenantId;
  if (jwtTenantId) return jwtTenantId;

  const jwtUserId = req.user?.id;
  if (!jwtUserId) return null;

  const user = await User.findById(jwtUserId).select("tenantId").lean();
  return user?.tenantId || null;
}

async function getTenantApplicationIds(userTenantId) {
  if (!userTenantId) return [];
  const apps = await Application.find({ tenantId: userTenantId })
    .select("_id")
    .lean();
  return (apps || []).map((a) => a._id);
}

async function getTenantUserIds(userTenantId) {
  if (!userTenantId) return [];
  const users = await User.find({ tenantId: userTenantId })
    .select("_id")
    .lean();
  return (users || []).map((u) => u._id);
}

export async function getTenantCampaignScopeQuery(req) {
  if (isPlatformActor(req)) return {};

  const userTenantId = await resolveUserTenantId(req);
  if (!userTenantId) {
    throw new AppError(
      "Tenant not found for the current user",
      403,
      "TENANT_REQUIRED",
    );
  }

  const [tenantApplicationIds, tenantUserIds] = await Promise.all([
    getTenantApplicationIds(userTenantId),
    getTenantUserIds(userTenantId),
  ]);

  return {
    $or: [
      { applicationId: { $in: tenantApplicationIds } },
      // Profile / Governance scoped campaigns store tenantId directly.
      { tenantId: userTenantId },
      {
        category: "MANAGER",
        createdBy: { $in: tenantUserIds },
        $or: [{ applicationId: { $exists: false } }, { applicationId: null }],
      },
    ],
  };
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

  const tenantScope = await getTenantCampaignScopeQuery(req);
  const campaign = await Campaign.findOne({ _id: cId, ...tenantScope })
    .select("_id applicationId category createdBy tenantId")
    .lean();

  if (!campaign) {
    throw new AppError(
      notFound ? "Campaign not found" : "Forbidden",
      notFound ? 404 : 403,
      "TENANT_FORBIDDEN",
    );
  }

  return campaign;
}
