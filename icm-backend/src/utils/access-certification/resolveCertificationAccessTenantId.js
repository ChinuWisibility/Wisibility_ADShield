import Application from "../../models/application/Application.js";
import User from "../../models/platform/User.js";
import Tenant from "../../models/platform/Tenant.js";

const _tenantIdCache = new Map();

/**
 * Tenant id for access-certification flows: JWT user lookup plus fallbacks
 * (tenant ownership / application ownership) when `User.tenantId` is unset.
 * Differs from `certificationTenantScope.resolveUserTenantId` (JWT-first, no inference).
 */
export async function resolveCertificationAccessTenantId(req) {
  const rawJwtId = req.user?.id ?? req.user?._id;
  const jwtUserId = rawJwtId != null ? String(rawJwtId) : null;
  if (!jwtUserId) return null;

  if (_tenantIdCache.has(jwtUserId)) return _tenantIdCache.get(jwtUserId);

  const user = await User.findById(jwtUserId).select("tenantId role").lean();
  let tenantId = user?.tenantId || null;

  if (!tenantId) {
    const role = user?.role;
    const inferredByTenant =
      role === "admin" || role === "superAdmin"
        ? await Tenant.findOne({ createdBy: jwtUserId, isActive: true })
            .select("_id")
            .lean()
        : null;
    tenantId = inferredByTenant?._id || null;

    if (!tenantId) {
      const inferredByApp = await Application.findOne({ createdBy: jwtUserId })
        .select("tenantId")
        .lean();
      tenantId = inferredByApp?.tenantId || null;
    }
  }

  _tenantIdCache.set(jwtUserId, tenantId);
  return tenantId;
}
