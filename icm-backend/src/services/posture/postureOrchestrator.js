import {
  saveScanResult,
  getScanResult,
  listScanResultsForApplication,
  deleteScanResult,
  queryScanResults,
} from "./postureScanResultsStore.js";
import { mergeFeatureSettingsForScan } from "./postureFeatureSettings.js";
import { fetchPostureDirectory } from "./postureDirectoryService.js";
import { validatePostureLdapConnection } from "./postureLdapValidator.js";
import {
  countFindingsByFeature,
  finalizeFeatureDiagnostics,
  logScanDiagnosticSummary,
} from "./postureFeatureDiagnostics.js";
import {
  toDiscoveryFinding,
  evaluateFindings,
} from "../security/securityPolicyEngine.js";
import { loadPoliciesForApplication } from "../security/securityPolicyService.js";

import {
  runUserAccountSecurityScan,
  USER_ACCOUNT_SECURITY_FEATURES,
} from "./userAccountSecurity.js";

import {
  runComputerSecurityScan,
  COMPUTER_SECURITY_FEATURES,
} from "./computerSecurity.js";

import {
  runKerberosSecurityScan,
  KERBEROS_SECURITY_FEATURES,
} from "./kerberosSecurity.js";

import {
  runDelegationSecurityScan,
  DELEGATION_SECURITY_FEATURES,
} from "./delegationSecurity.js";

import {
  runGroupLdapSecurityScan,
  GROUP_LDAP_SECURITY_FEATURES,
} from "./groupLdapSecurity.js";

import {
  runIdentityGraphSecurityScan,
  IDENTITY_GRAPH_SECURITY_FEATURES,
} from "../security/identityGraphSecurityScan.js";

/** @typedef {'user_account_security' | 'group_ldap_security' | 'identity_graph_security' | 'computer_security' | 'kerberos_security' | 'delegation_security'} PostureModuleId */

export const POSTURE_MODULES = {
  user_account_security: {
    id: "user_account_security",
    label: "User Account Security",
    features: USER_ACCOUNT_SECURITY_FEATURES,
    requiresAdLdap: true,
    run: runUserAccountSecurityScan,
  },
  computer_security: {
    id: "computer_security",
    label: "Computer Security",
    features: COMPUTER_SECURITY_FEATURES,
    requiresAdLdap: true,
    run: runComputerSecurityScan,
  },
  kerberos_security: {
    id: "kerberos_security",
    label: "Kerberos Security",
    features: KERBEROS_SECURITY_FEATURES,
    requiresAdLdap: true,
    run: runKerberosSecurityScan,
  },
  delegation_security: {
    id: "delegation_security",
    label: "Delegation Security",
    features: DELEGATION_SECURITY_FEATURES,
    requiresAdLdap: true,
    run: runDelegationSecurityScan,
  },
  group_ldap_security: {
    id: "group_ldap_security",
    label: "Group LDAP Security",
    features: GROUP_LDAP_SECURITY_FEATURES,
    requiresAdLdap: true,
    run: runGroupLdapSecurityScan,
  },
  identity_graph_security: {
    id: "identity_graph_security",
    label: "Identity Graph Security",
    features: IDENTITY_GRAPH_SECURITY_FEATURES,
    requiresAdLdap: false,
    run: runIdentityGraphSecurityScan,
  },
};

const MODULE_FEATURE_MAP = [
  { module: "user_account_security", features: USER_ACCOUNT_SECURITY_FEATURES },
  { module: "computer_security", features: COMPUTER_SECURITY_FEATURES },
  { module: "kerberos_security", features: KERBEROS_SECURITY_FEATURES },
  { module: "delegation_security", features: DELEGATION_SECURITY_FEATURES },
  { module: "group_ldap_security", features: GROUP_LDAP_SECURITY_FEATURES },
  { module: "identity_graph_security", features: IDENTITY_GRAPH_SECURITY_FEATURES },
];

const ALL_KNOWN_FEATURES = new Set(MODULE_FEATURE_MAP.flatMap((m) => m.features));

export function resolvePostureModules(requestedFeatures) {
  if (!Array.isArray(requestedFeatures) || !requestedFeatures.length) {
    return ["identity_graph_security"];
  }

  const modules = new Set();
  for (const { module, features } of MODULE_FEATURE_MAP) {
    if (
      requestedFeatures.includes(module) ||
      requestedFeatures.some((f) => features.includes(f))
    ) {
      modules.add(module);
    }
  }

  for (const f of requestedFeatures) {
    if (!ALL_KNOWN_FEATURES.has(f)) continue;
    for (const { module, features } of MODULE_FEATURE_MAP) {
      if (features.includes(f)) modules.add(module);
    }
  }

  return modules.size ? [...modules] : ["identity_graph_security"];
}

export async function runPostureScan(params) {
  const { applicationId, application, adConfig, features, options } = params;
  const modules = resolvePostureModules(features);
  const moduleResults = [];
  const featureSettings = mergeFeatureSettingsForScan(application, options);
  let scanOptions = { ...options, featureSettings };

  const ldapModules = modules.filter((id) => POSTURE_MODULES[id]?.requiresAdLdap);
  if (ldapModules.length && adConfig) {
    await validatePostureLdapConnection(adConfig);
  }

  if (ldapModules.length > 1 && adConfig) {
    scanOptions = {
      ...scanOptions,
      postureDirectory: await fetchPostureDirectory(adConfig, options),
    };
  }

  for (const moduleId of modules) {
    const mod = POSTURE_MODULES[moduleId];
    if (!mod?.run) continue;

    const featureFilter = Array.isArray(features)
      ? features.filter((f) => mod.features.includes(f))
      : undefined;

    if (mod.requiresAdLdap) {
      const result = await mod.run({
        applicationId,
        adConfig,
        application,
        features: featureFilter?.length ? featureFilter : mod.features,
        options: scanOptions,
      });
      moduleResults.push(result);
    } else {
      const result = await mod.run({
        application,
        features: featureFilter?.length ? featureFilter : mod.features,
        options: scanOptions,
      });
      moduleResults.push(result);
    }
  }

  const scanId = moduleResults[0]?.scanId || moduleResults.map((r) => r.scanId).find(Boolean);

  const discoveryFindings = moduleResults
    .flatMap((r) => r.findings || [])
    .map((f) => toDiscoveryFinding(f));

  const rawDiagnostics = moduleResults.flatMap((r) => r.featureDiagnostics || []);
  const persistedByFeature = countFindingsByFeature(discoveryFindings);
  const diagnostics = finalizeFeatureDiagnostics(rawDiagnostics, persistedByFeature);
  logScanDiagnosticSummary(diagnostics);

  const policies = await loadPoliciesForApplication(application);
  const evaluatedFindings = evaluateFindings(discoveryFindings, policies);

  const payload = {
    scanId,
    tenantId: application?.tenantId ? String(application.tenantId) : undefined,
    applicationId: String(applicationId),
    assessmentId: options?.assessmentId ? String(options.assessmentId) : null,
    assessmentVersionId: options?.assessmentVersionId
      ? String(options.assessmentVersionId)
      : null,
    status: "completed",
    startedAt: moduleResults[0]?.startedAt,
    completedAt: new Date().toISOString(),
    modules,
    results: moduleResults.map((r) => ({
      ...r,
      findings: (r.findings || []).map((f) => toDiscoveryFinding(f)),
    })),
    findings: discoveryFindings,
    policySnapshot: {
      evaluatedAt: new Date().toISOString(),
      policyCount: policies.length,
      severityCounts: evaluatedFindings.reduce(
        (acc, f) => {
          const s = String(f.severity || f.riskLevel || "medium").toLowerCase();
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        },
        { critical: 0, high: 0, medium: 0, low: 0 },
      ),
    },
    scanConfig: {
      scanSource: options?.scanSource || "manual",
      requestedFeatures: features,
      customFeatures: options?.customFeatures || [],
      customFeaturesExecuted: [],
      featureSettings,
      assessmentId: options?.assessmentId ? String(options.assessmentId) : null,
      assessmentVersionId: options?.assessmentVersionId
        ? String(options.assessmentVersionId)
        : null,
    },
    summary: {
      totalFindings: discoveryFindings.length,
      modules: moduleResults.map((r) => ({
        module: r.module,
        userCount: r.userCount,
        computerCount: r.computerCount,
        counts: r.counts,
        materializeStats: r.materializeStats,
      })),
      byFeature: persistedByFeature,
    },
    diagnostics,
  };

  await saveScanResult(payload);
  return payload;
}

export {
  getScanResult,
  listScanResultsForApplication,
  deleteScanResult,
  queryScanResults,
  USER_ACCOUNT_SECURITY_FEATURES,
  IDENTITY_GRAPH_SECURITY_FEATURES,
  COMPUTER_SECURITY_FEATURES,
  KERBEROS_SECURITY_FEATURES,
  DELEGATION_SECURITY_FEATURES,
  GROUP_LDAP_SECURITY_FEATURES,
};
