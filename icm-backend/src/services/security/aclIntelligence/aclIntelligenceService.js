import { detectAclShadowAdminRights, detectGraphShadowAdmins } from "./detectAclShadowAdminRights.js";
import { detectBrokenAcls } from "./detectBrokenAcls.js";
import { detectForeignSecurityPrincipals } from "./detectForeignSecurityPrincipals.js";
import { detectSidHistoryAnalysis } from "./detectSidHistoryAnalysis.js";
import { detectUnknownSidBindings } from "./detectUnknownSidBindings.js";
import { buildGraphRiskFinding } from "../../graph/graphFindingBuilder.js";
import { ACL_INTELLIGENCE_FEATURES } from "../../posture/postureFeatureIds.js";
import {
  isAdShieldEnabled,
} from "../adShield/adShieldClient.js";
import {
  ADSHIELD_ACL_FEATURES,
  isAdShieldFullyDelegatedFeature,
  runAdShieldAclFeatures,
} from "../adShield/adShieldAclAdapter.js";

export { ACL_INTELLIGENCE_FEATURES };
function getAnalysis(ctx) {
  return ctx.analysisCtx;
}

/** @deprecated use registry via buildAclIntelligenceContext — kept for backward-compatible orphan heuristic */
export async function detectOrphanSids(ctx) {
  const { application, scanId } = ctx;
  const analysis = getAnalysis(ctx);

  const entitlements = analysis?.entitlements || [];
  const users = analysis?.users || [];

  const knownSids = new Set();
  for (const ent of entitlements) {
    const sid = String(ent.rawData?.objectSid || ent.rawData?.object_sid || "").trim();
    if (sid) knownSids.add(sid.toLowerCase());
  }

  const findings = [];
  for (const user of users) {
    const raw = user.rawData || {};
    const candidates = [
      raw.objectSid,
      raw.primaryGroupID,
      ...(Array.isArray(raw.sIDHistory) ? raw.sIDHistory : []),
    ].filter(Boolean);

    for (const sid of candidates) {
      const s = String(sid).trim().toLowerCase();
      if (!s || !/^s-\d/i.test(s)) continue;
      if (!knownSids.has(s)) {
        findings.push(
          buildGraphRiskFinding({
            scanId,
            feature: "orphan_sids",
            objectType: "user",
            objectName: user.user_id,
            status: "orphan_sid",
            metadata: { sid },
            findingSignals: ["ORPHAN_SID"],
          }),
        );
      }
    }
  }

  return { feature: "orphan_sids", count: findings.length, findings };
}

/**
 * Shadow admin detection — hybrid:
 * - Graph half always runs in Node (detectGraphShadowAdmins).
 * - ACL half: ADShield live when ADSHIELD_ENABLED, else Node detectAclShadowAdminRights.
 */
export async function detectShadowAdmins(ctx) {
  const graphFindings = await detectGraphShadowAdmins(ctx);
  let aclFindings = [];
  const aclErrors = [];
  let aclSource = "node";
  let aclDiagnostics;

  if (isAdShieldEnabled()) {
    const remote = await runAdShieldAclFeatures(ctx, ["shadow_admins_acl"]);
    aclFindings = remote.findings || [];
    aclSource = "adshield";
    aclDiagnostics = remote.diagnostics;
    if (remote.errors?.length) aclErrors.push(...remote.errors);
  } else {
    const aclResult = await detectAclShadowAdminRights(ctx);
    aclFindings = aclResult.findings || [];
  }

  const merged = [...graphFindings, ...aclFindings];
  return {
    feature: "shadow_admins",
    count: merged.length,
    findings: merged,
    source: "hybrid",
    aclSource,
    ...(aclDiagnostics ? { diagnostics: aclDiagnostics } : {}),
    ...(aclErrors.length ? { errors: aclErrors } : {}),
  };
}

const RUNNERS = {
  orphan_sids: detectOrphanSids,
  shadow_admins: detectShadowAdmins,
  sid_history_analysis: detectSidHistoryAnalysis,
  foreign_security_principals: detectForeignSecurityPrincipals,
  unknown_sid_bindings: detectUnknownSidBindings,
  broken_acls: detectBrokenAcls,
};

/**
 * Features fully owned by ADShield when ADSHIELD_ENABLED — skip Node SD detectors.
 * shadow_admins is hybrid and always uses the Node runner (graph + optional remote ACL).
 * @param {string} feature
 * @param {boolean} adShieldOn
 */
function shouldRunNodeRunner(feature, adShieldOn) {
  if (!adShieldOn) return true;
  return !isAdShieldFullyDelegatedFeature(feature);
}

export async function runAclIntelligence(ctx, features) {
  const selected = new Set(
    (features || ACL_INTELLIGENCE_FEATURES).filter((f) =>
      ACL_INTELLIGENCE_FEATURES.includes(f),
    ),
  );
  if (!selected.size) ACL_INTELLIGENCE_FEATURES.forEach((f) => selected.add(f));

  const adShieldOn = isAdShieldEnabled();
  const results = [];
  const allFindings = [];
  const errors = [];

  for (const [feature, fn] of Object.entries(RUNNERS)) {
    if (!selected.has(feature)) continue;
    if (!shouldRunNodeRunner(feature, adShieldOn)) continue;
    const tFeat = Date.now();
    const r = await fn(ctx);
    results.push({
      ...r,
      durationMs: Date.now() - tFeat,
      source: r.source || "node",
    });
    allFindings.push(...(r.findings || []));
    if (r.errors?.length) errors.push(...r.errors);
  }

  if (adShieldOn) {
    // Phase 1 fully delegated features only — shadow_admins_acl is invoked from detectShadowAdmins.
    const delegated = [...selected].filter(isAdShieldFullyDelegatedFeature);
    if (delegated.length) {
      const remote = await runAdShieldAclFeatures(ctx, delegated);
      results.push(...(remote.results || []));
      allFindings.push(...(remote.findings || []));
      if (remote.errors?.length) errors.push(...remote.errors);
    }
  }

  return {
    results,
    findings: allFindings,
    ...(errors.length ? { errors } : {}),
  };
}

export { parseSecurityDescriptor, extractSecurityDescriptorRaw, listDescriptorAces } from "./securityDescriptorParser.js";
export { buildSidRegistry, buildAclIntelligenceContext } from "./sidRegistry.js";
export { ACCESS_MASK, describeDangerousRights, hasShadowAdminRights } from "./aceConstants.js";
export { ADSHIELD_ACL_FEATURES };
