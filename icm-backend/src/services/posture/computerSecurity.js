import { randomUUID } from "crypto";
import { normalizeAdConfig } from "../adLdapService.js";
import {
  buildComputerRiskFinding,
  buildPostureRiskFinding,
  isDisabled,
  isInactiveComputer,
  isUnsupportedComputerOperatingSystem,
  normalizeSpnList,
} from "./utils/adSecurityHelpers.js";
import {
  inactiveThresholdSignals,
} from "../../constants/findingSignals.js";
import {
  resolveInactiveComputersDays,
  resolveUnsupportedOsTokens,
  resolveWorkstationOuPatterns,
} from "./postureFeatureSettings.js";
import {
  buildGlobalSpnIndex,
  fetchNormalizedPostureComputers,
} from "./postureDirectoryService.js";
import {
  resolveFeatureQuery,
} from "./postureFeatureLdap.js";
import {
  createFeatureDiagnostic,
  logFeatureDiagnostic,
} from "./postureFeatureDiagnostics.js";
import { COMPUTER_SECURITY_FEATURES } from "./postureFeatureIds.js";

export { COMPUTER_SECURITY_FEATURES };

function normalizeFeatures(selected) {
  const list = Array.isArray(selected) ? selected : COMPUTER_SECURITY_FEATURES;
  const allowed = new Set(COMPUTER_SECURITY_FEATURES);
  const out = list.map((f) => String(f).trim()).filter((f) => allowed.has(f));
  return out.length ? out : [...COMPUTER_SECURITY_FEATURES];
}

function isServerOs(operatingSystem) {
  return /server/i.test(String(operatingSystem || ""));
}

function isWorkstationRelatedSearchBase(searchBase) {
  const base = String(searchBase || "").trim().toLowerCase();
  if (!base) return false;
  return /(?:^|,)ou=(?:workstations|clients|desktops|laptops|desktop|computers)(?:,|$)/.test(base)
    || /workstation|desktop|laptop|client/i.test(base);
}

/**
 * test.ps1 parity: DN suffix match on full OU paths, plus single RDN tokens
 * (e.g. ou=workstations) anywhere in the DN path for nested AD layouts.
 * @param {string} dn
 * @param {string} pattern
 */
export function dnMatchesWorkstationOuPattern(dn, pattern) {
  const normalizedDn = String(dn || "").trim().toLowerCase();
  const p = String(pattern || "").trim().toLowerCase();
  if (!normalizedDn || !p) return false;
  if (normalizedDn === p || normalizedDn.endsWith(`,${p}`)) return true;
  if (!p.includes(",") && p.startsWith("ou=")) {
    return normalizedDn.includes(`,${p},`) || normalizedDn.endsWith(`,${p}`);
  }
  return false;
}

/**
 * @param {string} dn
 * @param {string[]} patterns
 * @param {string} [searchBase]
 */
export function dnMatchesWorkstationOu(dn, patterns, searchBase) {
  const normalizedDn = String(dn || "").trim().toLowerCase();
  if (!normalizedDn) return false;

  const lowerBase = String(searchBase || "").trim().toLowerCase();
  if (
    lowerBase
    && isWorkstationRelatedSearchBase(lowerBase)
    && (normalizedDn === lowerBase || normalizedDn.endsWith(`,${lowerBase}`))
  ) {
    return true;
  }

  for (const pattern of patterns || []) {
    if (dnMatchesWorkstationOuPattern(normalizedDn, pattern)) return true;
  }
  return false;
}

export function matchingWorkstationOuPatterns(dn, patterns, searchBase) {
  const matches = (patterns || []).filter((pattern) =>
    dnMatchesWorkstationOuPattern(dn, pattern),
  );
  const lowerBase = String(searchBase || "").trim().toLowerCase();
  const normalizedDn = String(dn || "").trim().toLowerCase();
  if (
    !matches.length
    && lowerBase
    && isWorkstationRelatedSearchBase(lowerBase)
    && (normalizedDn === lowerBase || normalizedDn.endsWith(`,${lowerBase}`))
  ) {
    matches.push(searchBase);
  }
  return matches;
}

export function detectDisabledComputers(computers, scanId) {
  const findings = [];
  for (const computer of computers) {
    if (!isDisabled(computer.userAccountControl)) continue;
    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "disabled_computers",
        computer,
        status: "disabled",
        findingSignals: ["DISABLED_COMPUTER"],
      }),
    );
  }
  return findings;
}

export function detectInactiveComputers(computers, scanId, inactiveDays) {
  const findings = [];
  for (const computer of computers) {
    if (
      !isInactiveComputer(
        computer.lastLogonTimestamp,
        inactiveDays,
        computer.userAccountControl,
      )
    ) {
      continue;
    }
    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "inactive_computers",
        computer,
        status: `inactive_${inactiveDays}d`,
        metadata: { inactiveDays, lastLogonTimestamp: computer.lastLogonTimestamp },
        findingSignals: [
          "INACTIVE_COMPUTER",
          ...inactiveThresholdSignals(inactiveDays, { computer: true }),
        ],
      }),
    );
  }
  return findings;
}

export function detectMissingOSInformation(computers, scanId) {
  const findings = [];
  for (const computer of computers) {
    const os = String(computer.operatingSystem || "").trim();
    const osVersion = String(computer.operatingSystemVersion || "").trim();
    if (os && osVersion) continue;
    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "missing_os_information",
        computer,
        status: "missing_operating_system",
        findingSignals: ["MISSING_OS_INFORMATION"],
      }),
    );
  }
  return findings;
}

export function detectUnsupportedOperatingSystems(computers, scanId, osTokens) {
  const findings = [];
  for (const computer of computers) {
    const operatingSystem = String(computer.operatingSystem || "").trim();
    if (!operatingSystem) continue;

    const regexMatch = isUnsupportedComputerOperatingSystem(operatingSystem);
    const tokenMatch = osTokens.find((token) =>
      operatingSystem.toLowerCase().includes(token),
    );
    const hit = regexMatch ? operatingSystem : tokenMatch;
    if (!hit) continue;

    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "unsupported_os_versions",
        computer,
        status: "unsupported_os",
        metadata: {
          matchedToken: typeof hit === "string" && hit !== operatingSystem ? hit : operatingSystem,
          operatingSystem,
          matchedBy: regexMatch ? "regex" : "token",
        },
        findingSignals: ["UNSUPPORTED_OS"],
      }),
    );
  }
  return findings;
}

export function detectServersInWorkstationOu(computers, scanId, ouPatterns, searchBase) {
  const findings = [];
  for (const computer of computers) {
    if (!isServerOs(computer.operatingSystem)) continue;
    const dn = computer.distinguishedName || computer.dn || "";
    if (!dnMatchesWorkstationOu(dn, ouPatterns, searchBase)) continue;
    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "servers_in_wrong_ou",
        computer,
        status: "server_in_workstation_ou",
        metadata: {
          ouPatternsMatched: matchingWorkstationOuPatterns(dn, ouPatterns, searchBase),
        },
        findingSignals: ["SERVER_IN_WRONG_OU"],
      }),
    );
  }
  return findings;
}

export function detectDuplicateComputerSpns(computers, scanId) {
  const index = buildGlobalSpnIndex([], computers);
  const findings = [];
  for (const [spn, holders] of index) {
    if (holders.length < 2) continue;
    for (const holder of holders) {
      findings.push(
        buildPostureRiskFinding({
          scanId,
          feature: "duplicate_spns",
          objectType: holder.objectType,
          objectName: holder.objectName,
          dn: holder.dn,
          status: "duplicate_spn",
          metadata: { spn, duplicateCount: holders.length, holders },
          findingSignals: ["DUPLICATE_SPN"],
        }),
      );
    }
  }
  return findings;
}

export function detectDuplicateSpns(users, computers, scanId) {
  const index = buildGlobalSpnIndex(users, computers);
  const findings = [];
  for (const [spn, holders] of index) {
    if (holders.length < 2) continue;
    for (const holder of holders) {
      findings.push(
        buildPostureRiskFinding({
          scanId,
          feature: "duplicate_spns",
          objectType: holder.objectType,
          objectName: holder.objectName,
          dn: holder.dn,
          status: "duplicate_spn",
          metadata: { spn, duplicateCount: holders.length, holders },
          findingSignals: ["DUPLICATE_SPN"],
        }),
      );
    }
  }
  return findings;
}

export function detectComputerObjectsWithoutOwners(computers, scanId) {
  const findings = [];
  for (const computer of computers) {
    const managedBy = String(computer.managedBy || computer.rawData?.managedBy || "").trim();
    if (managedBy) continue;
    findings.push(
      buildComputerRiskFinding({
        scanId,
        feature: "computers_without_owners",
        computer,
        status: "missing_managed_by",
        findingSignals: ["COMPUTER_WITHOUT_OWNER"],
      }),
    );
  }
  return findings;
}

/**
 * Run one computer security feature against a loaded computer set.
 * @param {object[]} computers
 * @param {string} scanId
 * @param {string} featureId
 * @param {object} [analysisOptions]
 * @param {object[]} [users]
 */
export function analyzeComputerFeature(
  computers,
  scanId,
  featureId,
  analysisOptions = {},
  users = [],
) {
  const inactiveDays = analysisOptions.inactiveComputerDays ?? 90;
  const osTokens = analysisOptions.unsupportedOsTokens || [];
  const ouPatterns = analysisOptions.workstationOuPatterns || [];
  const featureSearchBase = analysisOptions.featureSearchBase || "";

  const runners = {
    disabled_computers: () => detectDisabledComputers(computers, scanId),
    inactive_computers: () => detectInactiveComputers(computers, scanId, inactiveDays),
    missing_os_information: () => detectMissingOSInformation(computers, scanId),
    unsupported_os_versions: () =>
      detectUnsupportedOperatingSystems(computers, scanId, osTokens),
    servers_in_wrong_ou: () =>
      detectServersInWorkstationOu(computers, scanId, ouPatterns, featureSearchBase),
    duplicate_spns: () => detectDuplicateComputerSpns(computers, scanId),
    computers_without_owners: () => detectComputerObjectsWithoutOwners(computers, scanId),
  };

  const findings = runners[featureId]?.() || [];
  return { findings, count: findings.length };
}

export function analyzeComputerSecurity(
  directory,
  scanId,
  selectedFeatures,
  analysisOptions = {},
) {
  const features = normalizeFeatures(selectedFeatures);
  const computers = directory.computers || [];
  const users = directory.users || [];
  const counts = Object.fromEntries(features.map((f) => [f, 0]));
  const findings = [];

  for (const feature of features) {
    const batch = analyzeComputerFeature(
      computers,
      scanId,
      feature,
      analysisOptions,
      users,
    );
    counts[feature] = batch.count;
    findings.push(...batch.findings);
  }

  return { findings, counts, features };
}

export async function runComputerSecurityScan({
  applicationId,
  adConfig,
  application = null,
  features,
  options = {},
}) {
  const scanId = randomUUID();
  const startedAt = new Date().toISOString();
  const cfg = normalizeAdConfig(adConfig);
  const featureList = normalizeFeatures(features);
  const queryOverrides = options.queryOverrides || {};
  const analysisOptions = {
    inactiveComputerDays: resolveInactiveComputersDays(application, options),
    unsupportedOsTokens: resolveUnsupportedOsTokens(application, options),
    workstationOuPatterns: resolveWorkstationOuPatterns(application, options),
  };

  const allFindings = [];
  const counts = Object.fromEntries(featureList.map((f) => [f, 0]));
  const featureDiagnostics = [];
  let totalComputersFetched = 0;
  /** @type {Map<string, object[]>} */
  const computersByCacheKey = new Map();

  for (const featureId of featureList) {
    const resolved = resolveFeatureQuery(featureId, queryOverrides, cfg);
    const ldapFilter = resolved.ldapFilter;
    const searchBase = resolved.searchBaseDn;
    const t0 = Date.now();

    const cacheKey = `${searchBase || ""}\0${ldapFilter}\0${resolved.searchScope}`;
    let computers = computersByCacheKey.get(cacheKey);
    if (!computers) {
      computers = await fetchNormalizedPostureComputers(cfg, {
        maxComputers: options.maxComputers,
        ldapFilter,
        searchBase,
        searchScope: resolved.searchScope,
      });
      computersByCacheKey.set(cacheKey, computers);
      totalComputersFetched += computers.length;
    }

    const analysis = analyzeComputerFeature(
      computers,
      scanId,
      featureId,
      {
        ...analysisOptions,
        featureSearchBase: searchBase,
      },
    );

    allFindings.push(...analysis.findings);
    counts[featureId] = analysis.count;

    const diagnostic = createFeatureDiagnostic({
      featureKey: featureId,
      executionMode: resolved.executionMode,
      ldapFilter,
      searchBase,
      searchScope: resolved.searchScope,
      registryDefaultFilter: resolved.registryDefaultFilter,
      overrideUsed: resolved.overrideUsed,
      ldapObjectsReturned: computers.length,
      ldapObjectsByType: { computer: computers.length },
      normalizedObjects: computers.length,
      findingsGenerated: analysis.count,
      elapsedMs: Date.now() - t0,
      moduleId: "computer_security",
    });
    featureDiagnostics.push(diagnostic);
    logFeatureDiagnostic(diagnostic);
  }

  return {
    scanId,
    module: "computer_security",
    applicationId: String(applicationId),
    startedAt,
    completedAt: new Date().toISOString(),
    userCount: 0,
    computerCount: totalComputersFetched,
    features: featureList,
    counts,
    findings: allFindings,
    featureDiagnostics,
    featureSettings: {
      inactive_computers: {
        inactiveDays: analysisOptions.inactiveComputerDays,
      },
    },
    summary: {
      totalFindings: allFindings.length,
      byFeature: counts,
    },
  };
}
