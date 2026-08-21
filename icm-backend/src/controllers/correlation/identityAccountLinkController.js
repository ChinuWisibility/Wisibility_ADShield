import mongoose from 'mongoose';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import Application from '../../models/application/Application.js';
import OrphanAccount from '../../models/identity/OrphanAccount.js'; // <-- NEW IMPORT!
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { getAppEntitlementsCollectionName, resolveTenantSlugFromTenantId } from '../../utils/applicationDynamicCollections.js';
import { syncIdentityStats } from '../../utils/syncIdentityStats.js';
import { evaluateGovernanceOrphan } from '../../utils/correlationGovernance.js';
import {
  fetchCorrelatedEntitlementsWithProjectionFallback,
  loadProjectedEntitlementsByAccountForIdentity,
} from '../../utils/identityEntitlementProjectionRead.js';
import {
  scheduleSyncForIdentity,
} from '../../utils/identityEntitlementSyncTrigger.js';

function getByPath(obj, path) {
  if (!path || !obj) return undefined;
  const data = obj.toObject ? obj.toObject() : obj;
  return String(path)
    .split('.')
    .reduce((acc, part) => (acc != null && acc[part] !== undefined ? acc[part] : undefined), data);
}

function looksLikeMongoId(s) {
  return typeof s === 'string' && /^[a-f\d]{24}$/i.test(s.trim());
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isResolvedLiveUserDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (String(doc.status || '').includes('Fallback')) return false;
  const id = doc._id;
  return Boolean(id && mongoose.Types.ObjectId.isValid(String(id)) && String(id).length === 24);
}

/**
 * Load app_*_users row: supports Mongo _id (manual link) and native/business ids (correlation engine stores nativeAccountId).
 * @param {import('mongoose').Model} DynamicUserModel
 * @param {object} link IdentityAccountLink lean or document
 * @param {object|null} appDoc populated Application
 */
export async function resolveLiveApplicationUser(DynamicUserModel, link, appDoc) {
  const aid = link.accountId;
  if (aid == null || String(aid).trim() === '') return null;

  const idStr = String(aid).trim();
  const appOid = appDoc && appDoc._id ? appDoc._id : null;

  try {
    if (looksLikeMongoId(idStr)) {
      if (appOid) {
        const scoped = await DynamicUserModel.findOne({ _id: idStr, applicationId: appOid }).lean();
        if (scoped) return scoped;
      }
      const byId = await DynamicUserModel.findById(aid).lean();
      if (byId) return byId;
    }
  } catch (e) {
    console.warn(`[resolveLiveApplicationUser] findById failed for ${idStr}:`, e.message);
  }

  const corrAttr =
    (link.correlationAccountAttribute && String(link.correlationAccountAttribute).trim()) ||
    (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.accountAttribute || '').trim()) ||
    '';

  const commonKeys = [
    'account_id',
    'username',
    'user_id',
    'email',
    'nativeAccountId',
    'samAccountName',
    'userPrincipalName',
    'oracle_username',
    'employee_id',
  ];

  const orEq = [];
  if (corrAttr) {
    orEq.push({ [corrAttr]: idStr });
    orEq.push({ [`rawData.${corrAttr}`]: idStr });
  }
  for (const k of commonKeys) {
    orEq.push({ [k]: idStr });
    orEq.push({ [`rawData.${k}`]: idStr });
  }

  const candidateFilter =
    appOid && orEq.length
      ? { $and: [{ applicationId: appOid }, { $or: orEq }] }
      : orEq.length
        ? { $or: orEq }
        : null;
  if (!candidateFilter) return null;

  try {
    const candidates = await DynamicUserModel.find(candidateFilter).sort({ updatedAt: -1 }).limit(10).lean();
    if (!candidates?.length) return null;

    const exact = candidates.find((c) => {
      if (corrAttr) {
        const top = getByPath(c, corrAttr);
        const raw = c.rawData ? getByPath(c.rawData, corrAttr) : undefined;
        if (top != null && String(top).trim() === idStr) return true;
        if (raw != null && String(raw).trim() === idStr) return true;
      }
      for (const k of commonKeys) {
        if (c[k] != null && String(c[k]).trim() === idStr) return true;
        if (c.rawData && c.rawData[k] != null && String(c.rawData[k]).trim() === idStr) return true;
      }
      return false;
    });

    const ci = new RegExp(`^${escapeRegex(idStr)}$`, 'i');
    const caseInsensitive = candidates.find((c) => {
      if (corrAttr) {
        const top = getByPath(c, corrAttr);
        const raw = c.rawData ? getByPath(c.rawData, corrAttr) : undefined;
        if (top != null && ci.test(String(top).trim())) return true;
        if (raw != null && ci.test(String(raw).trim())) return true;
      }
      for (const k of commonKeys) {
        if (c[k] != null && ci.test(String(c[k]).trim())) return true;
        if (c.rawData && c.rawData[k] != null && ci.test(String(c.rawData[k]).trim())) return true;
      }
      return false;
    });

    return exact || caseInsensitive || candidates[0];
  } catch (e) {
    console.warn(`[resolveLiveApplicationUser] native lookup failed for ${idStr}:`, e.message);
    return null;
  }
}

function normalizeAccountDedupeKeyPart(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function mergeCorrelatedEntitlementLists(lists) {
  const byKey = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      const id = e?.entitlementId != null ? String(e.entitlementId) : '';
      const name = e?.entitlementName != null ? String(e.entitlementName) : '';
      const disp = e?.displayName != null ? String(e.displayName) : '';
      const key = id || normalizeAccountDedupeKeyPart(disp || name);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, e);
    }
  }
  return [...byKey.values()];
}

const ENTITLEMENT_MERGE_KEYS = [
  'sap_roles',
  'member_of_entitlements',
  'groups',
  'roles',
  'entitlements',
  'profiles',
  'permissions',
  'data_access',
  'responsibilities',
];

/**
 * When duplicate user rows exist for the same logical account, union delimited entitlement fields for UI extraction.
 * @param {object} base primary live user lean doc
 * @param {object[]} allResolvedDocs other resolved lean docs in the same consolidate group
 */
function mergeEntitlementFieldsAcrossDuplicates(base, allResolvedDocs) {
  if (!base || !allResolvedDocs?.length) return base;
  const out = { ...base };
  for (const k of ENTITLEMENT_MERGE_KEYS) {
    const tokens = new Set();
    for (const d of allResolvedDocs) {
      const v = d[k] ?? (d.rawData && typeof d.rawData === 'object' ? d.rawData[k] : undefined);
      if (Array.isArray(v)) {
        v.forEach((x) => {
          const s = String(x).trim();
          if (s) tokens.add(s);
        });
      } else if (typeof v === 'string' && v.trim()) {
        v.split(/[;,|]/).forEach((p) => {
          const s = p.trim();
          if (s) tokens.add(s);
        });
      }
    }
    if (tokens.size) out[k] = [...tokens].join('|');
  }
  return out;
}

function fallbackAccountIdentifier(doc) {
  if (!doc) return '';
  const d = doc.toObject ? doc.toObject() : doc;
  return (
    d.samAccountName ||
    d.userPrincipalName ||
    d.username ||
    d.user_id ||
    d.email ||
    d.employee_id ||
    d.display_name ||
    d.displayName ||
    ''
  );
}

/** Same slug as appCorrelationController.executeCorrelation (underscores between words). */
function appCorrelationCollectionSlug(appName) {
  return String(appName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_');
}

/**
 * Entitlements linked to this account row via Account/Entitlement correlation (Run Engine).
 * @param {import('mongodb').Db} db
 * @param {string} appName Application display name
 * @param {import('mongoose').Types.ObjectId} applicationId
 * @param {import('mongoose').Types.ObjectId} userObjectId Account document _id in app_*_users
 * @returns {Promise<{ entitlementId: string, entitlementName: string, displayName: string }[]>}
 */
export async function fetchCorrelatedEntitlementsForAccount(db, appName, applicationId, userObjectId, tenantId) {
  if (!db || !appName || !applicationId || !userObjectId) return [];

  const corrSlug = appCorrelationCollectionSlug(appName);
  const corrColl = db.collection(`app_${corrSlug}_correlation`);
  const tenantSlug = await resolveTenantSlugFromTenantId(tenantId);
  if (!tenantSlug) {
    console.warn(`[fetchCorrelatedEntitlementsForAccount] Cannot resolve tenant slug for application "${appName}" — skipping entitlement lookup.`);
    return [];
  }
  const entColl = db.collection(getAppEntitlementsCollectionName(appName, tenantSlug));

  let rows = [];
  try {
    rows = await corrColl.find({ applicationId, userId: userObjectId }).project({ entitlementId: 1 }).toArray();
  } catch {
    return [];
  }
  if (!rows.length) return [];

  const entIds = [...new Set(rows.map((r) => r.entitlementId).filter(Boolean))];
  const oidList = entIds
    .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null))
    .filter(Boolean);
  if (!oidList.length) return [];

  let entDocs = [];
  try {
    entDocs = await entColl.find({ _id: { $in: oidList } }).toArray();
  } catch {
    entDocs = [];
  }

  const byId = new Map(entDocs.map((e) => [String(e._id), e]));
  const out = [];
  const seen = new Set();

  for (const row of rows) {
    const eid = row.entitlementId;
    if (!eid) continue;
    const key = String(eid);
    if (seen.has(key)) continue;
    seen.add(key);
    const d = byId.get(key);
    const entName = d?.entitlement_name || d?.name || key;
    const disp = d?.displayName || d?.display_name || entName;
    out.push({
      entitlementId: key,
      entitlementName: entName,
      displayName: disp,
    });
  }
  return out;
}

/**
 * Human-readable value for “what matched” on the application account — never prefer Mongo _id.
 */
function resolveCorrelationAccountDisplay(link, liveDoc, appDoc) {
  const snap = link.correlationMatchDisplay && String(link.correlationMatchDisplay).trim();
  if (snap) return snap;

  const field =
    (link.correlationAccountAttribute && String(link.correlationAccountAttribute).trim()) ||
    (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.accountAttribute || '').trim()) ||
    '';

  if (field && liveDoc) {
    const v = getByPath(liveDoc, field) ?? (liveDoc.rawData ? getByPath(liveDoc.rawData, field) : undefined);
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }

  const fb = fallbackAccountIdentifier(liveDoc);
  if (fb) return String(fb).trim();

  if (link.accountName && String(link.accountName).trim()) return String(link.accountName).trim();

  const aid = link.accountId;
  if (aid && !looksLikeMongoId(String(aid))) return String(aid).trim();

  return '';
}

/** Links that share the same correlation snapshot can borrow a sibling's resolved warehouse row when this link's Mongo id matches that row (restores data after per-row grouping). */
function cohortDisplayKeyForLink(link, appId) {
  const snap = link.correlationMatchDisplay && String(link.correlationMatchDisplay).trim();
  if (snap) return `${String(appId || '')}|${normalizeAccountDedupeKeyPart(snap)}`;
  return `${String(appId || '')}|link:${String(link._id)}`;
}

/**
 * Second-chance warehouse load, cohort borrow, then refresh display / group key / correlated entitlements.
 */
async function repairAndFinalizePreRows(preRows, identityId, tenantId) {
  for (const row of preRows) {
    if (isResolvedLiveUserDoc(row.liveAccountData)) continue;
    if (!row.appDoc || row.appName === 'Unknown Application') continue;
    const aid = row.link?.accountId;
    if (!aid || !looksLikeMongoId(String(aid))) continue;
    try {
      const M = await getDynamicUserModelForTenantId(row.appName, row.appDoc?.tenantId);
      const oid = new mongoose.Types.ObjectId(String(aid).trim());
      const d = await M.findOne({ _id: oid, applicationId: row.appDoc._id }).lean();
      if (d) row.liveAccountData = d;
    } catch {
      /* invalid ObjectId */
    }
  }

  const cohortMap = new Map();
  for (const row of preRows) {
    const ck = cohortDisplayKeyForLink(row.link, row.appId);
    if (!cohortMap.has(ck)) cohortMap.set(ck, []);
    cohortMap.get(ck).push(row);
  }

  for (const row of preRows) {
    if (isResolvedLiveUserDoc(row.liveAccountData)) continue;
    const aid = row.link?.accountId;
    if (!aid || !looksLikeMongoId(String(aid))) continue;
    const sibs = cohortMap.get(cohortDisplayKeyForLink(row.link, row.appId)) || [];
    const donor = sibs.find(
      (s) =>
        s !== row &&
        isResolvedLiveUserDoc(s.liveAccountData) &&
        String(s.liveAccountData._id) === String(aid)
    );
    if (donor) row.liveAccountData = donor.liveAccountData;
  }

  const projectedByAccount =
    identityId && tenantId
      ? await loadProjectedEntitlementsByAccountForIdentity(identityId, tenantId)
      : null;

  const db = mongoose.connection.db;
  for (const row of preRows) {
    row.correlationDisplayValue = resolveCorrelationAccountDisplay(row.link, row.liveAccountData, row.appDoc);
    const stableAccountKey =
      row.liveAccountData && row.liveAccountData._id
        ? String(row.liveAccountData._id)
        : `link:${String(row.link._id)}`;
    row.groupKey = `${String(row.appId || '')}|${stableAccountKey}`;

    const uid = row.liveAccountData?._id;
    if (!row.correlatedEntitlements?.length && db && row.appId && uid) {
      try {
        if (projectedByAccount) {
          const key = `${String(row.appId)}:${String(uid)}`;
          row.correlatedEntitlements = projectedByAccount.get(key) || [];
        } else {
          row.correlatedEntitlements = await fetchCorrelatedEntitlementsWithProjectionFallback({
            identityId,
            applicationId: row.appId,
            accountId: uid,
            tenantId: row.appDoc?.tenantId || tenantId,
            legacyFetch: () =>
              fetchCorrelatedEntitlementsForAccount(
                db,
                row.appName,
                row.appId,
                uid,
                row.appDoc?.tenantId || tenantId,
              ),
          });
        }
      } catch (e) {
        console.warn(`[getLinksForIdentity] correlated entitlements refetch skipped: ${e.message}`);
      }
    }
  }
}

// 1. GET ALL ACCOUNTS FOR AN IDENTITY (Robust Version)
export const getLinksForIdentity = async (req, res) => {
  try {
    const identityId = req.params.id;
    const LegacyIdentity = getLegacyIdentityModel();
    const legacyIdentity = await LegacyIdentity.findById(identityId).select('tenantId').lean();
    const tenantId = legacyIdentity?.tenantId;

    const links = await IdentityAccountLink.find({ identityId })
      .populate('applicationId', 'name type lastManualCorrelation tenantId icon color')
      .sort({ createdAt: -1 });

    /** @type {object[]} */
    const preRows = [];

    for (const link of links) {
      const appDoc = link.applicationId && typeof link.applicationId === 'object' ? link.applicationId : null;
      const appName = appDoc ? appDoc.name : 'Unknown Application';
      const appType = appDoc ? appDoc.type : 'UNKNOWN';
      const appId = appDoc ? appDoc._id : null;

      let liveAccountData = null;
      try {
        if (appName !== 'Unknown Application') {
          const DynamicUserModel = await getDynamicUserModelForTenantId(appName, appDoc?.tenantId);
          liveAccountData = await resolveLiveApplicationUser(DynamicUserModel, link, appDoc);
        }
      } catch (err) {
        console.warn(`[WARNING] Could not fetch live data for account ${link.accountId} in app ${appName}. Error: ${err.message}`);
      }

      const correlationAccountAttribute =
        (link.correlationAccountAttribute && String(link.correlationAccountAttribute).trim()) ||
        (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.accountAttribute || '').trim()) ||
        '';

      const correlationIdentityAttribute =
        (link.correlationIdentityAttribute && String(link.correlationIdentityAttribute).trim()) ||
        (appDoc?.lastManualCorrelation && String(appDoc.lastManualCorrelation.identityAttribute || '').trim()) ||
        '';

      const correlationDisplayValue = resolveCorrelationAccountDisplay(link, liveAccountData, appDoc);

      let correlatedEntitlements = [];
      try {
        const db = mongoose.connection.db;
        const uid = liveAccountData?._id;
        if (db && appId && uid) {
          correlatedEntitlements = await fetchCorrelatedEntitlementsForAccount(db, appName, appId, uid, appDoc?.tenantId);
        }
      } catch (e) {
        console.warn(`[getLinksForIdentity] correlated entitlements skipped: ${e.message}`);
      }

      preRows.push({
        link,
        appDoc,
        appName,
        appType,
        appId,
        appIcon: appDoc?.icon || null,
        appColor: appDoc?.color || null,
        liveAccountData,
        correlationAccountAttribute,
        correlationIdentityAttribute,
        correlationDisplayValue,
        correlationMatchDisplay: link.correlationMatchDisplay,
        correlatedEntitlements,
      });
    }

    // Scoped warehouse load + cohort borrow, then groupKey from resolved Mongo _id (not display alone).
    await repairAndFinalizePreRows(preRows, identityId, tenantId);

    const byGroup = new Map();
    for (const row of preRows) {
      // Prefer stable warehouse id; fall back to match-display so legacy native-id
      // links collapse with Mongo-_id links for the same logical account.
      const displayKey = normalizeAccountDedupeKeyPart(
        row.correlationDisplayValue ||
          row.correlationMatchDisplay ||
          row.link?.correlationMatchDisplay ||
          row.link?.accountName ||
          '',
      );
      const logicalKey =
        row.liveAccountData && row.liveAccountData._id
          ? `${String(row.appId || '')}|mongo:${String(row.liveAccountData._id)}`
          : displayKey
            ? `${String(row.appId || '')}|disp:${displayKey}`
            : row.groupKey;
      if (!byGroup.has(logicalKey)) byGroup.set(logicalKey, []);
      byGroup.get(logicalKey).push(row);
    }

    const enrichedLinks = [];
    for (const [, group] of byGroup) {
      const sorted = [...group].sort((a, b) => {
        const ar = isResolvedLiveUserDoc(a.liveAccountData) ? 1 : 0;
        const br = isResolvedLiveUserDoc(b.liveAccountData) ? 1 : 0;
        if (br !== ar) return br - ar;
        const aAct = a.link?.isActive === false ? 0 : 1;
        const bAct = b.link?.isActive === false ? 0 : 1;
        if (bAct !== aAct) return bAct - aAct;
        const at = a.link?.updatedAt ? new Date(a.link.updatedAt).getTime() : 0;
        const bt = b.link?.updatedAt ? new Date(b.link.updatedAt).getTime() : 0;
        return bt - at;
      });

      const primary = sorted[0];
      const mergedEnts = mergeCorrelatedEntitlementLists(sorted.map((s) => s.correlatedEntitlements));
      const consolidatedLinkIds = sorted.map((s) => String(s.link._id));

      let accountData =
        primary.liveAccountData ||
        sorted.find((s) => isResolvedLiveUserDoc(s.liveAccountData))?.liveAccountData ||
        null;

      if (!accountData) {
        // Unresolved warehouse row — do not invent a fake "Active (Fallback)" twin
        // that looks like a second live account. Surface the link metadata instead.
        accountData = {
          _id: primary.link.accountId,
          status: 'Link only',
          unresolved: true,
        };
      }

      const resolvedDocs = sorted.map((s) => s.liveAccountData).filter((d) => isResolvedLiveUserDoc(d));
      if (resolvedDocs.length > 1 && isResolvedLiveUserDoc(accountData)) {
        accountData = mergeEntitlementFieldsAcrossDuplicates(accountData, resolvedDocs);
      }

      const isLinkActive = sorted.some((s) => s.link?.isActive !== false);

      enrichedLinks.push({
        linkId: primary.link._id,
        consolidatedLinkIds,
        isActive: isLinkActive,
        applicationId: primary.appId,
        applicationName: primary.appName,
        applicationType: primary.appType,
        applicationIcon: primary.appIcon || undefined,
        applicationColor: primary.appColor || undefined,
        correlationMethod: primary.link.correlationMethod,
        correlationScore: primary.link.correlationScore,
        lastVerifiedAt: primary.link.lastVerifiedAt,
        correlationIdentityAttribute: primary.correlationIdentityAttribute || undefined,
        correlationAccountAttribute: primary.correlationAccountAttribute || undefined,
        correlationMatchDisplay: primary.correlationMatchDisplay || undefined,
        correlationDisplayValue: primary.correlationDisplayValue,
        accountData,
        correlatedEntitlements: mergedEnts,
      });
    }

    res.status(200).json({ success: true, count: enrichedLinks.length, data: enrichedLinks });
  } catch (error) {
    console.error("Error fetching links:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. MANUALLY LINK AN ACCOUNT
export const manuallyLinkAccount = async (req, res) => {
  try {
    const { applicationId, accountId, accountName } = req.body;
    const rawIdentityId = req.body.identityId ?? req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(rawIdentityId))) {
      return res.status(400).json({ success: false, message: 'Invalid identity id' });
    }
    const identityOid = new mongoose.Types.ObjectId(String(rawIdentityId));

    const legacyIdentity = await getLegacyIdentityModel().findById(identityOid).select('tenantId').lean();
    const Identity = legacyIdentity?.tenantId
      ? await getDynamicIdentityModelForTenantId(legacyIdentity.tenantId)
      : null;
    const identityDoc = Identity
      ? await Identity.findById(identityOid).select('lifecycleState').lean()
      : null;
    let accountDoc = null;
    try {
      const app = await Application.findById(applicationId).select('name tenantId').lean();
      if (app?.name && mongoose.Types.ObjectId.isValid(String(accountId))) {
        const Model = await getDynamicUserModelForTenantId(app.name, app.tenantId);
        accountDoc = await Model.findById(accountId).lean();
      }
    } catch (e) {
      console.warn('[manuallyLinkAccount] account load for governance:', e.message);
    }
    const gov = evaluateGovernanceOrphan({ lifecycleState: identityDoc?.lifecycleState }, accountDoc || {});

    const newLink = await IdentityAccountLink.findOneAndUpdate(
      { applicationId, accountId },
      {
        tenantId: legacyIdentity?.tenantId || undefined,
        identityId: identityOid,
        accountName,
        correlationMethod: 'MANUAL',
        correlationScore: 100,
        correlationStatus: 'correlated',
        correlationConfidence: 'high',
        isOrphan: gov.isOrphan,
        orphanReason: gov.orphanReason || null,
        isActive: true,
        lastVerifiedAt: new Date()
      },
      { new: true, upsert: true }
    );

    // If this was an orphan, delete it from the orphan queue!
    await OrphanAccount.findOneAndDelete({ applicationId, accountId });

    await syncIdentityStats(identityOid);
    scheduleSyncForIdentity(identityOid, applicationId);

    res.status(200).json({ success: true, message: 'Account successfully linked manually.', data: newLink });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Soft-enable / disable an identity–application account link (does not delete the link).
 * When the UI merged duplicate links, pass consolidatedLinkIds so all rows stay in sync.
 */
export const setIdentityAccountLinkActive = async (req, res) => {
  try {
    const { linkId } = req.params;
    const { isActive, consolidatedLinkIds } = req.body || {};

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Request body must include isActive (boolean).' });
    }

    const anchor = await IdentityAccountLink.findById(linkId).lean();
    if (!anchor) return res.status(404).json({ success: false, message: 'Link not found' });

    const identityOid = anchor.identityId;
    const idStrings = Array.isArray(consolidatedLinkIds) && consolidatedLinkIds.length
      ? [...new Set([...consolidatedLinkIds.map(String), String(linkId)])]
      : [String(linkId)];

    const oids = idStrings
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    if (!oids.length) {
      return res.status(400).json({ success: false, message: 'No valid link ids to update.' });
    }

    const matched = await IdentityAccountLink.countDocuments({ _id: { $in: oids }, identityId: identityOid });
    if (matched !== oids.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more link ids do not belong to this identity.',
      });
    }

    await IdentityAccountLink.updateMany(
      { _id: { $in: oids }, identityId: identityOid },
      { $set: { isActive, lastVerifiedAt: new Date() } },
    );

    if (identityOid) {
      await syncIdentityStats(identityOid);
      scheduleSyncForIdentity(identityOid, anchor.applicationId);
    }

    res.status(200).json({
      success: true,
      message: isActive ? 'Account link enabled.' : 'Account link disabled.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. UNLINK AN ACCOUNT (Turns it into an Orphan!)
export const unlinkAccount = async (req, res) => {
  try {
    const { linkId } = req.params;

    const link = await IdentityAccountLink.findById(linkId);
    if (!link) return res.status(404).json({ success: false, message: 'Link not found' });

    const identityId = link.identityId;

    // Delete the link
    await IdentityAccountLink.findByIdAndDelete(linkId);

    // Update the Identity's counters
    await syncIdentityStats(identityId);
    scheduleSyncForIdentity(identityId, link.applicationId);

    const appDoc = await Application.findById(link.applicationId).select('tenantId').lean();
    const tenantId = appDoc?.tenantId;
    const aid = String(link.accountId);
    const correlationKey = `aid:${aid}`;
    const appOid = mongoose.Types.ObjectId.isValid(link.applicationId)
      ? new mongoose.Types.ObjectId(String(link.applicationId))
      : link.applicationId;

    // Identity: (applicationId, accountId) — same contract as correlation run upserts.
    await OrphanAccount.findOneAndUpdate(
      { applicationId: appOid, accountId: aid },
      {
        $set: {
          tenantId,
          applicationId: appOid,
          accountId: aid,
          accountName: link.accountName,
          correlationKey,
          status: 'OPEN',
          riskLevel: 'HIGH',
        },
        $setOnInsert: { detectedAt: new Date() },
      },
      { upsert: true }
    );
    
    res.status(200).json({ success: true, message: 'Account unlinked and moved to Orphans.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
