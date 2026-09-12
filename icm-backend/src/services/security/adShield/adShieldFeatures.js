/**
 * ACL intelligence features delegated to ADShield when ADSHIELD_ENABLED=true.
 *
 * Phase 1 (fully delegated — skip Node SD detectors):
 *   broken_acls, unknown_sid_bindings, orphan_sids,
 *   sid_history_analysis, foreign_security_principals
 *
 * Phase 2 (hybrid token — NOT a full Node skip):
 *   shadow_admins_acl — ACL half only; Node graph half always runs via detectShadowAdmins.
 *
 * Keep in sync with .NET AclAnalysisService.SupportedFeatures.
 */
export const ADSHIELD_ACL_FEATURES = Object.freeze([
  "broken_acls",
  "unknown_sid_bindings",
  "orphan_sids",
  "sid_history_analysis",
  "foreign_security_principals",
  "shadow_admins_acl",
]);

/** Features that fully replace the Node runner when ADShield is on. */
export const ADSHIELD_FULLY_DELEGATED_FEATURES = Object.freeze([
  "broken_acls",
  "unknown_sid_bindings",
  "orphan_sids",
  "sid_history_analysis",
  "foreign_security_principals",
]);

export function isAdShieldAclFeature(featureId) {
  return ADSHIELD_ACL_FEATURES.includes(String(featureId || ""));
}

export function isAdShieldFullyDelegatedFeature(featureId) {
  return ADSHIELD_FULLY_DELEGATED_FEATURES.includes(String(featureId || ""));
}

/**
 * Whether an ADShield response finding.feature is acceptable.
 * shadow_admins_acl analysis emits IdentitySphere feature "shadow_admins".
 */
export function isAdShieldFindingFeature(featureId) {
  const f = String(featureId || "");
  return (
    f === "shadow_admins" ||
    f === "orphan_sids" ||
    f === "sid_history_analysis" ||
    f === "foreign_security_principals" ||
    isAdShieldAclFeature(f)
  );
}
