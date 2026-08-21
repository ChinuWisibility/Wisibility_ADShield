/** Scan Center sidebar categories (UI labels). */
export const SCAN_CENTER_CATEGORIES = [
  { id: "user_security", label: "User Account Security" },
  { id: "privileged_access", label: "Privileged Access" },
  { id: "group_security", label: "Group Intelligence" },
  { id: "kerberos_security", label: "Kerberos Security" },
  { id: "acl_intelligence", label: "SID & ACL Intelligence" },
  { id: "computer_security", label: "Computer Security" },
];

/**
 * Map registry feature metadata to Scan Center sidebar category id.
 * @param {{ category?: string, moduleId?: string }} feature
 */
export function resolveScanCenterCategoryId(feature) {
  if (feature.category === "kerberos_delegation") return "kerberos_security";
  if (SCAN_CENTER_CATEGORIES.some((c) => c.id === feature.category)) {
    return feature.category;
  }
  return "user_security";
}

/**
 * @param {object[]} features
 * @returns {Map<string, object[]>}
 */
export function groupFeaturesByCategory(features) {
  const map = new Map(SCAN_CENTER_CATEGORIES.map((c) => [c.id, []]));
  for (const feature of features || []) {
    const catId = resolveScanCenterCategoryId(feature);
    if (!map.has(catId)) map.set(catId, []);
    map.get(catId).push(feature);
  }
  return map;
}

/**
 * Derive last-run timestamp per feature from scan history.
 * @param {object[]} scans
 * @returns {Map<string, string>}
 */
export function buildFeatureLastRunMap(scans) {
  const out = new Map();
  for (const scan of scans || []) {
    const completed = scan.completedAt || scan.startedAt;
    if (!completed) continue;
    const requested =
      scan.scanConfig?.requestedFeatures ||
      scan.results?.flatMap((r) => r.features || []) ||
      [];
    const ids = Array.isArray(requested) ? requested : [];
    for (const fid of ids) {
      const key = String(fid);
      const prev = out.get(key);
      if (!prev || Date.parse(completed) > Date.parse(prev)) {
        out.set(key, completed);
      }
    }
  }
  return out;
}

export function formatFeatureLastRun(iso) {
  if (!iso) return "—";
  const d = Date.parse(iso);
  if (!Number.isFinite(d)) return "—";
  return new Date(d).toLocaleString();
}

export const RISK_CHIP_COLORS = {
  critical: "error",
  high: "warning",
  medium: "info",
  low: "default",
};

/**
 * Feature keys per Scan Center category (Findings Explorer filters).
 * Mirrors FEATURE_CATEGORIES but keyed by SCAN_CENTER_CATEGORIES ids.
 */
export const SCAN_CENTER_CATEGORY_FEATURES = {
  user_security: [
    "disabled_users",
    "inactive_users",
    "locked_accounts",
    "password_never_expires",
    "password_not_required",
    "reversible_encryption_enabled",
    "smartcard_not_required",
    "service_accounts",
  ],
  privileged_access: [
    "nested_privileged_access",
    "dormant_privileged_users",
    "excessive_privileges",
    "privilege_escalation_paths",
  ],
  group_security: [
    "empty_groups",
    "groups_without_owners",
    "nested_groups",
    "circular_memberships",
    "unused_groups",
    "orphan_groups",
    "duplicate_groups",
    "toxic_privilege_combinations",
  ],
  kerberos_security: [
    "kerberoastable_accounts",
    "asrep_roastable_users",
    "preauth_disabled",
    "spn_misconfigurations",
    "unconstrained_delegation",
    "constrained_delegation",
    "rbcd",
  ],
  acl_intelligence: [
    "orphan_sids",
    "shadow_admins",
    "sid_history_analysis",
    "foreign_security_principals",
    "unknown_sid_bindings",
    "broken_acls",
  ],
  computer_security: [
    "disabled_computers",
    "inactive_computers",
    "missing_os_information",
    "unsupported_os_versions",
    "servers_in_wrong_ou",
    "duplicate_spns",
    "computers_without_owners",
  ],
};

/** Feature keys available for the given category ids (empty categories → all). */
export function featureKeysForCategories(categoryIds = []) {
  const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];
  if (!ids.length) {
    return Object.values(SCAN_CENTER_CATEGORY_FEATURES).flat();
  }
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    for (const key of SCAN_CENTER_CATEGORY_FEATURES[id] || []) {
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
  }
  return out;
}

/** Resolve Scan Center category id that owns a feature key. */
export function categoryIdForFeatureKey(featureKey) {
  const key = String(featureKey || "");
  for (const [catId, keys] of Object.entries(SCAN_CENTER_CATEGORY_FEATURES)) {
    if (keys.includes(key)) return catId;
  }
  return null;
}
