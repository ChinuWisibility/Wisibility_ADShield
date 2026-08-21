/**
 * Tenant scoping helpers for remediation (matches req.scopedTenantId from auth middleware).
 */
export function remediationTenantFilter(scopedTenantId) {
  const t = scopedTenantId ? String(scopedTenantId) : null;
  return t ? { tenantId: t } : {};
}

export function remediationWithTenant(scopedTenantId, payload) {
  const t = scopedTenantId ? String(scopedTenantId) : null;
  if (!t) return payload;
  return { ...payload, tenantId: t };
}
