/**
 * Build pageBenchmarks[] + sharedOptimizations[] from harness results + API probes.
 */
import {
  PAGE_FE,
  PAGE_METRIC,
  PAGE_ROUTES,
  SHARED_BACKENDS,
  sharedBackendForPage,
} from "./catalog.mjs";
import {
  computeOverallGrade,
  gradeApi,
  gradeDatabase,
  gradeFrontend,
  gradePayload,
  pickPrimaryBottleneck,
  timeSharePct,
  bandForGrade,
} from "./lib/grades.mjs";
import { estimateParseMs, estimateRenderMs, analyzePayload } from "./lib/payload.mjs";

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

function frontendLayer(pageId, payloadBytes, rows) {
  const fe = PAGE_FE[pageId] || {
    reactQuery: false,
    mountApiCalls: 1,
    duplicateRisk: "low",
    primaryApis: [],
  };
  return {
    reactQuery: fe.reactQuery,
    mountApiCalls: fe.mountApiCalls,
    duplicateRisk: fe.duplicateRisk,
    primaryApis: fe.primaryApis,
    estParseMs: estimateParseMs(payloadBytes),
    estRenderMs: estimateRenderMs(rows),
  };
}

export function enrichBenchmarkRaw(raw, { apiProbes = {}, pageSize = 10 } = {}) {
  const byLabel = Object.fromEntries((raw.results || []).map((r) => [r.label, r]));
  const pageBenchmarks = [];

  for (const pageId of Object.keys(PAGE_METRIC)) {
    const metricLabel = PAGE_METRIC[pageId];
    const mongoResult = byLabel[metricLabel];
    const probe = apiProbes[pageId];
    const shared = sharedBackendForPage(pageId);

    const database =
      probe?.database ||
      mongoLayerFromResult(mongoResult, pageSize) ||
      null;

    let api = null;
    let measurementMode = "mongo-only";
    if (probe?.ok && probe.api) {
      api = probe.api;
      measurementMode = probe.measurementMode || "api+mongo";
    } else if (mongoResult?.ok !== false && mongoResult?.ms != null) {
      // Proxy: mongo wall as API stand-in, clearly marked
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
        note: "API p50 proxied from Mongo wall-clock (controller probe not registered)",
      };
      measurementMode = "mongo-only";
    }

    const payload =
      probe?.payload ||
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

    const payloadBytesForFe = payload?.apiBytes ?? payload?.rawBytes ?? mongoResult?.payloadBytes;
    const frontend = frontendLayer(pageId, payloadBytesForFe, api?.rows ?? mongoResult?.rows);

    const gDb = gradeDatabase(database, { pageSize });
    const gApi = gradeApi(api);
    const gPay = gradePayload(payload || {});
    const gFe = gradeFrontend({
      ...frontend,
      reactQuery: frontend.reactQuery ? "Yes" : "No",
    });

    const grades = {
      database: gDb.grade,
      api: gApi.grade,
      payload: gPay.grade,
      frontend: gFe.grade,
      overall: computeOverallGrade({
        database: gDb.grade,
        api: gApi.grade,
        payload: gPay.grade,
        frontend: gFe.grade,
      }),
    };

    const layers = { database, api, payload, frontend };
    const primaryBottleneck = pickPrimaryBottleneck({ grades, layers });
    const breakdown = api?.breakdown || {};
    const share = timeSharePct({
      dbMs: breakdown.dbMs ?? database?.execMs,
      appMs: breakdown.appMs,
      serializeMs: breakdown.serializeMs,
    });

    pageBenchmarks.push({
      pageId,
      route: PAGE_ROUTES[pageId] || null,
      metricLabel,
      sharedBackendId: shared?.id || null,
      measurementMode,
      inheritedFrom: probe?.inheritedFrom || null,
      layers,
      grades,
      gradeReasons: {
        database: gDb.reason,
        api: gApi.reason,
        payload: gPay.reason,
        frontend: gFe.reason,
      },
      primaryBottleneck,
      timeSharePct: share,
      band: bandForGrade(grades.overall),
      optimizeRequired:
        grades.overall === "Critical" ||
        grades.overall === "D" ||
        grades.overall === "C"
          ? "YES"
          : "NO",
    });
  }

  const sharedOptimizations = SHARED_BACKENDS.map((group) => {
    const members = pageBenchmarks.filter((p) => group.pages.includes(p.pageId));
    if (!members.length) return null;
    const order = ["A+", "A", "B+", "B", "C", "D", "Critical"];
    const worstPage = members.reduce((acc, cur) => {
      const ai = order.indexOf(acc.grades.overall);
      const bi = order.indexOf(cur.grades.overall);
      return bi >= ai ? cur : acc;
    });

    return {
      id: group.id,
      api: group.api,
      controller: group.controller,
      pages: group.pages,
      bottleneck: worstPage.primaryBottleneck,
      overallGrade: worstPage.grades.overall,
      recommendation: group.recommendation,
      evidence: {
        database: worstPage.layers.database,
        api: worstPage.layers.api
          ? {
              p50Ms: worstPage.layers.api.p50Ms,
              payloadBytes: worstPage.layers.api.payloadBytes,
            }
          : null,
        payload: worstPage.layers.payload,
      },
    };
  }).filter(Boolean);

  return {
    ...raw,
    schemaVersion: 2,
    pageBenchmarks,
    sharedOptimizations,
    framework: {
      name: "Wisibility Application Performance Benchmark",
      version: 2,
      layers: ["database", "api", "payload", "frontend"],
    },
  };
}

export { analyzePayload };
