import mongoose from "mongoose";
import ApplicationUserInactiveAccess from "../../models/application/ApplicationUserInactiveAccess.js";
import ApplicationUserInactiveAccessState from "../../models/application/ApplicationUserInactiveAccessState.js";
import { isInactiveAppUserWithAccess } from "../../utils/datahygine/appUserInactiveWithAccess.js";
import {
  applicationIdInClause,
  normalizePrimaryKeyValue,
} from "../application/applicationUserIngestService.js";
import { normalizeHygieneSearchField } from "./hygieneFindingSearch.js";

/** Bump when {@link isInactiveAppUserWithAccess} semantics change. */
export const INACTIVE_ACCESS_PREDICATE_VERSION = 1;

const BULK_CHUNK = 500;
const WIDGET_ID = "inactiveUsersWithAccess";
const LOG_PREFIX = "[inactiveAccessSidecar]";

function toOid(id) {
  if (id == null || id === "") return null;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * @param {object} user
 * @param {string} [pkField]
 */
function primaryKeyNormFromUser(user, pkField) {
  if (pkField && user?.[pkField] != null) {
    return normalizePrimaryKeyValue(user[pkField]);
  }
  return (
    normalizePrimaryKeyValue(user?.user_id) ||
    normalizePrimaryKeyValue(user?.username) ||
    normalizePrimaryKeyValue(user?.email) ||
    null
  );
}

function searchFieldsFromUser(user, pkField) {
  const displayName = normalizeHygieneSearchField(
    user?.display_name ?? user?.displayName ?? user?.name,
  );
  const email = normalizeHygieneSearchField(user?.email);
  const account = normalizeHygieneSearchField(
    user?.[pkField] ?? user?.user_id ?? user?.username ?? user?.email,
  );
  const employeeId = normalizeHygieneSearchField(user?.employee_id ?? user?.employeeId);
  const searchText = [displayName, email, account, employeeId].filter(Boolean).join(" ");
  return {
    searchText: searchText.slice(0, 2000),
    searchDisplayName: displayName,
    searchEmail: email,
    searchAccount: account,
    searchEmployeeId: employeeId,
  };
}

async function markBuilt(tenantId, applicationId, hitCount, options = {}) {
  try {
    const { markHygieneRollupBuilt } = await import("./hygieneRollupService.js");
    await markHygieneRollupBuilt({
      tenantId,
      applicationId,
      widgetId: WIDGET_ID,
      sourceGeneration: options.sourceGeneration,
      count: hitCount,
      predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
      enqueueAssemble: !options.skipAssemble,
    });
  } catch (e) {
    console.error(LOG_PREFIX, "mark rollup built failed", e?.message || e);
  }
}

/**
 * Full rebuild of inactive-with-access sidecar for one application from live user docs.
 * @param {{ applicationId: import("mongoose").Types.ObjectId|string, tenantId: import("mongoose").Types.ObjectId|string, users: object[], pkField?: string, sourceGeneration?: number, skipAssemble?: boolean }} params
 */
export async function rebuildInactiveAccessSidecar(params) {
  const applicationId = toOid(params.applicationId);
  const tenantId = toOid(params.tenantId);
  if (!applicationId || !tenantId) return { hitCount: 0 };

  const appIdClause = applicationIdInClause(applicationId);
  const users = Array.isArray(params.users) ? params.users : [];
  const now = new Date();
  const hits = [];

  for (const user of users) {
    if (!user?._id || !isInactiveAppUserWithAccess(user)) continue;
    hits.push({
      tenantId,
      applicationId,
      userId: user._id,
      primaryKeyNormalized: primaryKeyNormFromUser(user, params.pkField),
      ...searchFieldsFromUser(user, params.pkField),
      predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
      observedAt: now,
    });
  }

  // Incremental: upsert desired, delete removed (avoid full deleteMany rewrite when possible).
  const existing = await ApplicationUserInactiveAccess.find({ applicationId: appIdClause })
    .select("userId")
    .lean();
  const desiredIds = new Set(hits.map((h) => String(h.userId)));
  const existingIds = new Set(existing.map((e) => String(e.userId)));

  const upsertOps = hits.map((row) => ({
    updateOne: {
      filter: { applicationId: appIdClause, userId: row.userId },
      update: { $set: row },
      upsert: true,
    },
  }));

  for (let i = 0; i < upsertOps.length; i += BULK_CHUNK) {
    const chunk = upsertOps.slice(i, i + BULK_CHUNK);
    if (chunk.length) {
      await ApplicationUserInactiveAccess.bulkWrite(chunk, { ordered: false });
    }
  }

  const toDelete = [...existingIds].filter((id) => !desiredIds.has(id));
  if (toDelete.length) {
    const oids = toDelete
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (oids.length) {
      await ApplicationUserInactiveAccess.deleteMany({
        applicationId: appIdClause,
        userId: { $in: oids },
      });
    }
  }

  await ApplicationUserInactiveAccessState.findOneAndUpdate(
    { applicationId },
    {
      $set: {
        tenantId,
        predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
        builtAt: now,
        hitCount: hits.length,
      },
    },
    { upsert: true },
  );

  await markBuilt(tenantId, applicationId, hits.length, params);
  return { hitCount: hits.length };
}

/**
 * Load live users and rebuild inactive-access sidecar (worker path).
 */
export async function rebuildInactiveAccessSidecarFromLiveUsers(params) {
  const applicationId = toOid(params.applicationId);
  const tenantId = toOid(params.tenantId);
  if (!applicationId || !tenantId) return { hitCount: 0 };

  const Application = (await import("../../models/application/Application.js")).default;
  const app = await Application.findById(applicationId).select("_id name tenantId").lean();
  if (!app?.name) return { hitCount: 0 };

  const { getDynamicUserModelForTenantId } = await import("../../models/application/Users.js");
  const UsersModel = await getDynamicUserModelForTenantId(app.name, tenantId);
  const users = await UsersModel.find({
    applicationId: applicationIdInClause(applicationId),
  }).lean();

  return rebuildInactiveAccessSidecar({
    applicationId,
    tenantId,
    users,
    sourceGeneration: params.sourceGeneration,
    skipAssemble: params.skipAssemble,
  });
}

/**
 * Incremental patch after partial ingest (skipFullReRead): upsert/delete for touched users; drop removed.
 * @param {{ applicationId: import("mongoose").Types.ObjectId|string, tenantId: import("mongoose").Types.ObjectId|string, users: object[], removedUserIds?: Array<string|import("mongoose").Types.ObjectId>, pkField?: string, sourceGeneration?: number, skipAssemble?: boolean }} params
 */
export async function patchInactiveAccessSidecar(params) {
  const applicationId = toOid(params.applicationId);
  const tenantId = toOid(params.tenantId);
  if (!applicationId || !tenantId) return;

  const appIdClause = applicationIdInClause(applicationId);
  const users = Array.isArray(params.users) ? params.users : [];
  const now = new Date();
  const upsertOps = [];
  const deleteUserIds = [];

  for (const user of users) {
    if (!user?._id) continue;
    if (isInactiveAppUserWithAccess(user)) {
      upsertOps.push({
        updateOne: {
          filter: { applicationId: appIdClause, userId: user._id },
          update: {
            $set: {
              tenantId,
              applicationId,
              userId: user._id,
              primaryKeyNormalized: primaryKeyNormFromUser(user, params.pkField),
              ...searchFieldsFromUser(user, params.pkField),
              predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
              observedAt: now,
            },
          },
          upsert: true,
        },
      });
    } else {
      deleteUserIds.push(user._id);
    }
  }

  for (const id of params.removedUserIds || []) {
    const oid = toOid(id);
    if (oid) deleteUserIds.push(oid);
  }

  for (let i = 0; i < upsertOps.length; i += BULK_CHUNK) {
    const chunk = upsertOps.slice(i, i + BULK_CHUNK);
    if (chunk.length) await ApplicationUserInactiveAccess.bulkWrite(chunk, { ordered: false });
  }
  if (deleteUserIds.length) {
    await ApplicationUserInactiveAccess.deleteMany({
      applicationId: appIdClause,
      userId: { $in: deleteUserIds },
    });
  }

  const hitCount = await ApplicationUserInactiveAccess.countDocuments({
    applicationId: appIdClause,
    predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
  });
  await ApplicationUserInactiveAccessState.findOneAndUpdate(
    { applicationId },
    {
      $set: {
        tenantId,
        predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
        builtAt: now,
        hitCount,
      },
    },
    { upsert: true },
  );

  await markBuilt(tenantId, applicationId, hitCount, params);
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function isInactiveAccessSidecarReady(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return false;
  const state = await ApplicationUserInactiveAccessState.findOne({
    applicationId: applicationIdInClause(oid),
  }).lean();
  return state?.predicateVersion === INACTIVE_ACCESS_PREDICATE_VERSION;
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function countInactiveAccessFromSidecar(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return 0;
  return ApplicationUserInactiveAccess.countDocuments({
    applicationId: applicationIdInClause(oid),
    predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
  });
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 * @param {number} skip
 * @param {number} limit
 * @param {string} [search]
 */
export async function listInactiveAccessUserIdsFromSidecar(
  applicationId,
  skip,
  limit,
  search,
) {
  const oid = toOid(applicationId);
  if (!oid) return { total: 0, userIds: [] };
  const filter = {
    applicationId: applicationIdInClause(oid),
    predicateVersion: INACTIVE_ACCESS_PREDICATE_VERSION,
  };
  const q = String(search || "")
    .trim()
    .toLowerCase();
  if (q) {
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`^${esc}`);
    filter.$or = [
      { searchDisplayName: rx },
      { searchEmail: rx },
      { searchAccount: rx },
      { searchEmployeeId: rx },
      { searchText: new RegExp(esc) },
      { primaryKeyNormalized: rx },
    ];
  }
  const [total, rows] = await Promise.all([
    ApplicationUserInactiveAccess.countDocuments(filter),
    ApplicationUserInactiveAccess.find(filter)
      .select("userId")
      .sort({ userId: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  return {
    total,
    userIds: rows.map((r) => r.userId).filter(Boolean),
  };
}

/**
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export async function deleteInactiveAccessSidecarForApplication(applicationId) {
  const oid = toOid(applicationId);
  if (!oid) return;
  const appIdClause = applicationIdInClause(oid);
  await Promise.all([
    ApplicationUserInactiveAccess.deleteMany({ applicationId: appIdClause }),
    ApplicationUserInactiveAccessState.deleteMany({ applicationId: appIdClause }),
  ]);
}
