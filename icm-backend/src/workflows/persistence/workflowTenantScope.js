/**
 * Tenant scope for remediation workflows.
 * Catalog list/create use owned-only filters so each tenant sees and creates its own flows.
 * Runtime "enabled" lookups may still include global templates (tenantId null).
 */
export function buildWorkflowTenantReadFilter(tenantId) {
  if (!tenantId) return {};
  const tid = String(tenantId);
  return {
    $or: [{ tenantId: tid }, { tenantId: null }, { tenantId: { $exists: false } }],
  };
}

/** Strict ownership — catalog list and writes for a tenant. */
export function buildWorkflowTenantOwnedFilter(tenantId) {
  if (!tenantId) return { tenantId: { $in: [null, undefined] } }; // unused; callers require tenant
  return { tenantId: String(tenantId) };
}

export function buildWorkflowTenantWriteFilter(tenantId) {
  if (!tenantId) return {};
  return { tenantId: String(tenantId) };
}
