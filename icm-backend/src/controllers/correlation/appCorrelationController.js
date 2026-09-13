import mongoose from "mongoose";
import Application from "../../models/application/Application.js";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import {
  getAppEntitlementsCollectionName,
  getAppUsersCollectionName,
  resolveTenantSlugFromTenantId,
} from "../../utils/applicationDynamicCollections.js";
import {
  appNameToCorrelationSlug,
  clearApplicationAccountEntitlementCorrelation,
  correlationStatsCollectionName,
  rebuildCorrelationEntitlementStats,
  runAccountEntitlementCorrelation,
} from "../../utils/accountEntitlementCorrelation.js";
import { scheduleSyncAllForApplication } from "../../utils/identityEntitlementSyncTrigger.js";
import {
  isAdAutoAccountEntitlementCorrelationApp,
  rebuildAdConnectorAccountEntitlementCorrelation,
} from "../../services/ad/adConnectorCorrelationService.js";
import { runAppManagerCorrelation } from "../../utils/appManagerCorrelation.js";
import {
  MANAGER_CORR_FACET_CACHE_MS,
  alternateKeysForUserField,
  escapeRegexForMongo,
  invalidateManagerCorrelationFacetCache,
  managerFacetCacheKey,
  matchApplicationUsersStage,
  projectStageNarrowForManagerCoalesce,
  stagesEffectiveManagerFields,
  withManagerFacetCache,
} from "../../utils/managerCorrelationQuery.js";
import {
  createManagerCorrelationJob,
  patchManagerCorrelationJob,
  getManagerCorrelationJobForApplication,
} from "../../services/identity/managerCorrelationJobStore.js";

/**
 * @param {unknown} id
 * @returns {mongoose.Types.ObjectId|null}
 */
function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    const s = String(id);
    if (mongoose.Types.ObjectId.isValid(s)) return new mongoose.Types.ObjectId(s);
  } catch {
    return null;
  }
  return null;
}

/**
 * Build $or conditions on hydrated user shape (`_u`) for correlation entitlement search.
 * Uses Application userMappings (standardField + rawData + csvColumn).
 * @param {{ userMappings?: { standardField?: string, csvColumn?: string }[] }} application
 */
function correlationUserSearchOrConditions(application, regexPattern) {
  const userOr = [];
  const seenPaths = new Set();
  const addPath = (path) => {
    if (!path || seenPaths.has(path)) return;
    seenPaths.add(path);
    userOr.push({ [path]: { $regex: regexPattern, $options: "i" } });
  };
  for (const m of application.userMappings || []) {
    const sf = String(m.standardField || "").trim();
    const csv = String(m.csvColumn || "").trim();
    if (sf) {
      addPath(`_u.${sf}`);
      addPath(`_u.rawData.${sf}`);
    }
    if (csv && csv !== sf) {
      addPath(`_u.rawData.${csv}`);
    }
  }
  if (userOr.length === 0) {
    for (const k of ["email", "displayName", "firstName", "lastName", "name", "account_id", "employeeId"]) {
      addPath(`_u.${k}`);
    }
  }
  return userOr;
}

/**
 * Account/entitlement correlation rows store only FKs. Resolve current user & entitlement
 * documents from dynamic collections for API consumers (same shape as before).
 *
 * @param {import("mongodb").Db} db
 * @param {string} appName sanitized application name (same as executeCorrelation)
 * @param {mongoose.Types.ObjectId} applicationId
 * @param {object[]} rows
 */
async function hydrateAccountEntitlementCorrelations(
  db,
  appName,
  applicationId,
  rows,
  tenantSlug,
  applicationDisplayName,
) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const userEntLabel =
    (applicationDisplayName && String(applicationDisplayName).trim()) ||
    String(appName || "")
      .replace(/_/g, "")
      .trim() ||
    String(appName || "");
  const usersColl = db.collection(getAppUsersCollectionName(userEntLabel, tenantSlug));
  const entsColl = db.collection(getAppEntitlementsCollectionName(userEntLabel, tenantSlug));

  const userIdStrs = new Set();
  const entIdStrs = new Set();

  for (const r of rows) {
    const uid = r.userId ?? r.userData?._id;
    const eid = r.entitlementId ?? r.entitlementData?._id;
    const uo = toObjectId(uid);
    const eo = toObjectId(eid);
    if (uo) userIdStrs.add(String(uo));
    if (eo) entIdStrs.add(String(eo));
  }

  const uidList = [...userIdStrs].map((s) => new mongoose.Types.ObjectId(s));
  const eidList = [...entIdStrs].map((s) => new mongoose.Types.ObjectId(s));

  const [userDocs, entDocs] = await Promise.all([
    uidList.length
      ? usersColl
          .find({ applicationId, _id: { $in: uidList } })
          .toArray()
      : [],
    eidList.length
      ? entsColl
          .find({ applicationId, _id: { $in: eidList } })
          .toArray()
      : [],
  ]);

  const userById = new Map(userDocs.map((u) => [String(u._id), u]));
  const entById = new Map(entDocs.map((e) => [String(e._id), e]));

  return rows.map((r) => {
    const uidRaw = r.userId ?? r.userData?._id;
    const eidRaw = r.entitlementId ?? r.entitlementData?._id;
    const uo = toObjectId(uidRaw);
    const eo = toObjectId(eidRaw);
    const us = uo ? String(uo) : null;
    const es = eo ? String(eo) : null;

    const userData = us ? userById.get(us) ?? null : null;
    const entitlementData = es ? entById.get(es) ?? null : null;

    return {
      _id: r._id,
      tenantId: r.tenantId,
      applicationId: r.applicationId,
      matchMethod: r.matchMethod,
      correlatedAt: r.correlatedAt,
      status: r.status,
      userId: uo ?? undefined,
      entitlementId: eo ?? undefined,
      userData,
      entitlementData,
    };
  });
}

// ============================================================================
// 🚀 Account / entitlement correlation — inverted index + streaming users (scalable)
// ============================================================================
export const executeCorrelation = async (req, res) => {
  try {
    const { id } = req.params;
    const { userField, entitlementField } = req.body;

    const application = await Application.findById(id);
    if (!application) return res.status(404).json({ success: false, message: "App not found" });

    if (isAdAutoAccountEntitlementCorrelationApp(application)) {
      const stats = await rebuildAdConnectorAccountEntitlementCorrelation(application);
      return res.json({
        success: true,
        auto: true,
        method: stats.method || "ad_memberOf_dns",
        message: `AD membership correlation complete. ${stats.matchCount} link(s) from ${stats.usersProcessed.toLocaleString()} account(s) × ${stats.entitlementsIndexed.toLocaleString()} entitlement(s) (group DN index: ${stats.indexTokenCount.toLocaleString()} keys, ${stats.durationMs} ms).`,
        matchCount: stats.matchCount,
        usersProcessed: stats.usersProcessed,
        entitlementsIndexed: stats.entitlementsIndexed,
        indexTokenCount: stats.indexTokenCount,
        durationMs: stats.durationMs,
      });
    }

    if (!userField || !entitlementField) {
      return res.status(400).json({
        success: false,
        message: "userField and entitlementField are required.",
      });
    }

    const uf = String(userField).trim();
    const ef = String(entitlementField).trim();

    const userKeys = new Set(
      (application.userMappings || []).map((m) => String(m.standardField || "").trim()).filter(Boolean),
    );
    const entKeys = new Set(
      (application.entitlementMappings || []).map((m) => String(m.standardField || "").trim()).filter(Boolean),
    );
    if (userKeys.size > 0 && !userKeys.has(uf)) {
      return res.status(400).json({
        success: false,
        message: `User attribute "${uf}" is not defined in the Application schema (userMappings).`,
      });
    }
    if (entKeys.size > 0 && !entKeys.has(ef)) {
      return res.status(400).json({
        success: false,
        message: `Entitlement attribute "${ef}" is not defined in the Entitlement schema (entitlementMappings).`,
      });
    }

    const appName = appNameToCorrelationSlug(application.name);
    const db = mongoose.connection.db;

    await clearApplicationAccountEntitlementCorrelation(
      db,
      appName,
      application._id,
    );

    const userRawDataAlternateKeys = (application.userMappings || [])
      .filter((m) => String(m.standardField || "").trim() === uf)
      .map((m) => String(m.csvColumn || "").trim())
      .filter(Boolean);
    const entitlementRawDataAlternateKeys = (application.entitlementMappings || [])
      .filter((m) => String(m.standardField || "").trim() === ef)
      .map((m) => String(m.csvColumn || "").trim())
      .filter(Boolean);

    const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
    if (!tenantSlug) {
      return res.status(500).json({
        success: false,
        message: "Could not resolve tenant name for dynamic user/entitlement collections. Ensure Tenant exists.",
      });
    }

    const stats = await runAccountEntitlementCorrelation(db, {
      appName,
      applicationDisplayName: application.name,
      applicationId: application._id,
      tenantId: application.tenantId,
      tenantSlug,
      userField: uf,
      entitlementField: ef,
      userRawDataAlternateKeys,
      entitlementRawDataAlternateKeys,
    });

    await rebuildCorrelationEntitlementStats(db, appName, application._id);

    scheduleSyncAllForApplication(application._id);

    res.json({
      success: true,
      message: `Correlation complete. ${stats.matchCount} link(s) from ${stats.usersProcessed.toLocaleString()} user(s) × ${stats.entitlementsIndexed.toLocaleString()} entitlement(s) (token index: ${stats.indexTokenCount.toLocaleString()} keys, ${stats.durationMs} ms).`,
      matchCount: stats.matchCount,
      usersProcessed: stats.usersProcessed,
      entitlementsIndexed: stats.entitlementsIndexed,
      indexTokenCount: stats.indexTokenCount,
      durationMs: stats.durationMs,
    });
  } catch (error) {
    console.error("executeCorrelation", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getCorrelationResults = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await Application.findById(id);
    if (!application) return res.status(404).json({ success: false, message: 'App not found' });

    const rawPage = parseInt(String(req.query.page ?? '0'), 10);
    const rawLimit = parseInt(String(req.query.limit ?? '500'), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(5000, Math.max(1, rawLimit)) : 500;
    const skip = page * limit;

    const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
    if (!tenantSlug) {
      return res.status(500).json({ success: false, message: "Could not resolve tenant slug for collections." });
    }

    const appName = appNameToCorrelationSlug(application.name);
    const correlationCollName = `app_${appName}_correlation`;
    const entsCollName = getAppEntitlementsCollectionName(application.name, tenantSlug);
    const statsCollName = correlationStatsCollectionName(appName);
    const db = mongoose.connection.db;

    const filter = { applicationId: application._id };
    let total = 0;
    let data = [];

    try {
      const statsColl = db.collection(statsCollName);
      const corrColl = db.collection(correlationCollName);

      total = await statsColl.countDocuments(filter);

      if (total === 0) {
        const linkCount = await corrColl.countDocuments(filter).catch(() => 0);
        if (linkCount > 0) {
          await rebuildCorrelationEntitlementStats(db, appName, application._id);
          total = await statsColl.countDocuments(filter);
        }
      }

      if (total > 0) {
        const rows = await statsColl
          .aggregate([
            { $match: filter },
            {
              $lookup: {
                from: entsCollName,
                localField: "entitlementId",
                foreignField: "_id",
                as: "ent",
              },
            },
            {
              $addFields: {
                entitlementData: { $arrayElemAt: ["$ent", 0] },
                sortName: {
                  $ifNull: [
                    { $arrayElemAt: ["$ent.entitlement_name", 0] },
                    { $ifNull: [{ $arrayElemAt: ["$ent.entitlement_id", 0] }, ""] },
                  ],
                },
              },
            },
            { $sort: { sortName: 1, entitlementId: 1 } },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                entitlementId: 1,
                userCount: 1,
                entitlementData: 1,
              },
            },
          ])
          .toArray();

        data = rows.map((r) => ({
          entitlementId: r.entitlementId,
          userCount: r.userCount ?? 0,
          entitlementData: r.entitlementData ?? null,
        }));
      }
    } catch (e) {
      /* no collection */
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.json({
      success: true,
      count: data.length,
      total,
      page,
      limit,
      totalPages,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Paginated correlation links for one entitlement (hydrated user rows). Used when opening “Assigned Users”.
 */
export const getCorrelationEntitlementUsers = async (req, res) => {
  try {
    const { id } = req.params;
    const application = await Application.findById(id);
    if (!application) return res.status(404).json({ success: false, message: "App not found" });

    const entitlementId = toObjectId(req.query.entitlementId);
    if (!entitlementId) {
      return res.status(400).json({ success: false, message: "entitlementId query parameter is required." });
    }

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "10"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 10;
    const skip = page * limit;

    const appName = appNameToCorrelationSlug(application.name);
    const correlationCollName = `app_${appName}_correlation`;
    const db = mongoose.connection.db;

    const tenantSlug = await resolveTenantSlugFromTenantId(application.tenantId);
    if (!tenantSlug) {
      return res.status(500).json({ success: false, message: "Could not resolve tenant slug for collections." });
    }

    const filter = {
      applicationId: application._id,
      entitlementId,
    };

    const searchRaw = String(req.query.search ?? "").trim().slice(0, 200);

    let results = [];
    let total = 0;
    try {
      const coll = db.collection(correlationCollName);
      const usersCollName = getAppUsersCollectionName(application.name, tenantSlug);

      if (searchRaw) {
        const regexPattern = escapeRegexForMongo(searchRaw);
        const userOr = correlationUserSearchOrConditions(application, regexPattern);
        const pipeline = [
          { $match: filter },
          {
            $lookup: {
              from: usersCollName,
              localField: "userId",
              foreignField: "_id",
              as: "_u",
            },
          },
          { $unwind: { path: "$_u", preserveNullAndEmptyArrays: false } },
          ...(userOr.length ? [{ $match: { $or: userOr } }] : []),
          { $sort: { correlatedAt: -1 } },
          {
            $facet: {
              totalCount: [{ $count: "n" }],
              pageRows: [
                { $skip: skip },
                { $limit: limit },
                {
                  $project: {
                    _id: 1,
                    tenantId: 1,
                    applicationId: 1,
                    matchMethod: 1,
                    correlatedAt: 1,
                    status: 1,
                    userId: 1,
                    entitlementId: 1,
                  },
                },
              ],
            },
          },
        ];
        const agg = await coll.aggregate(pipeline).toArray();
        const facet = agg[0] || { totalCount: [], pageRows: [] };
        total = facet.totalCount[0]?.n ?? 0;
        results = facet.pageRows || [];
      } else {
        [results, total] = await Promise.all([
          coll.find(filter).sort({ correlatedAt: -1 }).skip(skip).limit(limit).toArray(),
          coll.countDocuments(filter),
        ]);
      }
    } catch (e) {
      /* no collection */
    }

    const hydrated = await hydrateAccountEntitlementCorrelations(
      db,
      appName,
      application._id,
      results,
      tenantSlug,
      application.name,
    );

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.json({
      success: true,
      count: hydrated.length,
      total,
      page,
      limit,
      totalPages,
      data: hydrated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Facet counts for manager correlation (cached briefly). Mirrors entitlement correlation_stats usage on the frontend. */
export const getManagerCorrelationFacets = async (req, res) => {
  try {
    const { id } = req.params;
    const managerAttrRaw = String(req.query.managerAttr ?? "").trim();
    if (!managerAttrRaw) {
      return res.status(400).json({
        success: false,
        message: "managerAttr query parameter is required.",
      });
    }

    const application = await Application.findById(id).lean();
    if (!application) return res.status(404).json({ success: false, message: "App not found" });

    const tenantKey = application.tenantId ? String(application.tenantId) : "";
    const cacheKey = managerFacetCacheKey(application._id, managerAttrRaw, tenantKey);

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);
    const coll = UsersModel.collection;
    const alternateKeys = alternateKeysForUserField(application, managerAttrRaw);
    const baseStages = [
      matchApplicationUsersStage(application._id, String(application._id)),
      projectStageNarrowForManagerCoalesce(managerAttrRaw, alternateKeys),
      ...stagesEffectiveManagerFields(managerAttrRaw, alternateKeys),
    ];

    const data = await withManagerFacetCache(cacheKey, async () => {
      const facetStage = {
        $facet: {
          totalAccounts: [{ $count: "n" }],
          withManagerValue: [{ $match: { __mgrNorm: { $ne: null } } }, { $count: "n" }],
          correlated: [
            {
              $match: {
                correlatedManagerIdentityId: { $exists: true, $ne: null },
              },
            },
            { $count: "n" },
          ],
          unresolvedWithManagerValue: [
            {
              $match: {
                __mgrNorm: { $ne: null },
                $or: [
                  { correlatedManagerIdentityId: { $exists: false } },
                  { correlatedManagerIdentityId: null },
                ],
              },
            },
            { $count: "n" },
          ],
          distinctManagerGroups: [
            { $match: { __mgrNorm: { $ne: null } } },
            { $group: { _id: "$__mgrNorm" } },
            { $count: "n" },
          ],
        },
      };
      const rows = await coll
        .aggregate([...baseStages, facetStage], { allowDiskUse: true })
        .toArray();
      const f = rows[0] || {};
      return {
        totalAccounts: f.totalAccounts?.[0]?.n ?? 0,
        withManagerValue: f.withManagerValue?.[0]?.n ?? 0,
        correlated: f.correlated?.[0]?.n ?? 0,
        unresolvedWithManagerValue: f.unresolvedWithManagerValue?.[0]?.n ?? 0,
        distinctManagerGroups: f.distinctManagerGroups?.[0]?.n ?? 0,
      };
    });

    const maxAge = Math.min(60, Math.max(5, Math.floor(MANAGER_CORR_FACET_CACHE_MS / 1000)));
    res.set("Cache-Control", `private, max-age=${maxAge}`);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Paginated manager groups (aggregation). One card per distinct normalized manager reference value. */
export const getManagerCorrelationGroups = async (req, res) => {
  try {
    const { id } = req.params;
    const managerAttrRaw = String(req.query.managerAttr ?? "").trim();
    if (!managerAttrRaw) {
      return res.status(400).json({
        success: false,
        message: "managerAttr query parameter is required.",
      });
    }

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "24"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 24;
    const skip = page * limit;
    const searchRaw = String(req.query.search ?? "").trim().slice(0, 200).toLowerCase();

    const application = await Application.findById(id).lean();
    if (!application) return res.status(404).json({ success: false, message: "App not found" });

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);
    const coll = UsersModel.collection;
    const alternateKeys = alternateKeysForUserField(application, managerAttrRaw);

    const baseStages = [
      matchApplicationUsersStage(application._id, String(application._id)),
      projectStageNarrowForManagerCoalesce(managerAttrRaw, alternateKeys),
      ...stagesEffectiveManagerFields(managerAttrRaw, alternateKeys),
      { $match: { __mgrNorm: { $ne: null } } },
    ];

    const searchStages =
      searchRaw.length > 0
        ? [
            {
              $match: {
                __mgrNorm: new RegExp(escapeRegexForMongo(searchRaw), "i"),
              },
            },
          ]
        : [];

    // One $group over app users, then $facet: count all groups + paginate. Sort/skip/limit *before* $lookup
    // so we only join identities for the current page (not every distinct manager on the app).
    const oneGroupPerManager = [
      {
        $group: {
          _id: "$__mgrNorm",
          managerRawDisplay: { $first: "$__mgrRaw" },
          userCount: { $sum: 1 },
          corrIds: { $push: "$correlatedManagerIdentityId" },
        },
      },
      {
        $project: {
          managerKeyNorm: "$_id",
          managerRawDisplay: 1,
          userCount: 1,
          managerIdentityId: {
            $arrayElemAt: [
              {
                $filter: {
                  input: "$corrIds",
                  as: "c",
                  cond: { $ne: ["$$c", null] },
                },
              },
              0,
            ],
          },
        },
      },
    ];

    const pageAfterGroup = [
      { $sort: { userCount: -1, managerKeyNorm: 1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: "identities",
          localField: "managerIdentityId",
          foreignField: "_id",
          as: "_ident",
        },
      },
      {
        $addFields: {
          resolvedManagerName: {
            $let: {
              vars: { d: { $arrayElemAt: ["$_ident", 0] } },
              in: {
                $ifNull: [
                  "$$d.displayName",
                  {
                    $trim: {
                      input: {
                        $concat: [
                          { $ifNull: ["$$d.firstName", ""] },
                          " ",
                          { $ifNull: ["$$d.lastName", ""] },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          isResolved: {
            $cond: [{ $ne: [{ $ifNull: ["$managerIdentityId", null] }, null] }, true, false],
          },
        },
      },
      { $project: { _ident: 0 } },
    ];

    const mergedPipeline = [
      ...baseStages,
      ...searchStages,
      ...oneGroupPerManager,
      {
        $facet: {
          countOnly: [{ $count: "n" }],
          page: pageAfterGroup,
        },
      },
    ];

    const [merged] = await coll.aggregate(mergedPipeline, { allowDiskUse: true }).toArray();

    const countArr = merged?.countOnly ?? [];
    const data = merged?.page ?? [];

    const total = countArr[0]?.n ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.set("Cache-Control", "private, max-age=15");
    res.json({
      success: true,
      count: data.length,
      total,
      page,
      limit,
      totalPages,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** Paginated direct reports for one manager group (normalized key). */
export const getManagerCorrelationGroupUsers = async (req, res) => {
  try {
    const { id } = req.params;
    const managerAttrRaw = String(req.query.managerAttr ?? "").trim();
    const managerKeyNorm = String(req.query.managerKeyNorm ?? "").trim();
    if (!managerAttrRaw || !managerKeyNorm) {
      return res.status(400).json({
        success: false,
        message: "managerAttr and managerKeyNorm query parameters are required.",
      });
    }

    const rawPage = parseInt(String(req.query.page ?? "0"), 10);
    const rawLimit = parseInt(String(req.query.limit ?? "25"), 10);
    const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 25;
    const skip = page * limit;
    const searchRaw = String(req.query.search ?? "").trim().slice(0, 200);

    const application = await Application.findById(id).lean();
    if (!application) return res.status(404).json({ success: false, message: "App not found" });

    const UsersModel = await getDynamicUserModelForTenantId(application.name, application.tenantId);
    const coll = UsersModel.collection;
    const alternateKeys = alternateKeysForUserField(application, managerAttrRaw);

    const preFacet = [
      matchApplicationUsersStage(application._id, String(application._id)),
      ...stagesEffectiveManagerFields(managerAttrRaw, alternateKeys),
      { $match: { __mgrNorm: managerKeyNorm } },
    ];

    const searchMatch =
      searchRaw.length > 0
        ? [
            {
              $match: {
                $or: [
                  { email: { $regex: escapeRegexForMongo(searchRaw), $options: "i" } },
                  { display_name: { $regex: escapeRegexForMongo(searchRaw), $options: "i" } },
                  { user_id: { $regex: escapeRegexForMongo(searchRaw), $options: "i" } },
                  { username: { $regex: escapeRegexForMongo(searchRaw), $options: "i" } },
                  { employee_id: { $regex: escapeRegexForMongo(searchRaw), $options: "i" } },
                ],
              },
            },
          ]
        : [];

    const facetStage = {
      $facet: {
        totalCount: [{ $count: "n" }],
        pageRows: [{ $sort: { updatedAt: -1, createdAt: -1 } }, { $skip: skip }, { $limit: limit }],
      },
    };

    const agg = await coll
      .aggregate([...preFacet, ...searchMatch, facetStage], { allowDiskUse: true })
      .toArray();
    const facet = agg[0] || { totalCount: [], pageRows: [] };
    const total = facet.totalCount[0]?.n ?? 0;
    const rows = facet.pageRows || [];

    const mergedUsers = rows.map((u) => {
      const { rawData, __mgrRaw, __mgrNorm, ...rest } = u;
      if (rawData && typeof rawData === "object") {
        return { ...rawData, ...rest };
      }
      return rest;
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    res.json({
      success: true,
      count: mergedUsers.length,
      total,
      page,
      limit,
      totalPages,
      data: mergedUsers,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Runs manager correlation off the HTTP thread; progress is polled via GET manager-correlation-jobs/:jobId.
 */
function scheduleManagerCorrelationJob(
  jobId,
  application,
  uf,
  mf,
  userRawDataAlternateKeys,
  referenceAccountLoginField,
) {
  const appName = application.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  const db = mongoose.connection.db;
  const tenantId = application.tenantId;
  const tenantIdStr = tenantId ? tenantId.toString() : null;

  patchManagerCorrelationJob(jobId, {
    status: "running",
    phase: "running",
    startedAt: Date.now(),
    message: "Starting…",
    percent: 1,
  });

  runAppManagerCorrelation(db, {
    appName,
    applicationId: application._id,
    tenantId,
    tenantIdStr,
    managerAppAttr: uf,
    managerIdentityAttr: mf,
    userRawDataAlternateKeys,
    application,
    applicationName: application.name,
    referenceAccountLoginField,
    onProgress: (p) => {
      patchManagerCorrelationJob(jobId, {
        phase: p.phase,
        percent: typeof p.percent === "number" ? p.percent : undefined,
        message: p.message,
      });
    },
  })
    .then((stats) => {
      invalidateManagerCorrelationFacetCache(application._id);
      patchManagerCorrelationJob(jobId, {
        status: "completed",
        phase: "completed",
        percent: 100,
        message: `Matched ${stats.matchCount} account(s).`,
        result: stats,
        completedAt: Date.now(),
      });
    })
    .catch((err) => {
      patchManagerCorrelationJob(jobId, {
        status: "failed",
        phase: "failed",
        message: err.message,
        error: err.message,
        completedAt: Date.now(),
      });
    });
}

/** Poll async manager correlation job status (see POST execute-manager-correlation with default async). */
export const getManagerCorrelationJobStatus = async (req, res) => {
  try {
    const { id, jobId } = req.params;
    const job = getManagerCorrelationJobForApplication(jobId, id);
    if (!job) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }
    res.json({
      success: true,
      data: {
        jobId: job.jobId,
        applicationId: job.applicationId,
        status: job.status,
        phase: job.phase,
        percent: job.percent,
        message: job.message,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Manager correlation: streaming identity reference index + bulk user updates.
 * Default: **async** — returns `202` + `jobId`; poll GET `/:id/manager-correlation-jobs/:jobId`.
 * Set query `sync=1` or body `{ sync: true }` for synchronous `200` (same process; long HTTP hold).
 */
export const executeManagerCorrelation = async (req, res) => {
  try {
    const sync =
      req.query.sync === "1" ||
      req.query.sync === "true" ||
      req.body?.sync === true;

    const { id } = req.params;
    const { managerAppAttr, managerIdentityAttr, referenceAccountLoginField } = req.body;

    const uf = String(managerAppAttr || "").trim();
    const mf = String(managerIdentityAttr || "").trim();
    if (!uf || !mf) {
      return res.status(400).json({
        success: false,
        message: "managerAppAttr and managerIdentityAttr are required.",
      });
    }

    const application = await Application.findById(id).lean();
    if (!application) {
      return res.status(404).json({ success: false, message: "App not found" });
    }

    const tenantId = application.tenantId;
    const tenantIdStr = tenantId ? tenantId.toString() : null;
    const appName = application.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
    const db = mongoose.connection.db;

    const appIdObj = application._id;
    const appIdStr = String(application._id);

    const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
    if (!tenantSlug) {
      return res.status(500).json({ success: false, message: "Could not resolve tenant slug for user collection." });
    }

    const usersColl = db.collection(getAppUsersCollectionName(application.name, tenantSlug));
    const userFilter = {
      $or: [{ applicationId: appIdObj }, { applicationId: appIdStr }],
    };

    const userCount = await usersColl.countDocuments(userFilter);
    if (userCount === 0) {
      return res.status(404).json({
        success: false,
        message: "No users found for this application to correlate.",
      });
    }

    const userRawDataAlternateKeys = (application.userMappings || [])
      .filter((m) => String(m.standardField || "").trim() === uf)
      .map((m) => String(m.csvColumn || "").trim())
      .filter(Boolean);

    if (!sync) {
      const jobId = createManagerCorrelationJob(String(application._id));
      setImmediate(() => {
        scheduleManagerCorrelationJob(
          jobId,
          application,
          uf,
          mf,
          userRawDataAlternateKeys,
          referenceAccountLoginField,
        );
      });
      return res.status(202).json({
        success: true,
        async: true,
        jobId,
        message: "Manager correlation job started. Poll GET status until completed.",
      });
    }

    const stats = await runAppManagerCorrelation(db, {
      appName,
      applicationId: application._id,
      tenantId,
      tenantIdStr,
      managerAppAttr: uf,
      managerIdentityAttr: mf,
      userRawDataAlternateKeys,
      application,
      applicationName: application.name,
      referenceAccountLoginField,
    });

    invalidateManagerCorrelationFacetCache(application._id);

    res.json({
      success: true,
      async: false,
      message: `Manager correlation complete. Matched ${stats.matchCount} account(s).`,
      matchCount: stats.matchCount,
      totalProcessed: stats.usersProcessed,
      skippedCount: stats.skippedCount,
      identitiesIndexed: stats.identitiesIndexed,
      referenceIndexSize: stats.referenceIndexSize,
      correlatedAccountReferenceIndexSize: stats.correlatedAccountReferenceIndexSize,
      identityAccountLinksScanned: stats.identityAccountLinksScanned,
      accountLoginFieldUsed: stats.accountLoginFieldUsed,
      durationMs: stats.durationMs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

