import UserSession from "../../models/platform/UserSession.js";
import { AppError } from "../../middleware/errorHandler.js";
import User from "../../models/platform/User.js";

function isPlatformPlaneActor(actor) {
  return (
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !actor?.tenantId)
  );
}

async function resolveScopedUserIds(actor) {
  if (!actor)
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  if (isPlatformPlaneActor(actor)) return null;
  if (!actor.tenantId)
    throw new AppError("Tenant context required", 403, "TENANT_SCOPE_REQUIRED");

  const users = await User.find({ tenantId: actor.tenantId })
    .select("_id")
    .lean();
  return users.map((u) => u._id);
}

export async function listActiveSessions(userId) {
  const sessions = await UserSession.find({
    userId,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  return sessions;
}

export async function revokeSession(userId, sessionId) {
  const session = await UserSession.findOne({ _id: sessionId, userId });
  if (!session)
    throw new AppError("Session not found", 404, "SESSION_NOT_FOUND");

  session.isRevoked = true;
  await session.save();
  return { message: "Session revoked" };
}

export async function listAllSessions({ page = 1, limit = 50, userId, actor }) {
  const query = { isRevoked: false, expiresAt: { $gt: new Date() } };
  const scopedUserIds = await resolveScopedUserIds(actor);

  if (scopedUserIds) {
    query.userId = { $in: scopedUserIds };
  }

  if (userId) {
    if (
      scopedUserIds &&
      !scopedUserIds.some((id) => String(id) === String(userId))
    ) {
      throw new AppError(
        "Cannot access sessions outside your tenant",
        403,
        "TENANT_SCOPE_VIOLATION",
      );
    }
    query.userId = userId;
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    UserSession.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "firstName lastName email role"),
    UserSession.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}
