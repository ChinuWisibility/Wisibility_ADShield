import { buildGraphDiscoveryFinding } from "../../graph/graphFindingBuilder.js";
import {
  isAdShieldEnabled,
  postAclAnalysis,
  sanitizeAdShieldErrorMessage,
} from "./adShieldClient.js";
import {
  ADSHIELD_ACL_FEATURES,
  isAdShieldAclFeature,
  isAdShieldAccountFeature,
  isAdShieldFindingFeature,
  isAdShieldFullyDelegatedFeature,
} from "./adShieldFeatures.js";
import { buildAclIntelligenceContext } from "../aclIntelligence/sidRegistry.js";

const FEATURE_SIGNAL = {
  broken_acls: "BROKEN_ACL",
  unknown_sid_bindings: "UNKNOWN_SID_BINDING",
  shadow_admins: "SHADOW_ADMIN",
  shadow_admins_acl: "SHADOW_ADMIN",
};

/**
 * @param {object} adConfig - normalizeAdConfig output
 * @returns {object}
 */
export function buildAdShieldConnection(adConfig = {}) {
  return {
    url: adConfig.url || "",
    bindDn: adConfig.bindDn || "",
    bindPassword: adConfig.bindPassword || "",
    baseDn: adConfig.baseDn || "",
    timeoutMs: Math.min(
      Math.max(parseInt(adConfig.ldapTimeoutMs, 10) || 120000, 1000),
      600000,
    ),
    tlsInsecure: Boolean(adConfig.tlsInsecure),
  };
}

/**
 * Resolve search scope for ADShield from assessment overrides / app base DN.
 * @param {object} ctx
 * @param {string[]} featureIds
 */
export function resolveAdShieldSearch(ctx, featureIds = []) {
  const overrides = ctx.queryOverrides || {};
  const firstFeature = featureIds.find(
    (f) =>
      isAdShieldAclFeature(f) ||
      isAdShieldAccountFeature(f) ||
      f === "shadow_admins" ||
      f === "shadow_admins_acl",
  );
  const override = firstFeature ? overrides[firstFeature] : null;
  // Prefer shadow_admins override when requesting ACL half (same IdentitySphere feature).
  const shadowOverride = overrides.shadow_admins;
  const overrideObj =
    (shadowOverride && typeof shadowOverride === "object" && !Array.isArray(shadowOverride)
      ? shadowOverride
      : null) ||
    (override && typeof override === "object" && !Array.isArray(override) ? override : null);

  const baseDn =
    overrideObj?.searchBase ||
    overrideObj?.baseDn ||
    ctx.adConfig?.baseDn ||
    ctx.ldapCfg?.baseDn ||
    ctx.application?.connectionConfig?.ad?.baseDn ||
    "";

  const filter =
    overrideObj?.ldapFilter ||
    overrideObj?.filter ||
    "(|(&(objectCategory=person)(objectClass=user))(objectClass=group))";

  const scopeRaw = String(
    overrideObj?.searchScope || overrideObj?.scope || "Subtree",
  ).toLowerCase();
  let scope = "sub";
  if (scopeRaw === "base" || scopeRaw === "0") scope = "base";
  else if (scopeRaw === "onelevel" || scopeRaw === "one" || scopeRaw === "1")
    scope = "one";

  return { baseDn, filter, scope };
}

/**
 * Collect privileged SIDs from the Node SID registry (request-scoped, non-secret).
 * @param {object} ctx
 * @returns {string[]}
 */
export function collectPrivilegedSidsForAdShield(ctx) {
  try {
    const { registry } = buildAclIntelligenceContext(ctx);
    return [...(registry.privilegedSids || [])].map(String).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Validate and normalize one ADShield discovery finding into IdentitySphere shape.
 * @param {object} raw
 * @param {string} scanId
 * @returns {object|null}
 */
export function mapAdShieldFinding(raw, scanId) {
  if (!raw || typeof raw !== "object") return null;

  const feature = String(raw.feature || "").trim();
  if (!isAdShieldFindingFeature(feature)) return null;

  const status = String(raw.status || "").trim();
  const objectName = String(raw.objectName || "").trim();
  const objectType = String(raw.objectType || "").trim();
  if (!status || !objectName || !objectType) return null;

  const expectedSignal = FEATURE_SIGNAL[feature];
  const explicitSignals = Array.isArray(raw.findingSignals)
    ? raw.findingSignals.map(String).filter(Boolean)
    : [];
  if (expectedSignal && !explicitSignals.includes(expectedSignal)) {
    explicitSignals.unshift(expectedSignal);
  }
  if (feature === "shadow_admins" || feature === "shadow_admins_acl") {
    if (!explicitSignals.includes("PRIVILEGED_USER")) {
      explicitSignals.push("PRIVILEGED_USER");
    }
  }
  if (!explicitSignals.length) return null;

  const findingType = String(raw.findingType || expectedSignal || "").trim();
  if (!findingType) return null;

  const evidence =
    raw.evidence && typeof raw.evidence === "object" && !Array.isArray(raw.evidence)
      ? raw.evidence
      : raw.metadata && typeof raw.metadata === "object"
        ? raw.metadata
        : {};

  // Persisted IdentitySphere feature: shadow_admins_acl analysis → shadow_admins.
  const persistedFeature =
    feature === "shadow_admins_acl" ? "shadow_admins" : feature;

  return buildGraphDiscoveryFinding({
    scanId: String(raw.scanId || scanId || "").trim() || scanId,
    feature: persistedFeature,
    objectType,
    objectName,
    dn: String(raw.dn || ""),
    status,
    attributes:
      raw.attributes && typeof raw.attributes === "object" ? raw.attributes : {},
    evidence,
    relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
    findingSignals: explicitSignals,
  });
}

/**
 * Run ADShield-owned ACL features and return runAclIntelligence-compatible results.
 * @param {object} ctx - ACL scan context (must include adConfig when live analysis is required)
 * @param {string[]} featureIds
 */
export async function runAdShieldAclFeatures(ctx, featureIds) {
  const selected = (featureIds || []).filter(isAdShieldAclFeature);
  if (!selected.length) {
    return { results: [], findings: [], errors: [] };
  }

  if (!isAdShieldEnabled()) {
    return { results: [], findings: [], errors: [] };
  }

  const adConfig = ctx.adConfig;
  if (!adConfig?.url || !adConfig?.bindDn || !adConfig?.bindPassword || !adConfig?.baseDn) {
    const err =
      "ADShield ACL analysis requires AD connection settings (url, bindDn, bindPassword, baseDn).";
    return {
      results: selected.map((feature) => ({
        feature,
        count: 0,
        findings: [],
        durationMs: 0,
        error: err,
        source: "adshield",
      })),
      findings: [],
      errors: [err],
    };
  }

  const searchFeatureIds = selected.includes("shadow_admins_acl")
    ? ["shadow_admins", ...selected]
    : selected;
  const search = resolveAdShieldSearch(ctx, searchFeatureIds);
  const options = {
    maxObjects: Math.min(
      Math.max(parseInt(adConfig.maxUsers, 10) || 5000, 1),
      50000,
    ),
  };

  if (selected.includes("shadow_admins_acl")) {
    const privilegedSids = collectPrivilegedSidsForAdShield(ctx);
    if (privilegedSids.length) {
      options.privilegedSids = privilegedSids;
    }
  }

  const body = {
    scanId: ctx.scanId,
    tenantId: ctx.tenantId ? String(ctx.tenantId) : undefined,
    applicationId: ctx.applicationId ? String(ctx.applicationId) : undefined,
    features: selected,
    connection: buildAdShieldConnection(adConfig),
    search: {
      baseDn: search.baseDn || adConfig.baseDn,
      filter: search.filter,
      scope: search.scope,
    },
    options,
  };

  const t0 = Date.now();
  try {
    const payload = await postAclAnalysis(body);
    const durationMs = Date.now() - t0;

    if (payload.success === false) {
      const remoteErrors = Array.isArray(payload.errors)
        ? payload.errors.map((e) => sanitizeAdShieldErrorMessage(e))
        : ["ADShield ACL analysis reported failure."];
      return {
        results: selected.map((feature) => ({
          feature,
          count: 0,
          findings: [],
          durationMs,
          error: remoteErrors[0],
          source: "adshield",
        })),
        findings: [],
        errors: remoteErrors,
        diagnostics: payload.diagnostics,
      };
    }

    const rawFindings = Array.isArray(payload.findings) ? payload.findings : [];
    const findings = [];
    let rejected = 0;
    for (const raw of rawFindings) {
      const mapped = mapAdShieldFinding(raw, ctx.scanId);
      if (mapped) findings.push(mapped);
      else rejected += 1;
    }

    const byFeature = new Map(selected.map((f) => [f, []]));
    for (const f of findings) {
      if (f.feature === "shadow_admins" && byFeature.has("shadow_admins_acl")) {
        byFeature.get("shadow_admins_acl").push(f);
      } else if (byFeature.has(f.feature)) {
        byFeature.get(f.feature).push(f);
      }
    }

    const remoteResults = Array.isArray(payload.results) ? payload.results : [];
    const results = selected.map((feature) => {
      const remote = remoteResults.find((r) => r?.feature === feature);
      const featureFindings = byFeature.get(feature) || [];
      return {
        feature,
        count: featureFindings.length,
        findings: featureFindings,
        durationMs: remote?.durationMs ?? durationMs,
        source: "adshield",
        diagnostics: payload.diagnostics || undefined,
      };
    });

    const errors = [
      ...(Array.isArray(payload.errors) ? payload.errors.map(String) : []),
      ...(rejected
        ? [`Rejected ${rejected} malformed ADShield finding(s).`]
        : []),
    ].map(sanitizeAdShieldErrorMessage);

    return { results, findings, errors, diagnostics: payload.diagnostics };
  } catch (err) {
    const message = sanitizeAdShieldErrorMessage(err);
    console.error("[adShieldAclAdapter]", message);
    return {
      results: selected.map((feature) => ({
        feature,
        count: 0,
        findings: [],
        durationMs: Date.now() - t0,
        error: message,
        source: "adshield",
      })),
      findings: [],
      errors: [message],
    };
  }
}

export {
  ADSHIELD_ACL_FEATURES,
  isAdShieldAclFeature,
  isAdShieldFullyDelegatedFeature,
  isAdShieldFindingFeature,
};
