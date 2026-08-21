/** Remediation event catalog and detail pages (replaces legacy /governance/workflows/runs). */
export const REMEDIATION_RUNS_BASE = "/governance/remediation-events";

/** Maps legacy `/executions?eventType=` values to runs slugs. */
export const LEGACY_EXECUTIONS_EVENT_SLUG = {
  IAM_ORPHAN_REVIEW: "iam-orphan-review",
  ACCESS_REVOKE: "access-revoke",
};

export function remediationRunsPath(slug, params = {}) {
  const base = slug ? `${REMEDIATION_RUNS_BASE}/${slug}` : REMEDIATION_RUNS_BASE;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}
