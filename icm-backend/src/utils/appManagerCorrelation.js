/**
 * Application-scoped manager correlation: streaming users + streaming identity reference index
 * (same scaling ideas as accountEntitlementCorrelation — avoid loading full collections into RAM).
 *
 * When `manager_login` (etc.) holds an **application-native id** (e.g. GH login), resolve managers via
 * **IdentityAccountLink** + the same account attribute used by the manual correlation engine
 * (`lastManualCorrelation.accountAttribute`), not only identity profile columns.
 */

import mongoose from "mongoose";
import { getDynamicIdentityModelForTenantId } from "../models/identity/Identity.js";
import IdentityAccountLink from "../models/identity/IdentityAccountLink.js";
import { getDynamicUserModelForTenantId } from "../models/application/Users.js";
import {
  getAppUsersCollectionName,
  getTenantIdentityCollectionName,
  resolveTenantSlugFromTenantId,
} from "./applicationDynamicCollections.js";
import {
  getRawMappedValueFromIdentity,
  normalizeReferenceLookupKey,
} from "./managerCorrelationEngine.js";
import {
  fieldValueForCorrelation,
  smartDataParser,
} from "./accountEntitlementCorrelation.js";
import { alternateKeysForUserField } from "./managerCorrelationQuery.js";

/**
 * `Application.lastManualCorrelation.accountAttribute` is whatever was saved on the **last** identity↔account
 * correlation run — it can be stale (e.g. Tableau) and must not be used unless it exists on **this** app’s user schema.
 * @param {null | { userMappings?: { standardField?: string, csvColumn?: string }[] }} application
 * @param {string} [explicitFromBody]
 * @returns {{ field: string, source: string, rejectedFromLast: string | null }}
 */
function resolveAccountLoginFieldForManagerCorrelation(application, explicitFromBody) {
  const isInUserSchema = (name) => {
    const t = String(name || "").trim();
    if (!t || !application?.userMappings?.length) return false;
    return application.userMappings.some(
      (m) =>
        String(m.standardField || "").trim() === t || String(m.csvColumn || "").trim() === t,
    );
  };

  const explicit = String(explicitFromBody || "").trim();
  if (explicit && isInUserSchema(explicit)) {
    return { field: explicit, source: "request", rejectedFromLast: null };
  }

  const fromLast = application?.lastManualCorrelation?.accountAttribute
    ? String(application.lastManualCorrelation.accountAttribute).trim()
    : "";

  let rejectedFromLast = null;
  if (fromLast && !isInUserSchema(fromLast)) {
    rejectedFromLast = fromLast;
  }

  if (fromLast && isInUserSchema(fromLast)) {
    return { field: fromLast, source: "lastManualCorrelation", rejectedFromLast };
  }

  return { field: "", source: "none", rejectedFromLast };
}

/** @type {number} */
const BULK_CHUNK = Number(process.env.APP_MANAGER_CORR_BULK_CHUNK ?? 500);
/** @type {number} */
const AUDIT_INSERT_CHUNK = Number(process.env.APP_MANAGER_CORR_AUDIT_CHUNK ?? 5000);

/**
 * Narrow projection used by the single-pass identity scan.
 * Covers every field `getRawMappedValueFromIdentity` may read (canonical targets + free-form `attributes`)
 * plus what we slice into the returned `index` (name + email).
 * @param {string} referenceTargetKey
 */
function referenceScanProjection(referenceTargetKey) {
  /** @type {Record<string, 1>} */
  const p = {
    _id: 1,
    email: 1,
    employeeId: 1,
    firstName: 1,
    lastName: 1,
    displayName: 1,
    department: 1,
    title: 1,
    phoneNumber: 1,
    managerEmail: 1,
    managerEmployeeId: 1,
    attributes: 1,
  };
  const refKey = String(referenceTargetKey || "").trim();
  if (refKey) p[refKey] = 1;
  return p;
}

/**
 * Single-pass streaming build: same semantics as buildReferenceIndex (duplicate reference values omitted).
 * Tracks first-seen slices and counts in one scan, then removes any key with count > 1.
 *
 * `onPass1Row`/`onPass2Row` are both invoked per identity so the caller's progress total stays unchanged
 * when upgrading from the previous two-pass implementation.
 *
 * @param {{ onPass1Row?: () => void, onPass2Row?: () => void }} [hooks]
 * @returns {Promise<{ index: Map<string, object>, identityCount: number }>}
 */
export async function buildReferenceLookupIndexStreaming(
  identColl,
  filter,
  referenceTargetKey,
  hooks = {},
) {
  const { onPass1Row, onPass2Row } = hooks;
  const refKey = String(referenceTargetKey || "").trim();
  const counts = new Map();
  /** @type {Map<string, { _id: unknown, displayName?: string, firstName?: string, lastName?: string, email?: string }>} */
  const index = new Map();
  let identityCount = 0;

  const projection = referenceScanProjection(refKey);
  let cursor = identColl.find(filter);
  if (typeof cursor.project === "function") cursor = cursor.project(projection);
  if (typeof cursor.batchSize === "function") cursor = cursor.batchSize(2000);

  for await (const ident of cursor) {
    identityCount += 1;
    onPass1Row?.();
    onPass2Row?.();
    const raw = getRawMappedValueFromIdentity(ident, refKey);
    const k = normalizeReferenceLookupKey(refKey, raw);
    if (!k) continue;
    const prev = counts.get(k) || 0;
    counts.set(k, prev + 1);
    if (prev === 0) {
      index.set(k, {
        _id: ident._id,
        displayName: ident.displayName,
        firstName: ident.firstName,
        lastName: ident.lastName,
        email: ident.email,
      });
    } else if (prev === 1) {
      index.delete(k);
    }
  }

  return { index, identityCount };
}

/** Business-id fields on app users that `IdentityAccountLink.accountId` may reference. */
const LINKABLE_USER_FIELDS = Object.freeze([
  "user_id",
  "username",
  "email",
  "nativeAccountId",
  "gh_login",
  "employee_id",
]);

/**
 * Bulk-load application user rows for a set of IdentityAccountLink.accountId values.
 * Two batched queries replace one findOne per link: {_id $in} for ObjectId-shaped ids, and
 * a single $or with $in per business-id field for the rest. Returns a Map(aidString → user doc).
 * @param {import('mongoose').Model} UsersModel
 * @param {import('mongoose').Types.ObjectId | string} applicationId
 * @param {Iterable<string>} accountIds
 * @param {string[]} extraProjection - user fields to include beyond the linkable keys
 * @returns {Promise<Map<string, object>>}
 */
export async function bulkLoadLinkedApplicationUsers(UsersModel, applicationId, accountIds, extraProjection = []) {
  const aidStrs = [
    ...new Set(
      [...accountIds]
        .map((v) => (v == null ? "" : String(v).trim()))
        .filter((v) => v.length > 0),
    ),
  ];
  if (aidStrs.length === 0) return new Map();

  const oidStrs = [];
  const rawStrs = [];
  for (const aid of aidStrs) {
    if (mongoose.Types.ObjectId.isValid(aid) && aid.length === 24) {
      oidStrs.push(aid);
    } else {
      rawStrs.push(aid);
    }
  }

  const scope = {
    $or: [{ applicationId }, { applicationId: String(applicationId) }],
  };

  /** @type {Record<string, 1>} */
  const projection = { _id: 1 };
  for (const f of LINKABLE_USER_FIELDS) projection[f] = 1;
  for (const f of extraProjection) {
    if (!f) continue;
    projection[f] = 1;
    projection[`rawData.${f}`] = 1;
  }
  // Do not set rawData: 1 here — MongoDB reports "Path collision at rawData" if both the parent
  // and subpaths (rawData.gh_login, etc.) are included. Per-key subpaths are enough for fieldValueForCorrelation.

  /** @type {Promise<object[]>[]} */
  const queries = [];

  if (oidStrs.length > 0) {
    const oidList = oidStrs.map((s) => new mongoose.Types.ObjectId(s));
    queries.push(
      UsersModel.find({ ...scope, _id: { $in: oidList } })
        .select(projection)
        .lean(),
    );
  }

  if (rawStrs.length > 0) {
    const rawOr = LINKABLE_USER_FIELDS.map((f) => ({ [f]: { $in: rawStrs } }));
    queries.push(
      UsersModel.find({ ...scope, $or: rawOr })
        .select(projection)
        .lean(),
    );
  }

  const buckets = queries.length > 0 ? await Promise.all(queries) : [];
  const flat = buckets.flat();

  /** @type {Map<string, object>} */
  const byAid = new Map();
  const setIfRequested = (key, doc) => {
    if (key == null) return;
    const k = String(key).trim();
    if (!k) return;
    if (!aidStrs.includes(k)) return;
    if (!byAid.has(k)) byAid.set(k, doc);
  };
  for (const u of flat) {
    setIfRequested(u._id, u);
    for (const f of LINKABLE_USER_FIELDS) {
      if (u[f] != null) setIfRequested(u[f], u);
    }
  }
  return byAid;
}

/**
 * Map normalized lookup token → manager identity document slice, using correlated app accounts
 * (same semantics as manual correlation: account attribute value identifies the person in this app).
 *
 * @param {{
 *   applicationId: import('mongoose').Types.ObjectId,
 *   applicationNameForModel: string,
 *   tenantId: import('mongoose').Types.ObjectId | null | undefined,
 *   tenantIdStr: string | null,
 *   managerIdentityAttr: string,
 *   accountLoginStandardField: string,
 *   applicationDoc: { userMappings?: object[], name?: string },
 *   onPass1Link?: () => void,
 *   onPass2Link?: () => void,
 * }} opts
 */
export async function buildCorrelatedAccountReferenceIndex(opts) {
  const {
    applicationId,
    applicationNameForModel,
    tenantId,
    tenantIdStr,
    managerIdentityAttr,
    accountLoginStandardField,
    applicationDoc,
    onPass1Link,
    onPass2Link,
  } = opts;

  const mf = String(managerIdentityAttr || "").trim();
  const loginStd = String(accountLoginStandardField || "").trim();
  if (!loginStd || !applicationDoc) {
    return { index: new Map(), linksScanned: 0 };
  }

  const UsersModel = await getDynamicUserModelForTenantId(applicationNameForModel, tenantId);
  const Identity = tenantId ? await getDynamicIdentityModelForTenantId(tenantId) : null;
  const loginAlternates = alternateKeysForUserField(applicationDoc, loginStd);

  const links = await IdentityAccountLink.find({
    applicationId,
    isActive: true,
    correlationStatus: "correlated",
  })
    .select("identityId accountId")
    .lean();

  const tenantOk = (tid) => {
    if (!tenantId) return true;
    return tid != null && (String(tid) === String(tenantId) || String(tid) === String(tenantIdStr));
  };

  const oidList = [
    ...new Set(
      links.map((l) => l.identityId).filter((id) => id != null && mongoose.Types.ObjectId.isValid(String(id))),
    ),
  ].map((id) => new mongoose.Types.ObjectId(String(id)));

  // Tenant scoping + account-user hydration run in parallel: different collections, no ordering dependency.
  const [identBrief, accountUserByAid] = await Promise.all([
    oidList.length > 0
      ? Identity.find({ _id: { $in: oidList } }).select("_id tenantId").lean()
      : Promise.resolve([]),
    bulkLoadLinkedApplicationUsers(
      UsersModel,
      applicationId,
      links.map((l) => l.accountId),
      [loginStd, ...loginAlternates],
    ),
  ]);

  const allowed = new Set(identBrief.filter((i) => tenantOk(i.tenantId)).map((i) => String(i._id)));

  /** @type {{ k: string, identityId: unknown }[]} */
  const extracted = [];

  for (const link of links) {
    onPass1Link?.();
    if (!allowed.has(String(link.identityId))) continue;

    const aid = link.accountId == null ? "" : String(link.accountId).trim();
    if (!aid) continue;
    const user = accountUserByAid.get(aid);
    if (!user) continue;

    const loginVal = fieldValueForCorrelation(user, loginStd, loginAlternates);
    if (loginVal == null || String(loginVal).trim() === "") continue;

    const k = normalizeReferenceLookupKey(mf, loginVal);
    if (!k) continue;

    extracted.push({ k, identityId: link.identityId });
  }

  const counts = new Map();
  for (const row of extracted) {
    counts.set(row.k, (counts.get(row.k) || 0) + 1);
  }

  const winners = extracted.filter((row) => counts.get(row.k) === 1);
  for (let i = 0; i < extracted.length; i += 1) {
    onPass2Link?.();
  }

  const uniqIds = [
    ...new Set(winners.map((w) => String(w.identityId)).filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ].map((id) => new mongoose.Types.ObjectId(id));

  const identDocs =
    uniqIds.length > 0
      ? await Identity.find({ _id: { $in: uniqIds } })
          .select("_id displayName firstName lastName email")
          .lean()
      : [];
  const byId = new Map(identDocs.map((i) => [String(i._id), i]));

  /** @type {Map<string, { _id: unknown, displayName?: string, firstName?: string, lastName?: string, email?: string }>} */
  const index = new Map();
  for (const row of winners) {
    const ident = byId.get(String(row.identityId));
    if (!ident) continue;
    index.set(row.k, {
      _id: ident._id,
      displayName: ident.displayName,
      firstName: ident.firstName,
      lastName: ident.lastName,
      email: ident.email,
    });
  }

  return { index, linksScanned: links.length };
}

/**
 * @param {import('mongodb').Db} db
 * @param {{
 *   appName: string,
 *   applicationId: import('mongoose').Types.ObjectId,
 *   tenantId: import('mongoose').Types.ObjectId | null | undefined,
 *   tenantIdStr: string | null,
 *   managerAppAttr: string,
 *   managerIdentityAttr: string,
 *   userRawDataAlternateKeys?: string[],
 *   application?: import('mongoose').FlattenMaps<Record<string, unknown>> | Record<string, unknown> | null,
 *   referenceAccountLoginField?: string,
 *   onProgress?: (p: {
 *     phase: string,
 *     percent: number,
 *     message?: string,
 *     processed?: number,
 *     totalUnits?: number,
 *   }) => void,
 * }} opts
 */
export async function runAppManagerCorrelation(db, opts) {
  const {
    appName,
    applicationId,
    tenantId,
    tenantIdStr,
    managerAppAttr,
    managerIdentityAttr,
    userRawDataAlternateKeys = [],
    onProgress,
    application = null,
    applicationName: applicationNameOpt,
    referenceAccountLoginField: referenceAccountLoginFieldOpt = "",
  } = opts;

  const accountLoginField =
    String(referenceAccountLoginFieldOpt || "").trim() ||
    (application?.lastManualCorrelation?.accountAttribute
      ? String(application.lastManualCorrelation.accountAttribute).trim()
      : "");

  const applicationNameForModel =
    String(applicationNameOpt || "").trim() ||
    (application?.name ? String(application.name) : String(appName).replace(/_/g, " "));

  const displayNameForUsersColl =
    String(application?.name || applicationNameForModel || "")
      .trim() ||
    String(appName || "")
      .replace(/_/g, "")
      .trim() ||
    String(appName || "");
  const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
  if (!tenantSlug) {
    throw new Error("Could not resolve tenant slug for user collection.");
  }
  const usersColl = db.collection(
    getAppUsersCollectionName(displayNameForUsersColl, tenantSlug),
  );
  const identColl = db.collection(getTenantIdentityCollectionName(tenantSlug));
  const auditColl = db.collection(`app_${appName}_managerCorrelation`);

  const appIdObj = applicationId;
  const appIdStr = String(applicationId);
  const userFilter = {
    $or: [{ applicationId: appIdObj }, { applicationId: appIdStr }],
  };

  let identityFilter = {};
  if (tenantId) {
    identityFilter = { $or: [{ tenantId }, { tenantId: tenantIdStr }] };
  }

  const uf = String(managerAppAttr || "").trim();
  const mf = String(managerIdentityAttr || "").trim();
  const matchMethodLabel = `${uf} [SmartMatch] = ${mf}`;

  const started = Date.now();

  const [identityTotal, userTotal] = await Promise.all([
    identColl.countDocuments(identityFilter),
    usersColl.countDocuments(userFilter),
  ]);

  let linkCount = 0;
  if (accountLoginField && application) {
    linkCount = await IdentityAccountLink.countDocuments({
      applicationId: appIdObj,
      isActive: true,
      correlationStatus: "correlated",
    });
  }

  const totalUnits = Math.max(
    1,
    2 * identityTotal + (linkCount > 0 ? 2 * linkCount : 0) + userTotal,
  );
  let unitsDone = 0;
  let lastMessage = "";

  /** Throttle progress callbacks so huge tenants do not overwhelm the job store / SSE. */
  let lastEmitMs = 0;
  let rowsSinceEmit = 0;
  const PROGRESS_EMIT_INTERVAL_MS = Number(process.env.APP_MANAGER_CORR_PROGRESS_MS ?? 400);
  const PROGRESS_EMIT_ROW_BATCH = Number(process.env.APP_MANAGER_CORR_PROGRESS_ROWS ?? 2500);

  const emitProgress = (force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    const pct = Math.min(99, Math.floor((100 * unitsDone) / totalUnits));
    const nearDone = unitsDone >= totalUnits - 1;
    if (
      !force &&
      !nearDone &&
      now - lastEmitMs < PROGRESS_EMIT_INTERVAL_MS &&
      rowsSinceEmit < PROGRESS_EMIT_ROW_BATCH
    ) {
      return;
    }
    lastEmitMs = now;
    rowsSinceEmit = 0;
    onProgress({
      phase: "running",
      percent: pct,
      message: lastMessage,
      processed: unitsDone,
      totalUnits,
    });
  };

  const bump = (n = 1, message) => {
    unitsDone = Math.min(totalUnits, unitsDone + n);
    if (message) lastMessage = message;
    rowsSinceEmit += n;
    emitProgress(false);
  };

  lastMessage = `Building identity index (${identityTotal.toLocaleString()} identities, ${userTotal.toLocaleString()} accounts)…`;
  emitProgress(true);

  // Independent collections → run in parallel. Identity index hits the `identities` coll, account ref
  // index hits IdentityAccountLink + app users coll; neither consumes the other's output.
  const identityIndexPromise = buildReferenceLookupIndexStreaming(
    identColl,
    identityFilter,
    mf,
    {
      onPass1Row: () => bump(1, "Scanning identities (pass 1/2)…"),
      onPass2Row: () => bump(1, "Scanning identities (pass 2/2)…"),
    },
  );

  let accountIndexPromise = Promise.resolve({ index: new Map(), linksScanned: 0 });
  if (accountLoginField && application) {
    lastMessage = `Indexing correlated accounts by “${accountLoginField}” (identity ↔ app links)…`;
    emitProgress(true);
    accountIndexPromise = buildCorrelatedAccountReferenceIndex({
      applicationId: appIdObj,
      applicationNameForModel,
      tenantId,
      tenantIdStr,
      managerIdentityAttr: mf,
      accountLoginStandardField: accountLoginField,
      applicationDoc: application,
      onPass1Link: () => bump(1, "Scanning correlated account logins (pass 1/2)…"),
      onPass2Link: () => bump(1, "Scanning correlated account logins (pass 2/2)…"),
    });
  }

  const [{ index, identityCount }, accBuilt] = await Promise.all([
    identityIndexPromise,
    accountIndexPromise,
  ]);
  const accountRefIndex = accBuilt.index;
  const linksScannedForAccounts = accBuilt.linksScanned;

  try {
    await auditColl.deleteMany({
      $or: [{ applicationId: appIdObj }, { applicationId: appIdStr }],
    });
  } catch {
    /* collection may not exist yet */
  }

  let matchCount = 0;
  let skippedCount = 0;
  let usersProcessed = 0;
  /** @type {object[]} */
  const bulkOps = [];
  /** @type {object[]} */
  const auditRows = [];

  const flushBulk = async () => {
    if (bulkOps.length === 0) return;
    const slice = bulkOps.splice(0, bulkOps.length);
    await usersColl.bulkWrite(slice, { ordered: false });
  };

  const flushAudit = async () => {
    if (auditRows.length === 0) return;
    const slice = auditRows.splice(0, auditRows.length);
    await auditColl.insertMany(slice, { ordered: false });
  };

  // Narrow projection: only fields `fieldValueForCorrelation` reads + `_id` for the update filter.
  // Cuts BSON size per row when `rawData` carries full source payloads (common at 2k+ accounts).
  /** @type {Record<string, 1>} */
  const userCursorProjection = { _id: 1 };
  const userCursorKeys = [uf, ...userRawDataAlternateKeys]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  for (const k of [...new Set(userCursorKeys)]) {
    userCursorProjection[k] = 1;
    userCursorProjection[`rawData.${k}`] = 1;
  }

  const userCursor = usersColl
    .find(userFilter, { projection: userCursorProjection })
    .batchSize(2000);
  for await (const user of userCursor) {
    usersProcessed += 1;
    bump(1, `Correlating application users (${usersProcessed.toLocaleString()} / ${userTotal.toLocaleString()})…`);
    const rawManagerValue = fieldValueForCorrelation(user, uf, userRawDataAlternateKeys);
    if (rawManagerValue == null || String(rawManagerValue).trim() === "") {
      skippedCount += 1;
      continue;
    }

    const parsedValues = smartDataParser(rawManagerValue);
    let matchedManager = null;
    for (const val of parsedValues) {
      const lookupKey = normalizeReferenceLookupKey(mf, val);
      if (!lookupKey) continue;
      const hit = accountRefIndex.get(lookupKey) || index.get(lookupKey);
      if (hit) {
        matchedManager = hit;
        break;
      }
    }

    if (!matchedManager) continue;

    matchCount += 1;

    const managerName =
      matchedManager.displayName ||
      `${matchedManager.firstName || ""} ${matchedManager.lastName || ""}`.trim() ||
      "Unknown Name";
    const managerEmail = matchedManager.email || "No Email";

    auditRows.push({
      tenantId,
      applicationId,
      userId: user._id,
      managerIdentityId: matchedManager._id,
      matchMethod: matchMethodLabel,
      correlatedAt: new Date(),
      status: "Manager Matched",
    });

    bulkOps.push({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $set: {
            correlatedManagerIdentityId: matchedManager._id,
            correlatedManagerName: managerName,
            correlatedManagerEmail: managerEmail,
            managerCorrelationMethod: matchMethodLabel,
            managerCorrelatedAt: new Date(),
          },
        },
      },
    });

    if (bulkOps.length >= BULK_CHUNK) await flushBulk();
    if (auditRows.length >= AUDIT_INSERT_CHUNK) await flushAudit();
  }

  await flushBulk();
  await flushAudit();

  unitsDone = totalUnits;
  onProgress?.({
    phase: "running",
    percent: 100,
    message: "Complete",
    processed: totalUnits,
    totalUnits,
  });

  const durationMs = Date.now() - started;

  return {
    matchCount,
    skippedCount,
    usersProcessed,
    identitiesIndexed: identityCount,
    referenceIndexSize: index.size,
    correlatedAccountReferenceIndexSize: accountRefIndex.size,
    identityAccountLinksScanned: linksScannedForAccounts,
    accountLoginFieldUsed: accountLoginField || null,
    durationMs,
  };
}
