import { randomUUID } from "crypto";

import { toTenantObjectId } from "../../utils/applicationDynamicCollections.js";

import { incrementalGraphUpdateFromDb } from "../graph/graphIncrementalUpdateService.js";

import { buildScanGraphContext } from "../graph/graphScanContext.js";

import { buildGraphAnalysisContext } from "../graph/graphAnalysisContext.js";

import { isGraphFreshForScan, markScanAnalyzed } from "../graph/graphMetadataService.js";

import { createGraphMetrics, finalizeMetrics, msSince } from "../graph/graphObservability.js";

import { runGroupIntelligence, GROUP_INTELLIGENCE_FEATURES } from "./groupIntelligence/groupIntelligenceService.js";

import {

  runPrivilegedAccessIntelligence,

  PRIVILEGED_ACCESS_FEATURES,

} from "./privilegedAccess/privilegedAccessService.js";

import {

  runAclIntelligence,

  ACL_INTELLIGENCE_FEATURES,

} from "./aclIntelligence/aclIntelligenceService.js";



export const IDENTITY_GRAPH_SECURITY_FEATURES = [

  ...GROUP_INTELLIGENCE_FEATURES,

  ...PRIVILEGED_ACCESS_FEATURES,

  ...ACL_INTELLIGENCE_FEATURES,

];



/**

 * Run identity graph security intelligence (analyze prebuilt graph).

 */

export async function runIdentityGraphSecurityScan({

  application,

  features,

  options = {},

}) {

  const scanId = randomUUID();

  const startedAt = new Date().toISOString();

  const tenantId = toTenantObjectId(application.tenantId);

  const applicationId = application._id;

  const scopeKey = `${tenantId}:${applicationId}`;

  const metrics = createGraphMetrics(scopeKey);

  const timings = {};



  const t0 = Date.now();

  let materializeStats;

  const selectedPreview = Array.isArray(features) ? features : IDENTITY_GRAPH_SECURITY_FEATURES;
  const needsNestingHeal = selectedPreview.some((f) =>
    ["nested_privileged_access", "privilege_escalation_paths", "nested_groups"].includes(f),
  );

  if (options.skipMaterialize) {
    materializeStats = { skipped: true, reason: "explicit_skip" };
  } else if (options.forceMaterialize) {
    materializeStats = await incrementalGraphUpdateFromDb(application, {
      fullRebuild: options.replaceExisting === true,
      source: "scan_force",
    });
  } else if (await isGraphFreshForScan(tenantId, applicationId)) {
    materializeStats = { skipped: true, reason: "graph_fresh_from_sync" };
  } else {
    materializeStats = await incrementalGraphUpdateFromDb(application, {
      fullRebuild: false,
      source: "scan_backfill",
    });
  }

  timings.materializeMs = msSince(t0);
  metrics.edgeBuildMs = timings.materializeMs;

  const t1 = Date.now();
  let scanGraph = await buildScanGraphContext(tenantId, applicationId);
  timings.graphLoadMs = msSince(t1);
  metrics.graphLoadMs = timings.graphLoadMs;

  // Stale "fresh" graphs often lack NESTED_MEMBER_OF after membership-only syncs.
  // Force a DB rematerialize once so entitlement memberOf can rebuild nesting.
  const nestedEdgeCount = [...(scanGraph.nestedGroupAdj?.values() || [])].reduce(
    (n, list) => n + (list?.length || 0),
    0,
  );
  if (
    needsNestingHeal &&
    !options.skipMaterialize &&
    nestedEdgeCount === 0 &&
    materializeStats?.skipped
  ) {
    const tHeal = Date.now();
    materializeStats = await incrementalGraphUpdateFromDb(application, {
      fullRebuild: true,
      source: "scan_nested_heal",
    });
    scanGraph = await buildScanGraphContext(tenantId, applicationId);
    timings.materializeMs = (timings.materializeMs || 0) + msSince(tHeal);
    metrics.edgeBuildMs = timings.materializeMs;
    materializeStats = { ...materializeStats, nestedHeal: true };
  }



  const tPre = Date.now();

  const analysisCtx = await buildGraphAnalysisContext({
    tenantId,
    applicationId,
    application,
    scanId,
    scanGraph,
    metrics,
  });

  const ldapCfg = {
    baseDn:
      options.adConfig?.baseDn ||
      application?.connectionConfig?.ad?.baseDn ||
      undefined,
    baseDns:
      options.adConfig?.baseDns ||
      application?.connectionConfig?.ad?.baseDns ||
      undefined,
  };

  const ctx = {
    tenantId,
    applicationId,
    application,
    scanId,
    scanGraph,
    analysisCtx,
    queryOverrides: options.queryOverrides || {},
    ldapCfg,
    // Request-scoped AD config for ADShield (never persisted by this module).
    adConfig: options.adConfig || null,
  };

  const selected = Array.isArray(features) ? features : IDENTITY_GRAPH_SECURITY_FEATURES;

  const groupFeatures = selected.filter((f) => GROUP_INTELLIGENCE_FEATURES.includes(f));

  const privFeatures = selected.filter((f) => PRIVILEGED_ACCESS_FEATURES.includes(f));

  const aclFeatures = selected.filter((f) => ACL_INTELLIGENCE_FEATURES.includes(f));

  const { isAdShieldEnabled } = await import("./adShield/adShieldClient.js");
  const adShieldOn = isAdShieldEnabled();
  const adShieldPostureFeatures = adShieldOn
    ? [...groupFeatures, ...privFeatures]
    : [];

  const t2 = Date.now();

  let group = { results: [], findings: [] };
  let priv = { results: [], findings: [] };
  let adShieldPosture = { findings: [], counts: {}, featureDiagnostics: [], results: [] };

  if (adShieldPostureFeatures.length) {
    const { runAdShieldPostureFeatures } = await import("./adShield/adShieldPostureAdapter.js");
    const adConfig =
      options.adConfig ||
      (application?.connectionConfig?.ad
        ? { ...application.connectionConfig.ad }
        : null);
    adShieldPosture = await runAdShieldPostureFeatures({
      adConfig,
      features: adShieldPostureFeatures,
      scanId,
      queryOverrides: options.queryOverrides || {},
    });
    // Shape results like graph runners for diagnostics.
    adShieldPosture.results = adShieldPostureFeatures.map((feature) => ({
      feature,
      count: adShieldPosture.counts?.[feature] || 0,
      findings: (adShieldPosture.findings || []).filter((f) => f.feature === feature),
      durationMs:
        adShieldPosture.featureDiagnostics?.find((d) => d.feature === feature)?.durationMs || 0,
    }));
    group = {
      results: adShieldPosture.results.filter((r) => groupFeatures.includes(r.feature)),
      findings: (adShieldPosture.findings || []).filter((f) => groupFeatures.includes(f.feature)),
    };
    priv = {
      results: adShieldPosture.results.filter((r) => privFeatures.includes(r.feature)),
      findings: (adShieldPosture.findings || []).filter((f) => privFeatures.includes(f.feature)),
    };
  } else {
    group = groupFeatures.length
      ? await runGroupIntelligence(ctx, groupFeatures)
      : { results: [], findings: [] };

    priv = privFeatures.length
      ? await runPrivilegedAccessIntelligence(ctx, privFeatures)
      : { results: [], findings: [] };
  }

  const acl = aclFeatures.length
    ? await runAclIntelligence(ctx, aclFeatures)
    : { results: [], findings: [] };

  timings.analyzeMs = msSince(t2);

  metrics.analyzeMs = timings.analyzeMs;

  timings.preloadMs = analysisCtx.metrics.preloadMs;

  const featureTimings = [
    ...(group.results || []),
    ...(priv.results || []),
    ...(acl.results || []),
  ]
    .map((r) => ({ feature: r.feature, durationMs: r.durationMs || 0 }))
    .sort((a, b) => b.durationMs - a.durationMs);
  timings.featureTimings = featureTimings;

  const findings = [...group.findings, ...priv.findings, ...acl.findings];



  const counts = {};

  for (const f of findings) {

    counts[f.feature] = (counts[f.feature] || 0) + 1;

  }



  timings.totalMs = msSince(t0);

  metrics.totalMs = timings.totalMs;

  finalizeMetrics(metrics);



  await markScanAnalyzed(tenantId, applicationId);



  return {

    scanId,

    module: "identity_graph_security",

    applicationId: String(applicationId),

    startedAt,

    completedAt: new Date().toISOString(),

    materializeStats,

    timings,

    metrics: {

      ...metrics,

      cacheHitRatio:

        metrics.cacheHits + metrics.cacheMisses > 0

          ? metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses)

          : null,

    },

    features: selected,

    counts,

    findings,

    results: {

      group: group.results,

      privilegedAccess: priv.results,

      acl: acl.results,

    },

    // Soft-fail diagnostics from ADShield (not shown as findings; distinguishes empty vs failed).
    ...(acl.errors?.length ? { aclErrors: acl.errors } : {}),

    summary: {

      totalFindings: findings.length,

      byFeature: counts,

      timings,

      metrics,

      ...(acl.errors?.length ? { aclErrors: acl.errors } : {}),

    },

  };

}

