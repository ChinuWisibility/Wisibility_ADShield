import { buildGraphDiscoveryFinding } from "../../graph/graphFindingBuilder.js";
import {
  isAdShieldEnabled,
  postAccountAnalysis,
} from "./adShieldClient.js";
import {
  ADSHIELD_ACCOUNT_FEATURES,
  isAdShieldAccountFeature,
  isAdShieldFindingFeature,
} from "./adShieldFeatures.js";
import {
  buildAdShieldConnection,
  resolveAdShieldSearch,
} from "./adShieldAclAdapter.js";

/**
 * Map ADShield account finding into IdentitySphere discovery shape.
 * @param {object} raw
 * @param {string} scanId
 */
export function mapAdShieldAccountFinding(raw, scanId) {
  if (!raw || typeof raw !== "object") return null;
  const feature = String(raw.feature || "").trim();
  if (!isAdShieldAccountFeature(feature) && !isAdShieldFindingFeature(feature)) {
    return null;
  }
  if (!isAdShieldAccountFeature(feature)) return null;

  const status = String(raw.status || "").trim();
  const objectName = String(raw.objectName || "").trim();
  const objectType = String(raw.objectType || "user").trim() || "user";
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
 * Run ADShield-owned account features for a posture scan module.
 * @param {object} params
 * @param {object} params.adConfig
 * @param {string[]} params.features
 * @param {string} params.scanId
 * @param {object} [params.queryOverrides]
 * @param {object} [params.application]
 * @param {number} [params.inactiveDays]
 * @param {number} [params.maxUsers]
 */
export async function runAdShieldAccountFeatures({
  adConfig,
  features,
  scanId,
  queryOverrides = {},
  inactiveDays = 90,
  maxUsers,
}) {
  const selected = (features || []).filter(isAdShieldAccountFeature);
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
      "ADShield account analysis requires AD connection settings (url, bindDn, bindPassword, baseDn).";
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

  const ctx = { adConfig, queryOverrides };
  const search = resolveAdShieldSearch(
    { ...ctx, adConfig },
    selected,
  );
  // Prefer person/user filter for account features when override not set.
  if (
    !search.filter ||
    search.filter === "(|(&(objectCategory=person)(objectClass=user))(objectClass=group))"
  ) {
    search.filter = "(&(objectCategory=person)(objectClass=user))";
  }

  const body = {
    scanId,
    features: selected,
    connection: buildAdShieldConnection(adConfig),
    search: {
      baseDn: search.baseDn,
      filter: search.filter,
      scope: search.scope,
    },
    options: {
      maxObjects: Math.min(Math.max(parseInt(maxUsers, 10) || 5000, 1), 50000),
      inactiveDays: Math.min(Math.max(parseInt(inactiveDays, 10) || 90, 1), 3650),
    },
  };

  const t0 = Date.now();
  const data = await postAccountAnalysis(body);
  const durationMs = Date.now() - t0;

  const rawFindings = Array.isArray(data?.findings) ? data.findings : [];
  const findings = [];
  for (const raw of rawFindings) {
    const mapped = mapAdShieldAccountFinding(raw, scanId);
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
      objectsScanned: data?.diagnostics?.objectsScanned,
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

export { ADSHIELD_ACCOUNT_FEATURES };
