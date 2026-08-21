/** Canonical Security Posture Dashboard tile / panel ids (persisted in user preferences). */

export const SECURITY_DASHBOARD_METRIC_TILES = [
  { id: "total_risks", label: "Total risks", group: "Overview" },
  { id: "disabled_users", label: "Disabled users", group: "Users" },
  { id: "critical", label: "Critical", group: "Overview" },
  { id: "toxic_combinations", label: "Toxic combinations", group: "Privileged" },
  { id: "dormant_privileged", label: "Dormant privileged", group: "Privileged" },
  { id: "empty_groups", label: "Empty groups", group: "Groups" },
  { id: "orphan_groups", label: "Orphan groups", group: "Groups" },
  { id: "escalation_paths", label: "Escalation paths", group: "Privileged" },
  { id: "shadow_admins", label: "Shadow admins", group: "ACL" },
  { id: "unknown_sid_bindings", label: "Unknown SID bindings", group: "ACL" },
  { id: "broken_acls", label: "Broken ACLs", group: "ACL" },
  { id: "sid_history_risks", label: "SID history risks", group: "ACL" },
  { id: "foreign_principals", label: "Foreign principals", group: "ACL" },
  { id: "inactive_computers", label: "Inactive computers", group: "Computers" },
  { id: "unsupported_os", label: "Unsupported OS", group: "Computers" },
  { id: "duplicate_spns", label: "Duplicate SPNs", group: "Computers" },
  { id: "kerberoastable", label: "Kerberoastable", group: "Kerberos" },
  { id: "asrep_roastable", label: "AS-REP roastable", group: "Kerberos" },
  { id: "unconstrained_delegation", label: "Unconstrained delegation", group: "Delegation" },
  { id: "rbcd_exposure", label: "RBCD exposure", group: "Delegation" },
];

export const SECURITY_DASHBOARD_PRIVILEGE_TILES = [
  { id: "priv_escalation_paths", label: "Escalation paths" },
  { id: "priv_dormant_privileged", label: "Dormant privileged" },
  { id: "priv_excessive_privileges", label: "Excessive privileges" },
  { id: "priv_nested_privileged", label: "Nested privileged" },
  { id: "priv_toxic_combinations", label: "Toxic combinations" },
  { id: "priv_shadow_admins", label: "Shadow admins" },
  { id: "priv_kerberoastable", label: "Kerberoastable" },
  { id: "priv_unconstrained_delegation", label: "Unconstrained delegation" },
  { id: "priv_rbcd", label: "RBCD" },
];

export const SECURITY_DASHBOARD_PANELS = [
  { id: "privilege_exposure", label: "Privilege exposure section" },
  { id: "comparison", label: "Assessment comparison (Resolved / New / Unchanged)" },
  { id: "severity_pie", label: "Risk severity distribution" },
  { id: "scan_status", label: "Scan status" },
  { id: "top_exposures", label: "Top exposures" },
  { id: "trends", label: "Recently improved / degraded" },
  { id: "domain_evidence", label: "Domain evidence" },
  { id: "assessment_compare_panel", label: "Assessment comparison picker" },
  { id: "top_findings", label: "Top risk findings table" },
  { id: "reports", label: "Assessment reports" },
];

export const ALL_SECURITY_DASHBOARD_TILE_IDS = new Set([
  ...SECURITY_DASHBOARD_METRIC_TILES.map((t) => t.id),
  ...SECURITY_DASHBOARD_PRIVILEGE_TILES.map((t) => t.id),
  ...SECURITY_DASHBOARD_PANELS.map((t) => t.id),
]);

export function defaultSecurityDashboardPrefs() {
  return {
    hideZeroMetrics: false,
    hiddenTiles: [],
  };
}

export function normalizeSecurityDashboardPrefs(raw = {}) {
  const defaults = defaultSecurityDashboardPrefs();
  const hidden = Array.isArray(raw.hiddenTiles)
    ? raw.hiddenTiles.map(String).filter((id) => ALL_SECURITY_DASHBOARD_TILE_IDS.has(id))
    : [];
  return {
    hideZeroMetrics: Boolean(raw.hideZeroMetrics ?? defaults.hideZeroMetrics),
    hiddenTiles: [...new Set(hidden)],
  };
}

export function isSecurityTileVisible(prefs, tileId, value) {
  const p = normalizeSecurityDashboardPrefs(prefs);
  if (p.hiddenTiles.includes(tileId)) return false;
  if (p.hideZeroMetrics && (value === 0 || value === "0")) return false;
  return true;
}
