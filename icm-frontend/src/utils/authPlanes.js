/**
 * Plane helpers for platform vs org-admin vs tenant roles.
 * tenantId may be null, an ObjectId string, or a populated `{ _id, name, code }`.
 */

export function getUserTenantId(user) {
  const raw = user?.tenantId;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    const id = raw._id ?? raw.id;
    if (id == null || id === '') return null;
    return String(id);
  }
  return String(raw);
}

export function computeIsPlatformAdmin(user) {
  if (!user?.role) return false;
  if (user.role === 'superAdmin') return true;
  return user.role === 'admin' && !getUserTenantId(user);
}

/** Tenant-scoped admin only — mutually exclusive with platform admin. */
export function computeIsOrgAdmin(user) {
  if (!user?.role) return false;
  if (user.role !== 'admin') return false;
  if (computeIsPlatformAdmin(user)) return false;
  return Boolean(getUserTenantId(user));
}

export function computeIsTenantAdmin(user) {
  return user?.role === 'certAdmin';
}

export function computeIsAdmin(user) {
  return user?.role === 'admin' || user?.role === 'superAdmin';
}
