import { randomUUID } from "crypto";
import { classifyAccountStatusRaw } from "../applicationUserStatusCountsService.js";
import {
  fetchAdUserLdapEntries,
  mapAdEntryToUserDoc,
  normalizeAdConfig,
} from "../adLdapService.js";
import { normalizeUser } from "../ldapNormalizer.js";
import { getAttrFirst, getAttrValues } from "../../utils/ldapEntryAttributes.js";
import {
  buildUserRiskFinding,
  isAccountLockedByLockoutTime,
  isDisabled,
  isLocked,
  isOlderThanDays,
  passwordNeverExpires,
  passwordNotRequired,
  reversibleEncryptionEnabled,
  smartcardNotRequired,
} from "./utils/adSecurityHelpers.js";
import {
  DEFAULT_INACTIVE_USERS_DAYS,
  resolveInactiveUsersDays,
} from "./postureFeatureSettings.js";
import { inactiveThresholdSignals } from "../../constants/findingSignals.js";
import { USER_ACCOUNT_SECURITY_FEATURES } from "./postureFeatureIds.js";
import { runLdapFeatureScanLoop } from "./ldapFeatureScanRunner.js";

export { USER_ACCOUNT_SECURITY_FEATURES };

const DEFAULT_INACTIVE_DAYS = DEFAULT_INACTIVE_USERS_DAYS;

/**
 * Build a single in-memory posture user from a normalized LDAP entry.
 * @param {import('ldapts').Entry|object} entry
 */
export function toPostureUserFromEntry(entry) {
  const n = normalizeUser(entry);
  const mapped = mapAdEntryToUserDoc(entry);
  const spn =
    n.servicePrincipalName?.length > 0
      ? n.servicePrincipalName
      : getAttrValues(entry, "servicePrincipalName");
  const lockoutTime =
    n.lockoutTime || getAttrFirst(entry, "lockoutTime") || mapped.rawData?.lockoutTime || "";

  return {
    userId: n.userId,
    displayName: n.displayName,
    email: n.email,
    distinguishedName: n.distinguishedName,
    dn: n.distinguishedName,
    userAccountControl: n.userAccountControl,
    lastLogonTimestamp: n.lastLogonTimestamp,
    lockoutTime,
    servicePrincipalNames: spn,
    status: mapped.status,
    rawData: mapped.rawData,
  };
}

/**
 * Fetch posture users using an explicit feature LDAP filter (not app userSearchFilter).
 * @param {object} adConfig normalized AD config
 * @param {{ ldapFilter: string, searchBase?: string, maxUsers?: number }} options
 */
export async function fetchNormalizedPostureUsers(adConfig, options = {}) {
  const cfg = normalizeAdConfig(adConfig);
  const filter = options.ldapFilter;
  if (filter) {
    cfg.userSearchFilter = filter;
    cfg.userSearchFilters = [filter];
  }
  const searchBase = options.searchBase?.trim() || options.baseDn?.trim();
  const entries = await fetchAdUserLdapEntries(cfg, {
    maxUsers: options.maxUsers,
    baseDn: searchBase || undefined,
    ldapFilter: filter,
    searchScope: options.searchScope,
  });
  return entries.map((entry) => toPostureUserFromEntry(entry));
}

/**
 * Analyze one feature against a user cohort (discovery findings only).
 * @param {object[]} users
 * @param {string} scanId
 * @param {string} featureId
 * @param {{ inactiveDays?: number }} [analysisOptions]
 */
export function analyzeUserAccountFeature(users, scanId, featureId, analysisOptions = {}) {
  return analyzeUserAccountSecurity(users, scanId, [featureId], analysisOptions);
}

/**
 * @param {object[]} users
 * @param {string} scanId
 * @param {string[]} [selectedFeatures]
 * @param {{ inactiveDays?: number }} [analysisOptions]
 */
export function analyzeUserAccountSecurity(
  users,
  scanId,
  selectedFeatures,
  analysisOptions = {},
) {
  const features = normalizeSelectedFeatures(selectedFeatures);
  const findings = [];
  const counts = Object.fromEntries(features.map((f) => [f, 0]));
  const inactiveDays = normalizeInactiveDays(analysisOptions.inactiveDays);

  for (const user of users) {
    const uac = user.userAccountControl;
    const accountStatus = classifyAccountStatusRaw(uac);

    if (features.includes("disabled_users")) {
      if (isDisabled(uac) || accountStatus === "inactive") {
        counts.disabled_users += 1;
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "disabled_users",
            user,
            status: "disabled",
            findingSignals: ["DISABLED_USER"],
          }),
        );
      }
    }

    if (features.includes("inactive_users")) {
      const activeAccount = !isDisabled(uac) && accountStatus === "active";
      if (
        activeAccount &&
        isOlderThanDays(user.lastLogonTimestamp, inactiveDays)
      ) {
        counts.inactive_users += 1;
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "inactive_users",
            user,
            status: `inactive_${inactiveDays}d`,
            metadata: { inactiveDays },
            findingSignals: [
              "INACTIVE_USER",
              ...inactiveThresholdSignals(inactiveDays),
            ],
          }),
        );
      }
    }

    if (features.includes("locked_accounts")) {
      if (isAccountLockedByLockoutTime(user.lockoutTime) || isLocked(uac)) {
        counts.locked_accounts += 1;
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "locked_accounts",
            user,
            status: "locked",
            findingSignals: ["LOCKED_ACCOUNT"],
          }),
        );
      }
    }

    if (features.includes("password_never_expires") && passwordNeverExpires(uac)) {
      counts.password_never_expires += 1;
      findings.push(
        buildUserRiskFinding({
          scanId,
          feature: "password_never_expires",
          user,
          status: "password_never_expires",
          findingSignals: ["PASSWORD_NEVER_EXPIRES"],
        }),
      );
    }

    if (features.includes("password_not_required") && passwordNotRequired(uac)) {
      counts.password_not_required += 1;
      findings.push(
        buildUserRiskFinding({
          scanId,
          feature: "password_not_required",
          user,
          status: "password_not_required",
          findingSignals: ["PASSWORD_NOT_REQUIRED"],
        }),
      );
    }

    if (
      features.includes("reversible_encryption_enabled") &&
      reversibleEncryptionEnabled(uac)
    ) {
      counts.reversible_encryption_enabled += 1;
      findings.push(
        buildUserRiskFinding({
          scanId,
          feature: "reversible_encryption_enabled",
          user,
          status: "reversible_encryption",
          findingSignals: ["REVERSIBLE_ENCRYPTION_ENABLED"],
        }),
      );
    }

    if (features.includes("smartcard_not_required") && smartcardNotRequired(uac)) {
      counts.smartcard_not_required += 1;
      findings.push(
        buildUserRiskFinding({
          scanId,
          feature: "smartcard_not_required",
          user,
          status: "smartcard_not_required",
          findingSignals: ["SMARTCARD_NOT_REQUIRED"],
        }),
      );
    }

    if (features.includes("service_accounts")) {
      const spns = user.servicePrincipalNames || [];
      if (Array.isArray(spns) && spns.length > 0) {
        counts.service_accounts += 1;
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "service_accounts",
            user,
            status: "has_spn",
            metadata: { spnCount: spns.length },
            findingSignals: ["SERVICE_ACCOUNT"],
          }),
        );
      }
    }
  }

  return { findings, counts, features };
}

function normalizeInactiveDays(value) {
  const n = parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_INACTIVE_DAYS;
  return Math.min(3650, Math.max(1, n));
}

function normalizeSelectedFeatures(selected) {
  const list = Array.isArray(selected) ? selected : USER_ACCOUNT_SECURITY_FEATURES;
  const allowed = new Set(USER_ACCOUNT_SECURITY_FEATURES);
  const out = list.map((f) => String(f).trim()).filter((f) => allowed.has(f));
  return out.length ? out : [...USER_ACCOUNT_SECURITY_FEATURES];
}

/**
 * Run user account security posture — each feature uses its own LDAP filter.
 */
export async function runUserAccountSecurityScan({
  applicationId,
  adConfig,
  features,
  options = {},
  application = null,
}) {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();
  const cfg = normalizeAdConfig(adConfig);
  const inactiveDays = resolveInactiveUsersDays(application, options);
  const featureList = normalizeSelectedFeatures(features);
  const queryOverrides = options.queryOverrides || {};

  // When ADShield is enabled, account features run in .NET (live AD), not Node LDAP detectors.
  const { isAdShieldEnabled } = await import("../security/adShield/adShieldClient.js");
  if (isAdShieldEnabled()) {
    const { runAdShieldAccountFeatures } = await import(
      "../security/adShield/adShieldAccountAdapter.js"
    );
    const adShieldResult = await runAdShieldAccountFeatures({
      adConfig: cfg,
      features: featureList,
      scanId,
      queryOverrides,
      inactiveDays,
      maxUsers: options.maxUsers ?? cfg.maxUsers,
    });

    return {
      scanId,
      module: "user_account_security",
      applicationId: String(applicationId),
      startedAt,
      completedAt: new Date().toISOString(),
      userCount: adShieldResult.diagnostics?.objectsScanned || 0,
      features: featureList,
      counts: adShieldResult.counts,
      findings: adShieldResult.findings,
      featureDiagnostics: adShieldResult.featureDiagnostics,
      featureSettings: {
        inactive_users: { inactiveDays },
      },
      summary: {
        totalFindings: adShieldResult.findings.length,
        byFeature: adShieldResult.counts,
      },
      source: "adshield",
      errors: adShieldResult.errors || [],
    };
  }

  const result = await runLdapFeatureScanLoop({
    moduleId: "user_account_security",
    featureList,
    cfg,
    queryOverrides,
    fetchOptions: {
      maxUsers: options.maxUsers ?? cfg.maxUsers,
    },
    analyzeFeature: (featureId, objects) => {
      const analysis = analyzeUserAccountFeature(objects.user || [], scanId, featureId, {
        inactiveDays,
      });
      return {
        findings: analysis.findings,
        count: analysis.counts[featureId] || analysis.findings.length,
      };
    },
  });

  return {
    scanId,
    module: "user_account_security",
    applicationId: String(applicationId),
    startedAt,
    completedAt: new Date().toISOString(),
    userCount: result.objectTotals.user || 0,
    features: featureList,
    counts: result.counts,
    findings: result.findings,
    featureDiagnostics: result.featureDiagnostics,
    featureSettings: {
      inactive_users: { inactiveDays },
    },
    summary: {
      totalFindings: result.findings.length,
      byFeature: result.counts,
    },
  };
}
