/** User-account posture feature keys (no registry imports — safe for circular-dep break). */
export const GROUP_LDAP_SECURITY_FEATURES = [
  "empty_groups",
  "groups_without_owners",
  "unused_groups",
  "orphan_groups",
  "duplicate_groups",
  "nested_groups",
  "circular_memberships",
  "nested_privileged_access",
];

export const USER_ACCOUNT_SECURITY_FEATURES = [
  "disabled_users",
  "inactive_users",
  "locked_accounts",
  "password_never_expires",
  "password_not_required",
  "reversible_encryption_enabled",
  "smartcard_not_required",
  "service_accounts",
];

export const COMPUTER_SECURITY_FEATURES = [
  "disabled_computers",
  "inactive_computers",
  "missing_os_information",
  "unsupported_os_versions",
  "servers_in_wrong_ou",
  "duplicate_spns",
  "computers_without_owners",
];

export const KERBEROS_SECURITY_FEATURES = [
  "kerberoastable_accounts",
  "asrep_roastable_users",
  "preauth_disabled",
  "spn_misconfigurations",
];

export const DELEGATION_SECURITY_FEATURES = [
  "unconstrained_delegation",
  "constrained_delegation",
  "rbcd",
];

/** Graph / HYBRID privileged detectors (Identity Graph). Nested privileged is LDAP. */
export const PRIVILEGED_ACCESS_FEATURES = [
  "dormant_privileged_users",
  "excessive_privileges",
  "privilege_escalation_paths",
];

export const GROUP_INTELLIGENCE_FEATURES = [
  "toxic_privilege_combinations",
];

export const ACL_INTELLIGENCE_FEATURES = [
  "orphan_sids",
  "shadow_admins",
  "sid_history_analysis",
  "foreign_security_principals",
  "unknown_sid_bindings",
  "broken_acls",
];
