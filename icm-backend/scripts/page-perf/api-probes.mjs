/**
 * Layer 2 API probes — invoke the same controllers the frontend uses.
 * Failures are captured; suite continues (mongo layer remains source of truth for that page).
 */
import mongoose from "mongoose";
import { createAdminRequest, createMockResponse } from "./lib/mock-http.mjs";
import { sampleAsync } from "./lib/timing.mjs";
import { bytesOf } from "./lib/bytes.mjs";
import { analyzePayload } from "./lib/payload.mjs";
import { explainFind } from "./lib/explain.mjs";
import { PAGE_FE } from "./catalog.mjs";

async function invoke(handler, req) {
  const res = createMockResponse();
  await handler(req, res);
  return res.result();
}

/**
 * @returns {Promise<Record<string, object>>} keyed by pageId / probe name
 */
export async function runApiProbes({ tenantId, db, pageSize = 10 }) {
  const probes = {};
  const tid = new mongoose.Types.ObjectId(tenantId);

  // --- All Identities (UI default sort + compact fields) ---
  try {
    const { getIdentities, buildIdentityListSort } = await import(
      "../../src/controllers/identity/identityController.js"
    );
    const { getDynamicIdentityModelForTenantId } = await import(
      "../../src/models/identity/Identity.js"
    );
    const Identity = await getDynamicIdentityModelForTenantId(tid);
    const fe = PAGE_FE.AllIdentities;
    const fields = fe.listFieldsHint;
    const sort = buildIdentityListSort(fe.uiSort.sortBy, fe.uiSort.sortDir);

    const explain = await Identity.find({ tenantId: tid })
      .sort(sort)
      .limit(pageSize)
      .lean()
      .explain("executionStats");
    const { summarizeExplain } = await import("./lib/explain.mjs");
    const dbExplain = summarizeExplain(explain);

    const mongoRows = await Identity.find({ tenantId: tid }).sort(sort).limit(pageSize).lean();
    const rawPayload = analyzePayload(mongoRows, {
      listFields: fields.split(",").concat(["_id", "tenantId", "lifecycleState", "updatedAt"]),
    });

    const runFull = async () =>
      invoke(
        getIdentities,
        createAdminRequest({
          tenantId,
          query: {
            page: 0,
            limit: pageSize,
            sortBy: fe.uiSort.sortBy,
            sortDir: fe.uiSort.sortDir,
          },
        }),
      );

    const runCompact = async () =>
      invoke(
        getIdentities,
        createAdminRequest({
          tenantId,
          query: {
            page: 0,
            limit: pageSize,
            sortBy: fe.uiSort.sortBy,
            sortDir: fe.uiSort.sortDir,
            fields,
          },
        }),
      );

    const fullSample = await sampleAsync(runFull, { warmups: 2, samples: 8 });
    const compactSample = await sampleAsync(runCompact, { warmups: 2, samples: 8 });

    const fullLast = fullSample.last;
    const compactLast = compactSample.last;
    const dbMs = dbExplain?.execMs ?? 0;
    const serializeMs = compactLast.serializeMs || 0;
    const p50 = compactSample.latency.p50Ms;
    const appMs = Math.max(0, (p50 || 0) - dbMs - serializeMs);

    probes.AllIdentities = {
      ok: fullLast.statusCode === 200 && compactLast.statusCode === 200,
      measurementMode: "api+mongo",
      route: "GET /identities",
      controller: "identityController.getIdentities",
      database: dbExplain,
      api: {
        p50Ms: compactSample.latency.p50Ms,
        p95Ms: compactSample.latency.p95Ms,
        minMs: compactSample.latency.minMs,
        maxMs: compactSample.latency.maxMs,
        status: compactLast.statusCode,
        payloadBytes: compactLast.payloadBytes,
        fullPayloadBytes: fullLast.payloadBytes,
        rows: compactLast.payload?.data?.length ?? 0,
        listTotal: compactLast.payload?.listTotal ?? null,
        breakdown: {
          dbMs,
          serializeMs: Number(serializeMs.toFixed(2)),
          appMs: Number(appMs.toFixed(2)),
        },
        note: "p50 uses compact fields (UI path); fullPayloadBytes is contract-default without fields",
      },
      payload: {
        ...rawPayload,
        apiBytes: compactLast.payloadBytes,
        rawBytes: fullLast.payloadBytes,
        projectedBytes: rawPayload.projectedBytes,
        potentialSavingsPct:
          fullLast.payloadBytes > 0
            ? Math.round(
                ((fullLast.payloadBytes - compactLast.payloadBytes) / fullLast.payloadBytes) * 1000,
              ) / 10
            : 0,
      },
      mongoWallMs: null,
    };

    // Alias for shared consumers of the same API
    probes.PeerComparison = { ...probes.AllIdentities, inheritedFrom: "AllIdentities" };
    probes.IdentityPosture = { ...probes.AllIdentities, inheritedFrom: "AllIdentities" };
  } catch (err) {
    probes.AllIdentities = { ok: false, error: err.message, measurementMode: "mongo-only" };
  }

  // --- Applications (projected list) ---
  try {
    const mod = await import("../../src/controllers/application/applicationController.js").catch(() => null);
    const handler = mod?.getApplications || mod?.listApplications;
    if (handler) {
      const sample = await sampleAsync(
        () =>
          invoke(
            handler,
            createAdminRequest({ tenantId, query: { page: 0, limit: pageSize } }),
          ),
        { warmups: 1, samples: 5 },
      );
      const last = sample.last;
      const explain = await explainFind(db.collection("applications"), { tenantId: tid }, {
        sort: { updatedAt: -1 },
        limit: pageSize,
      });
      probes.Applications = {
        ok: last.statusCode === 200,
        measurementMode: "api+mongo",
        route: "GET /applications",
        controller: "applicationController.getApplications",
        database: explain,
        api: {
          p50Ms: sample.latency.p50Ms,
          p95Ms: sample.latency.p95Ms,
          status: last.statusCode,
          payloadBytes: last.payloadBytes,
          rows: last.payload?.data?.length ?? last.payload?.applications?.length ?? 0,
          breakdown: {
            dbMs: explain?.execMs ?? 0,
            serializeMs: Number((last.serializeMs || 0).toFixed(2)),
            appMs: Math.max(
              0,
              Number(((sample.latency.p50Ms || 0) - (explain?.execMs || 0) - (last.serializeMs || 0)).toFixed(2)),
            ),
          },
        },
        payload: analyzePayload(last.payload?.data || last.payload?.applications || [], {
          apiBytes: last.payloadBytes,
        }),
      };
    }
  } catch (err) {
    probes.Applications = { ok: false, error: err.message };
  }

  // --- Identity profiles ---
  try {
    const mod = await import("../../src/controllers/identity/identityProfileController.js").catch(() => null);
    const handler = mod?.getIdentityProfiles || mod?.listIdentityProfiles;
    if (handler) {
      const sample = await sampleAsync(
        () =>
          invoke(handler, createAdminRequest({ tenantId, query: { limit: pageSize } })),
        { warmups: 1, samples: 5 },
      );
      const last = sample.last;
      probes.IdentityProfiles = {
        ok: last.statusCode === 200,
        measurementMode: "api+mongo",
        route: "GET /identity-profiles",
        controller: "identityProfileController",
        api: {
          p50Ms: sample.latency.p50Ms,
          p95Ms: sample.latency.p95Ms,
          status: last.statusCode,
          payloadBytes: last.payloadBytes,
          rows: last.payload?.data?.length ?? 0,
          breakdown: {
            dbMs: null,
            serializeMs: Number((last.serializeMs || 0).toFixed(2)),
            appMs: null,
          },
        },
        payload: { apiBytes: last.payloadBytes, rawBytes: last.payloadBytes },
      };
    }
  } catch (err) {
    probes.IdentityProfiles = { ok: false, error: err.message };
  }

  // --- Access cert campaigns (payload hotspot) ---
  try {
    const mod = await import("../../src/controllers/access-certification/campaignController.js").catch(() => null);
    const handler = mod?.getAllCampaigns || mod?.listCampaigns;
    if (handler) {
      const sample = await sampleAsync(
        () => invoke(handler, createAdminRequest({ tenantId, query: {} })),
        { warmups: 1, samples: 3 },
      );
      const last = sample.last;
      const rows = last.payload?.data || last.payload?.campaigns || [];
      const thinFields = ["_id", "name", "status", "tenantId", "createdAt", "updatedAt", "type", "startDate", "endDate"];
      const payload = analyzePayload(rows, { listFields: thinFields, apiBytes: last.payloadBytes });
      probes.AccessCertification = {
        ok: last.statusCode === 200,
        measurementMode: "api+mongo",
        route: "GET /access-certification/campaigns",
        controller: "campaignController.getAllCampaigns",
        api: {
          p50Ms: sample.latency.p50Ms,
          p95Ms: sample.latency.p95Ms,
          status: last.statusCode,
          payloadBytes: last.payloadBytes,
          rows: Array.isArray(rows) ? rows.length : 0,
          breakdown: {
            dbMs: null,
            serializeMs: Number((last.serializeMs || 0).toFixed(2)),
            appMs: null,
          },
        },
        payload,
      };
    }
  } catch (err) {
    probes.AccessCertification = { ok: false, error: err.message };
  }

  // --- Data hygiene summary: warm snapshot hit vs forced refresh ---
  try {
    const cacheMod = await import("../../src/services/datahygine/dataHygieneSummaryCacheService.js");
    const { getDataHygieneSummaryFast, recomputeDataHygieneSummary } = cacheMod;

    // Ensure a warm snapshot exists, then measure cache hit.
    await recomputeDataHygieneSummary(tid);

    const hitSample = await sampleAsync(async () => {
      const t0 = process.hrtime.bigint();
      const result = await getDataHygieneSummaryFast(tid, { forceRefresh: false });
      const summary = result?.payload ?? result;
      const serializeT0 = process.hrtime.bigint();
      const serialized = JSON.stringify(summary);
      const serializeMs = Number(process.hrtime.bigint() - serializeT0) / 1e6;
      return {
        statusCode: 200,
        payload: summary,
        serialized,
        serializeMs,
        payloadBytes: Buffer.byteLength(serialized),
        _totalMs: Number(process.hrtime.bigint() - t0) / 1e6,
      };
    }, { warmups: 1, samples: 3 });

    const refreshSample = await sampleAsync(async () => {
      const t0 = process.hrtime.bigint();
      const result = await getDataHygieneSummaryFast(tid, { forceRefresh: true });
      const summary = result?.payload ?? result;
      const serializeT0 = process.hrtime.bigint();
      const serialized = JSON.stringify(summary);
      const serializeMs = Number(process.hrtime.bigint() - serializeT0) / 1e6;
      return {
        statusCode: 200,
        payload: summary,
        serialized,
        serializeMs,
        payloadBytes: Buffer.byteLength(serialized),
        _totalMs: Number(process.hrtime.bigint() - t0) / 1e6,
        meta: result?.meta ?? null,
      };
    }, { warmups: 0, samples: 1 });

    const hit = hitSample.last;
    const refresh = refreshSample.last;
    probes.DataHygiene = {
      ok: true,
      measurementMode: "api+mongo",
      route: "GET /data-hygiene/summary",
      controller: "dataHygieneSummaryCacheService.getDataHygieneSummaryFast",
      api: {
        p50Ms: hitSample.latency.p50Ms,
        p95Ms: hitSample.latency.p95Ms,
        status: 200,
        payloadBytes: hit.payloadBytes,
        rows: 1,
        breakdown: {
          dbMs: null,
          serializeMs: Number((hit.serializeMs || 0).toFixed(2)),
          appMs: hitSample.latency.p50Ms,
        },
      },
      cacheHit: {
        p50Ms: hitSample.latency.p50Ms,
        p95Ms: hitSample.latency.p95Ms,
        payloadBytes: hit.payloadBytes,
      },
      forceRefresh: {
        p50Ms: refreshSample.latency.p50Ms,
        p95Ms: refreshSample.latency.p95Ms,
        payloadBytes: refresh.payloadBytes,
      },
      payload: { apiBytes: hit.payloadBytes, rawBytes: hit.payloadBytes },
    };
  } catch (err) {
    probes.DataHygiene = { ok: false, error: err.message };
  }

  return probes;
}

export { bytesOf };
