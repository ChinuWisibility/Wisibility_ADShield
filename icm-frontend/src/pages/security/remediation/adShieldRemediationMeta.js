/**
 * Shared ADShield remediation metadata for Security Remediation UI.
 * Keep in sync with backend ADSHIELD_FEATURE_REMEDIATION_ACTION / remediable catalog.
 */

import { FEATURE_CATEGORIES, featureLabel } from "../securityFeatureMeta";
import { findingTypeLabel } from "../findingTypeMeta";

export const ADSHIELD_REMEDIABLE_FEATURES = new Set([
  "disabled_users",
  "inactive_users",
  "locked_accounts",
  "password_never_expires",
  "password_not_required",
  "reversible_encryption_enabled",
  "smartcard_not_required",
  "service_accounts",
  "shadow_admins",
  "sid_history_analysis",
  "foreign_security_principals",
  "unknown_sid_bindings",
  "broken_acls",
  "orphan_sids",
  "empty_groups",
  "groups_without_owners",
  "nested_groups",
  "circular_memberships",
  "unused_groups",
  "orphan_groups",
  "duplicate_groups",
  "toxic_privilege_combinations",
  "nested_privileged_access",
  "dormant_privileged_users",
  "excessive_privileges",
  "privilege_escalation_paths",
  "disabled_computers",
  "inactive_computers",
  "servers_in_wrong_ou",
  "duplicate_spns",
  "computers_without_owners",
  "kerberoastable_accounts",
  "asrep_roastable_users",
  "preauth_disabled",
  "spn_misconfigurations",
  "unconstrained_delegation",
  "constrained_delegation",
  "rbcd",
]);

/** Features whose default action needs extra admin input (owner DN, parent OU, member, ACE). */
export const REQUIRES_REVIEW_FEATURES = new Set([
  "groups_without_owners",
  "computers_without_owners",
  "servers_in_wrong_ou",
  "nested_groups",
  "circular_memberships",
  "toxic_privilege_combinations",
  "nested_privileged_access",
  "excessive_privileges",
  "privilege_escalation_paths",
  "shadow_admins",
  "orphan_sids",
  "unknown_sid_bindings",
  "broken_acls",
]);

/** Remediable without extra target fields — eligible for bulk "safe" remediate. */
export const SAFE_BULK_FEATURES = new Set(
  [...ADSHIELD_REMEDIABLE_FEATURES].filter((f) => !REQUIRES_REVIEW_FEATURES.has(f)),
);

export const ACTION_LABELS = {
  enable_account: "Enable this account in Active Directory",
  delete_user_account: "Delete this user account from Active Directory",
  disable_account: "Disable this account in Active Directory",
  unlock_account: "Unlock this account",
  clear_password_never_expires: "Clear PasswordNeverExpires",
  clear_password_not_required: "Clear PasswordNotRequired",
  clear_reversible_encryption: "Clear reversible encryption",
  require_smartcard: "Require smartcard logon",
  remove_service_principal_names: "Remove service principal names",
  remove_dacl_ace: "Remove dangerous ACE",
  clear_sid_history: "Clear SID history",
  delete_foreign_security_principal: "Delete foreign security principal",
  delete_group: "Delete this group",
  delete_computer: "Delete this computer account",
  remove_group_member: "Remove nested / privileged group membership",
  set_managed_by: "Set managedBy owner",
  move_object: "Move object to a correct OU",
  clear_dont_require_preauth: "Require Kerberos pre-authentication",
  clear_trusted_for_delegation: "Clear unconstrained delegation",
  clear_constrained_delegation: "Clear constrained delegation",
  clear_rbcd: "Clear resource-based constrained delegation",
};

/** Default action id per feature (mirrors Node ADSHIELD_FEATURE_REMEDIATION_ACTION). */
export const FEATURE_REMEDIATION_ACTION = {
  disabled_users: "enable_account",
  inactive_users: "disable_account",
  locked_accounts: "unlock_account",
  password_never_expires: "clear_password_never_expires",
  password_not_required: "clear_password_not_required",
  reversible_encryption_enabled: "clear_reversible_encryption",
  smartcard_not_required: "require_smartcard",
  service_accounts: "remove_service_principal_names",
  shadow_admins: "remove_dacl_ace",
  sid_history_analysis: "clear_sid_history",
  foreign_security_principals: "delete_foreign_security_principal",
  unknown_sid_bindings: "remove_dacl_ace",
  broken_acls: "remove_dacl_ace",
  orphan_sids: "remove_dacl_ace",
  empty_groups: "delete_group",
  groups_without_owners: "set_managed_by",
  nested_groups: "remove_group_member",
  circular_memberships: "remove_group_member",
  unused_groups: "delete_group",
  orphan_groups: "delete_group",
  duplicate_groups: "delete_group",
  toxic_privilege_combinations: "remove_group_member",
  nested_privileged_access: "remove_group_member",
  dormant_privileged_users: "disable_account",
  excessive_privileges: "remove_group_member",
  privilege_escalation_paths: "remove_group_member",
  disabled_computers: "enable_account",
  inactive_computers: "disable_account",
  servers_in_wrong_ou: "move_object",
  duplicate_spns: "remove_service_principal_names",
  computers_without_owners: "set_managed_by",
  kerberoastable_accounts: "remove_service_principal_names",
  asrep_roastable_users: "clear_dont_require_preauth",
  preauth_disabled: "clear_dont_require_preauth",
  spn_misconfigurations: "remove_service_principal_names",
  unconstrained_delegation: "clear_trusted_for_delegation",
  constrained_delegation: "clear_constrained_delegation",
  rbcd: "clear_rbcd",
};

export const CATEGORY_FILTERS = [
  { id: "all", label: "All" },
  { id: "account", label: "Users" },
  { id: "group", label: "Groups" },
  { id: "privileged", label: "Privileged" },
  { id: "computer", label: "Computers" },
  { id: "acl", label: "ACLs" },
  { id: "kerberos", label: "Kerberos" },
  { id: "delegation", label: "Delegation" },
];

export const SEVERITY_FILTERS = [
  { id: "all", label: "All" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

const SEVERITY_RANK = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  "not defined": 4,
  unknown: 5,
};

export function normalizeSeverity(value) {
  const s = String(value || "").trim().toLowerCase();
  if (["critical", "high", "medium", "low", "not defined"].includes(s)) return s;
  return "not defined";
}

export function maxSeverity(severities = []) {
  let best = "not defined";
  let bestRank = SEVERITY_RANK["not defined"];
  for (const raw of severities) {
    const s = normalizeSeverity(raw);
    const rank = SEVERITY_RANK[s] ?? 9;
    if (rank < bestRank) {
      best = s;
      bestRank = rank;
    }
  }
  return best;
}

export function categoryForFeature(featureId) {
  const id = String(featureId || "");
  for (const [cat, features] of Object.entries(FEATURE_CATEGORIES)) {
    if (features.includes(id)) return cat;
  }
  return "other";
}

export function isAdShieldRemediableFeature(featureId) {
  return ADSHIELD_REMEDIABLE_FEATURES.has(String(featureId || ""));
}

export function remediationAvailability(featureId, finding = null) {
  const feature = String(featureId || finding?.feature || "");
  if (!feature) return "not_remediable";
  if (!ADSHIELD_REMEDIABLE_FEATURES.has(feature)) return "not_remediable";
  if (REQUIRES_REVIEW_FEATURES.has(feature)) return "requires_review";
  const dn = String(finding?.dn || "").trim();
  if (finding && !dn) return "requires_review";
  return "remediable";
}

export function remediationAvailabilityLabel(status) {
  switch (status) {
    case "remediable":
      return "Available";
    case "requires_review":
      return "Requires review";
    case "not_remediable":
      return "Not remediable";
    case "failed":
      return "Failed";
    case "resolved":
      return "Already resolved";
    default:
      return "Unknown";
  }
}

export function recommendedActionLabel(featureId) {
  const action = FEATURE_REMEDIATION_ACTION[String(featureId || "")];
  if (!action) return "No automated remediation is defined for this finding.";
  return ACTION_LABELS[action] || action;
}

export function whatAdShieldWillChange(featureId) {
  return recommendedActionLabel(featureId);
}

export function humanFindingType(finding) {
  return findingTypeLabel(finding?.findingType || finding?.status || "");
}

export function featureDisplayName(featureId) {
  return featureLabel(featureId);
}

export function findingHasDn(finding) {
  return Boolean(String(finding?.dn || "").trim());
}

/**
 * Group findings into feature rows for the remediation list.
 * @param {object[]} findings
 * @returns {object[]}
 */
export function buildFeatureIssueRows(findings = []) {
  /** @type {Map<string, object>} */
  const byFeature = new Map();
  for (const f of findings) {
    const feature = String(f.feature || "").trim();
    if (!feature) continue;
    let row = byFeature.get(feature);
    if (!row) {
      row = {
        feature,
        title: featureDisplayName(feature),
        category: categoryForFeature(feature),
        findings: [],
        severities: [],
        recommendation: "",
        whyItMatters: "",
      };
      byFeature.set(feature, row);
    }
    row.findings.push(f);
    row.severities.push(normalizeSeverity(f.severity || f.riskLevel));
    if (!row.recommendation && f.recommendation) row.recommendation = String(f.recommendation);
    if (!row.whyItMatters && (f.recommendation || f.description)) {
      row.whyItMatters = String(f.recommendation || f.description);
    }
  }

  return [...byFeature.values()]
    .map((row) => {
      const availability = remediationAvailability(row.feature);
      const remediableCount = row.findings.filter(
        (f) =>
          remediationAvailability(row.feature, f) === "remediable" && findingHasDn(f),
      ).length;
      return {
        ...row,
        count: row.findings.length,
        severity: maxSeverity(row.severities),
        availability,
        availabilityLabel: remediationAvailabilityLabel(availability),
        remediableCount,
        actionLabel: recommendedActionLabel(row.feature),
      };
    })
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity] ?? 9;
      const sb = SEVERITY_RANK[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      return b.count - a.count;
    });
}
