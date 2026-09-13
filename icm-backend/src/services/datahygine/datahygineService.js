/**
 * Tenant-scoped hygiene counts: OrphanAccount + Identity + Application use `tenantId`;
 * Inactive-with-access scans per-app `app_iga_<tenant>_<app>_users` for inactive status + entitlements.
 */
import mongoose from "mongoose";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import SodPolicy from "../../models/sod/SodPolicy.js";
import SodViolation from "../../models/sod/SodViolation.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import Application from "../../models/application/Application.js";
import ApplicationUserDuplicate from "../../models/application/ApplicationUserDuplicate.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import { applicationIdInClause } from "../application/applicationUserIngestService.js";
import {
  countInactiveAccessFromSidecar,
  isInactiveAccessSidecarReady,
  listInactiveAccessUserIdsFromSidecar,
  rebuildInactiveAccessSidecar,
} from "./applicationUserInactiveAccessSidecar.js";
import {
  countManagerMismatchesFromSidecar,
  isManagerMismatchSidecarReady,
  listManagerMismatchItemsFromSidecar,
  rebuildManagerMismatchSidecarForApplication,
} from "./applicationManagerMismatchSidecar.js";
import {
  enrichOrphanRowsForDisplay,
  orphanDisplayFromCorrelationKey,
} from "../../utils/datahygine/orphanAccountDisplayEnrichment.js";
import {
  getAppEntitlementsCollectionName,
  getAppCorrelationCollectionName,
  getAppUsersCollectionName,
  resolveTenantSlugFromTenantId,
} from "../../utils/applicationDynamicCollections.js";
import {
  isAppUserInactiveForHygiene,
  isInactiveAppUserWithAccess,
  mapAppUserToInactiveAccessHygieneItem,
  pickAppUserAccountStatusDisplay,
} from "../../utils/datahygine/appUserInactiveWithAccess.js";
import { summarizeDuplicateAccountForDisplay } from "../../utils/datahygine/duplicateAccountDisplayEnrichment.js";
import {
  APPLICATION_TILE_EXCLUDED_WIDGET_IDS,
  MAX_WIDGET_DETAIL_PAGE_SIZE,
  WIDGET_ITEM_KEYS,
} from "./widgetKeys.js";
import {
  countStatusMismatchesFromSidecar,
  isStatusMismatchSidecarReady,
  listStatusMismatchItemsFromSidecar,
  rebuildStatusMismatchSidecarForApplication,
} from "./applicationStatusMismatchSidecar.js";

const MAX_ROWS_PER_WIDGET = 25;
const MANAGER_MISMATCH_APP_MANAGER_NAME_FIELDS = Object.freeze([
  "manager_name",
  "managerName",
  "manager",
]);
const MANAGER_MISMATCH_APP_MANAGER_EMAIL_FIELDS = Object.freeze([
  "manager_email",
  "managerEmail",
]);
const MANAGER_MISMATCH_APP_MANAGER_REFERENCE_FIELDS = Object.freeze([
  "manager_login",
  "managerLogin",
  "manager_id",
  "managerId",
  "managerid",
]);
const MANAGER_MISMATCH_APP_MANAGER_FIELDS = Object.freeze([
  ...MANAGER_MISMATCH_APP_MANAGER_NAME_FIELDS,
  ...MANAGER_MISMATCH_APP_MANAGER_EMAIL_FIELDS,
  ...MANAGER_MISMATCH_APP_MANAGER_REFERENCE_FIELDS,
]);
const MANAGER_MISMATCH_IDENTITY_MANAGER_NAME_FIELDS = Object.freeze([
  "managerName",
  "managername",
  "manager_name",
  "manager",
]);
const MANAGER_MISMATCH_IDENTITY_MANAGER_EMAIL_FIELDS = Object.freeze([
  "managerEmail",
  "manageremail",
  "manager_email",
]);
const MANAGER_MISMATCH_IDENTITY_MANAGER_REFERENCE_FIELDS = Object.freeze([
  "managerEmployeeId",
  "manageremployeeid",
  "manager_id",
  "managerId",
  "managerid",
]);

/** Account-id fields used to resolve IdentityAccountLink.accountId → app user (same as correlation loader). */
const MANAGER_MISMATCH_LINKABLE_USER_FIELDS = Object.freeze([
  "user_id",
  "username",
  "email",
  "nativeAccountId",
  "gh_login",
  "employee_id",
]);

const MANAGER_MISMATCH_QUERY_CHUNK = 500;
/** Prefer one $in when under this size (remote Mongo round-trips dominate sequential chunks). */
const MANAGER_MISMATCH_SINGLE_IN_MAX = 2500;
const MANAGER_MISMATCH_CHUNK_CONCURRENCY = 4;

const MANAGER_MISMATCH_IDENTITY_COUNT_SELECT =
  "managerId managerEmail managerEmployeeId managerKeyRaw manager attributes";
const MANAGER_MISMATCH_IDENTITY_ITEM_SELECT =
  "displayName firstName lastName email employeeId lifecycleState identityType managerId managerEmail managerEmployeeId managerKeyRaw manager attributes";

const STATUS_MISMATCH_IDENTITY_INACTIVE = new Set([
  "INACTIVE",
  "LEAVER",
  "TERMINATED",
  "QUARANTINE",
]);
const STATUS_MISMATCH_IDENTITY_COUNT_SELECT = "lifecycleState";
const STATUS_MISMATCH_IDENTITY_ITEM_SELECT =
  "displayName firstName lastName email employeeId lifecycleState identityType";
const STATUS_MISMATCH_APP_STATUS_FIELDS = Object.freeze([
  "status",
  "user_status",
  "account_status",
  "profile_status",
  "lifecycleState",
  "lifecycle",
  "state",
  "isActive",
  "active",
  "enabled",
  "accountDisabled",
  "locked",
]);

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @param {(chunk: T[]) => Promise<unknown>} fn
 * @param {number} [concurrency]
 */
async function mapChunksParallel(items, size, fn, concurrency = MANAGER_MISMATCH_CHUNK_CONCURRENCY) {
  if (!items.length) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  const results = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const i = next++;
      results[i] = await fn(chunks[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()),
  );
  return results;
}

/**
 * Bulk-load app users for manager-mismatch compare. Same accountId resolution as
 * {@link bulkLoadLinkedApplicationUsers}, but with leaner projections.
 * @param {import("mongoose").Model} UsersModel
 * @param {import("mongoose").Types.ObjectId} applicationId
 * @param {Iterable<unknown>} accountIds
 * @param {{ includeItems?: boolean }} [opts]
 * @returns {Promise<Map<string, object>>}
 */
async function bulkLoadAppUsersForManagerMismatch(UsersModel, applicationId, accountIds, opts = {}) {
  const includeItems = opts.includeItems === true;
  const aidStrs = [
    ...new Set(
      [...accountIds]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter((v) => v.length > 0),
    ),
  ];
  if (!aidStrs.length) return new Map();

  const oidStrs = [];
  const rawStrs = [];
  for (const aid of aidStrs) {
    if (mongoose.Types.ObjectId.isValid(aid) && aid.length === 24) oidStrs.push(aid);
    else rawStrs.push(aid);
  }

  const scope = {
    $or: [{ applicationId }, { applicationId: String(applicationId) }],
  };

  /** @type {Record<string, 1>} */
  const projection = { _id: 1 };
  for (const f of MANAGER_MISMATCH_APP_MANAGER_FIELDS) {
    projection[f] = 1;
    projection[`rawData.${f}`] = 1;
  }
  for (const f of STATUS_MISMATCH_APP_STATUS_FIELDS) {
    projection[f] = 1;
    projection[`rawData.${f}`] = 1;
  }
  if (includeItems) {
    for (const f of ["display_name", "displayName", "email", "user_id", "username", "employee_id"]) {
      projection[f] = 1;
      projection[`rawData.${f}`] = 1;
    }
  }
  if (rawStrs.length > 0) {
    for (const f of MANAGER_MISMATCH_LINKABLE_USER_FIELDS) {
      projection[f] = 1;
    }
  }

  /** @type {object[]} */
  const flat = [];

  const loadOidChunk = async (chunk) => {
    const oidList = chunk.map((s) => new mongoose.Types.ObjectId(s));
    return UsersModel.find({ ...scope, _id: { $in: oidList } }).select(projection).lean();
  };
  const loadRawChunk = async (chunk) => {
    const rawOr = MANAGER_MISMATCH_LINKABLE_USER_FIELDS.map((f) => ({ [f]: { $in: chunk } }));
    return UsersModel.find({ ...scope, $or: rawOr }).select(projection).lean();
  };

  if (oidStrs.length > 0) {
    if (oidStrs.length <= MANAGER_MISMATCH_SINGLE_IN_MAX) {
      flat.push(...(await loadOidChunk(oidStrs)));
    } else {
      const parts = await mapChunksParallel(oidStrs, MANAGER_MISMATCH_QUERY_CHUNK, loadOidChunk);
      for (const rows of parts) flat.push(...rows);
    }
  }

  if (rawStrs.length > 0) {
    if (rawStrs.length <= MANAGER_MISMATCH_SINGLE_IN_MAX) {
      flat.push(...(await loadRawChunk(rawStrs)));
    } else {
      const parts = await mapChunksParallel(rawStrs, MANAGER_MISMATCH_QUERY_CHUNK, loadRawChunk);
      for (const rows of parts) flat.push(...rows);
    }
  }

  /** @type {Map<string, object>} */
  const byAid = new Map();
  const aidSet = new Set(aidStrs);
  const setIfRequested = (key, doc) => {
    if (key == null) return;
    const k = String(key).trim();
    if (!k || !aidSet.has(k) || byAid.has(k)) return;
    byAid.set(k, doc);
  };
  for (const u of flat) {
    setIfRequested(u._id, u);
    for (const f of MANAGER_MISMATCH_LINKABLE_USER_FIELDS) {
      if (u[f] != null) setIfRequested(u[f], u);
    }
  }
  return byAid;
}

/**
 * @param {import("mongoose").Model} IdentityModel
 * @param {import("mongoose").Types.ObjectId[]} identityIds
 * @param {string} select
 */
async function loadIdentitiesByIdChunked(IdentityModel, identityIds, select) {
  if (!identityIds.length) return [];
  if (identityIds.length <= MANAGER_MISMATCH_SINGLE_IN_MAX) {
    return IdentityModel.find({ _id: { $in: identityIds } }).select(select).lean();
  }
  const parts = await mapChunksParallel(identityIds, MANAGER_MISMATCH_QUERY_CHUNK, (chunk) =>
    IdentityModel.find({ _id: { $in: chunk } }).select(select).lean(),
  );
  return parts.flat();
}

function managerMismatchHasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return true;
  return String(value).trim() !== "";
}

function readAppUserField(user, key) {
  if (!user || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(user, key)) return user[key];
  const raw = user.rawData;
  if (raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, key)) {
    return raw[key];
  }
  return undefined;
}

function readIdentityField(identity, key) {
  if (!identity || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(identity, key)) return identity[key];
  const attrs = identity.attributes;
  if (attrs && typeof attrs === "object" && Object.prototype.hasOwnProperty.call(attrs, key)) {
    return attrs[key];
  }
  return undefined;
}

function hasAppUserField(user, key) {
  return readAppUserField(user, key) !== undefined;
}

function pickPresentAppUserField(user, ...keys) {
  for (const key of keys) {
    const value = readAppUserField(user, key);
    if (managerMismatchHasValue(value)) return String(value).trim();
  }
  return null;
}

function pickPresentIdentityField(identity, ...keys) {
  for (const key of keys) {
    const value = readIdentityField(identity, key);
    if (managerMismatchHasValue(value)) return String(value).trim();
  }
  return null;
}

function normalizeManagerMismatchIdString(value) {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId || mongoose.isValidObjectId(value)) {
    const s = String(value).trim();
    return s || null;
  }
  if (typeof value === "object" && value !== null && value._id != null) {
    return normalizeManagerMismatchIdString(value._id);
  }
  const s = String(value).trim();
  return s || null;
}

function identityDisplayName(doc) {
  if (!doc) return null;
  if (managerMismatchHasValue(doc.displayName)) return String(doc.displayName).trim();
  const full = `${doc.firstName || ""} ${doc.lastName || ""}`.trim();
  return full || null;
}

function normalizedManagerCompareTokens(value) {
  if (!managerMismatchHasValue(value)) return [];
  const raw = String(value).trim().toLowerCase();
  if (!raw) return [];
  const tokens = new Set([raw.replace(/\s+/g, " ")]);
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact) tokens.add(compact);
  if (raw.includes("@")) {
    const local = raw.split("@")[0].trim();
    if (local) {
      tokens.add(local);
      const localCompact = local.replace(/[^a-z0-9]/g, "");
      if (localCompact) tokens.add(localCompact);
    }
  }
  return [...tokens];
}

function buildManagerCompareTokenSet(...values) {
  const set = new Set();
  for (const value of values.flat()) {
    for (const token of normalizedManagerCompareTokens(value)) {
      set.add(token);
    }
  }
  return set;
}

function hasManagerTokenOverlap(left, right) {
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function deriveManagerMismatchType(hasProfileManagerValue, hasApplicationManagerValue) {
  if (!hasProfileManagerValue && hasApplicationManagerValue) return "missing_in_profile";
  if (hasProfileManagerValue && !hasApplicationManagerValue) return "missing_in_application";
  return "different_manager";
}

function resolveApplicationManagerValues(appUser) {
  return {
    name: pickPresentAppUserField(appUser, ...MANAGER_MISMATCH_APP_MANAGER_NAME_FIELDS),
    email: pickPresentAppUserField(appUser, ...MANAGER_MISMATCH_APP_MANAGER_EMAIL_FIELDS),
    reference: pickPresentAppUserField(appUser, ...MANAGER_MISMATCH_APP_MANAGER_REFERENCE_FIELDS),
  };
}

function resolveIdentityProfileManagerValues(identity, resolvedManager) {
  return {
    name:
      pickPresentIdentityField(identity, ...MANAGER_MISMATCH_IDENTITY_MANAGER_NAME_FIELDS) ||
      resolvedManager?.name ||
      null,
    email:
      pickPresentIdentityField(identity, ...MANAGER_MISMATCH_IDENTITY_MANAGER_EMAIL_FIELDS) ||
      (managerMismatchHasValue(identity.managerEmail) ? String(identity.managerEmail).trim() : null) ||
      resolvedManager?.email ||
      null,
    reference:
      pickPresentIdentityField(identity, ...MANAGER_MISMATCH_IDENTITY_MANAGER_REFERENCE_FIELDS) ||
      (managerMismatchHasValue(identity.managerKeyRaw) ? String(identity.managerKeyRaw).trim() : null),
  };
}

export async function collectManagerMismatchRecordsForApplication(
  tid,
  application,
  applicationLabel,
  IdentityModel,
  options = {},
) {
  const includeItems = options.includeItems === true;
  const skip = Math.max(0, Number(options.skip) || 0);
  const limit = Math.max(0, Number(options.limit) || 0);
  if (!application?._id || !application?.name) return { items: [], total: 0 };

  let UsersModel;
  try {
    UsersModel = await getDynamicUserModelForTenantId(application.name, tid);
  } catch {
    return { items: [], total: 0 };
  }

  const links = await IdentityAccountLink.find({
    applicationId: application._id,
    isActive: true,
    correlationStatus: "correlated",
  })
    .select("identityId accountId accountName")
    .lean();
  if (!links.length) return { items: [], total: 0 };

  const identityIds = [
    ...new Set(
      links
        .map((link) => normalizeManagerMismatchIdString(link.identityId))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id)),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (!identityIds.length) return { items: [], total: 0 };

  const identitySelect = includeItems
    ? MANAGER_MISMATCH_IDENTITY_ITEM_SELECT
    : MANAGER_MISMATCH_IDENTITY_COUNT_SELECT;

  const [identities, appUsersByAccountId] = await Promise.all([
    loadIdentitiesByIdChunked(IdentityModel, identityIds, identitySelect),
    bulkLoadAppUsersForManagerMismatch(
      UsersModel,
      application._id,
      links.map((link) => link.accountId),
      { includeItems },
    ),
  ]);

  const identityById = new Map(identities.map((identity) => [String(identity._id), identity]));

  // Count path: only load manager docs when identity-local compare tokens are empty but managerId is set.
  // Item path: always load managers for display fields.
  const managerIdStrsNeeded = new Set();
  for (const identity of identities) {
    const mid = normalizeManagerMismatchIdString(identity.managerId);
    if (!mid || !mongoose.Types.ObjectId.isValid(mid)) continue;
    if (includeItems) {
      managerIdStrsNeeded.add(mid);
      continue;
    }
    const local = resolveIdentityProfileManagerValues(identity, null);
    const localTokens = buildManagerCompareTokenSet(local.name, local.email, local.reference);
    if (localTokens.size === 0) managerIdStrsNeeded.add(mid);
  }

  const managerDocs =
    managerIdStrsNeeded.size > 0
      ? await loadIdentitiesByIdChunked(
          IdentityModel,
          [...managerIdStrsNeeded].map((id) => new mongoose.Types.ObjectId(id)),
          "displayName firstName lastName email",
        )
      : [];
  const managerById = new Map(
    managerDocs.map((doc) => [
      String(doc._id),
      {
        name: identityDisplayName(doc),
        email: managerMismatchHasValue(doc.email) ? String(doc.email).trim() : null,
      },
    ]),
  );
  let total = 0;
  /** @type {Array<object>} */
  const mismatchRows = [];

  for (const link of links) {
    const identityId = normalizeManagerMismatchIdString(link.identityId);
    const accountId = normalizeManagerMismatchIdString(link.accountId);
    if (!identityId || !accountId) continue;

    const identity = identityById.get(identityId);
    const appUser = appUsersByAccountId.get(accountId);
    if (!identity || !appUser) continue;

    const profileManagerId = normalizeManagerMismatchIdString(identity.managerId);
    const resolvedProfileManager = profileManagerId ? managerById.get(profileManagerId) : null;
    const profileManager = resolveIdentityProfileManagerValues(identity, resolvedProfileManager);
    const applicationManager = resolveApplicationManagerValues(appUser);
    const hasAppManagerField = MANAGER_MISMATCH_APP_MANAGER_FIELDS.some((key) =>
      hasAppUserField(appUser, key),
    );
    const profileTokens = buildManagerCompareTokenSet(
      profileManager.name,
      profileManager.email,
      profileManager.reference,
    );
    const applicationTokens = buildManagerCompareTokenSet(
      applicationManager.name,
      applicationManager.email,
      applicationManager.reference,
    );

    if (!hasAppManagerField && profileTokens.size === 0) continue;
    if (profileTokens.size === 0 && applicationTokens.size === 0) continue;
    if (
      profileTokens.size > 0 &&
      applicationTokens.size > 0 &&
      hasManagerTokenOverlap(profileTokens, applicationTokens)
    ) {
      continue;
    }

    total += 1;
    if (!includeItems) continue;

    mismatchRows.push({
      link,
      identity,
      appUser,
      profileManagerId,
      profileManager,
      applicationManager,
      mismatchType: deriveManagerMismatchType(profileTokens.size > 0, applicationTokens.size > 0),
      sortKey: identityDisplayName(identity) || String(link.accountName || accountId || ""),
    });
  }

  if (!includeItems || mismatchRows.length === 0) {
    return { items: [], total };
  }

  mismatchRows.sort((a, b) =>
    String(a.sortKey || "").localeCompare(String(b.sortKey || ""), undefined, {
      sensitivity: "base",
    }),
  );

  const pageRows =
    limit > 0 ? mismatchRows.slice(skip, skip + limit) : mismatchRows.slice(skip);

  const items = pageRows.map(
    ({ link, identity, appUser, profileManagerId, profileManager, applicationManager, mismatchType }) => {
      const accountName =
        managerMismatchHasValue(link.accountName) && String(link.accountName).trim() !== ""
          ? String(link.accountName).trim()
          : pickPresentAppUserField(
              appUser,
              "display_name",
              "displayName",
              "user_id",
              "username",
              "email",
            );

      return {
        kind: "managerMismatch",
        id: `${String(application._id)}:${String(identity._id)}:${String(link.accountId || "")}`,
        identityId: String(identity._id),
        displayName: identityDisplayName(identity) || accountName || null,
        email:
          managerMismatchHasValue(identity.email) && String(identity.email).trim() !== ""
            ? String(identity.email).trim()
            : pickPresentAppUserField(appUser, "email"),
        employeeId:
          managerMismatchHasValue(identity.employeeId) && String(identity.employeeId).trim() !== ""
            ? String(identity.employeeId).trim()
            : pickPresentAppUserField(appUser, "employee_id"),
        lifecycleState: identity.lifecycleState ?? null,
        identityType: identity.identityType ?? null,
        accountId: String(link.accountId || "").trim() || null,
        accountName: accountName || null,
        applicationId: String(application._id),
        applicationLabel,
        profileManagerId,
        profileManagerName: profileManager.name ?? null,
        profileManagerEmail: profileManager.email ?? null,
        profileManagerReference: profileManager.reference ?? null,
        applicationManagerName: applicationManager.name ?? null,
        applicationManagerEmail: applicationManager.email ?? null,
        applicationManagerReference: applicationManager.reference ?? null,
        mismatchType,
      };
    },
  );

  return { items, total };
}

/**
 * Classify identity STATUS (UI column; stored as lifecycleState when status is mapped).
 * @param {unknown} lifecycleState
 * @returns {"active"|"inactive"|null} null = skip (NEW/MOVER/unknown)
 */
function classifyIdentityStatusForMismatch(lifecycleState) {
  const s = String(lifecycleState ?? "")
    .trim()
    .toUpperCase();
  if (s === "ACTIVE") return "active";
  if (STATUS_MISMATCH_IDENTITY_INACTIVE.has(s)) return "inactive";
  return null;
}

/**
 * Status mismatches: identity STATUS vs target-app ACCOUNT STATUS on correlated links.
 * Authoritative apps should be excluded by the caller (aggregate / list).
 *
 * @param {import("mongoose").Types.ObjectId} tid
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @param {string} applicationLabel
 * @param {import("mongoose").Model} IdentityModel
 * @param {{ includeItems?: boolean, skip?: number, limit?: number }} [options]
 */
export async function collectStatusMismatchRecordsForApplication(
  tid,
  application,
  applicationLabel,
  IdentityModel,
  options = {},
) {
  const includeItems = options.includeItems === true;
  const skip = Math.max(0, Number(options.skip) || 0);
  const limit = Math.max(0, Number(options.limit) || 0);
  if (!application?._id || !application?.name) return { items: [], total: 0 };

  let UsersModel;
  try {
    UsersModel = await getDynamicUserModelForTenantId(application.name, tid);
  } catch {
    return { items: [], total: 0 };
  }

  // Include inactive links too: correlation sets link.isActive=false when account.status
  // is INACTIVE, and that is exactly the identity_active_app_inactive mismatch case.
  const links = await IdentityAccountLink.find({
    applicationId: application._id,
    correlationStatus: "correlated",
  })
    .select("identityId accountId accountName isActive")
    .lean();
  if (!links.length) return { items: [], total: 0 };

  const identityIds = [
    ...new Set(
      links
        .map((link) => normalizeManagerMismatchIdString(link.identityId))
        .filter((id) => id && mongoose.Types.ObjectId.isValid(id)),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (!identityIds.length) return { items: [], total: 0 };

  const identitySelect = includeItems
    ? STATUS_MISMATCH_IDENTITY_ITEM_SELECT
    : STATUS_MISMATCH_IDENTITY_COUNT_SELECT;

  const [identities, appUsersByAccountId] = await Promise.all([
    loadIdentitiesByIdChunked(IdentityModel, identityIds, identitySelect),
    bulkLoadAppUsersForManagerMismatch(
      UsersModel,
      application._id,
      links.map((link) => link.accountId),
      { includeItems: true },
    ),
  ]);

  const identityById = new Map(identities.map((identity) => [String(identity._id), identity]));

  let total = 0;
  /** @type {Array<object>} */
  const mismatchRows = [];

  for (const link of links) {
    const identityId = normalizeManagerMismatchIdString(link.identityId);
    const accountId = normalizeManagerMismatchIdString(link.accountId);
    if (!identityId || !accountId) continue;

    const identity = identityById.get(identityId);
    const appUser = appUsersByAccountId.get(accountId);
    if (!identity || !appUser) continue;

    const identityClass = classifyIdentityStatusForMismatch(identity.lifecycleState);
    if (!identityClass) continue;

    const appInactive = isAppUserInactiveForHygiene(appUser);
    let mismatchType = null;
    if (identityClass === "active" && appInactive) {
      mismatchType = "identity_active_app_inactive";
    } else if (identityClass === "inactive" && !appInactive) {
      mismatchType = "identity_inactive_app_active";
    }
    if (!mismatchType) continue;

    total += 1;
    if (!includeItems) continue;

    mismatchRows.push({
      link,
      identity,
      appUser,
      mismatchType,
      sortKey: identityDisplayName(identity) || String(link.accountName || accountId || ""),
    });
  }

  if (!includeItems || mismatchRows.length === 0) {
    return { items: [], total };
  }

  mismatchRows.sort((a, b) =>
    String(a.sortKey || "").localeCompare(String(b.sortKey || ""), undefined, {
      sensitivity: "base",
    }),
  );

  const pageRows =
    limit > 0 ? mismatchRows.slice(skip, skip + limit) : mismatchRows.slice(skip);

  const items = pageRows.map(({ link, identity, appUser, mismatchType }) => {
    const accountName =
      managerMismatchHasValue(link.accountName) && String(link.accountName).trim() !== ""
        ? String(link.accountName).trim()
        : pickPresentAppUserField(
            appUser,
            "display_name",
            "displayName",
            "user_id",
            "username",
            "email",
          );
    const identityStatus =
      identity.lifecycleState != null && String(identity.lifecycleState).trim() !== ""
        ? String(identity.lifecycleState).trim()
        : null;
    const accountStatus = pickAppUserAccountStatusDisplay(appUser);

    return {
      kind: "statusMismatch",
      id: `${String(application._id)}:${String(identity._id)}:${String(link.accountId || "")}`,
      identityId: String(identity._id),
      displayName: identityDisplayName(identity) || accountName || null,
      email:
        managerMismatchHasValue(identity.email) && String(identity.email).trim() !== ""
          ? String(identity.email).trim()
          : pickPresentAppUserField(appUser, "email"),
      employeeId:
        managerMismatchHasValue(identity.employeeId) && String(identity.employeeId).trim() !== ""
          ? String(identity.employeeId).trim()
          : pickPresentAppUserField(appUser, "employee_id"),
      identityStatus,
      accountStatus,
      identityType: identity.identityType ?? null,
      accountId: String(link.accountId || "").trim() || null,
      accountName: accountName || null,
      applicationId: String(application._id),
      applicationLabel,
      mismatchType,
    };
  });

  return { items, total };
}

/** Shared lifecycle / type filters for manager hygiene widgets. */
function missingManagerHygieneBase(tid) {
  return {
    tenantId: tid,
    lifecycleState: { $in: ["ACTIVE", "NEW", "MOVER"] },
    identityType: { $nin: ["service", "vendor", "nhi"] },
  };
}

/**
 * Identities flagged for manager hygiene: no resolved manager, unresolved reference,
 * or declared top of hierarchy (manager correlation engine).
 * @param {import('mongoose').Types.ObjectId} tid
 */
function missingManagerIdentityMatch(tid) {
  return {
    ...missingManagerHygieneBase(tid),
    $or: [
      {
        isRoot: { $ne: true },
        managerResolutionStatus: { $ne: "root" },
        $or: [{ managerId: { $exists: false } }, { managerId: null }],
      },
      { managerResolutionStatus: "unresolved" },
      { managerResolutionStatus: "root" },
      { isRoot: true },
    ],
  };
}

/**
 * @param {object} doc
 * @returns {'missing_manager' | 'unresolved' | 'top_of_hierarchy'}
 */
function deriveManagerHygieneIssue(doc) {
  if (doc?.managerResolutionStatus === "root" || doc?.isRoot === true) {
    return "top_of_hierarchy";
  }
  if (
    doc?.managerResolutionStatus === "unresolved" ||
    (doc?.managerKeyRaw != null && String(doc.managerKeyRaw).trim() !== "")
  ) {
    return "unresolved";
  }
  return "missing_manager";
}

/** @param {object} doc */
function mapIdentityToMissingManagerHygieneItem(doc, appNameMap, extra = {}) {
  return {
    kind: "identity",
    id: doc._id ? String(doc._id) : null,
    displayName: doc.displayName ?? null,
    firstName: doc.firstName ?? null,
    lastName: doc.lastName ?? null,
    email: doc.email ?? null,
    employeeId: doc.employeeId ?? null,
    lifecycleState: doc.lifecycleState ?? null,
    identityType: doc.identityType ?? null,
    totalEntitlements: doc.totalEntitlements ?? 0,
    riskLevel: doc.riskLevel ?? null,
    sourceApplication: doc.sourceApplication != null ? String(doc.sourceApplication) : null,
    sourceApplicationLabel: appLabel(appNameMap, doc.sourceApplication),
    managerResolutionStatus: doc.managerResolutionStatus ?? null,
    managerKeyRaw: doc.managerKeyRaw ?? null,
    isRoot: Boolean(doc.isRoot),
    managerIssue: deriveManagerHygieneIssue(doc),
    ...extra,
  };
}

/**
 * Entitlements catalog + correlation collection names for hygiene widgets.
 * @param {{ name: string }} application
 * @param {string} tenantSlug
 */
function resolveEntitlementHygieneCollections(application, tenantSlug) {
  return {
    entsColl: getAppEntitlementsCollectionName(application.name, tenantSlug),
    corrColl: getAppCorrelationCollectionName(application.name),
  };
}

/**
 * $lookup stage: correlation rows for this entitlement (at least one = assigned to a user for hygiene).
 * @param {string} correlationCollection
 * @param {import("mongoose").Types.ObjectId} applicationId
 */
function unassignedEntitlementLookupStage(correlationCollection, applicationId) {
  return {
    $lookup: {
      from: correlationCollection,
      let: { eid: "$_id", aid: applicationId },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$applicationId", "$$aid"] },
                { $eq: ["$entitlementId", "$$eid"] },
              ],
            },
          },
        },
        { $limit: 1 },
      ],
      as: "_corr",
    },
  };
}

const MATCH_NO_USER_CORRELATION = {
  $match: { $expr: { $eq: [{ $size: { $ifNull: ["$_corr", []] } }, 0] } },
};

/** Aligned with access certification normalization for `is_privilege` / privileged flag. */
const PRIVILEGE_STRING_TOKENS = ["true", "yes", "1", "y", "privileged"];

/**
 * Match clause for connector `app_*_entitlements` docs flagged as privileged in the catalog extract.
 * @param {import("mongoose").Types.ObjectId} applicationId
 */
function matchPrivilegedEntitlementsForApplication(applicationId) {
  return {
    applicationId,
    $or: [
      { isPrivileged: true },
      { is_privilege: true },
      { classification: { $regex: /^privileged$/i } },
      {
        $expr: {
          $in: [
            {
              $toLower: {
                $trim: {
                  input: {
                    $convert: {
                      input: "$is_privilege",
                      to: "string",
                      onError: "",
                      onNull: "",
                    },
                  },
                },
              },
            },
            PRIVILEGE_STRING_TOKENS,
          ],
        },
      },
    ],
  };
}

/**
 * Trimmed string length of an entitlement owner-related field (for $expr).
 * @param {string} fieldPath e.g. `"$owner"`
 */
function trimmedOwnerFieldLenExpr(fieldPath) {
  return {
    $strLenCP: {
      $trim: {
        input: {
          $convert: {
            input: fieldPath,
            to: "string",
            onError: "",
            onNull: "",
          },
        },
      },
    },
  };
}

/**
 * Catalog entitlement rows with no owner after trimming: all of owner, ownerEmail, entitlement_owner empty.
 * @param {import("mongoose").Types.ObjectId} applicationId
 */
function matchEntitlementsMissingOwnerForApplication(applicationId) {
  return {
    applicationId,
    $expr: {
      $and: [
        { $eq: [trimmedOwnerFieldLenExpr("$owner"), 0] },
        { $eq: [trimmedOwnerFieldLenExpr("$ownerEmail"), 0] },
        { $eq: [trimmedOwnerFieldLenExpr("$entitlement_owner"), 0] },
      ],
    },
  };
}

/**
 * Entitlements in `app_iga_<tenant>_<app>_entitlements` with no rows in `app_<app>_correlation`.
 * Uses distinct assigned entitlement ids + $nin (same semantics as $lookup with zero corr rows).
 * @param {import("mongoose").default.mongo.Db} db
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @param {string} tenantSlug
 * @param {number} [denominator] optional precomputed catalog total
 * @returns {Promise<{ unassigned: number, denominator: number }>}
 */
async function countUnassignedEntitlementsForApplication(db, application, tenantSlug, denominator) {
  let entsColl;
  let corrColl;
  try {
    ({ entsColl, corrColl } = resolveEntitlementHygieneCollections(application, tenantSlug));
  } catch {
    return { unassigned: 0, denominator: 0 };
  }
  const appId = application._id;
  try {
    const total =
      typeof denominator === "number"
        ? denominator
        : await db.collection(entsColl).countDocuments({ applicationId: appId });
    if (total === 0) return { unassigned: 0, denominator: 0 };

    const assignedIds = await db.collection(corrColl).distinct("entitlementId", { applicationId: appId });
    if (!assignedIds.length) {
      return { unassigned: total, denominator: total };
    }
    const unassigned = await db.collection(entsColl).countDocuments({
      applicationId: appId,
      _id: { $nin: assignedIds },
    });
    return { unassigned, denominator: total };
  } catch {
    return { unassigned: 0, denominator: 0 };
  }
}

/**
 * @param {import("mongoose").default.mongo.Db} db
 * @param {import("mongoose").Types.ObjectId} tid
 */
/** Limit concurrent native-collection aggregations when many apps exist (avoids connection / CPU spikes). */
const UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY = 8;

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await mapper(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function appRowFromCount(appNameMap, app, count, denominator) {
  return {
    application: appLabel(appNameMap, app._id),
    applicationId: app._id,
    count,
    denominator: denominator ?? count,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 */
async function loadTenantHygieneContext(tid) {
  const [apps, tenantSlug, IdentityModel] = await Promise.all([
    Application.find({ tenantId: tid }).select("name _id authoritativeSource").lean(),
    resolveTenantSlugFromTenantId(tid),
    getDynamicIdentityModelForTenantId(tid),
  ]);
  const appNameMap = new Map();
  for (const a of apps) {
    appNameMap.set(String(a._id), a.name || "Application");
  }
  const nonAuthoritativeApps = apps.filter((a) => !a.authoritativeSource);
  return {
    apps,
    appNameMap,
    tenantSlug,
    tenantAppIds: apps.map((a) => a._id),
    /** Target / non-HR apps only — used by missingManagersByApplication. */
    nonAuthoritativeAppIds: nonAuthoritativeApps.map((a) => a._id),
    IdentityModel,
  };
}

/**
 * @param {import("mongoose").default.mongo.Db} db
 * @param {Array<{ _id: import("mongoose").Types.ObjectId, name: string }>} apps
 * @param {Map<string, string>} appNameMap
 * @param {string} tenantSlug
 */
async function computeEntitlementWidgetStats(db, apps, appNameMap, tenantSlug) {
  const empty = { total: 0, byApp: [] };
  if (!tenantSlug || !apps.length) {
    return {
      unassigned: empty,
      privileged: empty,
      missingOwner: empty,
    };
  }

  const unassignedByApp = [];
  const privilegedByApp = [];
  const missingOwnerByApp = [];

  await mapWithConcurrency(apps, UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY, async (app) => {
    let entsColl;
    try {
      ({ entsColl } = resolveEntitlementHygieneCollections(app, tenantSlug));
    } catch {
      unassignedByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      privilegedByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      missingOwnerByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      return;
    }

    let total = 0;
    try {
      total = await db.collection(entsColl).countDocuments({ applicationId: app._id });
    } catch {
      unassignedByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      privilegedByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      missingOwnerByApp.push(appRowFromCount(appNameMap, app, 0, 0));
      return;
    }

    const [un, privileged, missingOwner] = await Promise.all([
      countUnassignedEntitlementsForApplication(db, app, tenantSlug, total),
      total === 0
        ? Promise.resolve(0)
        : db.collection(entsColl).countDocuments(matchPrivilegedEntitlementsForApplication(app._id)),
      total === 0
        ? Promise.resolve(0)
        : db.collection(entsColl).countDocuments(matchEntitlementsMissingOwnerForApplication(app._id)),
    ]);

    unassignedByApp.push(appRowFromCount(appNameMap, app, un.unassigned, total));
    privilegedByApp.push(appRowFromCount(appNameMap, app, privileged, total));
    missingOwnerByApp.push(appRowFromCount(appNameMap, app, missingOwner, total));
  });

  const sum = (rows) => rows.reduce((s, r) => s + r.count, 0);
  return {
    unassigned: { total: sum(unassignedByApp), byApp: unassignedByApp },
    privileged: { total: sum(privilegedByApp), byApp: privilegedByApp },
    missingOwner: { total: sum(missingOwnerByApp), byApp: missingOwnerByApp },
  };
}

/**
 * Count privileged rows in `app_iga_<tenant>_<app>_entitlements`.
 * @param {import("mongoose").default.mongo.Db} db
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @param {string} tenantSlug
 * @returns {Promise<{ privileged: number, denominator: number }>}
 */
async function countPrivilegedEntitlementsForApplication(db, application, tenantSlug) {
  let entsColl;
  try {
    ({ entsColl } = resolveEntitlementHygieneCollections(application, tenantSlug));
  } catch {
    return { privileged: 0, denominator: 0 };
  }
  const appId = application._id;
  const m = matchPrivilegedEntitlementsForApplication(appId);
  try {
    const [privileged, total] = await Promise.all([
      db.collection(entsColl).countDocuments(m),
      db.collection(entsColl).countDocuments({ applicationId: appId }),
    ]);
    return { privileged, denominator: total };
  } catch {
    return { privileged: 0, denominator: 0 };
  }
}

/**
 * Count entitlement rows with no populated owner / ownerEmail / entitlement_owner (catalog extract).
 * @param {import("mongoose").default.mongo.Db} db
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @returns {Promise<{ missingOwner: number, denominator: number }>}
 */
async function countEntitlementsMissingOwnerForApplication(db, application, tenantSlug) {
  let entsColl;
  try {
    ({ entsColl } = resolveEntitlementHygieneCollections(application, tenantSlug));
  } catch {
    return { missingOwner: 0, denominator: 0 };
  }
  const appId = application._id;
  const m = matchEntitlementsMissingOwnerForApplication(appId);
  try {
    const [missingOwner, total] = await Promise.all([
      db.collection(entsColl).countDocuments(m),
      db.collection(entsColl).countDocuments({ applicationId: appId }),
    ]);
    return { missingOwner, denominator: total };
  } catch {
    return { missingOwner: 0, denominator: 0 };
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 */
export async function computeDataHygieneSummary(tid) {
  const db = mongoose.connection.db;
  const ctx = await loadTenantHygieneContext(tid);

  // Single parallel wave — widget rollups do not depend on each other.
  const [
    entitlementStats,
    inactiveAccessByApp,
    managerMismatchByApp,
    statusMismatchByApp,
    sodTotals,
    duplicateAccountsByApp,
    orphanedProfiles,
    missingManagers,
    accessCertificationCampaigns,
    orphansByApp,
    missingMgrBySource,
    missingMgrByLinkedApp,
    campaignsByApp,
    appAccountCountById,
  ] = await Promise.all([
    computeEntitlementWidgetStats(db, ctx.apps, ctx.appNameMap, ctx.tenantSlug),
    aggregateInactiveAccessByApplication(db, ctx.apps, ctx.appNameMap, ctx.tenantSlug, tid),
    aggregateManagerMismatchesByApplication(tid, ctx.apps, ctx.appNameMap, ctx.IdentityModel),
    aggregateStatusMismatchesByApplication(
      tid,
      ctx.apps.filter((a) => !a.authoritativeSource),
      ctx.appNameMap,
      ctx.IdentityModel,
    ),
    aggregateSodTotalsByApplication(tid, ctx.appNameMap),
    aggregateDuplicateAccountsByApplication(tid, ctx.appNameMap),
    OrphanAccount.countDocuments({ tenantId: tid, status: "OPEN" }),
    countMissingManagers(tid, ctx.IdentityModel),
    Campaign.countDocuments({ tenantId: tid }),
    aggregateOrphansByApplication(tid, ctx.appNameMap),
    aggregateMissingManagersBySource(tid, ctx.appNameMap, ctx.IdentityModel),
    aggregateMissingManagersByLinkedApplication(
      tid,
      ctx.appNameMap,
      ctx.nonAuthoritativeAppIds,
      ctx.IdentityModel,
    ),
    aggregateAccessCertificationCampaignsByApplication(tid, ctx.appNameMap),
    aggregateAppAccountCountsByApplication(db, ctx.apps, ctx.tenantSlug),
  ]);

  const inactiveUsersWithAccess = inactiveAccessByApp.reduce((s, r) => s + (r.count || 0), 0);
  const managerMismatches = managerMismatchByApp.reduce((s, r) => s + (r.count || 0), 0);
  const statusMismatches = statusMismatchByApp.reduce((s, r) => s + (r.count || 0), 0);
  const duplicateAccountGroups = duplicateAccountsByApp.reduce((s, r) => s + (r.count || 0), 0);

  const dashboardData = buildHygieneWidgetsFromRollups(
    ctx.apps,
    entitlementStats,
    inactiveAccessByApp,
    managerMismatchByApp,
    statusMismatchByApp,
    sodTotals,
    duplicateAccountsByApp,
    orphansByApp,
    missingMgrBySource,
    missingMgrByLinkedApp,
    campaignsByApp,
    appAccountCountById,
  );

  return {
    orphanedProfiles,
    missingManagers,
    unassignedEntitlements: entitlementStats.unassigned.total,
    privilegedEntitlements: entitlementStats.privileged.total,
    entitlementsMissingOwner: entitlementStats.missingOwner.total,
    inactiveUsersWithAccess,
    managerMismatches,
    statusMismatches,
    accessCertificationCampaigns,
    sodPolicies: sodTotals.totalPolicies,
    sodOpenViolations: sodTotals.totalOpenViolations,
    duplicateAccountGroups,
    widgets: dashboardData.widgets,
    applicationTiles: dashboardData.applicationTiles,
    computedAt: new Date().toISOString(),
  };
}

async function countMissingManagers(tid, IdentityModel) {
  return IdentityModel.countDocuments(missingManagerIdentityMatch(tid));
}

/** Fields loaded when scanning app users for inactive-with-access hygiene. */
const INACTIVE_APP_USER_PROJECTION = {
  status: 1,
  user_status: 1,
  account_status: 1,
  profile_status: 1,
  lifecycleState: 1,
  lifecycle: 1,
  state: 1,
  isActive: 1,
  active: 1,
  enabled: 1,
  accountDisabled: 1,
  locked: 1,
  user_id: 1,
  username: 1,
  email: 1,
  display_name: 1,
  member_of_entitlements: 1,
  entitlements: 1,
  roles: 1,
  groups: 1,
  rawData: 1,
};

/**
 * Count inactive users with access for one app — prefers ingest sidecar when ready.
 * On cold miss: one live scan (same predicate), return count, and seed the sidecar asynchronously.
 * @param {import("mongoose").default.mongo.Db} db
 * @param {{ _id: import("mongoose").Types.ObjectId, name: string }} application
 * @param {string} tenantSlug
 * @param {import("mongoose").Types.ObjectId} [tenantId]
 */
async function countInactiveAppUsersWithAccessForApplication(db, application, tenantSlug, tenantId) {
  if (await isInactiveAccessSidecarReady(application._id)) {
    return countInactiveAccessFromSidecar(application._id);
  }

  let usersColl;
  try {
    usersColl = getAppUsersCollectionName(application.name, tenantSlug);
  } catch {
    return 0;
  }
  const filter = { applicationId: application._id };
  const allUsers = [];
  let count = 0;
  try {
    const cursor = db
      .collection(usersColl)
      .find(filter)
      .project(INACTIVE_APP_USER_PROJECTION)
      .batchSize(500);
    for await (const user of cursor) {
      allUsers.push(user);
      if (isInactiveAppUserWithAccess(user)) count += 1;
    }
  } catch {
    return 0;
  }

  if (tenantId) {
    void rebuildInactiveAccessSidecar({
      applicationId: application._id,
      tenantId,
      users: allUsers,
    }).catch(() => {});
  }

  return count;
}

/**
 * Per-application counts for the inactive-users-with-access widget only.
 * @param {import("mongoose").default.mongo.Db} db
 * @param {Array<{ _id: import("mongoose").Types.ObjectId, name: string }>} apps
 * @param {Map<string, string>} appNameMap
 * @param {string|null} tenantSlug
 * @param {import("mongoose").Types.ObjectId} [tenantId]
 */
async function aggregateInactiveAccessByApplication(db, apps, appNameMap, tenantSlug, tenantId) {
  if (!tenantSlug || !apps.length) return [];
  return mapWithConcurrency(apps, UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY, async (app) => {
    const count = await countInactiveAppUsersWithAccessForApplication(
      db,
      app,
      tenantSlug,
      tenantId,
    );
    return {
      application: appLabel(appNameMap, app._id),
      applicationId: app._id,
      count,
    };
  });
}

async function aggregateManagerMismatchesByApplication(tid, apps, appNameMap, IdentityModel) {
  if (!apps.length) return [];
  return mapWithConcurrency(apps, UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY, async (app) => {
    if (await isManagerMismatchSidecarReady(app._id)) {
      const count = await countManagerMismatchesFromSidecar(app._id);
      return {
        application: appLabel(appNameMap, app._id),
        applicationId: app._id,
        count,
      };
    }

    const { total } = await collectManagerMismatchRecordsForApplication(
      tid,
      app,
      appLabel(appNameMap, app._id),
      IdentityModel,
      { includeItems: false },
    );

    // Seed sidecar in background (same live compare → same counts on next read).
    void rebuildManagerMismatchSidecarForApplication(tid, app).catch(() => {});

    return {
      application: appLabel(appNameMap, app._id),
      applicationId: app._id,
      count: total,
    };
  });
}

async function aggregateStatusMismatchesByApplication(tid, apps, appNameMap, IdentityModel) {
  if (!apps.length) return [];
  return mapWithConcurrency(apps, UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY, async (app) => {
    if (await isStatusMismatchSidecarReady(app._id)) {
      const count = await countStatusMismatchesFromSidecar(app._id);
      return {
        application: appLabel(appNameMap, app._id),
        applicationId: app._id,
        count,
      };
    }

    const { total } = await collectStatusMismatchRecordsForApplication(
      tid,
      app,
      appLabel(appNameMap, app._id),
      IdentityModel,
      { includeItems: false },
    );

    void rebuildStatusMismatchSidecarForApplication(tid, app).catch(() => {});

    return {
      application: appLabel(appNameMap, app._id),
      applicationId: app._id,
      count: total,
    };
  });
}

/**
 * Assemble widgets/tiles from already-fetched rollups (sync — no extra DB I/O).
 * Account-based metrics use % of that application's accounts (not share of tenant findings).
 */
function buildHygieneWidgetsFromRollups(
  apps,
  entitlementStats,
  inactiveAccessByAppPrecomputed,
  managerMismatchByAppPrecomputed,
  statusMismatchByAppPrecomputed,
  sodTotals,
  duplicateAccountsByAppPrecomputed,
  orphansByApp,
  missingMgrBySource,
  missingMgrByLinkedApp,
  campaignsByApp,
  appAccountCountById = new Map(),
) {
  const withAccountDenom = (rows) => attachAppAccountDenominator(rows, appAccountCountById);

  const widgetDefinitions = [
    {
      id: "orphanedProfiles",
      title: "Orphaned Accounts",
      percentLabel: "% of app accounts",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(orphansByApp)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(orphansByApp), { trim: false }),
    },
    {
      id: "missingManagers",
      title: "Missing managers (by identity source)",
      percentLabel: "% of findings",
      primaryColumnLabel: "Identity source",
      rows: addRowPercentsOfGrandTotal(missingMgrBySource),
      allRows: addRowPercentsOfGrandTotal(missingMgrBySource, { trim: false }),
    },
    {
      id: "missingManagersByApplication",
      title: "Missing managers (by linked application)",
      percentLabel: "% of app accounts",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(missingMgrByLinkedApp)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(missingMgrByLinkedApp), {
        trim: false,
      }),
    },
    {
      id: "managerMismatches",
      title: "Manager mismatches",
      percentLabel: "% of app accounts",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(managerMismatchByAppPrecomputed)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(managerMismatchByAppPrecomputed), {
        trim: false,
      }),
    },
    {
      id: "statusMismatches",
      title: "Status mismatches",
      percentLabel: "% of app accounts",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(statusMismatchByAppPrecomputed)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(statusMismatchByAppPrecomputed), {
        trim: false,
      }),
    },
    {
      id: "unassignedEntitlements",
      title: "Unassigned entitlements",
      percentLabel: "% of app entitlements",
      rows: addPercentOfAppEntitlementTotal(entitlementStats.unassigned.byApp),
      allRows: addPercentOfAppEntitlementTotal(entitlementStats.unassigned.byApp, { trim: false }),
    },
    {
      id: "privilegedEntitlements",
      title: "Privileged entitlements",
      percentLabel: "% of app entitlements",
      rows: addPercentOfAppEntitlementTotal(entitlementStats.privileged.byApp),
      allRows: addPercentOfAppEntitlementTotal(entitlementStats.privileged.byApp, { trim: false }),
    },
    {
      id: "entitlementsMissingOwner",
      title: "Entitlements missing owner",
      percentLabel: "% of app entitlements",
      rows: addPercentOfAppEntitlementTotal(entitlementStats.missingOwner.byApp),
      allRows: addPercentOfAppEntitlementTotal(entitlementStats.missingOwner.byApp, { trim: false }),
    },
    {
      id: "inactiveUsersWithAccess",
      title: "Inactive users with access",
      percentLabel: "% of app accounts",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(inactiveAccessByAppPrecomputed)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(inactiveAccessByAppPrecomputed), {
        trim: false,
      }),
    },
    {
      id: "accessCertificationCampaigns",
      title: "Access certification",
      percentLabel: "% of campaigns",
      rows: addRowPercentsOfGrandTotal(campaignsByApp),
      allRows: addRowPercentsOfGrandTotal(campaignsByApp, { trim: false }),
    },
    {
      id: "sodPoliciesViolations",
      title: "SoD policies & violations",
      percentLabel: "% of policies",
      countColumnLabel: "Policies in scope",
      rows: addSodRowPercents(sodTotals.byApp),
      allRows: addSodRowPercents(sodTotals.byApp, { trim: false }),
    },
    {
      id: "duplicateAccountsByApplication",
      title: "Duplicate accounts",
      percentLabel: "% of app accounts",
      countColumnLabel: "Duplicate groups",
      rows: addPercentOfAppEntitlementTotal(withAccountDenom(duplicateAccountsByAppPrecomputed)),
      allRows: addPercentOfAppEntitlementTotal(withAccountDenom(duplicateAccountsByAppPrecomputed), {
        trim: false,
      }),
    },
  ];

  return {
    widgets: widgetDefinitions.map(({ allRows, ...widget }) => widget),
    applicationTiles: buildApplicationHygieneTiles(apps, widgetDefinitions, appAccountCountById),
  };
}

/**
 * @deprecated Prefer {@link buildHygieneWidgetsFromRollups} after a single parallel wave.
 * Kept for any callers that still expect the older async signature.
 */
async function buildHygieneWidgets(
  tid,
  apps,
  tenantAppIds,
  nonAuthoritativeAppIds,
  appNameMap,
  IdentityModel,
  entitlementStats,
  inactiveAccessByAppPrecomputed,
  managerMismatchByAppPrecomputed,
  statusMismatchByAppPrecomputed,
  sodTotals,
  duplicateAccountsByAppPrecomputed,
) {
  const [orphansByApp, missingMgrBySource, missingMgrByLinkedApp, campaignsByApp] =
    await Promise.all([
      aggregateOrphansByApplication(tid, appNameMap),
      aggregateMissingManagersBySource(tid, appNameMap, IdentityModel),
      aggregateMissingManagersByLinkedApplication(
        tid,
        appNameMap,
        nonAuthoritativeAppIds,
        IdentityModel,
      ),
      aggregateAccessCertificationCampaignsByApplication(tid, appNameMap),
    ]);

  return buildHygieneWidgetsFromRollups(
    apps,
    entitlementStats,
    inactiveAccessByAppPrecomputed,
    managerMismatchByAppPrecomputed,
    statusMismatchByAppPrecomputed,
    sodTotals,
    duplicateAccountsByAppPrecomputed,
    orphansByApp,
    missingMgrBySource,
    missingMgrByLinkedApp,
    campaignsByApp,
    new Map(),
  );
}

function sameApplicationBucket(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left) === String(right);
}

/** Widgets whose share is not an in-app rate (no app accounts/entitlements base). */
const APPLICATION_TILE_NON_RATE_WIDGET_IDS = new Set([
  "accessCertificationCampaigns",
  "sodPoliciesViolations",
]);

function buildApplicationHygieneTiles(apps, widgetDefinitions, appAccountCountById = new Map()) {
  // Application dashboard tiles = registered tenant applications only.
  // Hygiene rows with no applicationId (e.g. Identity / Governance for access cert)
  // or a stale/unknown applicationId still appear on the function-wise widgets;
  // they are not separate "applications".
  const appBuckets = new Map(
    (apps || []).map((app) => [
      String(app._id),
      {
        id: `application:${String(app._id)}`,
        title: app.name || "Application",
        applicationId: String(app._id),
        authoritativeSource: Boolean(app.authoritativeSource),
      },
    ]),
  );

  const widgetsForApplicationTiles = widgetDefinitions.filter(
    (widget) => !APPLICATION_TILE_EXCLUDED_WIDGET_IDS.has(widget.id),
  );

  return [...appBuckets.values()]
    .map((bucket) => {
      const rows = widgetsForApplicationTiles.map((widget) => {
        const matched = (widget.allRows || []).find((row) =>
          sameApplicationBucket(row.applicationId, bucket.applicationId),
        );
        const count = matched?.count || 0;

        // Campaigns / SoD are absolute counts — do not show cross-tenant-share %.
        if (APPLICATION_TILE_NON_RATE_WIDGET_IDS.has(widget.id)) {
          return {
            label: widget.title,
            count,
            denominator: 0,
            percent: 0,
            percentBasis: null,
            applicationId: bucket.applicationId,
            detailWidgetId: widget.id,
          };
        }

        const denominator =
          Number(matched?.denominator) > 0
            ? Number(matched.denominator)
            : appAccountCountById.get(String(bucket.applicationId)) || 0;
        const percent =
          denominator > 0 ? Math.round((1000 * count) / denominator) / 10 : 0;

        return {
          label: widget.title,
          count,
          denominator,
          percent,
          percentBasis: widget.percentLabel || null,
          applicationId: bucket.applicationId,
          detailWidgetId: widget.id,
        };
      });

      const totalCount = rows.reduce((sum, row) => sum + (row.count || 0), 0);
      return {
        id: bucket.id,
        applicationId: bucket.applicationId,
        authoritativeSource: bucket.authoritativeSource,
        themeKey: "_application",
        title: bucket.title,
        percentLabel: "Share",
        primaryColumnLabel: "Metric",
        countColumnLabel: "Count",
        tip: bucket.authoritativeSource
          ? "Identity-source (authoritative) application. Metrics with no findings show as N/A — many target-app hygiene checks do not apply here."
          : "All data hygiene metrics for this application. Open any row with findings to see the detailed records.",
        rows,
        totalCount,
      };
    })
    .sort((a, b) => {
      if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
      return String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        sensitivity: "base",
      });
    })
    .map(({ totalCount, ...tile }) => tile);
}

function appLabel(map, applicationId) {
  if (applicationId == null) return "Not linked";
  const s = String(applicationId);
  return map.get(s) || "Unknown application";
}

/**
 * Human label for access-cert campaigns with no applicationId
 * (PROFILE / org-wide identity reviews vs GOVERNANCE).
 * @param {unknown[]} scopes
 */
function accessCertificationUnscopedLabel(scopes) {
  const normalized = (scopes || []).map((s) => String(s || "").toUpperCase());
  const set = new Set(normalized.filter(Boolean));
  const hasUnset = normalized.some((s) => !s);
  const hasGovernance = set.has("GOVERNANCE");
  const hasIdentityLike = hasUnset || [...set].some((s) => s !== "GOVERNANCE");

  if (hasGovernance && hasIdentityLike) return "Identity & governance";
  if (hasGovernance) return "Governance";
  return "Identity";
}

/**
 * @param {Map<string, string>} map
 * @param {import("mongoose").Types.ObjectId | null | undefined} applicationId
 * @param {unknown[]} [scopes]
 */
function accessCertificationBucketLabel(map, applicationId, scopes) {
  if (applicationId != null) return appLabel(map, applicationId);
  return accessCertificationUnscopedLabel(scopes);
}

function trimRows(rows) {
  return rows
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ROWS_PER_WIDGET);
}

function addRowPercentsOfGrandTotal(rows, options = {}) {
  const list = options.trim === false ? [...rows] : trimRows(rows);
  const total = list.reduce((s, r) => s + r.count, 0);
  return list.map((r) => ({
    application: r.application,
    applicationId: r.applicationId ?? null,
    count: r.count,
    denominator: total,
    percent: total > 0 ? Math.round((1000 * r.count) / total) / 10 : 0,
  }));
}

/** SoD tile: `count` = policies in scope per application. */
function addSodRowPercents(rows, options = {}) {
  const list = options.trim === false ? [...rows] : trimSodRows(rows);
  const policyTotal = list.reduce((s, r) => s + (r.policyCount || 0), 0);
  return list.map((r) => ({
    application: r.application,
    applicationId: r.applicationId ?? null,
    count: r.policyCount || 0,
    openViolations: r.openViolations || 0,
    denominator: policyTotal,
    percent:
      policyTotal > 0
        ? Math.round((1000 * (r.policyCount || 0)) / policyTotal) / 10
        : 0,
  }));
}

function trimSodRows(rows) {
  return rows
    .filter((r) => (r.policyCount || 0) > 0)
    .sort((a, b) => (b.policyCount || 0) - (a.policyCount || 0))
    .slice(0, MAX_ROWS_PER_WIDGET);
}

function sodTenantKey(tid) {
  return String(tid);
}

/**
 * Resolve primary application for a policy (first scoped app, same as SoD certification helpers).
 * @param {{ applications?: unknown[] }} policy
 * @returns {import("mongoose").Types.ObjectId | null}
 */
function primarySodPolicyApplicationId(policy) {
  const first = Array.isArray(policy?.applications) ? policy.applications[0] : null;
  if (first == null) return null;
  if (mongoose.Types.ObjectId.isValid(String(first))) {
    return new mongoose.Types.ObjectId(String(first));
  }
  return null;
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {Map<string, string>} appNameMap
 */
async function aggregateSodTotalsByApplication(tid, appNameMap) {
  const tenantKey = sodTenantKey(tid);
  const policies = await SodPolicy.find({ tenantId: tenantKey })
    .select("_id applications")
    .lean();

  const policyCountByAppKey = new Map();

  for (const p of policies) {
    const appId = primarySodPolicyApplicationId(p);
    const key = appId ? String(appId) : "__none__";
    policyCountByAppKey.set(key, (policyCountByAppKey.get(key) || 0) + 1);
  }

  // Live tallies from sod_violations via $group (not SodPolicy cached counters / full find).
  const openByPolicy = await SodViolation.aggregate([
    { $match: { tenantId: tenantKey, status: "open" } },
    { $group: { _id: "$policy", count: { $sum: 1 } } },
  ]);

  const policyToAppKey = new Map(
    policies.map((p) => {
      const appId = primarySodPolicyApplicationId(p);
      return [String(p._id), appId ? String(appId) : "__none__"];
    }),
  );

  const openByAppKey = new Map();
  for (const row of openByPolicy) {
    const key = policyToAppKey.get(String(row._id)) || "__none__";
    openByAppKey.set(key, (openByAppKey.get(key) || 0) + (row.count || 0));
  }

  const appKeys = new Set([...policyCountByAppKey.keys(), ...openByAppKey.keys()]);
  const byApp = [];
  let totalPolicies = 0;
  let totalOpenViolations = 0;

  for (const key of appKeys) {
    const policyCount = policyCountByAppKey.get(key) || 0;
    const openViolations = openByAppKey.get(key) || 0;
    totalPolicies += policyCount;
    totalOpenViolations += openViolations;
    const applicationId = key === "__none__" ? null : new mongoose.Types.ObjectId(key);
    byApp.push({
      application: appLabel(appNameMap, applicationId),
      applicationId,
      policyCount,
      openViolations,
    });
  }

  return { byApp, totalPolicies, totalOpenViolations };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
function sodPolicyMatchForApplication(tid, applicationId) {
  const base = { tenantId: sodTenantKey(tid) };
  if (applicationId === null) {
    return {
      ...base,
      $or: [
        { applications: { $exists: false } },
        { applications: null },
        { applications: { $size: 0 } },
      ],
    };
  }
  return { ...base, applications: applicationId };
}

const EMPTY_SOD_VIOLATION_COUNTS = {
  total: 0,
  open: 0,
  remediated: 0,
  exceptionGranted: 0,
  falsePositive: 0,
};

/**
 * Live tallies from sod_violations (not SodPolicy cached counters).
 * @param {string} tenantKey
 * @param {import("mongoose").Types.ObjectId[] | string[]} policyIds
 * @returns {Promise<Map<string, typeof EMPTY_SOD_VIOLATION_COUNTS>>}
 */
async function aggregateViolationCountsForPolicies(tenantKey, policyIds) {
  const map = new Map();
  const idStrs = [
    ...new Set(
      (policyIds || [])
        .map((id) => String(id))
        .filter((id) => mongoose.Types.ObjectId.isValid(id)),
    ),
  ];
  if (!idStrs.length) return map;

  for (const id of idStrs) {
    map.set(id, { ...EMPTY_SOD_VIOLATION_COUNTS });
  }

  const oids = idStrs.map((id) => new mongoose.Types.ObjectId(id));

  const statusGroups = await SodViolation.aggregate([
    { $match: { tenantId: tenantKey, policy: { $in: oids } } },
    {
      $group: {
        _id: { policy: "$policy", status: "$status" },
        count: { $sum: 1 },
      },
    },
  ]);

  for (const row of statusGroups) {
    const pid = String(row._id?.policy);
    const bucket = map.get(pid);
    if (!bucket) continue;
    const c = row.count || 0;
    const st = String(row._id?.status || "").toLowerCase();
    bucket.total += c;
    if (st === "open") bucket.open += c;
    else if (st === "remediated") bucket.remediated += c;
    else if (st === "exception_granted") bucket.exceptionGranted += c;
    else if (st === "false_positive") bucket.falsePositive += c;
  }

  return map;
}

function addPercentOfAppEntitlementTotal(rows, options = {}) {
  const list = options.trim === false ? [...rows] : trimRows(rows);
  return list.map((r) => ({
    application: r.application,
    applicationId: r.applicationId ?? null,
    count: r.count,
    denominator: r.denominator ?? 0,
    percent:
      r.denominator > 0 ? Math.round((1000 * r.count) / r.denominator) / 10 : 0,
  }));
}

/**
 * Attach per-application account totals so share = findings / accounts in that app.
 * @param {Array<{ applicationId?: unknown, count?: number, application?: string }>} rows
 * @param {Map<string, number>} appAccountCountById
 */
function attachAppAccountDenominator(rows, appAccountCountById) {
  return (rows || []).map((r) => ({
    ...r,
    denominator: appAccountCountById.get(String(r.applicationId)) || 0,
  }));
}

/**
 * Total rows in each app's users collection (application accounts).
 * @param {import("mongoose").default.mongo.Db} db
 * @param {Array<{ _id: import("mongoose").Types.ObjectId, name: string }>} apps
 * @param {string|null} tenantSlug
 * @returns {Promise<Map<string, number>>}
 */
async function aggregateAppAccountCountsByApplication(db, apps, tenantSlug) {
  /** @type {Map<string, number>} */
  const map = new Map();
  if (!tenantSlug || !apps?.length) return map;

  await mapWithConcurrency(apps, UNASSIGNED_ENTITLEMENT_APP_CONCURRENCY, async (app) => {
    let n = 0;
    try {
      const usersColl = getAppUsersCollectionName(app.name, tenantSlug);
      n = await db.collection(usersColl).countDocuments({});
    } catch {
      n = 0;
    }
    map.set(String(app._id), n);
  });
  return map;
}

/** PK collision groups from application_user_duplicates (ingest sidecar). */
async function aggregateDuplicateAccountsByApplication(tid, appNameMap) {
  const raw = await ApplicationUserDuplicate.aggregate([
    { $match: { tenantId: tid } },
    {
      $group: {
        _id: "$applicationId",
        count: { $sum: 1 },
        extraRows: { $sum: "$duplicateCount" },
      },
    },
  ]);
  return raw.map((r) => ({
    application: appLabel(appNameMap, r._id),
    applicationId: r._id,
    count: r.count,
    extraRows: r.extraRows ?? 0,
  }));
}

async function aggregateAccessCertificationCampaignsByApplication(tid, appNameMap) {
  const raw = await Campaign.aggregate([
    { $match: { tenantId: tid } },
    {
      $group: {
        _id: "$applicationId",
        count: { $sum: 1 },
        scopes: { $addToSet: "$certificationScope" },
      },
    },
  ]);
  return raw.map((r) => ({
    application: accessCertificationBucketLabel(appNameMap, r._id, r.scopes),
    applicationId: r._id,
    count: r.count,
  }));
}

async function aggregateOrphansByApplication(tid, appNameMap) {
  const raw = await OrphanAccount.aggregate([
    { $match: { tenantId: tid, status: "OPEN" } },
    {
      $group: {
        _id: "$applicationId",
        count: { $sum: 1 },
      },
    },
  ]);
  return raw.map((r) => ({
    application: appLabel(appNameMap, r._id),
    applicationId: r._id,
    count: r.count,
  }));
}

async function aggregateMissingManagersBySource(tid, appNameMap, IdentityModel) {
  const raw = await IdentityModel.aggregate([
    { $match: missingManagerIdentityMatch(tid) },
    {
      $group: {
        _id: "$sourceApplication",
        count: { $sum: 1 },
      },
    },
  ]);
  return raw.map((r) => ({
    application: appLabel(appNameMap, r._id),
    applicationId: r._id,
    count: r.count,
  }));
}

/**
 * Distinct identities missing a manager, counted once per **non-authoritative** tenant
 * application where they have an active identity–account link. Authoritative HR / directory
 * source apps are excluded (those appear under "Missing managers by identity source").
 *
 * Inverted path: start from indexed identity_account_links, then restrict to missing-manager identities.
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {Map<string, string>} appNameMap
 * @param {import('mongoose').Types.ObjectId[]} nonAuthoritativeAppIds
 * @param {import('mongoose').Model} IdentityModel
 */
async function aggregateMissingManagersByLinkedApplication(
  tid,
  appNameMap,
  nonAuthoritativeAppIds,
  IdentityModel,
) {
  if (!nonAuthoritativeAppIds?.length) return [];

  const missingIds = await IdentityModel.find(missingManagerIdentityMatch(tid)).select("_id").lean();
  if (!missingIds.length) return [];

  const identityIds = missingIds.map((d) => d._id);
  /** @type {Map<string, { applicationId: import("mongoose").Types.ObjectId, count: number }>} */
  const byApp = new Map();

  const mergeRaw = (raw) => {
    for (const r of raw) {
      const key = String(r._id);
      const prev = byApp.get(key);
      if (prev) prev.count += r.count || 0;
      else byApp.set(key, { applicationId: r._id, count: r.count || 0 });
    }
  };

  const runChunk = (chunk) =>
    IdentityAccountLink.aggregate([
      {
        $match: {
          isActive: true,
          applicationId: { $in: nonAuthoritativeAppIds },
          identityId: { $in: chunk },
        },
      },
      {
        $group: {
          _id: {
            app: "$applicationId",
            ident: "$identityId",
          },
        },
      },
      {
        $group: {
          _id: "$_id.app",
          count: { $sum: 1 },
        },
      },
    ]);

  if (identityIds.length <= MANAGER_MISMATCH_SINGLE_IN_MAX) {
    mergeRaw(await runChunk(identityIds));
  } else {
    const parts = await mapChunksParallel(identityIds, MANAGER_MISMATCH_QUERY_CHUNK, runChunk);
    for (const raw of parts) mergeRaw(raw);
  }

  return [...byApp.values()].map((r) => ({
    application: appLabel(appNameMap, r.applicationId),
    applicationId: r.applicationId,
    count: r.count,
  }));
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {string} widget
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 * @param {number} page 1-based
 * @param {number} limit
 */
export function isValidWidgetKey(widget) {
  return WIDGET_ITEM_KEYS.has(widget);
}

/** Max rows scanned when applying detail-page search (then filtered + paginated). */
const HYGIENE_SEARCH_SCAN_CAP = 10000;

/**
 * @param {unknown} search
 * @returns {string}
 */
function normalizeHygieneSearch(search) {
  return String(search ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Flatten primitive values from a hygiene item for substring search.
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {string[]}
 */
function collectHygieneSearchTokens(value, depth = 0) {
  if (value == null || depth > 3) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const s = String(value).trim();
    return s ? [s] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => collectHygieneSearchTokens(v, depth + 1));
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap((v) => collectHygieneSearchTokens(v, depth + 1));
  }
  return [];
}

/**
 * @param {object} item
 * @param {string} q normalized lowercase search
 */
function hygieneItemMatchesSearch(item, q) {
  if (!q) return true;
  if (!item || typeof item !== "object") return false;
  const hay = collectHygieneSearchTokens(item).join(" ").toLowerCase();
  return hay.includes(q);
}

/**
 * When `search` is set: scan up to HYGIENE_SEARCH_SCAN_CAP, filter, then page.
 * @param {(skip: number, limit: number) => Promise<{ items: object[], total: number }>} listCall
 * @param {number} skip
 * @param {number} limit
 * @param {string} [search]
 */
async function paginateHygieneListWithSearch(listCall, skip, limit, search) {
  const q = normalizeHygieneSearch(search);
  if (!q) return listCall(skip, limit);
  const { items: scanned } = await listCall(0, HYGIENE_SEARCH_SCAN_CAP);
  const filtered = (scanned || []).filter((item) => hygieneItemMatchesSearch(item, q));
  return {
    total: filtered.length,
    items: filtered.slice(skip, skip + limit),
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {string} widget
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 * @param {number} page
 * @param {number} limit
 * @param {string} [search]
 */
export async function listDataHygieneWidgetItems(tid, widget, applicationId, page, limit, search) {
  const cap = Math.min(Math.max(1, limit), MAX_WIDGET_DETAIL_PAGE_SIZE);
  const p = Math.max(1, page);
  const skip = (p - 1) * cap;
  const q = normalizeHygieneSearch(search);
  const { apps, appNameMap, tenantAppIds, nonAuthoritativeAppIds, IdentityModel } =
    await loadTenantHygieneContext(tid);
  const applicationLabel =
    widget === "accessCertificationCampaigns" && applicationId == null
      ? "Identity"
      : appLabel(appNameMap, applicationId);
  const base = {
    page: p,
    limit: cap,
    widget,
    applicationLabel,
    computedAt: new Date().toISOString(),
    ...(q ? { search: q } : {}),
  };

  switch (widget) {
    case "orphanedProfiles": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listOrphanProfileItems(tid, applicationId, s, l, appNameMap),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "missingManagers": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listMissingManagerBySourceItems(tid, applicationId, s, l, appNameMap, IdentityModel),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "missingManagersByApplication": {
      if (!applicationId) {
        return { ...base, items: [], total: 0 };
      }
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listMissingManagerByLinkedAppItems(
            tid,
            applicationId,
            appNameMap,
            nonAuthoritativeAppIds,
            s,
            l,
            IdentityModel,
          ),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "managerMismatches": {
      if (!applicationId) {
        return { ...base, items: [], total: 0 };
      }
      const application = apps.find((app) => String(app._id) === String(applicationId));
      if (!application) {
        return { ...base, items: [], total: 0 };
      }
      // Materialized: Mongo-side indexed search (no 10k in-memory scan).
      if (await isManagerMismatchSidecarReady(application._id)) {
        const { items, total } = await listManagerMismatchItemsFromSidecar(
          application._id,
          skip,
          cap,
          q,
        );
        return { ...base, items, total };
      }
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listManagerMismatchItems(tid, application, appNameMap, s, l, IdentityModel),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "statusMismatches": {
      if (!applicationId) {
        return { ...base, items: [], total: 0 };
      }
      const inScope = nonAuthoritativeAppIds.some((id) => String(id) === String(applicationId));
      if (!inScope) {
        return { ...base, items: [], total: 0 };
      }
      const application = apps.find((app) => String(app._id) === String(applicationId));
      if (!application) {
        return { ...base, items: [], total: 0 };
      }
      if (await isStatusMismatchSidecarReady(application._id)) {
        const { items, total } = await listStatusMismatchItemsFromSidecar(
          application._id,
          skip,
          cap,
          q,
        );
        return { ...base, items, total };
      }
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listStatusMismatchItems(tid, application, appNameMap, s, l, IdentityModel),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "unassignedEntitlements": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listUnassignedEntitlementItems(tid, applicationId, s, l),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "privilegedEntitlements": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listPrivilegedEntitlementItems(tid, applicationId, s, l),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "entitlementsMissingOwner": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listEntitlementsMissingOwnerItems(tid, applicationId, s, l),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "inactiveUsersWithAccess": {
      if (!applicationId) {
        return { ...base, items: [], total: 0 };
      }
      const inTenant = tenantAppIds.some(
        (id) => String(id) === String(applicationId)
      );
      if (!inTenant) {
        return { ...base, items: [], total: 0 };
      }
      if (await isInactiveAccessSidecarReady(applicationId)) {
        const { items, total } = await listInactiveUsersWithAccessItems(
          tid,
          applicationId,
          skip,
          cap,
          applicationLabel,
          q,
        );
        return { ...base, items, total };
      }
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listInactiveUsersWithAccessItems(tid, applicationId, s, l, applicationLabel),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "accessCertificationCampaigns": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) =>
          listAccessCertificationCampaignItems(tid, applicationId, s, l, appNameMap),
        skip,
        cap,
        q,
      );
      let label = applicationLabel;
      if (applicationId == null) {
        const scopes = await Campaign.distinct(
          "certificationScope",
          accessCertificationCampaignItemMatch(tid, null),
        );
        label = accessCertificationUnscopedLabel(scopes);
      }
      return { ...base, applicationLabel: label, items, total };
    }
    case "sodPoliciesViolations": {
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listSodPoliciesViolationsItems(tid, applicationId, s, l, appNameMap),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    case "duplicateAccountsByApplication": {
      if (!applicationId) {
        return { ...base, items: [], total: 0 };
      }
      const inTenant = tenantAppIds.some(
        (id) => String(id) === String(applicationId),
      );
      if (!inTenant) {
        return { ...base, items: [], total: 0 };
      }
      const { items, total } = await paginateHygieneListWithSearch(
        (s, l) => listDuplicateAccountItems(tid, applicationId, s, l, applicationLabel),
        skip,
        cap,
        q,
      );
      return { ...base, items, total };
    }
    default:
      return { ...base, items: [], total: 0 };
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
function accessCertificationCampaignItemMatch(tid, applicationId) {
  const base = { tenantId: tid };
  if (applicationId === null) {
    return {
      ...base,
      $or: [{ applicationId: null }, { applicationId: { $exists: false } }],
    };
  }
  return { ...base, applicationId };
}

/**
 * Live review tallies from `review_items` (same rules as access-cert `getProgress`).
 * @param {import('mongoose').Types.ObjectId[]} campaignIds
 * @returns {Promise<Map<string, { approved: number, revoked: number, pending: number, total: number }>>}
 */
async function aggregateCampaignReviewCountsByCampaignIds(campaignIds) {
  const map = new Map();
  if (!campaignIds?.length) return map;

  const oids = campaignIds
    .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!oids.length) return map;

  const rows = await ReviewItem.aggregate([
    { $match: { campaignId: { $in: oids } } },
    {
      $group: {
        _id: { campaignId: "$campaignId", status: "$status" },
        count: { $sum: 1 },
      },
    },
  ]);

  for (const r of rows) {
    const cid = String(r._id?.campaignId);
    if (!cid) continue;
    if (!map.has(cid)) {
      map.set(cid, { approved: 0, revoked: 0, pending: 0, total: 0 });
    }
    const bucket = map.get(cid);
    const c = r.count || 0;
    const st = String(r._id?.status || "");
    bucket.total += c;
    if (st === "PENDING") bucket.pending += c;
    else if (st === "APPROVED" || st === "DELEGATED" || st === "EXCEPTION") bucket.approved += c;
    else if (st === "REVOKED") bucket.revoked += c;
  }
  return map;
}

/**
 * Align with Access Certification dashboard when ReviewItem rows are not materialized yet.
 * @param {Record<string, unknown>} campaignLean
 */
function resolveCampaignScopeTotal(campaignLean) {
  const selectedLen = Array.isArray(campaignLean.selectedIds)
    ? campaignLean.selectedIds.length
    : 0;
  return Math.max(
    Number(campaignLean.totalScope) || 0,
    selectedLen,
    Number(campaignLean.totalItems) || 0,
  );
}

/**
 * @param {Record<string, unknown>} campaignLean
 * @param {{ approved: number, revoked: number, pending: number, total: number } | undefined} fromReviewItems
 */
function resolveCampaignReviewCounts(campaignLean, fromReviewItems) {
  if (fromReviewItems && fromReviewItems.total > 0) {
    return { ...fromReviewItems };
  }

  const scopeTotal = resolveCampaignScopeTotal(campaignLean);
  if (scopeTotal > 0) {
    const approved = Number(campaignLean.approvedItems) || 0;
    const revoked = Number(campaignLean.revokedItems) || 0;
    let pending = Number(campaignLean.pendingItems) || 0;
    if (approved + revoked + pending === 0) {
      pending = scopeTotal;
    } else {
      pending = Math.max(0, scopeTotal - approved - revoked);
    }
    return {
      approved,
      revoked,
      pending,
      total: scopeTotal,
    };
  }

  const approved = Number(campaignLean.approvedItems) || 0;
  const revoked = Number(campaignLean.revokedItems) || 0;
  const pending = Number(campaignLean.pendingItems) || 0;
  return {
    approved,
    revoked,
    pending,
    total: approved + revoked + pending,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 * @param {Map<string, string>} appNameMap
 */
async function listAccessCertificationCampaignItems(
  tid,
  applicationId,
  skip,
  limit,
  appNameMap,
) {
  const match = accessCertificationCampaignItemMatch(tid, applicationId);
  const [total, docs] = await Promise.all([
    Campaign.countDocuments(match),
    Campaign.find(match)
      .select(
        "name status category certificationScope startDate dueDate applicationId applicationName createdAt approvedItems revokedItems pendingItems totalScope totalItems selectedIds",
      )
      .sort({ createdAt: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const reviewCountsByCampaign = await aggregateCampaignReviewCountsByCampaignIds(
    docs.map((d) => d._id),
  );

  const items = docs.map((d) => {
    const appOid = d.applicationId ?? null;
    const cid = d._id ? String(d._id) : "";
    const counts = resolveCampaignReviewCounts(
      d,
      reviewCountsByCampaign.get(cid),
    );
    return {
      kind: "campaign",
      id: d._id ? String(d._id) : null,
      name: d.name ?? null,
      status: d.status ?? null,
      category: d.category ?? null,
      certificationScope: d.certificationScope ?? null,
      startDate: d.startDate ? new Date(d.startDate).toISOString() : null,
      dueDate: d.dueDate ? new Date(d.dueDate).toISOString() : null,
      applicationId: appOid != null ? String(appOid) : null,
      applicationLabel:
        d.applicationName?.trim() ||
        accessCertificationBucketLabel(appNameMap, appOid, [
          d.certificationScope,
        ]),
      approvedItems: counts.approved,
      revokedItems: counts.revoked,
      pendingItems: counts.pending,
      totalItems: counts.total,
    };
  });
  return { items, total };
}

/**
 * Policies in scope for the selected application (tile drill-down).
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
async function listSodPoliciesViolationsItems(tid, applicationId, skip, limit, appNameMap) {
  const tenantKey = sodTenantKey(tid);
  const policyMatch = sodPolicyMatchForApplication(tid, applicationId);
  const appOid = applicationId;
  const applicationLabel = appLabel(appNameMap, appOid);

  const policies = await SodPolicy.find(policyMatch)
    .select(
      "policyId name description status severity type owner ownerEmail lastScanDate",
    )
    .lean();

  const countsByPolicy = await aggregateViolationCountsForPolicies(
    tenantKey,
    policies.map((p) => p._id),
  );

  const ranked = policies
    .map((p) => {
      const pid = p._id ? String(p._id) : "";
      const c = countsByPolicy.get(pid) || { ...EMPTY_SOD_VIOLATION_COUNTS };
      return { p, c };
    })
    .sort((a, b) => {
      const openDiff = (b.c.open || 0) - (a.c.open || 0);
      if (openDiff !== 0) return openDiff;
      return String(a.p.name || "").localeCompare(String(b.p.name || ""));
    });

  const total = ranked.length;
  const page = ranked.slice(skip, skip + limit);

  const items = page.map(({ p, c }) => ({
    kind: "sodPolicy",
    id: p._id ? String(p._id) : null,
    policyId: p.policyId ?? null,
    name: p.name ?? null,
    description: p.description ?? null,
    status: p.status ?? null,
    severity: p.severity ?? null,
    type: p.type ?? null,
    openViolations: c.open,
    totalViolations: c.total,
    remediated: c.remediated,
    exceptionGranted: c.exceptionGranted,
    falsePositive: c.falsePositive,
    owner: p.owner ?? null,
    ownerEmail: p.ownerEmail ?? null,
    lastScanDate: p.lastScanDate ? new Date(p.lastScanDate).toISOString() : null,
    applicationId: appOid != null ? String(appOid) : null,
    applicationLabel,
  }));

  return { items, total };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId} applicationId
 */
async function listDuplicateAccountItems(tid, applicationId, skip, limit, applicationLabel) {
  const filter = {
    tenantId: tid,
    applicationId: applicationIdInClause(applicationId),
  };
  const app = await Application.findById(applicationId)
    .select("userMappings csvImportMapping")
    .lean();
  const appSchema = app
    ? {
        userMappings: app.userMappings || [],
        csvImportMapping: app.csvImportMapping || null,
      }
    : null;
  const [total, docs] = await Promise.all([
    ApplicationUserDuplicate.countDocuments(filter),
    ApplicationUserDuplicate.find(filter)
      .select(
        "primaryKeyField primaryKeyValue primaryKeyNormalized duplicateCount canonicalization observedAt source canonicalRow rows",
      )
      .sort({ duplicateCount: -1, observedAt: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const items = docs.map((d) => {
    const summary = summarizeDuplicateAccountForDisplay(d, appSchema);
    return {
      kind: "duplicateAccount",
      id: d._id ? String(d._id) : null,
      displayName: summary.displayName || null,
      email: summary.email || null,
      username: summary.username || null,
      employeeId: summary.employeeId || null,
      department: summary.department || null,
      jobTitle: summary.jobTitle || null,
      managerName: summary.managerName || null,
      organizationRole: summary.organizationRole || null,
      status: summary.status || null,
      suspended: summary.suspended || null,
      applicationId: applicationId != null ? String(applicationId) : null,
      applicationLabel,
    };
  });

  return { items, total };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
function orphanItemMatch(tid, applicationId) {
  const base = { tenantId: tid, status: "OPEN" };
  if (applicationId === null) {
    return {
      ...base,
      $or: [{ applicationId: null }, { applicationId: { $exists: false } }],
    };
  }
  return { ...base, applicationId };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
async function listOrphanProfileItems(tid, applicationId, skip, limit, appNameMap) {
  const match = orphanItemMatch(tid, applicationId);
  const [total, docs] = await Promise.all([
    OrphanAccount.countDocuments(match),
    OrphanAccount.find(match)
      .select(
        "accountName accountId correlationKey riskLevel status lastLoginAt detectedAt applicationId tenantId workflowStatus currentStepLabel nextCheckAt"
      )
      .populate("applicationId", "name tenantId userMappings lastManualCorrelation")
      .sort({ detectedAt: -1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  let enriched = docs;
  try {
    enriched = await enrichOrphanRowsForDisplay(docs);
  } catch (enrichErr) {
    console.warn("[listOrphanProfileItems] enrichOrphanRowsForDisplay:", enrichErr?.message);
  }
  const items = enriched.map((d) => {
    const appOid =
      d.applicationId && typeof d.applicationId === "object" && d.applicationId._id
        ? d.applicationId._id
        : d.applicationId;
    return {
      kind: "orphan",
      id: d._id ? String(d._id) : null,
      accountName: d.accountName ?? null,
      correlationKey: d.correlationKey ?? null,
      correlationDisplay: orphanDisplayFromCorrelationKey(d.correlationKey) || null,
      userEmail: d.userEmail ?? null,
      userEmployeeId: d.userEmployeeId ?? null,
      userUsername: d.userUsername ?? null,
      userDisplayName: d.userDisplayName ?? null,
      riskLevel: d.riskLevel ?? null,
      status: d.status ?? null,
      lastLoginAt: d.lastLoginAt ? d.lastLoginAt.toISOString() : null,
      detectedAt: d.detectedAt ? d.detectedAt.toISOString() : null,
      applicationId: appOid != null ? String(appOid) : null,
      applicationLabel: appLabel(appNameMap, appOid),
      workflowStatus: d.workflowStatus ?? null,
      currentStepLabel: d.currentStepLabel ?? null,
      nextCheckAt: d.nextCheckAt ? d.nextCheckAt.toISOString() : null,
    };
  });
  return { items, total };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
function missingBySourceItemMatch(tid, applicationId) {
  const base = missingManagerIdentityMatch(tid);
  if (applicationId === null) {
    return {
      ...base,
      $or: [
        { sourceApplication: null },
        { sourceApplication: { $exists: false } },
      ],
    };
  }
  return { ...base, sourceApplication: applicationId };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
async function listMissingManagerBySourceItems(tid, applicationId, skip, limit, appNameMap, IdentityModel) {
  const match = missingBySourceItemMatch(tid, applicationId);
  const [total, docs] = await Promise.all([
    IdentityModel.countDocuments(match),
    IdentityModel.find(match)
      .select(
        "displayName firstName lastName email employeeId lifecycleState identityType sourceApplication totalEntitlements riskLevel managerResolutionStatus managerKeyRaw isRoot"
      )
      .sort({ displayName: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);
  const items = docs.map((d) => mapIdentityToMissingManagerHygieneItem(d, appNameMap));
  return { items, total };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {Map<string, string>} appNameMap
 * @param {import('mongoose').Types.ObjectId[]} nonAuthoritativeAppIds
 * @param {number} skip
 * @param {number} limit
 * @param {import('mongoose').Model} IdentityModel
 */
async function listMissingManagerByLinkedAppItems(
  tid,
  applicationId,
  appNameMap,
  nonAuthoritativeAppIds,
  skip,
  limit,
  IdentityModel,
) {
  if (!nonAuthoritativeAppIds?.length) {
    return { items: [], total: 0 };
  }
  const inScope = nonAuthoritativeAppIds.some((id) => String(id) === String(applicationId));
  if (!inScope) {
    return { items: [], total: 0 };
  }
  const appLabelValue = appNameMap.get(String(applicationId)) || "Application";
  const linkLookup = {
    $lookup: {
      from: "identity_account_links",
      let: { iid: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ["$identityId", "$$iid"] },
                { $eq: ["$isActive", true] },
                { $eq: ["$applicationId", applicationId] },
              ],
            },
          },
        },
        { $limit: 1 },
      ],
      as: "links",
    },
  };
  const afterLink = {
    $match: { "links.0": { $exists: true } },
  };
  const projectStage = {
    $project: {
      _id: 0,
      kind: { $literal: "identity" },
      id: { $toString: "$_id" },
      displayName: 1,
      firstName: 1,
      lastName: 1,
      email: 1,
      employeeId: 1,
      lifecycleState: 1,
      identityType: 1,
      totalEntitlements: { $ifNull: ["$totalEntitlements", 0] },
      riskLevel: 1,
      managerResolutionStatus: 1,
      managerKeyRaw: 1,
      isRoot: { $ifNull: ["$isRoot", false] },
      _srcApp: "$sourceApplication",
      sourceApplication: {
        $cond: {
          if: { $ifNull: ["$sourceApplication", false] },
          then: { $toString: "$sourceApplication" },
          else: null,
        },
      },
      linkedApplicationId: { $toString: applicationId },
      linkedApplicationLabel: { $literal: appLabelValue },
    },
  };
  const pipeline = [
    { $match: missingManagerIdentityMatch(tid) },
    linkLookup,
    afterLink,
    {
      $facet: {
        meta: [{ $count: "c" }],
        data: [
          { $sort: { displayName: 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          projectStage,
        ],
      },
    },
  ];
  const [facetResult] = await IdentityModel.aggregate(pipeline);
  const total = facetResult?.meta?.[0]?.c ?? 0;
  const itemsRaw = facetResult?.data ?? [];
  const items = itemsRaw.map((it) => {
    const { _srcApp, ...rest } = it;
    return mapIdentityToMissingManagerHygieneItem(
      {
        _id: rest.id,
        displayName: rest.displayName,
        firstName: rest.firstName,
        lastName: rest.lastName,
        email: rest.email,
        employeeId: rest.employeeId,
        lifecycleState: rest.lifecycleState,
        identityType: rest.identityType,
        totalEntitlements: rest.totalEntitlements,
        riskLevel: rest.riskLevel,
        sourceApplication: _srcApp,
        managerResolutionStatus: rest.managerResolutionStatus,
        managerKeyRaw: rest.managerKeyRaw,
        isRoot: rest.isRoot,
      },
      appNameMap,
      {
        linkedApplicationId: rest.linkedApplicationId,
        linkedApplicationLabel: appLabelValue,
      },
    );
  });
  return { items, total };
}

async function listManagerMismatchItems(
  tid,
  application,
  appNameMap,
  skip,
  limit,
  IdentityModel,
  search,
) {
  const applicationLabel = appLabel(appNameMap, application._id);

  if (await isManagerMismatchSidecarReady(application._id)) {
    return listManagerMismatchItemsFromSidecar(application._id, skip, limit, search);
  }

  const live = await collectManagerMismatchRecordsForApplication(
    tid,
    application,
    applicationLabel,
    IdentityModel,
    { includeItems: true, skip, limit },
  );

  void rebuildManagerMismatchSidecarForApplication(tid, application).catch(() => {});
  return live;
}

async function listStatusMismatchItems(
  tid,
  application,
  appNameMap,
  skip,
  limit,
  IdentityModel,
  search,
) {
  const applicationLabel = appLabel(appNameMap, application._id);

  if (await isStatusMismatchSidecarReady(application._id)) {
    return listStatusMismatchItemsFromSidecar(application._id, skip, limit, search);
  }

  const live = await collectStatusMismatchRecordsForApplication(
    tid,
    application,
    applicationLabel,
    IdentityModel,
    { includeItems: true, skip, limit },
  );

  void rebuildStatusMismatchSidecarForApplication(tid, application).catch(() => {});
  return live;
}

/**
 * @param {object} doc
 * @param {object} raw
 * @param  {...string} keys
 */
function pickEntitlementCatalogField(doc, raw, ...keys) {
  for (const key of keys) {
    const top = doc?.[key];
    if (top != null && String(top).trim() !== "") return top;
    const nested = raw?.[key];
    if (nested != null && String(nested).trim() !== "") return nested;
  }
  return null;
}

/**
 * @param {object} d native entitlement document
 * @param {string} applicationIdStr
 * @param {string} appLabelValue
 */
function mapNativeEntitlementDocToHygieneItem(d, applicationIdStr, appLabelValue) {
  const raw = d.rawData && typeof d.rawData === "object" ? d.rawData : {};
  const entitlementId = pickEntitlementCatalogField(d, raw, "entitlement_id", "entitlementId");
  const entitlementName = pickEntitlementCatalogField(
    d,
    raw,
    "entitlement_name",
    "name",
    "displayName",
    "display_name",
  );
  const description = pickEntitlementCatalogField(
    d,
    raw,
    "entitlement_description",
    "description",
  );
  const isPrivilegeRaw = pickEntitlementCatalogField(d, raw, "is_privilege", "isPrivileged");
  const isPrivileged =
    isPrivilegeRaw === true ||
    String(isPrivilegeRaw ?? "")
      .trim()
      .toLowerCase() === "true" ||
    String(isPrivilegeRaw ?? "")
      .trim()
      .toLowerCase() === "yes" ||
    String(isPrivilegeRaw ?? "").trim() === "1";

  return {
    kind: "entitlement",
    id: d._id ? String(d._id) : null,
    entitlementId,
    entitlementName: entitlementName ?? entitlementId,
    name: entitlementId,
    displayName: entitlementName,
    applicationId: applicationIdStr,
    applicationLabel: appLabelValue,
    description,
    entitlementType: pickEntitlementCatalogField(d, raw, "entitlement_type", "type"),
    applicationCode: pickEntitlementCatalogField(d, raw, "application"),
    classification: pickEntitlementCatalogField(d, raw, "classification"),
    isPrivileged,
    isPrivilege: isPrivilegeRaw,
    owner: pickEntitlementCatalogField(d, raw, "owner", "entitlement_owner"),
    ownerEmail: pickEntitlementCatalogField(d, raw, "ownerEmail", "owner_email"),
    grantedVia: pickEntitlementCatalogField(d, raw, "granted_via", "grantedVia"),
    source: pickEntitlementCatalogField(d, raw, "source"),
    grantedAt: pickEntitlementCatalogField(d, raw, "granted_at", "grantedAt"),
    validFrom: pickEntitlementCatalogField(d, raw, "valid_from", "validFrom"),
    validTo: pickEntitlementCatalogField(d, raw, "valid_to", "validTo"),
    isActive: pickEntitlementCatalogField(d, raw, "is_active", "isActive"),
    tags: pickEntitlementCatalogField(d, raw, "tags"),
    riskLevel: pickEntitlementCatalogField(d, raw, "riskLevel", "risk_level"),
  };
}

function entitlementHygieneListFacetStage(skip, limit) {
  return {
    $facet: {
      meta: [{ $count: "c" }],
      data: [
        { $sort: { entitlement_name: 1, entitlement_id: 1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
      ],
    },
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId | null} applicationId
 */
async function resolveApplicationEntitlementHygiene(tid, applicationId) {
  if (applicationId == null) return null;
  const application = await Application.findOne({ _id: applicationId, tenantId: tid }).lean();
  if (!application) return null;
  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) return null;
  try {
    const { entsColl, corrColl } = resolveEntitlementHygieneCollections(application, tenantSlug);
    return {
      application,
      db: mongoose.connection.db,
      entsColl,
      corrColl,
      appId: application._id,
      appIdStr: String(applicationId),
      appLabelValue: application.name || "Application",
    };
  } catch {
    return null;
  }
}

/**
 * @param {Awaited<ReturnType<typeof resolveApplicationEntitlementHygiene>>} ctx
 * @param {object[]} pipelinePrefix
 * @param {number} skip
 * @param {number} limit
 */
async function runEntitlementHygieneList(ctx, pipelinePrefix, skip, limit) {
  if (!ctx) return { items: [], total: 0 };
  try {
    const [facetOut] = await ctx.db
      .collection(ctx.entsColl)
      .aggregate([...pipelinePrefix, entitlementHygieneListFacetStage(skip, limit)])
      .toArray();
    const total = facetOut?.meta?.[0]?.c ?? 0;
    const docs = facetOut?.data ?? [];
    const items = docs.map((d) =>
      mapNativeEntitlementDocToHygieneItem(d, ctx.appIdStr, ctx.appLabelValue),
    );
    return { items, total };
  } catch {
    return { items: [], total: 0 };
  }
}

/**
 * Entitlements in `app_iga_*_*_entitlements` with no user in `app_<app>_correlation`.
 */
async function listUnassignedEntitlementItems(tid, applicationId, skip, limit) {
  const ctx = await resolveApplicationEntitlementHygiene(tid, applicationId);
  if (!ctx) return { items: [], total: 0 };
  let assignedIds = [];
  try {
    assignedIds = await ctx.db
      .collection(ctx.corrColl)
      .distinct("entitlementId", { applicationId: ctx.appId });
  } catch {
    return { items: [], total: 0 };
  }
  const match =
    assignedIds.length > 0
      ? { applicationId: ctx.appId, _id: { $nin: assignedIds } }
      : { applicationId: ctx.appId };
  return runEntitlementHygieneList(ctx, [{ $match: match }], skip, limit);
}

/** Privileged entitlement catalog rows for one tenant application. */
async function listPrivilegedEntitlementItems(tid, applicationId, skip, limit) {
  const ctx = await resolveApplicationEntitlementHygiene(tid, applicationId);
  if (!ctx) return { items: [], total: 0 };
  return runEntitlementHygieneList(
    ctx,
    [{ $match: matchPrivilegedEntitlementsForApplication(ctx.appId) }],
    skip,
    limit,
  );
}

/** Entitlement catalog rows with no owner / ownerEmail / entitlement_owner. */
async function listEntitlementsMissingOwnerItems(tid, applicationId, skip, limit) {
  const ctx = await resolveApplicationEntitlementHygiene(tid, applicationId);
  if (!ctx) return { items: [], total: 0 };
  return runEntitlementHygieneList(
    ctx,
    [{ $match: matchEntitlementsMissingOwnerForApplication(ctx.appId) }],
    skip,
    limit,
  );
}

/**
 * Inactive application users with entitlements for one app (`app_iga_*_*_users`).
 * Prefers sidecar user ids when built; otherwise live scan (and seeds sidecar).
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {number} skip
 * @param {number} limit
 * @param {string} applicationLabel
 * @param {string} [search]
 */
async function listInactiveUsersWithAccessItems(
  tid,
  applicationId,
  skip,
  limit,
  applicationLabel,
  search,
) {
  const app = await Application.findOne({ _id: applicationId, tenantId: tid })
    .select("name")
    .lean();
  if (!app?.name) return { items: [], total: 0 };

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) return { items: [], total: 0 };

  let usersColl;
  try {
    usersColl = getAppUsersCollectionName(app.name, tenantSlug);
  } catch {
    return { items: [], total: 0 };
  }

  const db = mongoose.connection.db;

  if (await isInactiveAccessSidecarReady(applicationId)) {
    const { total, userIds } = await listInactiveAccessUserIdsFromSidecar(
      applicationId,
      skip,
      limit,
      search,
    );
    if (!userIds.length) return { items: [], total };
    const users = await db
      .collection(usersColl)
      .find({ _id: { $in: userIds } })
      .project(INACTIVE_APP_USER_PROJECTION)
      .toArray();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    const items = userIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((user) =>
        mapAppUserToInactiveAccessHygieneItem(user, applicationId, applicationLabel),
      )
      .sort((a, b) =>
        String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, {
          sensitivity: "base",
        }),
      );
    return { items, total };
  }

  const matches = [];
  const allUsers = [];
  try {
    const cursor = db
      .collection(usersColl)
      .find({ applicationId })
      .project(INACTIVE_APP_USER_PROJECTION)
      .batchSize(500);
    for await (const user of cursor) {
      allUsers.push(user);
      if (isInactiveAppUserWithAccess(user)) {
        matches.push(mapAppUserToInactiveAccessHygieneItem(user, applicationId, applicationLabel));
      }
    }
  } catch {
    return { items: [], total: 0 };
  }

  void rebuildInactiveAccessSidecar({
    applicationId,
    tenantId: tid,
    users: allUsers,
  }).catch(() => {});

  matches.sort((a, b) =>
    String(a.displayName || "").localeCompare(String(b.displayName || ""), undefined, {
      sensitivity: "base",
    }),
  );
  const total = matches.length;
  const items = matches.slice(skip, skip + limit);
  return { items, total };
}
