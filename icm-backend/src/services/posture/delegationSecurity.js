import { randomUUID } from "crypto";
import { normalizeAdConfig } from "../ad/adLdapService.js";
import {
  buildComputerRiskFinding,
  // buildPostureRiskFinding, // unused while delegation_exposure is disabled
  buildUserRiskFinding,
  trustedForDelegation,
  trustedToAuthForDelegation,
} from "./utils/adSecurityHelpers.js";
import { runLdapFeatureScanLoop } from "./ldapFeatureScanRunner.js";
import { DELEGATION_SECURITY_FEATURES } from "./postureFeatureIds.js";

export { DELEGATION_SECURITY_FEATURES };
function normalizeFeatures(selected) {
  const list = Array.isArray(selected) ? selected : DELEGATION_SECURITY_FEATURES;
  const allowed = new Set(DELEGATION_SECURITY_FEATURES);
  const out = list.map((f) => String(f).trim()).filter((f) => allowed.has(f));
  return out.length ? out : [...DELEGATION_SECURITY_FEATURES];
}

function delegationTargets(entity) {
  const fromRaw = entity.rawData || {};
  const values =
    entity.msDSAllowedToDelegateTo ||
    fromRaw.msDSAllowedToDelegateTo ||
    fromRaw["msDS-AllowedToDelegateTo"];
  if (Array.isArray(values)) return values.map(String).filter(Boolean);
  const single = String(values || "").trim();
  return single ? [single] : [];
}

function hasRbcd(entity) {
  const raw = entity.rawData || {};
  const val =
    entity.msDSAllowedToActOnBehalfOfOtherIdentity ||
    raw.msDSAllowedToActOnBehalfOfOtherIdentity ||
    raw["msDS-AllowedToActOnBehalfOfOtherIdentity"];
  if (val == null) return false;
  if (Buffer.isBuffer(val)) return val.length > 0;
  if (typeof val === "string") return val.trim() !== "";
  if (Array.isArray(val)) return val.some((v) => hasRbcd({ msDSAllowedToActOnBehalfOfOtherIdentity: v }));
  return String(val).trim() !== "";
}

function buildEntityFinding(scanId, feature, entity, objectType, payload) {
  if (objectType === "computer") {
    return buildComputerRiskFinding({
      scanId,
      feature,
      computer: entity,
      ...payload,
    });
  }
  return buildUserRiskFinding({
    scanId,
    feature,
    user: entity,
    ...payload,
  });
}

export function detectUnconstrainedDelegation(users, computers, scanId) {
  const findings = [];
  const inspect = (entity, objectType) => {
    if (!trustedForDelegation(entity.userAccountControl)) return;
    findings.push(
      buildEntityFinding(scanId, "unconstrained_delegation", entity, objectType, {
        status: "unconstrained_delegation",
        metadata: {
          delegationType: "unconstrained",
          userAccountControl: entity.userAccountControl,
        },
        findingSignals: ["UNCONSTRAINED_DELEGATION"],
      }),
    );
  };
  for (const user of users || []) inspect(user, "user");
  for (const computer of computers || []) inspect(computer, "computer");
  return findings;
}

export function detectConstrainedDelegation(users, computers, scanId) {
  const findings = [];
  const inspect = (entity, objectType) => {
    const targets = delegationTargets(entity);
    const uacConstrained = trustedToAuthForDelegation(entity.userAccountControl);
    if (!targets.length && !uacConstrained) return;
    findings.push(
      buildEntityFinding(scanId, "constrained_delegation", entity, objectType, {
        status: "constrained_delegation",
        metadata: {
          delegationType: "constrained",
          targetServices: targets,
          userAccountControl: entity.userAccountControl,
        },
        findingSignals: ["CONSTRAINED_DELEGATION"],
      }),
    );
  };
  for (const user of users || []) inspect(user, "user");
  for (const computer of computers || []) inspect(computer, "computer");
  return findings;
}

/** Primary search is computer objects (msDS-AllowedToActOnBehalfOfOtherIdentity). */
export function detectResourceBasedConstrainedDelegation(_users, computers, scanId) {
  const findings = [];
  for (const computer of computers || []) {
    if (!hasRbcd(computer)) continue;
    findings.push(
      buildEntityFinding(scanId, "rbcd", computer, "computer", {
        status: "resource_based_constrained_delegation",
        metadata: { delegationType: "rbcd" },
        findingSignals: ["RBCD_CONFIGURED"],
      }),
    );
  }
  return findings;
}

export function analyzeDelegationFeature(featureId, objects, scanId) {
  const users = objects.user || [];
  const computers = objects.computer || [];
  const runners = {
    unconstrained_delegation: () => detectUnconstrainedDelegation(users, computers, scanId),
    constrained_delegation: () => detectConstrainedDelegation(users, computers, scanId),
    rbcd: () => detectResourceBasedConstrainedDelegation(users, computers, scanId),
  };
  const findings = runners[featureId]?.() || [];
  return { findings, count: findings.length };
}

export function analyzeDelegationSecurity(directory, scanId, selectedFeatures) {
  const features = normalizeFeatures(selectedFeatures);
  const users = directory.users || directory.user || [];
  const computers = directory.computers || directory.computer || [];
  const counts = Object.fromEntries(features.map((f) => [f, 0]));
  const findings = [];

  for (const feature of features) {
    const batch = analyzeDelegationFeature(
      feature,
      { user: users, computer: computers },
      scanId,
    );
    counts[feature] = batch.count;
    findings.push(...batch.findings);
  }

  return { findings, counts, features };
}

export async function runDelegationSecurityScan({
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
      module: "delegation_security",
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
    moduleId: "delegation_security",
    featureList,
    cfg,
    queryOverrides,
    fetchOptions: {
      maxUsers: options.maxUsers ?? cfg.maxUsers,
      maxComputers: options.maxComputers,
    },
    analyzeFeature: (featureId, objects) =>
      analyzeDelegationFeature(featureId, objects, scanId),
  });

  return {
    scanId,
    module: "delegation_security",
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
