/**
 * Tenant scoping helpers for SoD (matches req.scopedTenantId from auth middleware).
 */
export function sodTenantFilter(scopedTenantId) {
  const t = scopedTenantId ? String(scopedTenantId) : null;
  return t ? { tenantId: t } : {};
}

export function sodWithTenant(scopedTenantId, payload) {
  const t = scopedTenantId ? String(scopedTenantId) : null;
  if (!t) return payload;
  return { ...payload, tenantId: t };
}
