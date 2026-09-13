import Activity from "../models/platform/Activity.js";
import { AppError } from "../middleware/errorHandler.js";
import User from "../models/platform/User.js";

function isPlatformPlaneActor(actor) {
  return (
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !actor?.tenantId)
  );
}

function applyTenantScope(query, actor) {
  if (!actor)
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  if (isPlatformPlaneActor(actor)) return query;
  if (!actor.tenantId)
    throw new AppError("Tenant context required", 403, "TENANT_SCOPE_REQUIRED");
  query.tenantId = actor.tenantId;
  return query;
}

export async function logActivity({
  userId,
  tenantId,
  type,
  description,
  entityType,
  entityId,
  metadata,
}) {
  if (!type)
    throw new AppError("Activity type is required", 400, "MISSING_TYPE");
  let resolvedTenantId = tenantId || null;
  if (!resolvedTenantId && userId) {
    const user = await User.findById(userId).select("tenantId").lean();
    resolvedTenantId = user?.tenantId || null;
  }

  const activity = await Activity.create({
    userId,
    tenantId: resolvedTenantId,
    type,
    description,
    entityType,
    entityId,
    metadata,
  });
  return activity;
}

export async function getActivityFeed({
  page = 1,
  limit = 50,
  type,
  userId,
  startDate,
  endDate,
  actor,
}) {
  const query = {};
  applyTenantScope(query, actor);
  if (type) {
    const t = String(type).trim().toLowerCase();
    // Accept UI-friendly aliases for stored activity types
    if (t === "login" || t === "signin" || t === "sign-in") {
      query.$or = [
        { type: { $regex: /^login$/i } },
        { type: { $regex: /^authentication$/i }, description: /logged in|login attempt|sign.?in/i },
      ];
    } else if (t === "logout" || t === "signout" || t === "sign-out") {
      query.$or = [
        { type: { $regex: /^logout$/i } },
        { type: { $regex: /^authentication$/i }, description: /logged out|sign.?out/i },
      ];
    } else if (t === "auth" || t === "authentication") {
      query.type = { $regex: /^(authentication|login|logout)$/i };
    } else {
      query.type = new RegExp(
        `^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i",
      );
    }
  }
  if (userId) query.userId = userId;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Activity.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "firstName lastName email")
      .populate("tenantId", "name code"),
    Activity.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function getMyActivity(userId, { page = 1, limit = 50 }) {
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Activity.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Activity.countDocuments({ userId }),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function getEntityActivity(
  entityId,
  { page = 1, limit = 50 },
  actor,
) {
  const query = { entityId };
  applyTenantScope(query, actor);
  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Activity.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "firstName lastName email")
      .populate("tenantId", "name code"),
    Activity.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}
