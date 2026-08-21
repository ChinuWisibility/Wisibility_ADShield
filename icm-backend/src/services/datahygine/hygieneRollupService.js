import mongoose from "mongoose";
import HygieneAppRollup from "../../models/dataHygiene/HygieneAppRollup.js";
import { hygieneLog, hygieneMetricInc } from "./hygieneTelemetry.js";

const LOG_PREFIX = "[hygieneRollup]";

/**
 * Default widgets dirtied when application users / correlation change.
 */
export const DEFAULT_APP_DIRTY_WIDGETS = Object.freeze([
  "managerMismatches",
  "statusMismatches",
  "inactiveUsersWithAccess",
]);

function toOid(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function normalizeWidgetIds(widgetIds) {
  const list = Array.isArray(widgetIds) ? widgetIds : [];
  const out = [];
  const seen = new Set();
  for (const w of list) {
    const id = String(w || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Mark app×widget scopes dirty and bump sourceGeneration.
 * Optionally enqueues durable recompute jobs (Phase 2).
 *
 * @param {{
 *   tenantId: import("mongoose").Types.ObjectId|string,
 *   applicationId: import("mongoose").Types.ObjectId|string,
 *   widgetIds?: string[],
 *   reason?: string,
 *   enqueue?: boolean,
 * }} params
 * @returns {Promise<{ rollups: object[], sourceGenerations: Record<string, number> }>}
 */
export async function emitHygieneDirty(params) {
  const tenantId = toOid(params.tenantId);
  const applicationId = toOid(params.applicationId);
  if (!tenantId || !applicationId) {
    return { rollups: [], sourceGenerations: {} };
  }

  const widgetIds = normalizeWidgetIds(
    params.widgetIds?.length ? params.widgetIds : DEFAULT_APP_DIRTY_WIDGETS,
  );
  if (!widgetIds.length) return { rollups: [], sourceGenerations: {} };

  const reason = String(params.reason || "unspecified").slice(0, 200);
  const now = new Date();
  const enqueue = params.enqueue !== false;
  const rollups = [];
  /** @type {Record<string, number>} */
  const sourceGenerations = {};

  for (const widgetId of widgetIds) {
    const doc = await HygieneAppRollup.findOneAndUpdate(
      { tenantId, applicationId, widgetId },
      {
        $inc: { sourceGeneration: 1 },
        $set: {
          tenantId,
          applicationId,
          widgetId,
          dirty: true,
          status: "dirty",
          lastDirtyAt: now,
          lastError: null,
        },
        $push: {
          dirtyReasons: { $each: [reason], $slice: -10 },
        },
      },
      { upsert: true, new: true },
    ).lean();

    if (doc) {
      rollups.push(doc);
      sourceGenerations[widgetId] = doc.sourceGeneration || 0;
    }
  }

  hygieneMetricInc("hygiene.dirty.emit", widgetIds.length);
  hygieneLog("dirty_emit", {
    tenantId: String(tenantId),
    applicationId: String(applicationId),
    widgetIds,
    reason,
    sourceGenerations,
  });

  if (enqueue) {
    try {
      const { enqueueHygieneRecomputeJobs } = await import("./hygieneJobService.js");
      await enqueueHygieneRecomputeJobs({
        tenantId,
        applicationId,
        sourceGenerations,
        reason,
      });
    } catch (err) {
      console.error(LOG_PREFIX, "enqueue after dirty failed", err?.message || err);
    }
  }

  return { rollups, sourceGenerations };
}

/**
 * Mark a rollup built for a successful generation.
 * @param {{
 *   tenantId: import("mongoose").Types.ObjectId|string,
 *   applicationId: import("mongoose").Types.ObjectId|string,
 *   widgetId: string,
 *   sourceGeneration?: number|null,
 *   count?: number,
 *   predicateVersion?: number,
 *   enqueueAssemble?: boolean,
 * }} params
 */
export async function markHygieneRollupBuilt(params) {
  const tenantId = toOid(params.tenantId);
  const applicationId = toOid(params.applicationId);
  const widgetId = String(params.widgetId || "").trim();
  if (!tenantId || !applicationId || !widgetId) return null;

  const now = new Date();
  const existing = await HygieneAppRollup.findOne({
    tenantId,
    applicationId,
    widgetId,
  }).lean();

  const targetGen =
    params.sourceGeneration != null
      ? Number(params.sourceGeneration)
      : existing?.sourceGeneration ?? 0;

  // Do not clear dirty if a newer generation arrived while we were building.
  if (existing && (existing.sourceGeneration || 0) > targetGen) {
    await HygieneAppRollup.updateOne(
      { _id: existing._id },
      {
        $set: {
          count: params.count ?? existing.count ?? 0,
          predicateVersion: params.predicateVersion ?? existing.predicateVersion ?? 0,
          builtAt: now,
          status: "dirty",
          dirty: true,
        },
      },
    );
    hygieneLog("rollup_built_stale", {
      tenantId: String(tenantId),
      applicationId: String(applicationId),
      widgetId,
      builtGeneration: targetGen,
      sourceGeneration: existing.sourceGeneration,
    });
    return existing;
  }

  const doc = await HygieneAppRollup.findOneAndUpdate(
    { tenantId, applicationId, widgetId },
    {
      $set: {
        tenantId,
        applicationId,
        widgetId,
        dirty: false,
        status: "fresh",
        builtGeneration: targetGen,
        sourceGeneration: Math.max(existing?.sourceGeneration ?? 0, targetGen),
        count: params.count ?? 0,
        predicateVersion: params.predicateVersion ?? existing?.predicateVersion ?? 0,
        builtAt: now,
        lastError: null,
        dirtyReasons: [],
      },
    },
    { upsert: true, new: true },
  ).lean();

  hygieneMetricInc("hygiene.rollup.built");
  hygieneLog("rollup_built", {
    tenantId: String(tenantId),
    applicationId: String(applicationId),
    widgetId,
    sourceGeneration: targetGen,
    count: doc?.count,
  });

  if (params.enqueueAssemble !== false) {
    try {
      const { enqueueAssembleTenantSummary } = await import("./hygieneJobService.js");
      await enqueueAssembleTenantSummary({
        tenantId,
        reason: `rollup_built:${widgetId}`,
      });
    } catch (err) {
      console.error(LOG_PREFIX, "enqueue assemble failed", err?.message || err);
    }
  }

  return doc;
}

/**
 * @param {{
 *   tenantId: import("mongoose").Types.ObjectId|string,
 *   applicationId: import("mongoose").Types.ObjectId|string,
 *   widgetId: string,
 *   error: string,
 *   sourceGeneration?: number,
 * }} params
 */
export async function markHygieneRollupFailed(params) {
  const tenantId = toOid(params.tenantId);
  const applicationId = toOid(params.applicationId);
  const widgetId = String(params.widgetId || "").trim();
  if (!tenantId || !applicationId || !widgetId) return null;

  return HygieneAppRollup.findOneAndUpdate(
    { tenantId, applicationId, widgetId },
    {
      $set: {
        dirty: true,
        status: "failed",
        lastError: String(params.error || "unknown").slice(0, 1000),
      },
    },
    { upsert: true, new: true },
  ).lean();
}

/**
 * Mark rollup as processing (worker claimed job).
 */
export async function markHygieneRollupProcessing(params) {
  const tenantId = toOid(params.tenantId);
  const applicationId = toOid(params.applicationId);
  const widgetId = String(params.widgetId || "").trim();
  if (!tenantId || !applicationId || !widgetId) return null;

  return HygieneAppRollup.updateOne(
    { tenantId, applicationId, widgetId },
    { $set: { status: "processing" } },
  );
}

/**
 * Drop rollups for a deleted application.
 */
export async function deleteHygieneRollupsForApplication(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return 0;
  const r = await HygieneAppRollup.deleteMany({ applicationId: oid });
  return r.deletedCount || 0;
}

/**
 * Invalidate tenant summary snapshot so next read recomputes / reassembles.
 */
export async function invalidateHygieneTenantSummary(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return;
  const DataHygieneTenantSummary = (
    await import("../../models/dataHygiene/DataHygieneTenantSummary.js")
  ).default;
  await DataHygieneTenantSummary.deleteOne({ tenantId: tid });
}

/**
 * Build freshness snapshot from rollups for summary payload / status API.
 * @param {import("mongoose").Types.ObjectId|string} tenantId
 */
export async function getTenantHygieneFreshness(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) {
    return {
      assembledAt: null,
      status: "unknown",
      dirtyCount: 0,
      failedCount: 0,
      processingCount: 0,
      freshCount: 0,
      neverBuiltCount: 0,
      byWidget: {},
      byApplication: {},
    };
  }

  const rows = await HygieneAppRollup.find({ tenantId: tid }).lean();
  let dirtyCount = 0;
  let failedCount = 0;
  let processingCount = 0;
  let freshCount = 0;
  let neverBuiltCount = 0;
  /** @type {Record<string, { dirty: number, failed: number, processing: number, fresh: number }>} */
  const byWidget = {};
  /** @type {Record<string, { dirty: number, failed: number, status: string }>} */
  const byApplication = {};

  for (const row of rows) {
    const builtOk = (row.builtGeneration || 0) >= (row.sourceGeneration || 0) && !row.dirty;
    let status = row.status || "neverBuilt";
    if (status === "neverBuilt" && (row.sourceGeneration || 0) === 0 && (row.builtGeneration || 0) === 0) {
      neverBuiltCount += 1;
    } else if (status === "failed" || row.lastError) {
      failedCount += 1;
      status = "failed";
    } else if (status === "processing") {
      processingCount += 1;
    } else if (!builtOk || row.dirty) {
      dirtyCount += 1;
      status = "dirty";
    } else {
      freshCount += 1;
      status = "fresh";
    }

    const wid = row.widgetId || "unknown";
    if (!byWidget[wid]) {
      byWidget[wid] = { dirty: 0, failed: 0, processing: 0, fresh: 0 };
    }
    if (status === "failed") byWidget[wid].failed += 1;
    else if (status === "processing") byWidget[wid].processing += 1;
    else if (status === "dirty" || status === "neverBuilt") byWidget[wid].dirty += 1;
    else byWidget[wid].fresh += 1;

    const aid = String(row.applicationId);
    if (!byApplication[aid]) {
      byApplication[aid] = { dirty: 0, failed: 0, status: "fresh" };
    }
    if (status === "failed") {
      byApplication[aid].failed += 1;
      byApplication[aid].status = "failed";
    } else if (status === "dirty" || status === "processing" || status === "neverBuilt") {
      byApplication[aid].dirty += 1;
      if (byApplication[aid].status !== "failed") {
        byApplication[aid].status = status === "processing" ? "processing" : "dirty";
      }
    }
  }

  let status = "fresh";
  if (failedCount > 0) status = "failed";
  else if (processingCount > 0) status = "processing";
  else if (dirtyCount > 0 || neverBuiltCount > 0) status = "dirty";

  return {
    assembledAt: new Date().toISOString(),
    status,
    dirtyCount,
    failedCount,
    processingCount,
    freshCount,
    neverBuiltCount,
    totalRollups: rows.length,
    byWidget,
    byApplication,
  };
}

/**
 * Whether any tracked app×widget scopes are dirty for the tenant.
 */
export async function tenantHasDirtyHygieneRollups(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return false;
  const n = await HygieneAppRollup.countDocuments({
    tenantId: tid,
    $or: [
      { dirty: true },
      { status: { $in: ["dirty", "processing", "failed"] } },
      { $expr: { $lt: ["$builtGeneration", "$sourceGeneration"] } },
    ],
  });
  return n > 0;
}
