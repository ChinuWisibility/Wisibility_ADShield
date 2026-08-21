/** Allowed Security Posture Dashboard tile / panel ids for preference validation. */

export const SECURITY_DASHBOARD_TILE_IDS = new Set([
  "total_risks",
  "disabled_users",
  "critical",
  "toxic_combinations",
  "dormant_privileged",
  "empty_groups",
  "orphan_groups",
  "escalation_paths",
  "shadow_admins",
  "unknown_sid_bindings",
  "broken_acls",
  "sid_history_risks",
  "foreign_principals",
  "inactive_computers",
  "unsupported_os",
  "duplicate_spns",
  "kerberoastable",
  "asrep_roastable",
  "unconstrained_delegation",
  "rbcd_exposure",
  "priv_escalation_paths",
  "priv_dormant_privileged",
  "priv_excessive_privileges",
  "priv_nested_privileged",
  "priv_toxic_combinations",
  "priv_shadow_admins",
  "priv_kerberoastable",
  "priv_unconstrained_delegation",
  "priv_rbcd",
  "privilege_exposure",
  "comparison",
  "severity_pie",
  "scan_status",
  "top_exposures",
  "trends",
  "domain_evidence",
  "assessment_compare_panel",
  "top_findings",
  "reports",
]);

export function normalizeSecurityDashboardPrefs(raw = {}) {
  const hidden = Array.isArray(raw?.hiddenTiles)
    ? raw.hiddenTiles.map(String).filter((id) => SECURITY_DASHBOARD_TILE_IDS.has(id))
    : [];
  return {
    hideZeroMetrics: Boolean(raw?.hideZeroMetrics),
    hiddenTiles: [...new Set(hidden)],
  };
}
