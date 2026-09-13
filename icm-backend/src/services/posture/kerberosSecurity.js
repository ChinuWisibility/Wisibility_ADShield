import { randomUUID } from "crypto";
import { normalizeAdConfig } from "../adLdapService.js";
import {
  buildUserRiskFinding,
  dontRequirePreauth,
  isDisabled,
  isMalformedSpn,
  normalizeSpnList,
} from "./utils/adSecurityHelpers.js";
import { buildGlobalSpnIndex } from "./postureDirectoryService.js";
import { runLdapFeatureScanLoop } from "./ldapFeatureScanRunner.js";
import { KERBEROS_SECURITY_FEATURES } from "./postureFeatureIds.js";

export { KERBEROS_SECURITY_FEATURES };
function normalizeFeatures(selected) {
  const list = Array.isArray(selected) ? selected : KERBEROS_SECURITY_FEATURES;
  const allowed = new Set(KERBEROS_SECURITY_FEATURES);
  const out = list.map((f) => String(f).trim()).filter((f) => allowed.has(f));
  return out.length ? out : [...KERBEROS_SECURITY_FEATURES];
}

export function detectKerberoastableAccounts(users, scanId) {
  const findings = [];
  for (const user of users) {
    const spns = normalizeSpnList(user.servicePrincipalNames);
    if (!spns.length) continue;
    if (isDisabled(user.userAccountControl)) continue;
    findings.push(
      buildUserRiskFinding({
        scanId,
        feature: "kerberoastable_accounts",
        user,
        status: "kerberoastable_spn",
        metadata: { servicePrincipalNames: spns },
        findingSignals: ["KERBEROASTABLE_ACCOUNT"],
      }),
    );
  }
  return findings;
}

export function detectAsRepRoastableUsers(users, scanId) {
  const findings = [];
  for (const user of users) {
    if (!dontRequirePreauth(user.userAccountControl)) continue;
    if (isDisabled(user.userAccountControl)) continue;
    findings.push(
      buildUserRiskFinding({
        scanId,
        feature: "asrep_roastable_users",
        user,
        status: "dont_require_preauth",
        metadata: { userAccountControl: user.userAccountControl },
        findingSignals: ["ASREP_ROASTABLE_USER"],
      }),
    );
  }
  return findings;
}

/** User-only per LDAP Query Framework (computers not fetched for this feature). */
export function detectPreAuthenticationDisabled(users, _computers, scanId) {
  const findings = [];
  for (const user of users || []) {
    if (!dontRequirePreauth(user.userAccountControl)) continue;
    findings.push(
      buildUserRiskFinding({
        scanId,
        feature: "preauth_disabled",
        user,
        status: "preauth_disabled",
        metadata: { objectClass: "user" },
        findingSignals: ["PREAUTH_DISABLED"],
      }),
    );
  }
  return findings;
}

/** User SPN analysis (computer duplicate SPNs handled by computer_security module). */
export function detectSpnMisconfigurations(users, computers, scanId) {
  const findings = [];
  const spnIndex = buildGlobalSpnIndex(users, computers || []);

  for (const user of users || []) {
    const spns = normalizeSpnList(user.servicePrincipalNames);
    for (const spn of spns) {
      if (isMalformedSpn(spn)) {
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "spn_misconfigurations",
            user,
            status: "malformed_spn",
            metadata: { spn },
            findingSignals: ["SPN_MISCONFIGURATION"],
          }),
        );
      }
      const holders = spnIndex.get(String(spn).toLowerCase()) || [];
      if (holders.length > 1) {
        findings.push(
          buildUserRiskFinding({
            scanId,
            feature: "spn_misconfigurations",
            user,
            status: "duplicate_spn",
            metadata: { spn, duplicateCount: holders.length, holders },
            findingSignals: ["SPN_MISCONFIGURATION", "DUPLICATE_SPN"],
          }),
        );
      }
    }
  }

  return findings;
}

export function analyzeKerberosFeature(featureId, objects, scanId) {
  const users = objects.user || [];
  const computers = objects.computer || [];
  const runners = {
    kerberoastable_accounts: () => detectKerberoastableAccounts(users, scanId),
    asrep_roastable_users: () => detectAsRepRoastableUsers(users, scanId),
    preauth_disabled: () => detectPreAuthenticationDisabled(users, computers, scanId),
    spn_misconfigurations: () => detectSpnMisconfigurations(users, computers, scanId),
  };
  const findings = runners[featureId]?.() || [];
  return { findings, count: findings.length };
}

export function analyzeKerberosSecurity(directory, scanId, selectedFeatures) {
  const features = normalizeFeatures(selectedFeatures);
  const users = directory.users || directory.user || [];
  const computers = directory.computers || directory.computer || [];
  const counts = Object.fromEntries(features.map((f) => [f, 0]));
  const findings = [];

  for (const feature of features) {
    const batch = analyzeKerberosFeature(
      feature,
      { user: users, computer: computers },
      scanId,
    );
    counts[feature] = batch.count;
    findings.push(...batch.findings);
  }

  return { findings, counts, features };
}

export async function runKerberosSecurityScan({
  applicationId,
  adConfig,
  features,
  options = {},
}) {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();
  const cfg = normalizeAdConfig(adConfig);
  const featureList = normalizeFeatures(features);
  const queryOverrides = options.queryOverrides || {};

  const { isAdShieldEnabled } = await import("../security/adShield/adShieldClient.js");
  if (isAdShieldEnabled()) {
    const { runAdShieldPostureFeatures } = await import(
      "../security/adShield/adShieldPostureAdapter.js"
    );
    const adShieldResult = await runAdShieldPostureFeatures({
      adConfig: cfg,
      features: featureList,
      scanId,
      queryOverrides,
      maxObjects: options.maxUsers ?? cfg.maxUsers,
    });
    return {
      scanId,
      module: "kerberos_security",
      applicationId: String(applicationId),
      startedAt,
      completedAt: new Date().toISOString(),
      userCount: adShieldResult.diagnostics?.usersScanned || 0,
      computerCount: adShieldResult.diagnostics?.computersScanned || 0,
      features: featureList,
      counts: adShieldResult.counts,
      findings: adShieldResult.findings,
      featureDiagnostics: adShieldResult.featureDiagnostics,
      summary: {
        totalFindings: adShieldResult.findings.length,
        byFeature: adShieldResult.counts,
      },
      source: "adshield",
      errors: adShieldResult.errors || [],
    };
  }

  const result = await runLdapFeatureScanLoop({
    moduleId: "kerberos_security",
    featureList,
    cfg,
    queryOverrides,
    fetchOptions: {
      maxUsers: options.maxUsers ?? cfg.maxUsers,
      maxComputers: options.maxComputers,
    },
    analyzeFeature: (featureId, objects) =>
      analyzeKerberosFeature(featureId, objects, scanId),
  });

  return {
    scanId,
    module: "kerberos_security",
    applicationId: String(applicationId),
    startedAt,
    completedAt: new Date().toISOString(),
    userCount: result.objectTotals.user || 0,
    computerCount: result.objectTotals.computer || 0,
    features: featureList,
    counts: result.counts,
    findings: result.findings,
    featureDiagnostics: result.featureDiagnostics,
    summary: {
      totalFindings: result.findings.length,
      byFeature: result.counts,
    },
  };
}
