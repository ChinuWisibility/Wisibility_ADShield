/**
 * Observatory enricher — builds targetBenchmarks[] + sharedApiReports[] (schema v3).
 * Wraps Framework v2 enrichBenchmarkRaw for pageBenchmarks compatibility.
 */
import { enrichBenchmarkRaw } from "./enrich-raw.mjs";
import {
  loadRegistry,
  childrenOf,
  sharedApiTargets,
  REGISTRY_VERSION,
} from "./registry/index.mjs";
import {
  computeOverallGradeWithAction,
  gradeApi,
  gradeDatabase,
  gradeFrontend,
  gradePayload,
  gradeAction,
  pickPrimaryBottleneck,
  timeSharePct,
  bandForGrade,
} from "./lib/grades.mjs";
import { estimateParseMs, estimateRenderMs } from "./lib/payload.mjs";

function mongoLayerFromResult(result, pageSize) {
  if (!result) return null;
  const explain = result.explain || null;
  return {
    wallMs: result.ms ?? null,
    execMs: explain?.execMs ?? null,
    docsExamined: explain?.docsExamined ?? null,
    keysExamined: explain?.keysExamined ?? null,
    nReturned: explain?.nReturned ?? result.rows ?? null,
    indexNames: explain?.indexNames || (explain?.indexName ? [explain.indexName] : []),
    indexName: explain?.indexName ?? explain?.indexNames?.[0] ?? null,
    hasBlockingSort: explain?.hasBlockingSort ?? false,
    hasCollectionScan: explain?.hasCollectionScan ?? false,
    collections: result.collections || [],
    pageSize,
  };
}

function gradeTargetFromLayers({ database, api, payload, frontend, action }) {
  const gDb = gradeDatabase(database, { pageSize: database?.pageSize || 10 });
  const gApi = gradeApi(api);
  const gPay = gradePayload(payload || {});
  const gFe = gradeFrontend({
    ...frontend,
    reactQuery: frontend?.reactQuery ? "Yes" : "No",
  });
  const gAct = gradeAction(action);
  const grades = {
    database: gDb.grade,
    api: gApi.grade,
    payload: gPay.grade,
    frontend: gFe.grade,
    action: gAct.grade,
    overall: computeOverallGradeWithAction({
      database: gDb.grade,
      api: gApi.grade,
      payload: gPay.grade,
      frontend: gFe.grade,
      action: gAct.grade,
    }),
  };
  return {
    grades,
    gradeReasons: {
      database: gDb.reason,
      api: gApi.reason,
      payload: gPay.reason,
      frontend: gFe.reason,
      action: gAct.reason,
    },
  };
}

function buildLayersForTarget(target, byLabel, apiProbes, actionProbes, pageSize) {
  const mongoResult = target.metricLabel ? byLabel[target.metricLabel] : null;
  const pageProbe = target.pageId ? apiProbes[target.pageId] : null;
  const actProbe = actionProbes[target.id];

  const database =
    pageProbe?.database || mongoLayerFromResult(mongoResult, pageSize) || null;

  let api = null;
  let measurementMode = "mongo-only";
  if (pageProbe?.ok && pageProbe.api) {
    api = pageProbe.api;
    measurementMode = pageProbe.measurementMode || "api+mongo";
  } else if (mongoResult?.ok !== false && mongoResult?.ms != null && target.kind !== "action") {
    api = {
      p50Ms: mongoResult.ms,
      p95Ms: mongoResult.ms,
      status: 200,
      payloadBytes: mongoResult.payloadBytes,
      rows: mongoResult.rows,
      breakdown: {
        dbMs: database?.execMs ?? mongoResult.ms,
        serializeMs: null,
        appMs: null,
      },
      proxy: true,
      note: "API p50 proxied from Mongo wall-clock",
    };
  }

  const payload =
    pageProbe?.payload ||
    (mongoResult
      ? {
          rawBytes: mongoResult.payloadBytes,
          apiBytes: null,
          projectedBytes: null,
          topFields: [],
          heavyObjects: [],
          potentialSavingsPct: null,
        }
      : null);

  const feMeta = target.fe || {};
  const payloadBytes = payload?.apiBytes ?? payload?.rawBytes ?? mongoResult?.payloadBytes;
  const frontend = {
    reactQuery: Boolean(feMeta.reactQuery),
    mountApiCalls: feMeta.mountApiCalls ?? 1,
    duplicateRisk: feMeta.duplicateRisk || "low",
    primaryApis: feMeta.primaryApis || target.primaryApis || [],
    estParseMs: estimateParseMs(payloadBytes),
    estRenderMs: estimateRenderMs(api?.rows ?? mongoResult?.rows),
  };

  let action = null;
  if (target.kind === "action") {
    action = actProbe?.action || mongoResult?.meta || null;
    measurementMode = "action-historical";
    if (action?.completionMs != null) {
      api = {
        p50Ms: action.completionMs,
        p95Ms: action.completionMs,
        status: 200,
        payloadBytes: mongoResult?.payloadBytes ?? 0,
        rows: action.sampleCount ?? 0,
        breakdown: {
          dbMs: action.executionMs,
          serializeMs: null,
          appMs: action.queueMs,
        },
        proxy: false,
        note: action.note,
      };
    }
  }

  return { database, api, payload, frontend, action, measurementMode, mongoResult };
}

/**
 * @param {object} raw — base payload with results + apiProbes
 * @param {{ apiProbes?: object, actionProbes?: object, pageSize?: number }} opts
 */
export function enrichObservatoryRaw(raw, opts = {}) {
  const pageSize = opts.pageSize || raw.pageSize || 10;
  const apiProbes = opts.apiProbes || raw.apiProbes || {};
  const actionProbes = opts.actionProbes || raw.actionProbes || {};

  // v2 page benchmarks (navigation)
  const v2 = enrichBenchmarkRaw(raw, { apiProbes, pageSize });
  const byLabel = Object.fromEntries((raw.results || []).map((r) => [r.label, r]));
  const byPageId = Object.fromEntries((v2.pageBenchmarks || []).map((p) => [p.pageId, p]));

  const registry = loadRegistry();
  const targetBenchmarks = [];

  for (const target of registry.targets) {
    if (target.kind === "sharedApi") continue;
    if (target.comingSoon) {
      targetBenchmarks.push({
        targetId: target.id,
        kind: target.kind,
        name: target.name,
        pageId: target.pageId || null,
        parentId: target.parentId || null,
        route: target.route || null,
        comingSoon: true,
        grades: {
          database: "N/A",
          api: "N/A",
          payload: "N/A",
          frontend: "N/A",
          action: "N/A",
          overall: "N/A",
        },
        primaryBottleneck: "none",
        optimizeRequired: "NO",
        band: "N/A",
      });
      continue;
    }

    // Navigation: reuse v2 pageBenchmark when present
    if (target.kind === "navigation" && target.pageId && byPageId[target.pageId]) {
      const pb = byPageId[target.pageId];
      targetBenchmarks.push({
        targetId: target.id,
        kind: "navigation",
        name: target.name,
        pageId: target.pageId,
        parentId: null,
        route: target.route || pb.route,
        metricLabel: target.metricLabel || pb.metricLabel,
        sharedApiIds: target.sharedApiIds || [],
        sharedBackendId: pb.sharedBackendId,
        measurementMode: pb.measurementMode,
        layers: pb.layers,
        grades: { ...pb.grades, action: "N/A" },
        gradeReasons: pb.gradeReasons,
        primaryBottleneck: pb.primaryBottleneck,
        timeSharePct: pb.timeSharePct,
        band: pb.band,
        optimizeRequired: pb.optimizeRequired,
        children: childrenOf(target.id).map((c) => c.id),
      });
      continue;
    }

    const built = buildLayersForTarget(target, byLabel, apiProbes, actionProbes, pageSize);
    const { grades, gradeReasons } = gradeTargetFromLayers(built);
    const layers = {
      database: built.database,
      api: built.api,
      payload: built.payload,
      frontend: built.frontend,
      action: built.action,
    };
    const primaryBottleneck =
      target.kind === "action" && grades.action && !["N/A", "A+", "A", "B+", "B"].includes(grades.action)
        ? "action"
        : pickPrimaryBottleneck({ grades, layers });

    targetBenchmarks.push({
      targetId: target.id,
      kind: target.kind,
      name: target.name,
      pageId: target.pageId || null,
      parentId: target.parentId || null,
      route: target.route || null,
      trigger: target.trigger || null,
      primaryApis: target.primaryApis || [],
      controller: target.controller || null,
      metricLabel: target.metricLabel || null,
      sharedApiIds: target.sharedApiIds || [],
      measurementMode: built.measurementMode,
      layers,
      grades,
      gradeReasons,
      primaryBottleneck,
      timeSharePct: timeSharePct({
        dbMs: built.api?.breakdown?.dbMs ?? built.database?.execMs,
        appMs: built.api?.breakdown?.appMs,
        serializeMs: built.api?.breakdown?.serializeMs,
      }),
      band: bandForGrade(grades.overall),
      optimizeRequired: ["Critical", "D", "C"].includes(grades.overall) ? "YES" : "NO",
    });
  }

  // Shared API reports — declared + auto-detect from primaryApis
  const apiUsage = new Map();
  for (const tb of targetBenchmarks) {
    for (const api of tb.primaryApis || []) {
      if (!api || !String(api).startsWith("GET ") && !String(api).startsWith("POST ")) continue;
      if (!apiUsage.has(api)) apiUsage.set(api, new Set());
      apiUsage.get(api).add(tb.targetId);
    }
    for (const sid of tb.sharedApiIds || []) {
      const def = sharedApiTargets().find((a) => a.id === sid);
      if (!def) continue;
      if (!apiUsage.has(def.api)) apiUsage.set(def.api, new Set());
      apiUsage.get(def.api).add(tb.targetId);
    }
  }

  const sharedApiReports = [];
  const seenApis = new Set();

  for (const def of sharedApiTargets()) {
    seenApis.add(def.api);
    const consumers = [
      ...new Set([
        ...(def.consumerTargetIds || []),
        ...[...(apiUsage.get(def.api) || [])],
      ]),
    ];
    const memberBenchmarks = targetBenchmarks.filter((t) => consumers.includes(t.targetId));
    const order = ["A+", "A", "B+", "B", "C", "D", "Critical"];
    const worst =
      memberBenchmarks.length > 0
        ? memberBenchmarks.reduce((acc, cur) => {
            const ai = order.indexOf(acc.grades.overall);
            const bi = order.indexOf(cur.grades.overall);
            return bi >= ai ? cur : acc;
          })
        : null;

    sharedApiReports.push({
      id: def.id,
      kind: "sharedApi",
      name: def.name,
      api: def.api,
      controller: def.controller,
      usedBy: consumers,
      usedByNames: consumers.map((id) => registry.byId[id]?.name || id),
      impactCount: consumers.length,
      overallGrade: worst?.grades.overall || "N/A",
      bottleneck: worst?.primaryBottleneck || "none",
      recommendation: def.recommendation,
      evidence: worst
        ? {
            database: worst.layers?.database,
            api: worst.layers?.api
              ? { p50Ms: worst.layers.api.p50Ms, payloadBytes: worst.layers.api.payloadBytes }
              : null,
            payload: worst.layers?.payload,
          }
        : null,
    });
  }

  // Auto-detect APIs used by ≥2 targets not already declared
  for (const [api, consumers] of apiUsage.entries()) {
    if (seenApis.has(api)) continue;
    if (consumers.size < 2) continue;
    const list = [...consumers];
    const memberBenchmarks = targetBenchmarks.filter((t) => list.includes(t.targetId));
    const order = ["A+", "A", "B+", "B", "C", "D", "Critical"];
    const worst = memberBenchmarks.reduce((acc, cur) => {
      const ai = order.indexOf(acc.grades.overall);
      const bi = order.indexOf(cur.grades.overall);
      return bi >= ai ? cur : acc;
    }, memberBenchmarks[0]);

    sharedApiReports.push({
      id: `api.auto.${api.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()}`,
      kind: "sharedApi",
      name: api,
      api,
      controller: null,
      usedBy: list,
      usedByNames: list.map((id) => registry.byId[id]?.name || id),
      impactCount: list.length,
      overallGrade: worst?.grades.overall || "N/A",
      bottleneck: worst?.primaryBottleneck || "none",
      recommendation: `Optimize ${api} once — improves ${list.length} features.`,
      autoDetected: true,
      evidence: worst
        ? {
            api: worst.layers?.api
              ? { p50Ms: worst.layers.api.p50Ms, payloadBytes: worst.layers.api.payloadBytes }
              : null,
          }
        : null,
    });
  }

  return {
    ...v2,
    schemaVersion: 3,
    registryVersion: REGISTRY_VERSION,
    targetBenchmarks,
    sharedApiReports,
    actionProbes,
    framework: {
      name: "Wisibility Performance Observatory",
      version: 3,
      layers: ["database", "api", "payload", "frontend", "action"],
      targetKinds: ["navigation", "feature", "action", "sharedApi"],
    },
  };
}

export { enrichBenchmarkRaw };
