/**
 * Features delegated to ADShield when ADSHIELD_ENABLED=true.
 *
 * Keep in sync with .NET:
 *   AclAnalysisService / AccountAnalysisService / PostureAnalysisService SupportedFeatures
 *   SecurityFeatureCatalog Implemented flags
 */

export const ADSHIELD_ACL_FEATURES = Object.freeze([
  "broken_acls",
  "unknown_sid_bindings",
  "orphan_sids",
  "sid_history_analysis",
  "foreign_security_principals",
  "shadow_admins_acl",
]);

/** Features that fully replace the Node ACL runner when ADShield is on. */
export const ADSHIELD_FULLY_DELEGATED_FEATURES = Object.freeze([
  "broken_acls",
  "unknown_sid_bindings",
  "orphan_sids",
  "sid_history_analysis",
  "foreign_security_principals",
]);

export const ADSHIELD_ACCOUNT_FEATURES = Object.freeze([
  "disabled_users",
  "inactive_users",
  "locked_accounts",
  "password_never_expires",
  "password_not_required",
  "reversible_encryption_enabled",
  "smartcard_not_required",
  "service_accounts",
]);

export const ADSHIELD_GROUP_FEATURES = Object.freeze([
  "empty_groups",
  "groups_without_owners",
  "nested_groups",
  "circular_memberships",
  "unused_groups",
  "orphan_groups",
  "duplicate_groups",
  "nested_privileged_access",
]);

export const ADSHIELD_PRIVILEGED_FEATURES = Object.freeze([
  "toxic_privilege_combinations",
  "dormant_privileged_users",
  "excessive_privileges",
  "privilege_escalation_paths",
]);

export const ADSHIELD_COMPUTER_FEATURES = Object.freeze([
  "disabled_computers",
  "inactive_computers",
  "missing_os_information",
  "unsupported_os_versions",
  "servers_in_wrong_ou",
  "duplicate_spns",
  "computers_without_owners",
]);

export const ADSHIELD_KERBEROS_FEATURES = Object.freeze([
  "kerberoastable_accounts",
  "asrep_roastable_users",
  "preauth_disabled",
  "spn_misconfigurations",
]);

export const ADSHIELD_DELEGATION_FEATURES = Object.freeze([
  "unconstrained_delegation",
  "constrained_delegation",
  "rbcd",
  "delegation_exposure",
]);

/** All non-account/non-ACL features served by POST /posture-analysis. */
export const ADSHIELD_POSTURE_FEATURES = Object.freeze([
  ...ADSHIELD_GROUP_FEATURES,
  ...ADSHIELD_PRIVILEGED_FEATURES,
  ...ADSHIELD_COMPUTER_FEATURES,
  ...ADSHIELD_KERBEROS_FEATURES,
  ...ADSHIELD_DELEGATION_FEATURES,
]);

/** Default remediation action per feature (typed ADShield action). */
export const ADSHIELD_FEATURE_REMEDIATION_ACTION = Object.freeze({
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
});

export function isAdShieldAclFeature(featureId) {
  return ADSHIELD_ACL_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldFullyDelegatedFeature(featureId) {
  return ADSHIELD_FULLY_DELEGATED_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldAccountFeature(featureId) {
  return ADSHIELD_ACCOUNT_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldPostureFeature(featureId) {
  return ADSHIELD_POSTURE_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldGroupFeature(featureId) {
  return ADSHIELD_GROUP_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldComputerFeature(featureId) {
  return ADSHIELD_COMPUTER_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldKerberosFeature(featureId) {
  return ADSHIELD_KERBEROS_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldDelegationFeature(featureId) {
  return ADSHIELD_DELEGATION_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldPrivilegedFeature(featureId) {
  return ADSHIELD_PRIVILEGED_FEATURES.includes(String(featureId || ""));
}

/**
 * Whether an ADShield response finding.feature is acceptable.
 * shadow_admins_acl analysis emits IdentitySphere feature "shadow_admins".
 */
export function isAdShieldFindingFeature(featureId) {
  const f = String(featureId || "");
  return (
    f === "shadow_admins" ||
    isAdShieldAccountFeature(f) ||
    isAdShieldPostureFeature(f) ||
    f === "orphan_sids" ||
    f === "sid_history_analysis" ||
    f === "foreign_security_principals" ||
    isAdShieldAclFeature(f)
  );
}

export function resolveAdShieldRemediationAction(featureId, finding = null) {
  const feature = String(featureId || finding?.feature || "").trim();
  const mapped = ADSHIELD_FEATURE_REMEDIATION_ACTION[feature];
  if (mapped) return mapped;

  if (finding?.evidence?.trusteeSid || finding?.attributes?.trusteeSid) {
    return "remove_dacl_ace";
  }
  return null;
}
