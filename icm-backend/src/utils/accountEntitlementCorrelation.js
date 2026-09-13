/**
 * Account ↔ entitlement correlation (application connector data).
 * Scales to large tenants: inverted token index over entitlements + streaming user cursor (O(users × avg_tokens) + O(ents × tokens)), not O(users × ents).
 * AD connectors use direct group-DN FK matching via rawData.ad_memberOf_dns (no display-name token matching).
 */

import { normalizeDn } from "../services/ad/ldapNormalizer.js";
import {
  getAppEntitlementsCollectionName,
  getAppUsersCollectionName,
} from "./applicationDynamicCollections.js";

/** @param {string} applicationName */
export function appNameToCorrelationSlug(applicationName) {
  return String(applicationName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
}

/** @param {string} appName Sanitized slug from {@link appNameToCorrelationSlug}. */
export function correlationStatsCollectionName(appName) {
  return `app_${appName}_correlation_stats`;
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} appName
 * @param {import('mongoose').Types.ObjectId} applicationId
 */
export async function clearApplicationAccountEntitlementCorrelation(db, appName, applicationId) {
  const correlationCollName = `app_${appName}_correlation`;
  try {
    await db.collection(correlationCollName).deleteMany({ applicationId });
  } catch {
    /* collection may not exist */
  }
  try {
    await db.collection(correlationStatsCollectionName(appName)).deleteMany({ applicationId });
  } catch {
    /* collection may not exist */
  }
}

/**
 * One row per entitlement with link count. Rebuilt after each account/entitlement correlation run.
 * @param {import('mongodb').Db} db
 * @param {string} appName
 * @param {import('mongoose').Types.ObjectId} applicationId
 */
export async function rebuildCorrelationEntitlementStats(db, appName, applicationId) {
  const corr = db.collection(`app_${appName}_correlation`);
  const stats = db.collection(correlationStatsCollectionName(appName));
  await stats.deleteMany({ applicationId });
  const agg = await corr
    .aggregate([
      { $match: { applicationId } },
      { $group: { _id: "$entitlementId", userCount: { $sum: 1 } } },
    ])
    .toArray();
  if (agg.length === 0) return;
  const now = new Date();
  const bulk = agg
    .filter((a) => a._id != null)
    .map((a) => ({
      applicationId,
      entitlementId: a._id,
      userCount: a.userCount,
      updatedAt: now,
    }));
  if (bulk.length === 0) return;
  await stats.insertMany(bulk, { ordered: false });
  await stats
    .createIndex({ applicationId: 1, entitlementId: 1 }, { unique: true, background: true })
    .catch(() => {});
}

/** @type {number} */
const INSERT_CHUNK = Number(process.env.ACCOUNT_ENT_CORR_INSERT_CHUNK ?? 5000);

/**
 * Resolve attribute for correlation: top-level, then rawData under standardField, then rawData under CSV column names.
 * User/entitlement docs map csvColumn → standardField at top level; Mongoose strict used to drop unknown top-level keys,
 * so values may only exist on rawData — keyed by csvColumn when it differs from standardField.
 * @param {object} doc
 * @param {string} field standardField from schema
 * @param {string[]} [rawDataAlternateKeys] csvColumn values from Application mappings for this field
 * @returns {unknown}
 */
export function fieldValueForCorrelation(doc, field, rawDataAlternateKeys = []) {
  if (!doc || !field) return undefined;
  const k0 = String(field).trim();
  if (!k0) return undefined;
  const nonempty = (v) => v != null && String(v).trim() !== "";
  const rd = doc.rawData && typeof doc.rawData === "object" ? doc.rawData : null;

  const order = [k0, ...(rawDataAlternateKeys || []).map((a) => String(a || "").trim()).filter((a) => a && a !== k0)];

  for (const key of order) {
    if (nonempty(doc[key])) return doc[key];
  }
  for (const key of order) {
    if (rd && nonempty(rd[key])) return rd[key];
  }
  return undefined;
}

/**
 * Parse connector values into comparable tokens (LDAP CN, JSON arrays, delimited lists).
 * @param {unknown} val
 * @returns {string[]}
 */
export function smartDataParser(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.flatMap((v) => smartDataParser(v));
  let str = String(val).trim();
  try {
    if (str.startsWith("[") && str.endsWith("]")) {
      const parsed = JSON.parse(str.replace(/'/g, '"'));
      if (Array.isArray(parsed)) return parsed.flatMap((v) => smartDataParser(v));
    }
  } catch {
    /* ignore */
  }
  if (str.toLowerCase().includes("cn=")) {
    const cnMatches = [...str.matchAll(/cn=([^,]+)/gi)];
    if (cnMatches.length > 0) return cnMatches.map((m) => m[1].toLowerCase().trim());
  }
  if (/[;,|]/.test(str)) return str.split(/[;,|]/).map((s) => s.toLowerCase().trim()).filter(Boolean);
  return [str.toLowerCase().trim()].filter(Boolean);
}

/**
 * Inverted index: normalized token -> entitlement _id list (deduped per token).
 * @param {import('mongodb').Collection} entColl
 * @param {object} filter
 * @param {string} entitlementField
 * @param {string[]} [entitlementRawDataAlternateKeys]
 * @returns {Promise<Map<string, object[]>>}
 */
export async function buildEntitlementTokenIndex(
  entColl,
  filter,
  entitlementField,
  entitlementRawDataAlternateKeys = [],
) {
  const index = new Map();
  const cursor = entColl.find(filter).batchSize(2000);
  let entCount = 0;
  for await (const ent of cursor) {
    entCount += 1;
    const tokens = smartDataParser(
      fieldValueForCorrelation(ent, entitlementField, entitlementRawDataAlternateKeys),
    );
    const entId = ent._id;
    const sid = String(entId);
    for (const t of tokens) {
      if (!t) continue;
      if (!index.has(t)) index.set(t, []);
      const arr = index.get(t);
      if (!arr.some((id) => String(id) === sid)) arr.push(entId);
    }
  }
  return { index, entCount };
}

/**
 * @param {Map<string, object[]>} index
 * @param {object} user
 * @param {string} userField
 * @param {string} matchMethodUsed
 * @param {object} tenantId
 * @param {object} applicationId
 * @param {string[]} [userRawDataAlternateKeys]
 * @returns {object[]}
 */
function linksForUser(
  index,
  user,
  userField,
  matchMethodUsed,
  tenantId,
  applicationId,
  userRawDataAlternateKeys = [],
) {
  const userTokens = smartDataParser(fieldValueForCorrelation(user, userField, userRawDataAlternateKeys));
  if (userTokens.length === 0) return [];
  const seenPair = new Set();
  const out = [];
  for (const t of userTokens) {
    const list = index.get(t);
    if (!list?.length) continue;
    for (const entId of list) {
      const key = `${String(user._id)}:${String(entId)}`;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      out.push({
        tenantId,
        applicationId,
        matchMethod: matchMethodUsed,
        correlatedAt: new Date(),
        status: "Matched",
        userId: user._id,
        entitlementId: entId,
      });
    }
  }
  return out;
}

/**
 * Stream users, match against pre-built index, bulk insert correlation rows in chunks.
 * @param {import('mongodb').Db} db
 * @param {{
 *   appName: string,
 *   applicationDisplayName?: string,
 *   applicationId: import('mongoose').Types.ObjectId,
 *   tenantId: import('mongoose').Types.ObjectId | null | undefined,
 *   tenantSlug: string,
 *   userField: string,
 *   entitlementField: string,
 *   userRawDataAlternateKeys?: string[],
 *   entitlementRawDataAlternateKeys?: string[],
 * }} opts
 */
export async function runAccountEntitlementCorrelation(db, opts) {
  const {
    appName,
    applicationDisplayName,
    applicationId,
    tenantId,
    tenantSlug,
    userField,
    entitlementField,
    userRawDataAlternateKeys = [],
    entitlementRawDataAlternateKeys = [],
  } = opts;
  const correlationCollName = `app_${appName}_correlation`;
  const userEntAppLabel =
    (applicationDisplayName && String(applicationDisplayName).trim()) ||
    String(appName || "")
      .replace(/_/g, "")
      .trim() ||
    String(appName || "");
  const usersColl = db.collection(getAppUsersCollectionName(userEntAppLabel, tenantSlug));
  const entsColl = db.collection(getAppEntitlementsCollectionName(userEntAppLabel, tenantSlug));

  const filter = { applicationId };
  const matchMethodUsed = `${userField} [SmartMatch] = ${entitlementField}`;

  const started = Date.now();
  const { index, entCount } = await buildEntitlementTokenIndex(
    entsColl,
    filter,
    entitlementField,
    entitlementRawDataAlternateKeys,
  );

  let usersProcessed = 0;
  let matchCount = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const slice = batch.splice(0, batch.length);
    await db.collection(correlationCollName).insertMany(slice, { ordered: false });
  };

  const userCursor = usersColl.find(filter).batchSize(2000);
  for await (const user of userCursor) {
    usersProcessed += 1;
    const links = linksForUser(
      index,
      user,
      userField,
      matchMethodUsed,
      tenantId,
      applicationId,
      userRawDataAlternateKeys,
    );
    matchCount += links.length;
    for (const row of links) {
      batch.push(row);
      if (batch.length >= INSERT_CHUNK) await flush();
    }
  }
  await flush();

  const durationMs = Date.now() - started;
  return {
    matchCount,
    usersProcessed,
    entitlementsIndexed: entCount,
    indexTokenCount: index.size,
    durationMs,
  };
}

/**
 * Normalized group DN → entitlement ObjectId[] (deduped per DN).
 * @param {import('mongodb').Collection} entColl
 * @param {object} filter
 */
export async function buildAdEntitlementDnIndex(entColl, filter) {
  const byDn = new Map();
  let entCount = 0;
  const cursor = entColl
    .find(filter)
    .project({ _id: 1, source_dn: 1, entitlement_id: 1, "rawData.groupDN": 1 })
    .batchSize(2000);

  for await (const ent of cursor) {
    entCount += 1;
    const entId = ent._id;
    const sid = String(entId);
    const dnCandidates = [
      ent.source_dn,
      ent.rawData?.groupDN,
    ];
    for (const dnRaw of dnCandidates) {
      const norm = normalizeDn(dnRaw);
      if (!norm) continue;
      if (!byDn.has(norm)) byDn.set(norm, []);
      const arr = byDn.get(norm);
      if (!arr.some((id) => String(id) === sid)) arr.push(entId);
    }
  }
  return { byDn, entCount };
}

/**
 * @param {object} user
 * @returns {string[]}
 */
export function memberGroupDnsForAdUser(user) {
  const rd = user?.rawData && typeof user.rawData === "object" ? user.rawData : null;
  const fromArray = Array.isArray(rd?.ad_memberOf_dns) ? rd.ad_memberOf_dns : [];
  const dns = fromArray.map((d) => normalizeDn(d)).filter(Boolean);
  if (dns.length) return dns;
  return [];
}

/**
 * AD connector: link users to entitlements by normalized group DN (memberOf), not display-name tokens.
 * @param {import('mongodb').Db} db
 * @param {{
 *   appName: string,
 *   applicationDisplayName?: string,
 *   applicationId: import('mongoose').Types.ObjectId,
 *   tenantId: import('mongoose').Types.ObjectId | null | undefined,
 *   tenantSlug: string,
 * }} opts
 */
export async function runAdMembershipAccountEntitlementCorrelation(db, opts) {
  const {
    appName,
    applicationDisplayName,
    applicationId,
    tenantId,
    tenantSlug,
  } = opts;
  const correlationCollName = `app_${appName}_correlation`;
  const userEntAppLabel =
    (applicationDisplayName && String(applicationDisplayName).trim()) ||
    String(appName || "")
      .replace(/_/g, "")
      .trim() ||
    String(appName || "");
  const usersColl = db.collection(getAppUsersCollectionName(userEntAppLabel, tenantSlug));
  const entsColl = db.collection(getAppEntitlementsCollectionName(userEntAppLabel, tenantSlug));

  const filter = { applicationId };
  const matchMethodUsed = "ad_memberOf_dns [AD FK]";

  const started = Date.now();
  const { byDn, entCount } = await buildAdEntitlementDnIndex(entsColl, filter);

  let usersProcessed = 0;
  let matchCount = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const slice = batch.splice(0, batch.length);
    await db.collection(correlationCollName).insertMany(slice, { ordered: false });
  };

  const userCursor = usersColl
    .find(filter)
    .project({ _id: 1, rawData: 1 })
    .batchSize(2000);

  for await (const user of userCursor) {
    usersProcessed += 1;
    const groupDns = memberGroupDnsForAdUser(user);
    if (!groupDns.length) continue;

    const seenPair = new Set();
    for (const dn of groupDns) {
      const entIds = byDn.get(dn);
      if (!entIds?.length) continue;
      for (const entId of entIds) {
        const key = `${String(user._id)}:${String(entId)}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        matchCount += 1;
        batch.push({
          tenantId,
          applicationId,
          matchMethod: matchMethodUsed,
          correlatedAt: new Date(),
          status: "Matched",
          userId: user._id,
          entitlementId: entId,
        });
        if (batch.length >= INSERT_CHUNK) await flush();
      }
    }
  }
  await flush();

  const durationMs = Date.now() - started;
  return {
    matchCount,
    usersProcessed,
    entitlementsIndexed: entCount,
    indexTokenCount: byDn.size,
    durationMs,
    method: "ad_memberOf_dns",
  };
}

const CORRELATION_PAIR_CHUNK = Number(process.env.ACCOUNT_ENT_CORR_DIFF_CHUNK ?? 2000);

function correlationPairKey(userId, entitlementId) {
  return `${String(userId)}|${String(entitlementId)}`;
}

/**
 * Incremental AD membership correlation — edge diff instead of deleteMany + full rebuild.
 * @param {import('mongodb').Db} db
 * @param {{
 *   appName: string,
 *   applicationDisplayName?: string,
 *   applicationId: import('mongoose').Types.ObjectId,
 *   tenantId: import('mongoose').Types.ObjectId | null | undefined,
 *   tenantSlug: string,
 *   userDocs: object[],
 *   membershipChangedUserIds?: import('mongoose').Types.ObjectId[],
 *   removedUserIds?: import('mongoose').Types.ObjectId[],
 *   rebuildStats?: boolean,
 * }} opts
 */
export async function applyIncrementalAdMembershipCorrelation(db, opts) {
  const {
    appName,
    applicationDisplayName,
    applicationId,
    tenantId,
    tenantSlug,
    userDocs = [],
    membershipChangedUserIds = [],
    removedUserIds = [],
    rebuildStats = false,
  } = opts;

  if (!membershipChangedUserIds.length && !removedUserIds.length) {
    return {
      matchCount: 0,
      edgesAdded: 0,
      edgesRemoved: 0,
      usersProcessed: 0,
      entitlementsIndexed: 0,
      indexTokenCount: 0,
      durationMs: 0,
      method: "ad_memberOf_dns_incremental_skipped",
    };
  }

  const correlationCollName = `app_${appName}_correlation`;
  const correlationColl = db.collection(correlationCollName);
  const userEntAppLabel =
    (applicationDisplayName && String(applicationDisplayName).trim()) ||
    String(appName || "")
      .replace(/_/g, "")
      .trim() ||
    String(appName || "");
  const entsColl = db.collection(getAppEntitlementsCollectionName(userEntAppLabel, tenantSlug));
  const filter = { applicationId };
  const matchMethodUsed = "ad_memberOf_dns [AD FK]";
  const started = Date.now();

  const { byDn, entCount } = await buildAdEntitlementDnIndex(entsColl, filter);

  const changedUserIdSet = new Set(
    [...membershipChangedUserIds, ...removedUserIds].map(String).filter(Boolean),
  );

  const docsWithIds = (userDocs || []).filter((u) => u._id);
  const desiredPairs = new Map();

  for (const user of docsWithIds) {
    if (changedUserIdSet.size && !changedUserIdSet.has(String(user._id))) continue;
    for (const dn of memberGroupDnsForAdUser(user)) {
      const entIds = byDn.get(dn);
      if (!entIds?.length) continue;
      for (const entId of entIds) {
        desiredPairs.set(correlationPairKey(user._id, entId), {
          userId: user._id,
          entitlementId: entId,
        });
      }
    }
  }

  let edgesRemoved = 0;
  let edgesAdded = 0;

  if (removedUserIds.length) {
    const res = await correlationColl.deleteMany({
      applicationId,
      userId: { $in: removedUserIds },
    });
    edgesRemoved += res.deletedCount || 0;
  }

  const userIdsToDiff = [...new Set(membershipChangedUserIds.map(String))].filter(Boolean);
  if (userIdsToDiff.length) {
    const existingPairs = new Map();
    const cursor = correlationColl
      .find({ applicationId, userId: { $in: membershipChangedUserIds } })
      .project({ userId: 1, entitlementId: 1 })
      .batchSize(2000);

    for await (const row of cursor) {
      existingPairs.set(correlationPairKey(row.userId, row.entitlementId), row);
    }

    const toDelete = [];
    for (const [key, row] of existingPairs) {
      if (!desiredPairs.has(key)) {
        toDelete.push({ userId: row.userId, entitlementId: row.entitlementId });
      }
    }

    const toInsert = [];
    const now = new Date();
    for (const [key, pair] of desiredPairs) {
      if (!existingPairs.has(key)) {
        toInsert.push({
          tenantId,
          applicationId,
          matchMethod: matchMethodUsed,
          correlatedAt: now,
          status: "Matched",
          userId: pair.userId,
          entitlementId: pair.entitlementId,
        });
      }
    }

    for (let i = 0; i < toDelete.length; i += CORRELATION_PAIR_CHUNK) {
      const chunk = toDelete.slice(i, i + CORRELATION_PAIR_CHUNK);
      if (!chunk.length) continue;
      await correlationColl.bulkWrite(
        chunk.map((p) => ({
          deleteOne: {
            filter: {
              applicationId,
              userId: p.userId,
              entitlementId: p.entitlementId,
            },
          },
        })),
        { ordered: false },
      );
      edgesRemoved += chunk.length;
    }

    for (let i = 0; i < toInsert.length; i += CORRELATION_PAIR_CHUNK) {
      const chunk = toInsert.slice(i, i + CORRELATION_PAIR_CHUNK);
      if (!chunk.length) continue;
      await correlationColl.insertMany(chunk, { ordered: false });
      edgesAdded += chunk.length;
    }
  } else if (!removedUserIds.length && docsWithIds.length && membershipChangedUserIds.length) {
    // Covered by per-user diff above
  }

  if (rebuildStats) {
    await rebuildCorrelationEntitlementStats(db, appName, applicationId);
  }

  const durationMs = Date.now() - started;
  return {
    matchCount: edgesAdded,
    edgesAdded,
    edgesRemoved,
    usersProcessed: docsWithIds.length,
    entitlementsIndexed: entCount,
    indexTokenCount: byDn.size,
    durationMs,
    method: "ad_memberOf_dns_incremental",
  };
}
