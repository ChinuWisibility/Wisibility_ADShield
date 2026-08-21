/**
 * Tenant-scoped query helpers for certification email collections.
 *
 * Migration phase (default): match campaignId + (tenantId OR legacy missing tenantId).
 * Final state: set TENANT_STRICT_EMAIL_QUERIES=true for { campaignId, tenantId } only.
 */
export function isStrictTenantEmailQueries() {
  return String(process.env.TENANT_STRICT_EMAIL_QUERIES || "")
    .trim()
    .toLowerCase() === "true";
}

/**
 * Build a Mongo filter scoped to a campaign, with optional tenant isolation.
 * Caller must validate campaign access (assertTenantForCampaign) before querying.
 */
export function buildTenantScopedCampaignFilter(campaignId, tenantId) {
  const filter = { campaignId };

  if (!tenantId) {
    return filter;
  }

  if (isStrictTenantEmailQueries()) {
    filter.tenantId = tenantId;
    return filter;
  }

  // Migration: include legacy rows created before tenantId was mandatory on writes.
  filter.$or = [
    { tenantId },
    { tenantId: { $exists: false } },
    { tenantId: null },
  ];

  return filter;
}
