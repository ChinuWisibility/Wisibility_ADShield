/**
 * Finding signal tokens used by the Security Policy Engine.
 * Detection modules emit facts; policies match on these condition tokens.
 */

/** @typedef {string} FindingSignal */

/** Primary signal per feature (detector output). */
export const FEATURE_PRIMARY_SIGNAL = {
  disabled_users: "DISABLED_USER",
  inactive_users: "INACTIVE_USER",
  locked_accounts: "LOCKED_ACCOUNT",
  password_never_expires: "PASSWORD_NEVER_EXPIRES",
  password_not_required: "PASSWORD_NOT_REQUIRED",
  reversible_encryption_enabled: "REVERSIBLE_ENCRYPTION_ENABLED",
  smartcard_not_required: "SMARTCARD_NOT_REQUIRED",
  service_accounts: "SERVICE_ACCOUNT",
  disabled_computers: "DISABLED_COMPUTER",
  inactive_computers: "INACTIVE_COMPUTER",
  missing_os_information: "MISSING_OS_INFORMATION",
  unsupported_os_versions: "UNSUPPORTED_OS",
  servers_in_wrong_ou: "SERVER_IN_WRONG_OU",
  duplicate_spns: "DUPLICATE_SPN",
  computers_without_owners: "COMPUTER_WITHOUT_OWNER",
  kerberoastable_accounts: "KERBEROASTABLE_ACCOUNT",
  asrep_roastable_users: "ASREP_ROASTABLE_USER",
  preauth_disabled: "PREAUTH_DISABLED",
  spn_misconfigurations: "SPN_MISCONFIGURATION",
  unconstrained_delegation: "UNCONSTRAINED_DELEGATION",
  constrained_delegation: "CONSTRAINED_DELEGATION",
  rbcd: "RBCD_CONFIGURED",
  // delegation_exposure: "DELEGATION_EXPOSURE", // disabled — Delegation Exposure Summary
  empty_groups: "EMPTY_GROUP",
  groups_without_owners: "GROUP_WITHOUT_OWNER",
  nested_groups: "NESTED_GROUP",
  unused_groups: "UNUSED_GROUP",
  orphan_groups: "ORPHAN_GROUP",
  circular_memberships: "CIRCULAR_GROUP_MEMBERSHIP",
  duplicate_groups: "DUPLICATE_GROUP",
  nested_privileged_access: "NESTED_PRIVILEGED_ACCESS",
  dormant_privileged_users: "DORMANT_PRIVILEGED_USER",
  toxic_privilege_combinations: "TOXIC_PRIVILEGE_COMBINATION",
  excessive_privileges: "EXCESSIVE_PRIVILEGES",
  privilege_escalation_paths: "PRIVILEGE_ESCALATION_PATH",
  orphan_sids: "ORPHAN_SID",
  shadow_admins: "SHADOW_ADMIN",
  sid_history_analysis: "SID_HISTORY_RISK",
  foreign_security_principals: "FOREIGN_SECURITY_PRINCIPAL",
  unknown_sid_bindings: "UNKNOWN_SID_BINDING",
  broken_acls: "BROKEN_ACL",
};

const PRIVILEGED_FEATURES = new Set([
  "dormant_privileged_users",
  "nested_privileged_access",
  "toxic_privilege_combinations",
  "excessive_privileges",
  "privilege_escalation_paths",
  "shadow_admins",
]);

/** Composite signals used in policies (non-threshold). */
export const COMPOSITE_SIGNALS = ["PRIVILEGED_USER"];

/** All boolean signal tokens available for policy editor UI. */
export const ALL_POLICY_SIGNALS = [
  ...new Set([...Object.values(FEATURE_PRIMARY_SIGNAL), ...COMPOSITE_SIGNALS]),
].sort();

/** @deprecated use ALL_POLICY_SIGNALS — kept for imports */
export const ALL_POLICY_CONDITIONS = ALL_POLICY_SIGNALS;

/**
 * Base inactive signals for detectors (thresholds are policy-defined).
 * @param {number} _days
 * @param {{ computer?: boolean }} [opts]
 * @returns {string[]}
 */
export function inactiveThresholdSignals(_days, opts = {}) {
  return opts.computer ? ["INACTIVE_COMPUTER"] : ["INACTIVE_USER"];
}

/**
 * @param {string} feature
 * @returns {string|null}
 */
export function primarySignalForFeature(feature) {
  return FEATURE_PRIMARY_SIGNAL[feature] || null;
}

/**
 * Derive all condition signals satisfied by a discovery finding.
 * @param {object} finding
 * @returns {FindingSignal[]}
 */
export function deriveFindingSignals(finding) {
  const signals = new Set();
  const feature = String(finding?.feature || "").trim();
  const status = String(finding?.status || "").trim();
  const meta = finding?.evidence || finding?.metadata || {};
  const attrs = finding?.attributes || {};

  const primary = FEATURE_PRIMARY_SIGNAL[feature];
  if (primary) signals.add(primary);

  if (feature === "disabled_users" || status === "disabled") {
    if (finding.objectType === "computer") signals.add("DISABLED_COMPUTER");
    else signals.add("DISABLED_USER");
  }

  if (feature === "disabled_computers") signals.add("DISABLED_COMPUTER");

  const inactiveMatch = status.match(/inactive_(\d+)d/i);
  if (inactiveMatch || meta.inactiveDays != null) {
    if (finding.objectType === "computer") signals.add("INACTIVE_COMPUTER");
    else signals.add("INACTIVE_USER");
  }

  if (PRIVILEGED_FEATURES.has(feature) || meta.isPrivileged === true || attrs.isPrivileged === true) {
    signals.add("PRIVILEGED_USER");
  }

  if (feature === "dormant_privileged_users") {
    signals.add("PRIVILEGED_USER");
    signals.add("INACTIVE_USER");
  }

  if (feature === "password_never_expires" || status === "password_never_expires") {
    signals.add("PASSWORD_NEVER_EXPIRES");
  }

  if (feature === "kerberoastable_accounts") signals.add("KERBEROASTABLE_ACCOUNT");

  if (Array.isArray(finding?.findingSignals)) {
    for (const s of finding.findingSignals) {
      if (s) signals.add(String(s));
    }
  }

  if (finding.findingType) signals.add(String(finding.findingType));

  return [...signals];
}

/**
 * @param {object} finding
 * @returns {string}
 */
export function resolvePrimaryFindingType(finding) {
  if (finding.findingType) return String(finding.findingType);
  const signals = deriveFindingSignals(finding);
  return signals[0] || "UNKNOWN";
}
