/** Human labels + categories for posture/graph finding features. */

export const FEATURE_CATEGORIES = {
  group: [
    "empty_groups",
    "groups_without_owners",
    "nested_groups",
    "circular_memberships",
    "unused_groups",
    "orphan_groups",
    "duplicate_groups",
    "toxic_privilege_combinations",
  ],
  privileged: [
    "nested_privileged_access",
    "dormant_privileged_users",
    "excessive_privileges",
    "privilege_escalation_paths",
  ],
  acl: [
    "orphan_sids",
    "shadow_admins",
    "sid_history_analysis",
    "foreign_security_principals",
    "unknown_sid_bindings",
    "broken_acls",
  ],
  account: [
    "disabled_users",
    "inactive_users",
    "locked_accounts",
    "password_never_expires",
    "password_not_required",
    "reversible_encryption_enabled",
    "smartcard_not_required",
    "service_accounts",
  ],
  computer: [
    "disabled_computers",
    "inactive_computers",
    "missing_os_information",
    "unsupported_os_versions",
    "servers_in_wrong_ou",
    "duplicate_spns",
    "computers_without_owners",
  ],
  kerberos: [
    "kerberoastable_accounts",
    "asrep_roastable_users",
    "preauth_disabled",
    "spn_misconfigurations",
  ],
  delegation: [
    "unconstrained_delegation",
    "constrained_delegation",
    "rbcd",
    // "delegation_exposure", // disabled — Delegation Exposure Summary
  ],
};

export const FEATURE_LABELS = {
  empty_groups: "Empty groups",
  groups_without_owners: "Groups without owners",
  nested_groups: "Nested groups",
  circular_memberships: "Circular membership",
  unused_groups: "Unused groups",
  orphan_groups: "Orphan groups",
  duplicate_groups: "Duplicate groups",
  toxic_privilege_combinations: "Toxic privilege combinations",
  nested_privileged_access: "Nested privileged access",
  dormant_privileged_users: "Dormant privileged users",
  excessive_privileges: "Excessive privileges",
  privilege_escalation_paths: "Privilege escalation paths",
  orphan_sids: "Orphan SIDs",
  shadow_admins: "Shadow admins",
  sid_history_analysis: "SID history analysis",
  foreign_security_principals: "Foreign security principals",
  unknown_sid_bindings: "Unknown SID bindings",
  broken_acls: "Broken ACLs",
  disabled_users: "Disabled users",
  inactive_users: "Inactive users",
  locked_accounts: "Locked accounts",
  password_never_expires: "Password never expires",
  password_not_required: "Password not required",
  reversible_encryption_enabled: "Reversible encryption",
  smartcard_not_required: "Smartcard not required",
  service_accounts: "Service accounts",
  disabled_computers: "Disabled computers",
  inactive_computers: "Inactive computers",
  missing_os_information: "Missing OS information",
  unsupported_os_versions: "Unsupported OS versions",
  servers_in_wrong_ou: "Servers in workstation OU",
  duplicate_spns: "Duplicate SPNs",
  computers_without_owners: "Computers without owners",
  kerberoastable_accounts: "Kerberoastable accounts",
  asrep_roastable_users: "AS-REP roastable users",
  preauth_disabled: "Pre-authentication disabled",
  spn_misconfigurations: "SPN misconfigurations",
  unconstrained_delegation: "Unconstrained delegation",
  constrained_delegation: "Constrained delegation",
  rbcd: "Resource-based constrained delegation",
  // delegation_exposure: "Delegation exposure summary", // disabled
};

export function featureLabel(feature) {
  return FEATURE_LABELS[feature] || String(feature || "").replace(/_/g, " ");
}

export const GROUP_FEATURES = FEATURE_CATEGORIES.group;
export const PRIVILEGED_FEATURES = FEATURE_CATEGORIES.privileged;
export const ACL_FEATURES = FEATURE_CATEGORIES.acl;
export const COMPUTER_FEATURES = FEATURE_CATEGORIES.computer;
export const KERBEROS_FEATURES = FEATURE_CATEGORIES.kerberos;
export const DELEGATION_FEATURES = FEATURE_CATEGORIES.delegation;
