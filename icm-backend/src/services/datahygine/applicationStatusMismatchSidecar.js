import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import ApplicationStatusMismatch from "../../models/application/ApplicationStatusMismatch.js";
import ApplicationStatusMismatchState from "../../models/application/ApplicationStatusMismatchState.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import { applicationIdInClause } from "../application/applicationUserIngestService.js";
import { buildHygieneFindingSearchFields } from "./hygieneFindingSearch.js";
import { hygieneMetricInc, hygieneTiming } from "./hygieneTelemetry.js";

/**
 * Bump when status-mismatch compare semantics change (forces rebuild).
 * Keep in sync with live collectStatusMismatchRecordsForApplication behavior.
 */
export const STATUS_MISMATCH_PREDICATE_VERSION = 2;

const BULK_CHUNK = 500;
const SCHEDULE_DEBOUNCE_MS = 2000;
const LOG_PREFIX = "[statusMismatchSidecar]";
const WIDGET_ID = "statusMismatches";

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const scheduleTimers = new Map();
/** @type {Map<string, Promise<unknown>>} */
const inFlight = new Map();

function toOid(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function appKey(applicationId) {
  return String(applicationId);
}

function subjectKey(identityId, accountId) {
  return `${String(identityId || "")}\0${accountId != null ? String(accountId) : ""}`;
}

function rowFromItem(tid, applicationId, item, now) {
  const identityId = String(item.identityId || "");
  const accountId = item.accountId != null ? String(item.accountId) : "";
  const search = buildHygieneFindingSearchFields(item);
  return {
    tenantId: tid,
    applicationId,
    identityId,
    accountId,
    mismatchType: search.mismatchType,
    item,
    searchText: search.searchText,
    searchDisplayName: search.searchDisplayName,
    searchEmail: search.searchEmail,
    searchAccount: search.searchAccount,
    searchEmployeeId: search.searchEmployeeId,
    predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
    observedAt: now,
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Incremental upsert/delete by (identityId, accountId).
 * @param {import("mongoose").Types.ObjectId|string} tenantId
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @param {{ sourceGeneration?: number, skipAssemble?: boolean }} [options]
 */
export async function rebuildStatusMismatchSidecarForApplication(
  tenantId,
  application,
  options = {},
) {
  const tid = toOid(tenantId);
  const applicationId = toOid(application?._id);
  if (!tid || !applicationId || !application?.name) return { hitCount: 0 };

  const key = appKey(applicationId);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const t0 = Date.now();
    let added = 0;
    let removed = 0;
    try {
      const { collectStatusMismatchRecordsForApplication } = await import(
        "./datahygineService.js"
      );
      const IdentityModel = await getDynamicIdentityModelForTenantId(tid);
      const applicationLabel = application.name || "Application";
      const { items, total } = await collectStatusMismatchRecordsForApplication(
        tid,
        application,
        applicationLabel,
        IdentityModel,
        { includeItems: true },
      );

      const appIdClause = applicationIdInClause(applicationId);
      const now = new Date();
      const desired = new Map();
      for (const item of items || []) {
        const identityId = String(item.identityId || "");
        const accountId = item.accountId != null ? String(item.accountId) : "";
        desired.set(subjectKey(identityId, accountId), rowFromItem(tid, applicationId, item, now));
      }

      const existingRows = await ApplicationStatusMismatch.find({
        applicationId: appIdClause,
      })
        .select("identityId accountId")
        .lean();

      const existingKeys = new Set(
        existingRows.map((r) => subjectKey(r.identityId, r.accountId)),
      );

      const upsertOps = [];
      for (const [sk, row] of desired.entries()) {
        upsertOps.push({
          updateOne: {
            filter: {
              applicationId: appIdClause,
              identityId: row.identityId,
              accountId: row.accountId,
            },
            update: { $set: row },
            upsert: true,
          },
        });
        if (!existingKeys.has(sk)) added += 1;
      }

      const deleteKeys = [];
      for (const r of existingRows) {
        const sk = subjectKey(r.identityId, r.accountId);
        if (!desired.has(sk)) {
          deleteKeys.push({ identityId: r.identityId, accountId: r.accountId ?? "" });
          removed += 1;
        }
      }

      for (let i = 0; i < upsertOps.length; i += BULK_CHUNK) {
        const chunk = upsertOps.slice(i, i + BULK_CHUNK);
        if (chunk.length) {
          await ApplicationStatusMismatch.bulkWrite(chunk, { ordered: false });
        }
      }

      if (deleteKeys.length) {
        for (let i = 0; i < deleteKeys.length; i += BULK_CHUNK) {
          const chunk = deleteKeys.slice(i, i + BULK_CHUNK);
          await ApplicationStatusMismatch.deleteMany({
            applicationId: appIdClause,
            $or: chunk.map((k) => ({
              identityId: k.identityId,
              accountId: k.accountId,
            })),
          });
        }
      }

      const hitCount =
        typeof total === "number"
          ? total
          : await ApplicationStatusMismatch.countDocuments({
              applicationId: appIdClause,
              predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
            });

      await ApplicationStatusMismatchState.findOneAndUpdate(
        { applicationId },
        {
          $set: {
            tenantId: tid,
            predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
            builtAt: now,
            hitCount,
          },
        },
        { upsert: true },
      );

      try {
        const { markHygieneRollupBuilt } = await import(
          "./hygieneRollupService.js"
        );
        await markHygieneRollupBuilt({
          tenantId: tid,
          applicationId,
          widgetId: WIDGET_ID,
          sourceGeneration: options.sourceGeneration,
          count: hitCount,
          predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
          enqueueAssemble: !options.skipAssemble,
        });
      } catch (e) {
        console.error(LOG_PREFIX, "mark rollup built failed", e?.message || e);
      }

      hygieneMetricInc("hygiene.findings.added", added);
      hygieneMetricInc("hygiene.findings.removed", removed);
      hygieneTiming("hygiene.sidecar.status", Date.now() - t0);
      console.info(
        LOG_PREFIX,
        `rebuild app=${application.name} hits=${hitCount} added=${added} removed=${removed} ms=${Date.now() - t0}`,
      );
      return { hitCount, added, removed };
    } catch (err) {
      console.error(LOG_PREFIX, "rebuild failed", application?.name, err?.message || err);
      try {
        const { markHygieneRollupFailed } = await import(
          "./hygieneRollupService.js"
        );
        await markHygieneRollupFailed({
          tenantId: tid,
          applicationId,
          widgetId: WIDGET_ID,
          error: err?.message || String(err),
          sourceGeneration: options.sourceGeneration,
        });
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Rebuild sidecars for every non-authoritative application in a tenant.
 * @param {import("mongoose").Types.ObjectId|string} tenantId
 */
export async function rebuildStatusMismatchSidecarsForTenant(tenantId) {
  const tid = toOid(tenantId);
  if (!tid) return { apps: 0, hits: 0 };
  const apps = await Application.find({
    tenantId: tid,
    authoritativeSource: { $ne: true },
  })
    .select("_id name")
    .lean();
  let hits = 0;
  for (const app of apps) {
    const r = await rebuildStatusMismatchSidecarForApplication(tid, app);
    hits += r?.hitCount || 0;
  }
  return { apps: apps.length, hits };
}

/**
 * Debounced per-app rebuild — emits dirty + durable job.
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 * @param {import("mongoose").Types.ObjectId|string} tenantId
 * @param {{ skipDirtyEmit?: boolean }} [options]
 */
export function scheduleStatusMismatchSidecarRebuild(applicationId, tenantId, options = {}) {
  const appOid = toOid(applicationId);
  const tid = toOid(tenantId);
  if (!appOid || !tid) return;

  if (!options.skipDirtyEmit) {
    void (async () => {
      try {
        const { emitHygieneDirty } = await import("./hygieneRollupService.js");
        await emitHygieneDirty({
          tenantId: tid,
          applicationId: appOid,
          widgetIds: [WIDGET_ID],
          reason: "schedule_status_mismatch",
        });
      } catch (err) {
        console.error(LOG_PREFIX, "emit dirty failed", err?.message || err);
      }
    })();
  }

  const key = appKey(appOid);
  const prev = scheduleTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    scheduleTimers.delete(key);
    setImmediate(() => {
      void (async () => {
        const app = await Application.findById(appOid)
          .select("_id name authoritativeSource")
          .lean();
        if (!app || app.authoritativeSource) return;
        await rebuildStatusMismatchSidecarForApplication(tid, app);
      })().catch((err) =>
        console.error(LOG_PREFIX, "scheduled rebuild failed", err?.message || err),
      );
    });
  }, SCHEDULE_DEBOUNCE_MS);
  scheduleTimers.set(key, timer);
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function isStatusMismatchSidecarReady(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return false;
  const state = await ApplicationStatusMismatchState.findOne({
    applicationId: applicationIdInClause(oid),
  }).lean();
  return state?.predicateVersion === STATUS_MISMATCH_PREDICATE_VERSION;
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function countStatusMismatchesFromSidecar(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return 0;
  const state = await ApplicationStatusMismatchState.findOne({
    applicationId: applicationIdInClause(oid),
  })
    .select("hitCount predicateVersion")
    .lean();
  if (state?.predicateVersion === STATUS_MISMATCH_PREDICATE_VERSION) {
    return state.hitCount || 0;
  }
  return ApplicationStatusMismatch.countDocuments({
    applicationId: applicationIdInClause(oid),
    predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
  });
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 * @param {number} skip
 * @param {number} limit
 * @param {string} [search]
 */
export async function listStatusMismatchItemsFromSidecar(
  applicationId,
  skip,
  limit,
  search,
) {
  const oid = toOid(applicationId);
  if (!oid) return { items: [], total: 0 };
  const filter = {
    applicationId: applicationIdInClause(oid),
    predicateVersion: STATUS_MISMATCH_PREDICATE_VERSION,
  };
  const q = String(search || "")
    .trim()
    .toLowerCase();
  if (q) {
    const rx = new RegExp(`^${escapeRegex(q)}`);
    filter.$or = [
      { searchDisplayName: rx },
      { searchEmail: rx },
      { searchAccount: rx },
      { searchEmployeeId: rx },
      { searchText: new RegExp(escapeRegex(q)) },
    ];
  }
  const [total, rows] = await Promise.all([
    ApplicationStatusMismatch.countDocuments(filter),
    ApplicationStatusMismatch.find(filter)
      .select("item")
      .sort({ searchDisplayName: 1, identityId: 1, accountId: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  return {
    total,
    items: rows.map((r) => r.item).filter(Boolean),
  };
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function deleteStatusMismatchSidecarForApplication(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return;
  const appIdClause = applicationIdInClause(oid);
  await Promise.all([
    ApplicationStatusMismatch.deleteMany({ applicationId: appIdClause }),
    ApplicationStatusMismatchState.deleteMany({ applicationId: appIdClause }),
  ]);
}
