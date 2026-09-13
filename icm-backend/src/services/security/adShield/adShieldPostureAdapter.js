import { buildGraphDiscoveryFinding } from "../../graph/graphFindingBuilder.js";
import {
  isAdShieldEnabled,
  postPostureAnalysis,
} from "./adShieldClient.js";
import {
  ADSHIELD_POSTURE_FEATURES,
  isAdShieldPostureFeature,
} from "./adShieldFeatures.js";
import {
  buildAdShieldConnection,
  resolveAdShieldSearch,
} from "./adShieldAclAdapter.js";

/**
 * Map ADShield posture finding into IdentitySphere discovery shape.
 * @param {object} raw
 * @param {string} scanId
 */
export function mapAdShieldPostureFinding(raw, scanId) {
  if (!raw || typeof raw !== "object") return null;
  const feature = String(raw.feature || "").trim();
  if (!isAdShieldPostureFeature(feature)) return null;

  const status = String(raw.status || "").trim();
  const objectName = String(raw.objectName || "").trim();
  const objectType = String(raw.objectType || "object").trim() || "object";
  if (!status || !objectName) return null;

  const signals = Array.isArray(raw.findingSignals)
    ? raw.findingSignals.map(String).filter(Boolean)
    : [];
  if (!signals.length) return null;

  const evidence =
    raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)
      ? raw.evidence
      : {};

  return buildGraphDiscoveryFinding({
    scanId: String(raw.scanId || scanId || "").trim() || scanId,
    feature,
    objectType,
    objectName,
    dn: String(raw.dn || ""),
    status,
    attributes:
      raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {},
    evidence,
    relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
    findingSignals: signals,
  });
}

/**
 * Run ADShield-owned posture features (groups/privileged/computers/kerberos/delegation).
 * @param {object} params
 */
export async function runAdShieldPostureFeatures({
  adConfig,
  features,
  scanId,
  queryOverrides = {},
  inactiveDays = 90,
  maxObjects,
  workstationOuPatterns,
  unsupportedOsTokens,
}) {
  const selected = (features || []).filter(isAdShieldPostureFeature);
  const counts = Object.fromEntries(selected.map((f) => [f, 0]));
  if (!selected.length) {
    return { findings: [], counts, featureDiagnostics: [], source: "adshield" };
  }

  if (!isAdShieldEnabled()) {
    return {
      findings: [],
      counts,
      featureDiagnostics: selected.map((feature) => ({
        feature,
        error: "ADShield is disabled",
        source: "adshield",
      })),
      source: "adshield",
      errors: ["ADShield is disabled"],
    };
  }

  if (!adConfig?.url || !adConfig?.bindDn || !adConfig?.bindPassword || !adConfig?.baseDn) {
    const err =
      "ADShield posture analysis requires AD connection settings (url, bindDn, bindPassword, baseDn).";
    return {
      findings: [],
      counts,
      featureDiagnostics: selected.map((feature) => ({
        feature,
        error: err,
        source: "adshield",
      })),
      source: "adshield",
      errors: [err],
    };
  }

  const search = resolveAdShieldSearch({ adConfig, queryOverrides }, selected);

  const body = {
    scanId,
    features: selected,
    connection: buildAdShieldConnection(adConfig),
    search: {
      baseDn: search.baseDn,
      // PostureAnalysisService uses class-specific filters; pass base only.
      filter: undefined,
      scope: search.scope || "sub",
    },
    options: {
      maxObjects: Math.min(Math.max(parseInt(maxObjects, 10) || 5000, 1), 50000),
      inactiveDays: Math.min(Math.max(parseInt(inactiveDays, 10) || 90, 1), 3650),
      workstationOuPatterns: Array.isArray(workstationOuPatterns)
        ? workstationOuPatterns
        : undefined,
      unsupportedOsTokens: Array.isArray(unsupportedOsTokens)
        ? unsupportedOsTokens
        : undefined,
    },
  };

  const t0 = Date.now();
  const data = await postPostureAnalysis(body);
  const durationMs = Date.now() - t0;

  const rawFindings = Array.isArray(data?.findings) ? data.findings : [];
  const findings = [];
  for (const raw of rawFindings) {
    const mapped = mapAdShieldPostureFinding(raw, scanId);
    if (mapped) {
      findings.push(mapped);
      if (counts[mapped.feature] != null) counts[mapped.feature] += 1;
    }
  }

  const featureDiagnostics = selected.map((feature) => {
    const resultRow = (data?.results || []).find((r) => r.feature === feature);
    return {
      feature,
      count: resultRow?.count ?? counts[feature] ?? 0,
      durationMs: resultRow?.durationMs ?? durationMs,
      source: "adshield",
      groupsScanned: data?.diagnostics?.groupsScanned,
      usersScanned: data?.diagnostics?.usersScanned,
      computersScanned: data?.diagnostics?.computersScanned,
    };
  });

  return {
    findings,
    counts,
    featureDiagnostics,
    source: "adshield",
    diagnostics: data?.diagnostics || null,
    errors: Array.isArray(data?.errors) ? data.errors : [],
  };
}

export { ADSHIELD_POSTURE_FEATURES };
