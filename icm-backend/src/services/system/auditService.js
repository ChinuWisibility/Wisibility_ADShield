import Audit from "../models/platform/Audit.js";
import { AppError } from "../middleware/errorHandler.js";

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

export async function listAuditLogs({
  page = 1,
  limit = 50,
  action,
  userId,
  startDate,
  endDate,
  method,
  path,
  sortField = "createdAt",
  sortDir = "desc",
  actor,
}) {
  const query = {};
  applyTenantScope(query, actor);
  if (action) query.action = new RegExp(action, "i");
  if (userId) query.userId = userId;
  if (method) query.method = method;
  if (path) query.path = new RegExp(path, "i");
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const SORTABLE = {
    createdAt: "createdAt",
    method: "method",
    action: "action",
    userEmail: "userEmail",
    statusCode: "statusCode",
    ipAddress: "ipAddress",
  };
  const sortKey = SORTABLE[sortField] || "createdAt";
  const sortOrder = String(sortDir).toLowerCase() === "asc" ? 1 : -1;

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Audit.find(query)
      .sort({ [sortKey]: sortOrder })
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "firstName lastName email")
      .populate("tenantId", "name code"),
    Audit.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function getAuditEntry(id, actor) {
  const query = { _id: id };
  applyTenantScope(query, actor);
  const entry = await Audit.findOne(query)
    .populate("userId", "firstName lastName email role")
    .populate("tenantId", "name code");
  if (!entry)
    throw new AppError("Audit entry not found", 404, "AUDIT_NOT_FOUND");
  return entry;
}

export async function getAuditByEntity(entityType, entityId, actor) {
  const query = { entityType, entityId };
  applyTenantScope(query, actor);
  const items = await Audit.find(query)
    .sort({ createdAt: -1 })
    .populate("userId", "firstName lastName email")
    .populate("tenantId", "name code");
  return items;
}

export async function exportAuditLog({
  format = "json",
  action,
  userId,
  startDate,
  endDate,
  method,
  path,
  actor,
}) {
  const query = {};
  applyTenantScope(query, actor);
  if (action) query.action = new RegExp(action, "i");
  if (userId) query.userId = userId;
  if (method) query.method = method;
  if (path) query.path = new RegExp(path, "i");
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const items = await Audit.find(query)
    .sort({ createdAt: -1 })
    .limit(10000)
    .populate("userId", "firstName lastName email")
    .populate("tenantId", "name code")
    .lean();

  if (format === "csv") {
    const header =
      "id,userEmail,action,method,path,statusCode,ipAddress,createdAt\n";
    const rows = items
      .map(
        (i) =>
          `${i._id},${i.userEmail || ""},${i.action},${i.method || ""},${i.path || ""},${i.statusCode || ""},${i.ipAddress || ""},${i.createdAt?.toISOString() || ""}`,
      )
      .join("\n");
    return { format: "csv", content: header + rows, count: items.length };
  }

  return { format: "json", content: items, count: items.length };
}

export async function getLoginHistory({ page = 1, limit = 50, actor }) {
  const query = { action: /login/i };
  applyTenantScope(query, actor);
  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Audit.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Audit.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function getAuditStats({ startDate, endDate, actor } = {}) {
  const match = {};
  applyTenantScope(match, actor);
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) match.createdAt.$gte = new Date(startDate);
    if (endDate) match.createdAt.$lte = new Date(endDate);
  }

  const pipeline = Object.keys(match).length ? [{ $match: match }] : [];

  const [total, byAction, byMethod, byDay] = await Promise.all([
    Audit.countDocuments(match),
    Audit.aggregate([
      ...pipeline,
      { $group: { _id: "$action", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]),
    Audit.aggregate([
      ...pipeline,
      { $group: { _id: "$method", count: { $sum: 1 } } },
    ]),
    Audit.aggregate([
      ...pipeline,
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
  ]);

  return { total, byAction, byMethod, byDay };
}

export async function purgeAuditLogs({ retentionDays, actor }) {
  if (!isPlatformPlaneActor(actor)) {
    throw new AppError("Platform-wide access required", 403, "FORBIDDEN");
  }

  if (!retentionDays || retentionDays < 1) {
    throw new AppError(
      "retentionDays must be a positive number",
      400,
      "INVALID_RETENTION",
    );
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const result = await Audit.deleteMany({ createdAt: { $lt: cutoff } });
  return {
    deletedCount: result.deletedCount,
    cutoffDate: cutoff.toISOString(),
  };
}
