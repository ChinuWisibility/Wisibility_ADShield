import mongoose from "mongoose";
import DataHygieneTenantSummary from "../../models/dataHygiene/DataHygieneTenantSummary.js";
import { computeDataHygieneSummary } from "./datahygineService.js";
import {
  getTenantHygieneFreshness,
  tenantHasDirtyHygieneRollups,
} from "./hygieneRollupService.js";
import { enqueueAssembleTenantSummary } from "./hygieneJobService.js";
import { hygieneTiming } from "./hygieneTelemetry.js";

/** Bump when the summary payload shape changes (forces cold recompute on read). */
export const DATA_HYGIENE_SUMMARY_VERSION = 8;

/** Soft TTL: serve stale snapshot immediately and refresh in background. */
const SOFT_TTL_MS = 20 * 60 * 1000;

/** Debounce window for event-driven schedule (bursty sync/correlation). */
const SCHEDULE_DEBOUNCE_MS = 2000;

const LOG_PREFIX = "[dataHygieneSummaryCache]";

/** @type {Map<string, Promise<unknown>>} */
const inFlightRecomputes = new Map();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const scheduleTimers = new Map();

function toOid(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  const s = String(tenantId);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * @param {import("mongoose").Types.ObjectId | string} tenantId
 * @returns {Promise<object|null>}
 */
export async function getCachedDataHygieneSummary(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return null;
  return DataHygieneTenantSummary.findOne({ tenantId: tid }).lean();
}

/**
 * Attach / refresh freshness metadata on a payload.
 * @param {object} payload
 * @param {import("mongoose").Types.ObjectId} tid
 */
async function withFreshness(payload, tid) {
  const freshness = await getTenantHygieneFreshness(tid);
  if (payload && typeof payload === "object") {
    payload.freshness = freshness;
  }
  return { payload, freshness };
}

/**
 * Recompute live summary and upsert the tenant snapshot.
 * Coalesces concurrent recomputes for the same tenant.
 * @param {import("mongoose").Types.ObjectId | string} tenantId
 * @returns {Promise<object|null>}
 */
export async function recomputeDataHygieneSummary(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return null;

  const key = String(tid);
  const existing = inFlightRecomputes.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const t0 = Date.now();
    try {
      const raw = await computeDataHygieneSummary(tid);
      const { payload, freshness } = await withFreshness(raw, tid);
      const computedAt = payload?.computedAt ? new Date(payload.computedAt) : new Date();
      await DataHygieneTenantSummary.findOneAndUpdate(
        { tenantId: tid },
        {
          $set: {
            payload,
            computedAt,
            version: DATA_HYGIENE_SUMMARY_VERSION,
            freshness,
          },
        },
        { upsert: true, new: true },
      );
      const ms = Date.now() - t0;
      let payloadBytes = 0;
      try {
        payloadBytes = Buffer.byteLength(JSON.stringify(payload));
      } catch {
        /* ignore */
      }
      hygieneTiming("hygiene.summary.recompute", ms);
      console.info(
        LOG_PREFIX,
        `recompute tenant=${key} ms=${ms} payloadBytes=${payloadBytes}`,
      );
      return payload;
    } catch (err) {
      console.error(LOG_PREFIX, "recompute failed", err?.message || err);
      throw err;
    } finally {
      inFlightRecomputes.delete(key);
    }
  })();

  inFlightRecomputes.set(key, promise);
  return promise;
}

/**
 * Fire-and-forget recompute via durable assemble job + interim debounce fallback.
 * @param {import("mongoose").Types.ObjectId | string} tenantId
 */
export function scheduleDataHygieneSummaryRecompute(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return;

  void enqueueAssembleTenantSummary({
    tenantId: tid,
    reason: "schedule_summary",
  }).catch((err) =>
    console.error(LOG_PREFIX, "enqueue assemble failed", err?.message || err),
  );

  const key = String(tid);
  const prev = scheduleTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    scheduleTimers.delete(key);
    setImmediate(() => {
      void recomputeDataHygieneSummary(tid).catch((err) =>
        console.error(LOG_PREFIX, "scheduled recompute failed", err?.message || err),
      );
    });
  }, SCHEDULE_DEBOUNCE_MS);
  scheduleTimers.set(key, timer);
}

/**
 * Start recompute immediately (no debounce). Used for Refresh SWR.
 * @param {import("mongoose").Types.ObjectId | string} tenantId
 */
export function startDataHygieneSummaryRecompute(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return;
  const key = String(tid);
  const prev = scheduleTimers.get(key);
  if (prev) {
    clearTimeout(prev);
    scheduleTimers.delete(key);
  }

  setImmediate(() => {
    void recomputeDataHygieneSummary(tid).catch((err) =>
      console.error(LOG_PREFIX, "immediate recompute failed", err?.message || err),
    );
  });
}

/**
 * Fast path for GET /summary: serve snapshot when warm; recompute on miss / force.
 *
 * @param {import("mongoose").Types.ObjectId | string} tenantId
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ payload: object, meta: object|null }>}
 */
export async function getDataHygieneSummaryFast(tenantId, options = {}) {
  const tid = toOid(tenantId);
  if (!tid) {
    throw new Error("Valid tenantId is required");
  }

  const forceRefresh = options.forceRefresh === true;
  const t0 = Date.now();
  const cached = await getCachedDataHygieneSummary(tid);
  hygieneTiming("hygiene.summary.read", Date.now() - t0);

  const versionOk = cached?.version === DATA_HYGIENE_SUMMARY_VERSION;
  const hasPayload = cached?.payload != null && typeof cached.payload === "object";

  const attachLiveFreshness = async (payload) => {
    if (!payload || typeof payload !== "object") return payload;
    if (payload.freshness) return payload;
    const freshness = await getTenantHygieneFreshness(tid);
    return { ...payload, freshness };
  };

  if (forceRefresh) {
    if (versionOk && hasPayload) {
      startDataHygieneSummaryRecompute(tid);
      const payload = await attachLiveFreshness(cached.payload);
      return {
        payload,
        meta: {
          staleWhileRevalidate: true,
          refreshStarted: true,
          previousComputedAt: cached.payload?.computedAt ?? cached.computedAt ?? null,
          freshness: payload?.freshness ?? cached.freshness ?? null,
        },
      };
    }
    const payload = await recomputeDataHygieneSummary(tid);
    return {
      payload,
      meta: {
        staleWhileRevalidate: false,
        refreshStarted: false,
        freshness: payload?.freshness ?? null,
      },
    };
  }

  if (versionOk && hasPayload) {
    const ageMs = cached.computedAt
      ? Date.now() - new Date(cached.computedAt).getTime()
      : Number.POSITIVE_INFINITY;
    const hasDirty = await tenantHasDirtyHygieneRollups(tid);
    if (ageMs > SOFT_TTL_MS || hasDirty) {
      scheduleDataHygieneSummaryRecompute(tid);
    }
    const payload = await attachLiveFreshness(cached.payload);
    return {
      payload,
      meta: {
        freshness: payload?.freshness ?? cached.freshness ?? null,
      },
    };
  }

  const payload = await recomputeDataHygieneSummary(tid);
  return { payload, meta: { freshness: payload?.freshness ?? null } };
}

/**
 * Light freshness polling endpoint helper.
 */
export async function getDataHygieneSummaryStatus(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) throw new Error("Valid tenantId is required");
  const cached = await getCachedDataHygieneSummary(tid);
  const freshness = await getTenantHygieneFreshness(tid);
  return {
    computedAt: cached?.computedAt ?? cached?.payload?.computedAt ?? null,
    version: cached?.version ?? null,
    freshness,
  };
}
