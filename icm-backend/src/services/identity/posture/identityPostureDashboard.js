/**
 * Identity Posture Dashboard — consolidated runtime logic for the
 * Identity Posture Details page (scoring, access, SOD, peers, profile fields).
 * Rule CRUD / validation: postureRuleDefaults, postureRuleResolver, postureRulesValidation.
 */

import mongoose from 'mongoose';
import IdentityAccountLink from '../../../models/identity/IdentityAccountLink.js';
import DiscoveryPolicy from '../../../models/discovery/DiscoveryPolicy.js';
import DiscoveryResult from '../../../models/discovery/DiscoveryResult.js';
import SodViolation from '../../../models/sod/SodViolation.js';
import { getDynamicUserModelForTenantId } from '../../../models/application/Users.js';
import { getIdentityEntitlementModelForTenantId } from '../../../models/identityEntitlementModel.js';
import {
  fetchCorrelatedEntitlementsForAccount,
  resolveLiveApplicationUser,
} from '../../../controllers/correlation/identityAccountLinkController.js';
import { getDynamicValue, identityTargetKeyToMongoPath } from '../../../utils/correlationIdentityFields.js';
import { tryProjectedCorrelatedEntitlements } from '../../../utils/identityEntitlementProjectionRead.js';
import { sodTenantFilter } from '../../../utils/sod/sodTenant.js';
import {
  getAppEntitlementsCollectionName,
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from '../../../utils/applicationDynamicCollections.js';
import {
  evaluateEntity,
  mergeEntityForDiscoveryEval,
} from '../../discovery/discoveryEvaluationService.js';
import { cloneDefaultRules, DEFAULT_IDENTITY_POSTURE_RULES, suggestResolvePaths } from './postureRuleDefaults.js';
import { PRIVILEGED_NAME_TOKENS } from '../../graph/graphConstants.js';

// ── postureConstants ──

const GROUP_ENTITLEMENT_KEYS = [
  'groups',
  'member_of_entitlements',
  'roles',
  'sap_roles',
];

const RAW_TITLE_KEYS = [
  'title',
  'job_title',
  'jobTitle',
  'position',
  'designation',
  'role',
  'Role',
  'Job Title',
];

const SEVERITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

const MAX_RANKING_SCAN = 500;

/** Aligned with access certification / data hygiene privileged flag normalization. */
const PRIVILEGE_STRING_TOKENS = ['true', 'yes', '1', 'y', 'privileged'];

const DISCOVERY_ENTITY_TYPES = ['USER', 'ENTITLEMENT', 'AD_GROUP'];

const ENTITLEMENT_NAME_KEYS = [
  'entitlement_name',
  'entitlement_id',
  'name',
  'displayName',
  'display_name',
];

const ACCOUNT_DISPLAY_KEYS = [
  'username',
  'email',
  'user_id',
  'display_name',
  'nativeAccountId',
  'samAccountName',
  'userPrincipalName',
  'login',
  'gh_login',
];

const ACCOUNT_RAW_DISPLAY_KEYS = [
  'gh_login',
  'github_username',
  'login',
  'username',
  'email',
  'userPrincipalName',
  'samAccountName',
  'oracle_username',
  'employee_id',
];

// ── postureUtils ──

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEntitlement(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  return String(title || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstTrimmed(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function sumBy(items, selector) {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

function toObjectIds(ids) {
  return [...new Set((ids || []).map((id) => String(id)).filter(Boolean))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

function toObjectId(value) {
  const id = String(value || '');
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function looksLikeMongoId(value) {
  return /^[a-f\d]{24}$/i.test(String(value || '').trim());
}

function getByPath(obj, path) {
  if (!path || !obj) return undefined;
  const data = obj.toObject ? obj.toObject() : obj;
  return path.split('.').reduce(
    (acc, part) => (acc != null && acc[part] !== undefined ? acc[part] : undefined),
    data,
  );
}

// ── postureIdentityResolvers ──

export function resolveIdentityTitle(identity) {
  const attrs = identity?.attributes || {};
  for (const key of RAW_TITLE_KEYS) {
    const val = identity?.[key] || attrs[key];
    if (val && String(val).trim()) return String(val).trim();
  }
  return String(identity?.title || '').trim();
}

export function resolveDisplayName(identity) {
  const displayName = String(identity?.displayName || '').trim();
  const fullName = [identity?.firstName, identity?.lastName].filter(Boolean).join(' ').trim();
  return displayName || fullName || identity?.email || 'Unknown';
}

export function resolveManagerName(identity) {
  if (identity?.managerId && typeof identity.managerId === 'object') {
    return resolveDisplayName(identity.managerId);
  }
  return String(identity?.manager || '').trim() || '—';
}

function resolveCorrelationAttribute(link, appDoc) {
  return firstTrimmed(
    link?.correlationAccountAttribute,
    appDoc?.lastManualCorrelation?.accountAttribute,
  );
}

// ── postureAccountHelpers ──

function extractGroupEntitlementsFromAccount(accountData) {
  if (!accountData || typeof accountData !== 'object') return [];

  const found = [];
  const seen = new Set();

  const pushValue = (raw) => {
    const text = String(raw).trim();
    if (!text) return;
    const norm = normalizeEntitlement(text);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    found.push(text);
  };

  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of GROUP_ENTITLEMENT_KEYS) {
      const val = obj[key];
      if (!val) continue;
      if (Array.isArray(val)) {
        val.forEach(pushValue);
      } else if (typeof val === 'string') {
        val.split(/[;|,]/).forEach(pushValue);
      }
    }
  };

  scan(accountData);
  if (accountData.rawData && typeof accountData.rawData === 'object') {
    scan(accountData.rawData);
  }
  return found;
}

function resolveAccountDisplayName(link, appDoc, accountDoc) {
  const matchDisplay = firstTrimmed(link?.correlationMatchDisplay);
  if (matchDisplay) return matchDisplay;

  const corrAttr = resolveCorrelationAttribute(link, appDoc);
  if (accountDoc && corrAttr) {
    const value = getByPath(accountDoc, corrAttr)
      ?? (accountDoc.rawData ? getByPath(accountDoc.rawData, corrAttr) : undefined);
    const text = firstTrimmed(value);
    if (text) return text;
  }

  if (accountDoc) {
    for (const key of ACCOUNT_DISPLAY_KEYS) {
      const text = firstTrimmed(accountDoc[key]);
      if (text) return text;
    }
    const rawData = accountDoc.rawData;
    if (rawData && typeof rawData === 'object') {
      for (const key of ACCOUNT_RAW_DISPLAY_KEYS) {
        const text = firstTrimmed(rawData[key]);
        if (text) return text;
      }
    }
  }

  const named = firstTrimmed(link?.accountName);
  if (named) return named;

  const accountId = link?.accountId != null ? String(link.accountId).trim() : '';
  if (accountId && !looksLikeMongoId(accountId)) return accountId;

  const fallback = firstTrimmed(accountDoc?.display_name, accountDoc?.email, accountDoc?.username);
  return fallback || 'Linked account';
}

function accountMergeKey(appDoc, link, accountDoc, accountDisplayName, corrAttr) {
  const appId = appDoc?._id != null ? String(appDoc._id) : String(appDoc?.name || 'app');
  const name = String(accountDisplayName || '').trim().toLowerCase();
  const corr = String(corrAttr || '').trim().toLowerCase();

  if (name && name !== 'linked account' && corr) {
    return `${appId}\0logical:${corr}:${name}`;
  }
  if (accountDoc?._id) {
    return `${appId}\0mongo:${String(accountDoc._id)}`;
  }

  const accountId = link?.accountId != null ? String(link.accountId).trim() : '';
  if (accountId && looksLikeMongoId(accountId)) {
    return `${appId}\0acct:${accountId.toLowerCase()}`;
  }

  return `${appId}\0link:${String(link._id)}`;
}

function entitlementLabel(entitlement) {
  return firstTrimmed(
    entitlement?.displayName,
    entitlement?.entitlementName,
    entitlement?.entitlementId != null ? String(entitlement.entitlementId) : '',
  );
}

// ── postureFieldResolver ──

function isPresentValue(val) {
  if (val == null) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') return Object.keys(val).length > 0;
  return true;
}

function getResolvePathsForCheck(check) {
  const ev = check?.evaluator || {};
  const paths = [];
  const seen = new Set();

  const pushPath = (p) => {
    const s = String(p || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    paths.push(s);
  };

  if (Array.isArray(ev.resolvePaths) && ev.resolvePaths.length > 0) {
    ev.resolvePaths.forEach(pushPath);
  } else if (ev.path) {
    pushPath(ev.path);
  }

  // Always merge alias fallbacks so tenant configs that only list top-level
  // `location` still find `attributes.location` (and similar nested variants).
  const logicalKey = ev.logicalKey || check?.id || '';
  if (logicalKey) {
    suggestResolvePaths(logicalKey).forEach(pushPath);
    const leaf = String(logicalKey).split('.').pop();
    if (leaf) {
      pushPath(leaf);
      pushPath(`attributes.${leaf}`);
    }
  }

  return paths;
}

export function resolveFieldValueFromIdentity(identity, paths) {
  const list = Array.isArray(paths) ? paths : [];
  for (const path of list) {
    const val = getDynamicValue(identity, path);
    if (isPresentValue(val)) return val;
  }

  // Case-insensitive attributes leaf fallback (e.g. attributes.Location vs location)
  const attrs = identity?.attributes;
  if (attrs && typeof attrs === 'object') {
    const attrKeys = Object.keys(attrs);
    for (const path of list) {
      const leaf = String(path || '').split('.').pop();
      if (!leaf) continue;
      const lower = leaf.toLowerCase();
      const matched = attrKeys.find((k) => k.toLowerCase() === lower);
      if (matched && isPresentValue(attrs[matched])) return attrs[matched];
    }
  }

  return undefined;
}

function isManagerPresenceCheck(check) {
  const ev = check?.evaluator || {};
  if (ev.type === 'builtin' && ev.key === 'hasManager') return true;
  if (ev.type !== 'fieldPresent') return false;
  const label = String(check?.label || '').toLowerCase();
  const logicalKey = String(ev.logicalKey || '').toLowerCase();
  if (logicalKey === 'manager' || label.includes('manager')) return true;
  const paths = getResolvePathsForCheck(check);
  return paths.some((p) => {
    const leaf = String(p || '').split('.').pop()?.toLowerCase() || '';
    return leaf === 'manager' || leaf === 'managerid' || leaf === 'manageremail';
  });
}

function evaluateBuiltinCheck(identity, key) {
  switch (key) {
    case 'hasManager':
      return Boolean(
        identity?.managerId
        || String(identity?.manager || '').trim()
        || String(identity?.managerEmail || '').trim(),
      );
    case 'hasEmail':
      return Boolean(String(identity?.email || '').trim());
    case 'hasHrRecord':
      return Boolean(identity?.identityProfileId);
    default:
      return false;
  }
}

/** Match admin Global rule set: omit `enabled` ⇒ treat as on. */
export function isAttributeCheckEnabled(check) {
  return check != null && check.enabled !== false;
}

export function evaluateIdentityCheck(identity, check) {
  if (!isAttributeCheckEnabled(check)) return false;
  const ev = check.evaluator || {};
  if (ev.type === 'builtin') {
    return evaluateBuiltinCheck(identity, ev.key);
  }
  if (ev.type === 'fieldPresent') {
    if (isManagerPresenceCheck(check)) {
      return evaluateBuiltinCheck(identity, 'hasManager');
    }
    const paths = getResolvePathsForCheck(check);
    if (!paths.length && ev.logicalKey) {
      paths.push(identityTargetKeyToMongoPath(ev.logicalKey));
    }
    return isPresentValue(resolveFieldValueFromIdentity(identity, paths));
  }
  return false;
}

export function resolveIdentityDepartmentForDisplay(identity) {
  const val = resolveFieldValueFromIdentity(identity, suggestResolvePaths('department'));
  if (val == null) return '—';
  if (Array.isArray(val)) return val.filter(Boolean).join(', ') || '—';
  return String(val).trim() || '—';
}

// ── posturePrivilegeDetection ──

function isPrivilegedFlag(raw) {
  if (raw === true) return true;
  return PRIVILEGE_STRING_TOKENS.includes(String(raw ?? '').trim().toLowerCase());
}

function readRawData(doc) {
  return doc?.rawData && typeof doc.rawData === 'object' ? doc.rawData : {};
}

function entitlementNameMatchesPrivilegedTokens(doc, raw) {
  const labels = [
    doc.entitlement_name,
    doc.name,
    doc.displayName,
    raw.name,
    raw.displayName,
    raw.cn,
    raw.samAccountName,
    raw.sAMAccountName,
  ];
  for (const label of labels) {
    const n = String(label || '').trim().toLowerCase();
    if (!n) continue;
    if (PRIVILEGED_NAME_TOKENS.some((t) => n.includes(t))) return true;
  }
  return false;
}

function isPrivilegedEntitlementDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const raw = readRawData(doc);
  if ([doc.isPrivileged, doc.is_privilege, raw.is_privilege, raw.isPrivileged, raw.privileged].some(isPrivilegedFlag)) {
    return true;
  }
  if (String(doc.classification || raw.classification || '').trim().toLowerCase() === 'privileged') {
    return true;
  }
  // Name heuristics (Domain Admins, *admin*, etc.) — no tenant/lab DN hardcoding.
  return entitlementNameMatchesPrivilegedTokens(doc, raw);
}

function isPrivilegedUserDoc(doc) {
  if (!doc || typeof doc !== 'object') return false;
  const raw = readRawData(doc);
  if ([doc.isPrivileged, doc.is_privileged, raw.is_privileged, raw.isPrivileged].some(isPrivilegedFlag)) {
    return true;
  }
  const accountType = String(doc.accountType || raw.accountType || '').trim().toLowerCase();
  return accountType === 'privileged' || accountType === 'admin';
}

function entityMatchesDiscoveryPolicies(entity, policies) {
  if (!entity || !policies?.length) return false;
  const merged = mergeEntityForDiscoveryEval(entity);
  return policies.some(({ steps, stepLogic }) => evaluateEntity(merged, steps, stepLogic).passed);
}

function discoveryEntityKey(applicationId, entityType, entityId) {
  if (!entityId) return null;
  return `${String(applicationId)}:${entityType}:${String(entityId)}`;
}

function isPrivilegedUser(userDoc, userPolicies = []) {
  return isPrivilegedUserDoc(userDoc) || entityMatchesDiscoveryPolicies(userDoc, userPolicies);
}

export function isPrivilegedEntitlement(entity, entitlementPolicies = []) {
  return isPrivilegedEntitlementDoc(entity) || entityMatchesDiscoveryPolicies(entity, entitlementPolicies);
}

function isPrivilegedEntitlementLabel(label, entitlementPolicies = []) {
  const raw = String(label || '').trim();
  if (!raw) return false;
  return isPrivilegedEntitlement(
    { entitlement_name: raw, entitlement_id: raw, name: raw, displayName: raw },
    entitlementPolicies,
  );
}

function isEntitlementPrivileged(
  label,
  entitlementId,
  entitlementPolicies,
  discoveryEntityKeys,
  appKey,
) {
  if (isPrivilegedEntitlementLabel(label, entitlementPolicies)) return true;
  if (!entitlementId || !discoveryEntityKeys || !appKey) return false;
  const id = String(entitlementId);
  return (
    discoveryEntityKeys.has(discoveryEntityKey(appKey, 'ENTITLEMENT', id))
    || discoveryEntityKeys.has(discoveryEntityKey(appKey, 'AD_GROUP', id))
  );
}

async function loadDiscoveryPoliciesForApps(appIds, tenantId) {
  const byApp = new Map();
  const oidList = toObjectIds(appIds);
  if (!oidList.length) return byApp;

  const query = {
    applicationId: { $in: oidList },
    type: { $in: DISCOVERY_ENTITY_TYPES },
  };
  const tid = toTenantObjectId(tenantId);
  if (tid) query.tenantId = tid;

  const policies = await DiscoveryPolicy.find(query)
    .select('applicationId type steps stepLogic')
    .lean();

  for (const policy of policies) {
    const appKey = String(policy.applicationId);
    if (!byApp.has(appKey)) {
      byApp.set(appKey, { userPolicies: [], entitlementPolicies: [] });
    }
    const bucket = byApp.get(appKey);
    if (policy.type === 'USER') bucket.userPolicies.push(policy);
    else bucket.entitlementPolicies.push(policy);
  }
  return byApp;
}

async function loadDiscoveryPrivilegedEntityKeys(appIds) {
  const keys = new Set();
  const oidList = toObjectIds(appIds);
  if (!oidList.length) return keys;

  const results = await DiscoveryResult.find({
    applicationId: { $in: oidList },
    reviewStatus: { $in: ['confirmed', 'detected'] },
    entityType: { $in: DISCOVERY_ENTITY_TYPES },
  })
    .select('applicationId entityType entityId')
    .lean();

  for (const row of results) {
    const key = discoveryEntityKey(row.applicationId, row.entityType, row.entityId);
    if (key) keys.add(key);
  }
  return keys;
}

function entitlementNormKeys(doc) {
  const keys = ENTITLEMENT_NAME_KEYS.map((field) => doc[field]);
  if (doc._id != null) keys.push(String(doc._id));
  return keys.map(normalizeEntitlement).filter(Boolean);
}

async function loadPrivilegedCatalogNormSet(db, appDoc, entitlementPolicies = []) {
  const norms = new Set();
  if (!db || !appDoc?._id) return norms;

  const tenantSlug = await resolveTenantSlugFromTenantId(appDoc.tenantId);
  if (!tenantSlug) return norms;

  try {
    const entColl = db.collection(getAppEntitlementsCollectionName(appDoc.name, tenantSlug));
    const docs = await entColl.find({ applicationId: appDoc._id }).toArray();
    for (const doc of docs) {
      if (!isPrivilegedEntitlement(doc, entitlementPolicies)) continue;
      entitlementNormKeys(doc).forEach((norm) => norms.add(norm));
    }
  } catch {
    /* ignore catalog read errors */
  }
  return norms;
}

async function loadEntitlementPrivilegeById(db, appDoc, entitlementIds, entitlementPolicies = []) {
  const out = new Map();
  const oidList = toObjectIds(entitlementIds);
  if (!oidList.length || !db || !appDoc?._id) return out;

  const tenantSlug = await resolveTenantSlugFromTenantId(appDoc.tenantId);
  if (!tenantSlug) return out;

  try {
    const entColl = db.collection(getAppEntitlementsCollectionName(appDoc.name, tenantSlug));
    const docs = await entColl.find({ _id: { $in: oidList } }).toArray();
    for (const doc of docs) {
      out.set(String(doc._id), isPrivilegedEntitlement(doc, entitlementPolicies));
    }
  } catch {
    /* ignore catalog read errors */
  }
  return out;
}

async function overlayProjectionPrivilegeFlags(
  identityId,
  appDoc,
  accountId,
  privilegeById,
  entitlementIds,
) {
  const oidList = toObjectIds(entitlementIds);
  if (!oidList.length || !appDoc?._id || !accountId) return privilegeById;

  const tid = toTenantObjectId(appDoc.tenantId);
  const identityOid = mongoose.Types.ObjectId.isValid(String(identityId))
    ? new mongoose.Types.ObjectId(String(identityId))
    : null;
  if (!tid || !identityOid) return privilegeById;

  try {
    const ProjectionModel = await getIdentityEntitlementModelForTenantId(appDoc.tenantId);
    const rows = await ProjectionModel.find({
      tenantId: tid,
      identityId: identityOid,
      applicationId: appDoc._id,
      accountId: new mongoose.Types.ObjectId(String(accountId)),
      entitlementId: { $in: oidList },
    })
      .select('entitlementId entitlementSnapshot.isPrivileged')
      .lean();

    for (const row of rows) {
      if (row.entitlementSnapshot?.isPrivileged) {
        privilegeById.set(String(row.entitlementId), true);
      }
    }
  } catch {
    /* ignore projection read errors */
  }
  return privilegeById;
}

function applyPrivilegedEntitlementNorms(
  entitlementNorms,
  privilegedEntitlementNorms,
  catalogNorms,
  entitlementPolicies,
) {
  for (const norm of entitlementNorms) {
    if (
      catalogNorms.has(norm)
      || isPrivilegedEntitlementLabel(norm, entitlementPolicies)
    ) {
      privilegedEntitlementNorms.add(norm);
    }
  }
}

function createEmptyAppRow(appKey, applicationName, extras = {}) {
  return {
    applicationId: appKey,
    applicationName,
    applicationIcon: extras.icon || null,
    applicationColor: extras.color || null,
    accountKeys: new Set(),
    entitlementNorms: new Set(),
    privilegedAccountKeys: new Set(),
    privilegedEntitlementNorms: new Set(),
  };
}

// ── postureAccessInventory ──

function createEntitlementTracker(entitlementPolicies, discoveryEntityKeys, appKey) {
  const entitlementNorms = new Set();
  const privilegedEntitlementNorms = new Set();

  const track = (raw, entitlementId = null, privileged = false) => {
    const norm = normalizeEntitlement(raw);
    if (!norm) return;
    entitlementNorms.add(norm);
    const isPrivileged = privileged || isEntitlementPrivileged(
      raw,
      entitlementId,
      entitlementPolicies,
      discoveryEntityKeys,
      appKey,
    );
    if (isPrivileged) privilegedEntitlementNorms.add(norm);
  };

  return { entitlementNorms, privilegedEntitlementNorms, track };
}

async function trackCorrelatedEntitlements(entitlements, tracker, loadPrivilegeById) {
  if (!entitlements.length) return;

  const entitlementIds = entitlements.map((ent) => ent.entitlementId);
  const privilegeById = await loadPrivilegeById(entitlementIds);

  for (const ent of entitlements) {
    const entitlementId = String(ent.entitlementId);
    tracker.track(
      entitlementLabel(ent),
      entitlementId,
      privilegeById.get(entitlementId),
    );
  }
}

async function collectEntitlementsForLink(identityId, link, appDoc, db, appContext, userDoc = null) {
  const {
    entitlementPolicies,
    discoveryEntityKeys,
    appKey,
    userModel,
  } = appContext;
  const tracker = createEntitlementTracker(entitlementPolicies, discoveryEntityKeys, appKey);

  if (!userDoc && userModel) {
    try {
      userDoc = await resolveLiveApplicationUser(userModel, link, appDoc);
    } catch {
      userDoc = null;
    }
  }

  const userObjectId = userDoc?._id;

  try {
    if (db && appDoc._id && userObjectId) {
      const projected = await tryProjectedCorrelatedEntitlements(
        identityId,
        appDoc._id,
        userObjectId,
        appDoc.tenantId,
      );

      if (projected !== null) {
        await trackCorrelatedEntitlements(
          projected,
          tracker,
          async (entitlementIds) => overlayProjectionPrivilegeFlags(
            identityId,
            appDoc,
            userObjectId,
            await loadEntitlementPrivilegeById(db, appDoc, entitlementIds, entitlementPolicies),
            entitlementIds,
          ),
        );
        return {
          entitlementNorms: tracker.entitlementNorms,
          privilegedEntitlementNorms: tracker.privilegedEntitlementNorms,
          userDoc,
        };
      }

      const correlated = await fetchCorrelatedEntitlementsForAccount(
        db,
        appDoc.name,
        appDoc._id,
        userObjectId,
        appDoc.tenantId,
      );

      if (correlated.length > 0) {
        await trackCorrelatedEntitlements(
          correlated,
          tracker,
          (entitlementIds) => loadEntitlementPrivilegeById(db, appDoc, entitlementIds, entitlementPolicies),
        );
        return {
          entitlementNorms: tracker.entitlementNorms,
          privilegedEntitlementNorms: tracker.privilegedEntitlementNorms,
          userDoc,
        };
      }
    }
  } catch {
    /* fall through to raw scan */
  }

  if (userDoc) {
    for (const raw of extractGroupEntitlementsFromAccount(userDoc)) {
      tracker.track(raw);
    }
  }

  return {
    entitlementNorms: tracker.entitlementNorms,
    privilegedEntitlementNorms: tracker.privilegedEntitlementNorms,
    userDoc,
  };
}

async function buildAppContext(appDoc, discoveryPolicyByApp, discoveryEntityKeys) {
  const appKey = String(appDoc._id);
  const policies = discoveryPolicyByApp.get(appKey) || {
    userPolicies: [],
    entitlementPolicies: [],
  };

  const [userModel, catalogNorms] = await Promise.all([
    getDynamicUserModelForTenantId(appDoc.name, appDoc.tenantId).catch(() => null),
    loadPrivilegedCatalogNormSet(mongoose.connection.db, appDoc, policies.entitlementPolicies),
  ]);

  return {
    appKey,
    userModel,
    catalogNorms,
    userPolicies: policies.userPolicies,
    entitlementPolicies: policies.entitlementPolicies,
    discoveryEntityKeys,
  };
}

function finalizeAppRow(row) {
  return {
    applicationId: row.applicationId,
    applicationName: row.applicationName,
    applicationIcon: row.applicationIcon || null,
    applicationColor: row.applicationColor || null,
    accounts: row.accountKeys.size,
    entitlements: row.entitlementNorms.size,
    privilegedEntitlements: row.privilegedEntitlementNorms.size,
    privilegedCount: row.privilegedAccountKeys.size + row.privilegedEntitlementNorms.size,
    privilegedEntitlementNames: [...row.privilegedEntitlementNorms].sort((a, b) =>
      String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }),
    ),
  };
}

function emptyInventory() {
  return {
    byApplication: [],
    linkedAccounts: [],
    totals: {
      totalAccounts: 0,
      totalEntitlements: 0,
      privilegedEntitlementCount: 0,
      privilegedCount: 0,
    },
    globalGroupCount: 0,
  };
}

export async function loadAccessInventoryByApplication(identityId, tenantId) {
  const db = mongoose.connection.db;
  const identityOid = toObjectId(identityId);
  if (!identityOid) return emptyInventory();

  const links = await IdentityAccountLink.find({
    identityId: identityOid,
    isActive: { $ne: false },
  })
    .populate('applicationId', 'name tenantId lastManualCorrelation icon color')
    .lean();

  if (!links.length) return emptyInventory();

  const appIds = toObjectIds(
    links.map((link) => link.applicationId?._id).filter(Boolean),
  );

  const [discoveryPolicyByApp, discoveryEntityKeys] = await Promise.all([
    loadDiscoveryPoliciesForApps(appIds, tenantId),
    loadDiscoveryPrivilegedEntityKeys(appIds),
  ]);

  const linksByApp = groupBy(
    links,
    (link) => (link.applicationId?._id ? String(link.applicationId._id) : null),
  );

  const appMap = new Map();
  const globalGroupNorms = new Set();
  const globalPrivilegedEntitlementNorms = new Set();
  const linkedAccounts = [];

  await Promise.all(
    [...linksByApp.entries()].map(async ([appKey, appLinks]) => {
      const appDoc = appLinks[0]?.applicationId;
      if (!appDoc?._id || !appDoc?.name) return;

      const appContext = await buildAppContext(appDoc, discoveryPolicyByApp, discoveryEntityKeys);
      const row = appMap.get(appKey) || createEmptyAppRow(appKey, appDoc.name, {
        icon: appDoc.icon,
        color: appDoc.color,
      });
      appMap.set(appKey, row);

      for (const link of appLinks) {
        const {
          entitlementNorms,
          privilegedEntitlementNorms,
          userDoc,
        } = await collectEntitlementsForLink(identityId, link, appDoc, db, appContext);

        const corrAttr = resolveCorrelationAttribute(link, appDoc);
        const accountDisplayName = resolveAccountDisplayName(link, appDoc, userDoc);
        const mergeKey = accountMergeKey(appDoc, link, userDoc, accountDisplayName, corrAttr);
        row.accountKeys.add(mergeKey);

        const userDiscoveryKey = discoveryEntityKey(appKey, 'USER', userDoc?._id);
        const isPrivilegedAccount = isPrivilegedUser(userDoc, appContext.userPolicies)
          || (userDiscoveryKey && discoveryEntityKeys.has(userDiscoveryKey));
        if (isPrivilegedAccount) {
          row.privilegedAccountKeys.add(mergeKey);
        }

        const linkPrivilegedNorms = new Set(privilegedEntitlementNorms);
        applyPrivilegedEntitlementNorms(
          entitlementNorms,
          linkPrivilegedNorms,
          appContext.catalogNorms,
          appContext.entitlementPolicies,
        );

        linkedAccounts.push({
          accountName: accountDisplayName || mergeKey,
          applicationName: appDoc.name,
          applicationId: appKey,
          entitlements: entitlementNorms.size,
          privilegedEntitlements: linkPrivilegedNorms.size,
          privilegedNames: [...linkPrivilegedNorms].sort((a, b) =>
            String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }),
          ),
          isPrivileged: isPrivilegedAccount || linkPrivilegedNorms.size > 0,
          isPrivilegedAccount,
        });

        for (const norm of entitlementNorms) {
          row.entitlementNorms.add(norm);
          globalGroupNorms.add(norm);
        }
        for (const norm of privilegedEntitlementNorms) {
          row.privilegedEntitlementNorms.add(norm);
        }

        applyPrivilegedEntitlementNorms(
          entitlementNorms,
          row.privilegedEntitlementNorms,
          appContext.catalogNorms,
          appContext.entitlementPolicies,
        );
        for (const norm of row.privilegedEntitlementNorms) {
          globalPrivilegedEntitlementNorms.add(norm);
        }
      }
    }),
  );

  const byApplication = [...appMap.values()]
    .map(finalizeAppRow)
    .sort((a, b) => a.applicationName.localeCompare(b.applicationName));

  return {
    byApplication,
    linkedAccounts: linkedAccounts.sort((a, b) => {
      const appCmp = a.applicationName.localeCompare(b.applicationName, undefined, { sensitivity: 'base' });
      return appCmp !== 0 ? appCmp : a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' });
    }),
    totals: {
      totalAccounts: sumBy(byApplication, (row) => row.accounts),
      totalEntitlements: sumBy(byApplication, (row) => row.entitlements),
      privilegedEntitlementCount: globalPrivilegedEntitlementNorms.size,
      privilegedCount: sumBy(byApplication, (row) => row.privilegedCount),
    },
    globalGroupCount: globalGroupNorms.size,
  };
}

// ── postureSodAnalysis ──

function buildSodViolationMatchFilter(identityId, identity, tenantId) {
  const orClauses = [{ identity: toObjectId(identityId) }].filter(Boolean);
  const email = normalizeEmail(identity?.email);
  if (email) orClauses.push({ identityEmail: email });

  return {
    ...sodTenantFilter(tenantId),
    status: 'open',
    $or: orClauses,
  };
}

export async function loadTenantOpenSodViolations(tenantId) {
  return SodViolation.find({
    ...sodTenantFilter(tenantId),
    status: 'open',
  })
    .select('identity identityEmail')
    .lean();
}

export async function loadOpenSodViolations(identityId, identity, tenantId) {
  return SodViolation.find(buildSodViolationMatchFilter(identityId, identity, tenantId))
    .select('severity leftEntitlements rightEntitlements ruleName policyName identityEmail')
    .lean();
}

export function buildConflictStrings(violations) {
  const conflicts = violations.map((violation) => {
    const left = (violation.leftEntitlements || []).map((entry) => entry.name).filter(Boolean);
    const right = (violation.rightEntitlements || []).map((entry) => entry.name).filter(Boolean);
    if (left.length && right.length) {
      return `${left.join(', ')} + ${right.join(', ')}`;
    }
    return violation.ruleName || violation.policyName || null;
  }).filter(Boolean);
  return [...new Set(conflicts)];
}

export function highestSeverity(violations) {
  return violations.reduce((best, violation) => {
    const rank = SEVERITY_RANK[String(violation.severity || '').toUpperCase()] || 0;
    if (rank <= (SEVERITY_RANK[String(best || '').toUpperCase()] || 0)) return best;
    return violation.severity;
  }, null);
}

function batchSodViolationCounts(tenantId, identities, preloadedViolations = null) {
  const identityRows = (identities || []).filter((row) => row?._id);
  if (!identityRows.length) return new Map();

  const idSet = new Set(identityRows.map((row) => String(row._id)));
  const emailToId = new Map();
  for (const row of identityRows) {
    const email = normalizeEmail(row.email);
    if (email) emailToId.set(email, String(row._id));
  }

  const violations = preloadedViolations || [];

  const counts = new Map();
  for (const violation of violations) {
    const targetId = violation.identity
      ? String(violation.identity)
      : emailToId.get(normalizeEmail(violation.identityEmail));
    if (!targetId || !idSet.has(targetId)) continue;
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return counts;
}

// ── posturePeerComparisonConfig ──

export function resolvePeerComparisonConfig(rules) {
  const defaults = DEFAULT_IDENTITY_POSTURE_RULES.peerComparison;
  const cfg = rules?.peerComparison || {};
  return {
    enabled: cfg.enabled !== false,
    matchField: 'jobTitle',
    aboveAveragePoints: clamp(cfg.aboveAveragePoints ?? defaults.aboveAveragePoints, 1, 50),
    belowAveragePoints: clamp(cfg.belowAveragePoints ?? defaults.belowAveragePoints, 1, 50),
    maxPeers: clamp(cfg.maxPeers ?? defaults.maxPeers, 1, 200),
    showEntitlements: cfg.showEntitlements !== false,
  };
}

export function peerComparisonIndicator(userScore, peerAvg, config) {
  const cfg = config || resolvePeerComparisonConfig(null);
  const diff = userScore - peerAvg;
  if (diff > cfg.aboveAveragePoints) return 'ABOVE_AVERAGE';
  if (diff < -cfg.belowAveragePoints) return 'BELOW_AVERAGE';
  return 'AVERAGE';
}

// ── postureScoring ──

function resolveRules(rules) {
  return rules && typeof rules === 'object' ? rules : cloneDefaultRules();
}

function labelFromBands(score, bands, fallback = '—') {
  const sorted = [...(bands || [])].sort((a, b) => (b.minScore ?? 0) - (a.minScore ?? 0));
  for (const band of sorted) {
    if (score >= (band.minScore ?? 0)) return band.label || fallback;
  }
  return fallback;
}

function labelFromScoreLevels(score, scoreLevels, defaults) {
  const list = scoreLevels?.length ? scoreLevels : defaults;
  const byKey = (key) => list.find((l) => l.key === key);
  const poor = byKey('poor')?.upTo ?? 40;
  const moderate = byKey('moderate')?.upTo ?? 60;
  const good = byKey('good')?.upTo ?? 80;
  const s = clamp(score, 0, 100);
  if (s <= poor) return 'Poor';
  if (s <= moderate) return 'Moderate';
  if (s <= good) return 'Good';
  return 'Excellent';
}

function titleCaseLabel(raw) {
  return String(raw || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'id' || lower === 'hr' || lower === 'sod') return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function getCheckDisplayLabel(check) {
  const label = String(check?.label || '').trim();
  if (label) {
    const trimmed = label.replace(/\s+present\s*$/i, '').trim();
    return titleCaseLabel(trimmed || label);
  }
  return titleCaseLabel(check?.id || 'Attribute');
}

export function computeIdentityHygiene(identity, rules) {
  const r = resolveRules(rules);
  const cfg = r.identityHygiene || DEFAULT_IDENTITY_POSTURE_RULES.identityHygiene;
  const checks = cfg.checks || [];
  const enabledCount = checks.filter((c) => isAttributeCheckEnabled(c)).length;
  const pointsPerCheck = enabledCount > 0 ? 100 / enabledCount : 0;
  const attributeChecks = [];
  let score = 0;

  for (const check of checks) {
    const enabled = isAttributeCheckEnabled(check);
    const passed = enabled ? evaluateIdentityCheck(identity, check) : false;
    attributeChecks.push({
      id: check.id,
      label: getCheckDisplayLabel(check),
      ok: passed,
      enabled,
    });
    if (enabled && passed) {
      score += pointsPerCheck;
    }
  }

  // No attributes configured / all toggled off → do not penalize posture as Poor/0%.
  if (enabledCount === 0) {
    return { score: 100, attributeChecks };
  }

  return { score: clamp(score, 0, 100), attributeChecks };
}

function accessTiersFromLevels(levels) {
  const list = levels || DEFAULT_IDENTITY_POSTURE_RULES.accessHygiene.levels;
  const byKey = (key) => list.find((l) => l.key === key);
  const legacy = ['band1', 'band2', 'band3', 'band4'];
  const safe = byKey('safe') || byKey(legacy[0]);
  const low = byKey('low') || byKey(legacy[1]);
  const medium = byKey('medium') || byKey(legacy[2]);
  const high = byKey('high') || byKey(legacy[3]);
  const tiers = [{ maxPrivilegedEntitlements: safe?.upTo ?? 0, score: safe?.score ?? 100 }];
  if ((low?.upTo ?? 0) > (safe?.upTo ?? 0)) {
    tiers.push({ maxPrivilegedEntitlements: low.upTo, score: low.score ?? 0 });
  }
  if ((medium?.upTo ?? 0) > (low?.upTo ?? 0)) {
    tiers.push({ maxPrivilegedEntitlements: medium.upTo, score: medium.score ?? 0 });
  }
  tiers.push({ maxPrivilegedEntitlements: high?.upTo ?? 100, score: high?.score ?? 0 });
  return tiers;
}

function accessTiersFromConfig(cfg) {
  if (Array.isArray(cfg?.levels) && cfg.levels.length > 0) {
    return accessTiersFromLevels(cfg.levels);
  }
  if (Array.isArray(cfg?.tiers) && cfg.tiers.length) {
    return [...cfg.tiers].sort(
      (a, b) => (a.maxPrivilegedEntitlements ?? 0) - (b.maxPrivilegedEntitlements ?? 0),
    );
  }
  return accessTiersFromLevels(cfg?.levels);
}

const ACCESS_TIER_LABELS = {
  safe: 'Safe',
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

/** Map privileged entitlement count to configured Safe / Low / Medium / High band. */
export function getAccessHygieneTier(privilegedEntitlementCount, rules) {
  const { key, label } = resolveAccessHygieneTierLabel(privilegedEntitlementCount, rules);
  return {
    key,
    label,
    score: computeAccessHygiene(privilegedEntitlementCount, rules),
  };
}

export function resolveAccessHygieneTierLabel(privilegedEntitlementCount, rules) {
  const r = resolveRules(rules);
  const cfg = r.accessHygiene || DEFAULT_IDENTITY_POSTURE_RULES.accessHygiene;
  const levels = cfg.levels || DEFAULT_IDENTITY_POSTURE_RULES.accessHygiene.levels;
  const byKey = (key) => levels.find((l) => l.key === key);
  const legacy = ['band1', 'band2', 'band3', 'band4'];
  const safeUp = byKey('safe')?.upTo ?? byKey(legacy[0])?.upTo ?? 0;
  const lowUp = byKey('low')?.upTo ?? byKey(legacy[1])?.upTo ?? 2;
  const mediumUp = byKey('medium')?.upTo ?? byKey(legacy[2])?.upTo ?? 5;
  const count = Math.max(0, privilegedEntitlementCount || 0);
  let key = 'high';
  if (count <= safeUp) key = 'safe';
  else if (count <= lowUp) key = 'low';
  else if (count <= mediumUp) key = 'medium';
  return {
    key,
    label: ACCESS_TIER_LABELS[key] || 'High',
  };
}

export function computeAccessHygiene(privilegedEntitlementCount, rules) {
  const r = resolveRules(rules);
  const cfg = r.accessHygiene || DEFAULT_IDENTITY_POSTURE_RULES.accessHygiene;
  const count = Math.max(0, privilegedEntitlementCount || 0);
  const tiers = accessTiersFromConfig(cfg);
  let matched = tiers[tiers.length - 1]?.score ?? 0;
  for (const tier of tiers) {
    if (count <= (tier.maxPrivilegedEntitlements ?? 0)) {
      matched = tier.score ?? matched;
      break;
    }
  }
  return clamp(matched, 0, 100);
}

function complexityTiersFromLevels(levels) {
  const list = levels || DEFAULT_IDENTITY_POSTURE_RULES.complexity.levels;
  const byKey = (key) => list.find((l) => l.key === key);
  const excellent = byKey('excellent');
  const good = byKey('good');
  const moderate = byKey('moderate');
  const poor = byKey('poor');
  const tiers = [{ maxGroups: excellent?.upTo ?? 0, score: excellent?.score ?? 100 }];
  if ((good?.upTo ?? 0) > (excellent?.upTo ?? 0)) {
    tiers.push({ maxGroups: good.upTo, score: good.score ?? 0 });
  }
  if ((moderate?.upTo ?? 0) > (good?.upTo ?? 0)) {
    tiers.push({ maxGroups: moderate.upTo, score: moderate.score ?? 0 });
  }
  tiers.push({ maxGroups: 999, score: poor?.score ?? 0 });
  return tiers;
}

function complexityTiersFromConfig(cfg) {
  if (Array.isArray(cfg?.levels) && cfg.levels.length > 0) {
    return complexityTiersFromLevels(cfg.levels);
  }
  if (Array.isArray(cfg?.tiers) && cfg.tiers.length && cfg.tiers[0].maxGroups != null) {
    return [...cfg.tiers].sort((a, b) => (a.maxGroups ?? 0) - (b.maxGroups ?? 0));
  }
  if (Array.isArray(cfg?.tiers) && cfg.tiers.length && cfg.tiers[0].minGroups != null) {
    const sorted = [...cfg.tiers].sort((a, b) => a.minGroups - b.minGroups);
    const finite = sorted.filter((t) => (t.minGroups ?? 0) < 999);
    return [
      { maxGroups: finite[0]?.minGroups ?? 0, score: finite[0]?.score ?? 100 },
      ...(finite[1] ? [{ maxGroups: finite[1].minGroups - 1, score: finite[1].score }] : []),
      ...(finite[2] ? [{ maxGroups: finite[2].minGroups - 1, score: finite[2].score }] : []),
      { maxGroups: 999, score: sorted[sorted.length - 1]?.score ?? 0 },
    ].filter((t, i, arr) => i === 0 || t.maxGroups > arr[i - 1].maxGroups);
  }
  return complexityTiersFromLevels(cfg?.levels);
}

function complexityScoreFromThresholds(count, cfg) {
  const thresholds = [...(cfg?.thresholds || [])].sort(
    (a, b) => (b.minGroups ?? 0) - (a.minGroups ?? 0),
  );
  for (const tier of thresholds) {
    if (count >= (tier.minGroups ?? 0)) {
      return clamp(tier.score ?? 0, 0, 100);
    }
  }
  return clamp(cfg?.defaultScore ?? 100, 0, 100);
}

export function computeComplexity(groupCount, rules) {
  const r = resolveRules(rules);
  const cfg = r.complexity || DEFAULT_IDENTITY_POSTURE_RULES.complexity;
  const count = Math.max(0, groupCount || 0);
  // Prefer levels/tiers (Global rule set Complexity editor) over legacy thresholds.
  const hasLevels = Array.isArray(cfg.levels) && cfg.levels.length > 0;
  const hasMaxGroupTiers =
    Array.isArray(cfg.tiers) && cfg.tiers.length > 0 && cfg.tiers[0]?.maxGroups != null;
  if (hasLevels || hasMaxGroupTiers) {
    const tiers = complexityTiersFromConfig(cfg);
    let matched = tiers[tiers.length - 1]?.score ?? 0;
    for (const tier of tiers) {
      if (count <= (tier.maxGroups ?? 0)) {
        matched = tier.score ?? matched;
        break;
      }
    }
    return clamp(matched, 0, 100);
  }
  if (Array.isArray(cfg.thresholds) && cfg.thresholds.length > 0) {
    return complexityScoreFromThresholds(count, cfg);
  }
  const tiers = complexityTiersFromConfig(cfg);
  let matched = tiers[tiers.length - 1]?.score ?? 0;
  for (const tier of tiers) {
    if (count <= (tier.maxGroups ?? 0)) {
      matched = tier.score ?? matched;
      break;
    }
  }
  return clamp(matched, 0, 100);
}

function sodTiersFromLevels(levels) {
  const list = levels || DEFAULT_IDENTITY_POSTURE_RULES.sodRisk.levels;
  const byKey = (key) => list.find((l) => l.key === key);
  const safe = byKey('safe');
  const low = byKey('low');
  const medium = byKey('medium');
  const high = byKey('high');
  const tiers = [{ maxViolations: safe?.upTo ?? 0, score: safe?.score ?? 100 }];
  if ((low?.upTo ?? 0) > (safe?.upTo ?? 0)) {
    tiers.push({ maxViolations: low.upTo, score: low.score ?? 0 });
  }
  if ((medium?.upTo ?? 0) > (low?.upTo ?? 0)) {
    tiers.push({ maxViolations: medium.upTo, score: medium.score ?? 0 });
  }
  tiers.push({ maxViolations: 999, score: high?.score ?? 0 });
  return tiers;
}

function sodTiersFromConfig(cfg) {
  if (Array.isArray(cfg?.levels) && cfg.levels.length > 0) {
    return sodTiersFromLevels(cfg.levels);
  }
  if (Array.isArray(cfg?.tiers) && cfg.tiers.length) {
    return [...cfg.tiers].sort((a, b) => (a.maxViolations ?? 0) - (b.maxViolations ?? 0));
  }
  return sodTiersFromLevels(cfg?.levels);
}

const SOD_TIER_LABELS = {
  safe: 'Safe',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/** Map open violation count to configured Safe / Low / Medium / High band. */
export function getSodViolationTier(violationCount, rules) {
  const { key, label } = resolveSodViolationTierLabel(violationCount, rules);
  return {
    key,
    label,
    score: computeSodRisk(violationCount, rules),
  };
}

export function resolveSodViolationTierLabel(violationCount, rules) {
  const r = resolveRules(rules);
  const cfg = r.sodRisk || DEFAULT_IDENTITY_POSTURE_RULES.sodRisk;
  const levels = cfg.levels || DEFAULT_IDENTITY_POSTURE_RULES.sodRisk.levels;
  const byKey = (key) => levels.find((l) => l.key === key);
  const safeUp = byKey('safe')?.upTo ?? 0;
  const lowUp = byKey('low')?.upTo ?? 1;
  const mediumUp = byKey('medium')?.upTo ?? 3;
  const count = Math.max(0, violationCount || 0);
  let key = 'high';
  if (count <= safeUp) key = 'safe';
  else if (count <= lowUp) key = 'low';
  else if (count <= mediumUp) key = 'medium';
  return {
    key,
    label: SOD_TIER_LABELS[key] || 'High',
  };
}

export function computeSodRisk(violationCount, rules) {
  const r = resolveRules(rules);
  const cfg = r.sodRisk || DEFAULT_IDENTITY_POSTURE_RULES.sodRisk;
  const count = Math.max(0, violationCount || 0);
  const tiers = sodTiersFromConfig(cfg);
  let matched = tiers[tiers.length - 1]?.score ?? 0;
  for (const tier of tiers) {
    if (count <= (tier.maxViolations ?? 0)) {
      matched = tier.score ?? matched;
      break;
    }
  }
  return clamp(matched, 0, 100);
}

function computeFinalPosture(identityHygiene, accessHygiene, sodRisk, complexity, rules) {
  const r = resolveRules(rules);
  const w = r.finalPosture?.weights || DEFAULT_IDENTITY_POSTURE_RULES.finalPosture.weights;
  const sumW = (w.identityHygiene ?? 0.25)
    + (w.accessHygiene ?? 0.25)
    + (w.sodRisk ?? 0.25)
    + (w.complexity ?? 0.25);
  const denom = sumW > 0 ? sumW : 1;
  return (
    (identityHygiene * (w.identityHygiene ?? 0.25)
      + accessHygiene * (w.accessHygiene ?? 0.25)
      + sodRisk * (w.sodRisk ?? 0.25)
      + complexity * (w.complexity ?? 0.25))
    / denom
  );
}

function getMaturityLevel(score, rules) {
  const r = resolveRules(rules);
  const bands = r.labels?.maturity || DEFAULT_IDENTITY_POSTURE_RULES.labels.maturity;
  return labelFromBands(score, bands, 'POOR');
}

export function getMetricLabel(metricKey, score, rules) {
  const r = resolveRules(rules);
  if (metricKey === 'sodRisk') {
    return labelFromBands(
      score,
      r.labels?.sodRisk || DEFAULT_IDENTITY_POSTURE_RULES.labels.sodRisk,
      'Critical',
    );
  }
  if (metricKey === 'complexity') {
    const cfg = r.complexity || DEFAULT_IDENTITY_POSTURE_RULES.complexity;
    return labelFromScoreLevels(
      score,
      cfg.scoreLevels,
      DEFAULT_IDENTITY_POSTURE_RULES.complexity.scoreLevels,
    );
  }
  if (metricKey === 'finalPosture') {
    return getMaturityLevel(score, rules);
  }
  if (metricKey === 'identityHygiene') {
    const cfg = r.identityHygiene || DEFAULT_IDENTITY_POSTURE_RULES.identityHygiene;
    return labelFromScoreLevels(
      score,
      cfg.scoreLevels,
      DEFAULT_IDENTITY_POSTURE_RULES.identityHygiene.scoreLevels,
    );
  }
  if (metricKey === 'accessHygiene') {
    return labelFromBands(
      score,
      r.labels?.generic || DEFAULT_IDENTITY_POSTURE_RULES.labels.generic,
      'Moderate',
    );
  }
  return labelFromBands(
    score,
    r.labels?.generic || DEFAULT_IDENTITY_POSTURE_RULES.labels.generic,
    'Low',
  );
}

export function computePostureFromInputs(
  identity,
  accountCount,
  groupCount,
  sodViolationCount,
  privilegedEntitlementCount = 0,
  rules = null,
) {
  const { score: identityHygiene, attributeChecks } = computeIdentityHygiene(identity, rules);
  const accessHygiene = computeAccessHygiene(privilegedEntitlementCount, rules);
  const complexity = computeComplexity(groupCount, rules);
  const sodRisk = computeSodRisk(sodViolationCount, rules);
  const finalPosture = computeFinalPosture(identityHygiene, accessHygiene, sodRisk, complexity, rules);

  return {
    identityHygiene,
    accessHygiene,
    complexity,
    sodRisk,
    finalPosture,
    maturityLevel: getMaturityLevel(finalPosture, rules),
    attributeChecks,
    accountCount,
    groupCount,
    privilegedEntitlementCount,
    privilegedCount: privilegedEntitlementCount,
    sodViolationCount,
  };
}

/** Lightweight final score for peer/ranking scans (no attributeChecks payload). */
function computeFinalPostureFromStats(identity, accountCount, groupCount, sodCount, privilegedCount, rules) {
  const { score: identityHygiene } = computeIdentityHygiene(identity, rules);
  const accessHygiene = computeAccessHygiene(privilegedCount, rules);
  const complexity = computeComplexity(groupCount, rules);
  const sodRisk = computeSodRisk(sodCount, rules);
  return computeFinalPosture(identityHygiene, accessHygiene, sodRisk, complexity, rules);
}

// ── posturePeerRanking ──

function buildPeerComparisonSummary({
  peerCount,
  userPostureScore,
  peerAvgPostureScore,
  userEntitlements,
  peerAvgEntitlements,
  indicator,
  showEntitlements = true,
}) {
  if (!peerCount) {
    return 'No other active users share this job title, so there is nothing to compare against.';
  }

  const postureDelta = userPostureScore - peerAvgPostureScore;
  const entitlementDelta = userEntitlements - peerAvgEntitlements;

  let postureLine;
  if (indicator === 'ABOVE_AVERAGE') {
    postureLine = `Overall posture is better than most peers with the same title (${postureDelta} points higher on average).`;
  } else if (indicator === 'BELOW_AVERAGE') {
    postureLine = `Overall posture is lower than most peers with the same title (${Math.abs(postureDelta)} points below average).`;
  } else {
    postureLine = `Overall posture is about the same as peers with the same title (within ${Math.abs(postureDelta)} points of the average).`;
  }

  let entitlementLine = '';
  if (showEntitlements) {
    if (entitlementDelta === 0) {
      entitlementLine = 'Unique entitlement count matches the peer average.';
    } else if (entitlementDelta < 0) {
      entitlementLine = `This user has ${Math.abs(entitlementDelta)} fewer unique entitlements than the peer average (often lower access exposure).`;
    } else {
      entitlementLine = `This user has ${entitlementDelta} more unique entitlements than the peer average.`;
    }
  }

  return entitlementLine ? `${postureLine} ${entitlementLine}` : postureLine;
}

function rankingIndicator(percentile) {
  if (percentile >= 75) return 'ABOVE_AVERAGE';
  if (percentile >= 25) return 'AVERAGE';
  return 'BELOW_AVERAGE';
}

function buildTitleRegex(normalizedTitle) {
  return new RegExp(`^\\s*${escapeRegex(normalizedTitle)}\\s*$`, 'i');
}

function scoreIdentityFromStats(identity, sodCounts, rules) {
  const accountCount = identity.totalAccounts ?? 0;
  const groupCount = identity.totalEntitlements ?? 0;
  const sodCount = sodCounts.get(String(identity._id)) || 0;
  const privilegedEntitlementCount = identity.totalPrivilegedEntitlements ?? 0;
  return computeFinalPostureFromStats(
    identity,
    accountCount,
    groupCount,
    sodCount,
    privilegedEntitlementCount,
    rules,
  );
}

export async function computePeerComparison(
  targetId,
  identity,
  targetPosture,
  tenantId,
  IdentityModel,
  rules = null,
  tenantSodViolations = null,
) {
  const pcConfig = resolvePeerComparisonConfig(rules);
  const title = resolveIdentityTitle(identity);
  const normalizedTitle = normalizeTitle(title);

  if (!pcConfig.enabled) {
    return {
      enabled: false,
      jobTitle: title || '—',
      peerCount: 0,
      userPostureScore: Math.round(targetPosture.finalPosture),
      peerAvgPostureScore: 0,
      userEntitlements: targetPosture.groupCount,
      peerAvgEntitlements: 0,
      postureDelta: 0,
      entitlementDelta: 0,
      indicator: 'AVERAGE',
      summary: 'Peer comparison is turned off in your organization rule set.',
    };
  }

  if (!normalizedTitle) {
    return {
      enabled: true,
      jobTitle: title || '—',
      peerCount: 0,
      userPostureScore: Math.round(targetPosture.finalPosture),
      peerAvgPostureScore: 0,
      userEntitlements: targetPosture.groupCount,
      peerAvgEntitlements: 0,
      postureDelta: 0,
      entitlementDelta: 0,
      indicator: 'AVERAGE',
      summary: buildPeerComparisonSummary({
        peerCount: 0,
        userPostureScore: Math.round(targetPosture.finalPosture),
        peerAvgPostureScore: 0,
        userEntitlements: targetPosture.groupCount,
        peerAvgEntitlements: 0,
        indicator: 'AVERAGE',
        showEntitlements: pcConfig.showEntitlements,
      }),
    };
  }

  const titleRegex = buildTitleRegex(normalizedTitle);
  const peers = await IdentityModel.find({
    tenantId,
    isActive: { $ne: false },
    lifecycleState: { $nin: ['TERMINATED', 'INACTIVE'] },
    _id: { $ne: toObjectId(targetId) },
    $or: [
      { title: titleRegex },
      { jobTitle: titleRegex },
      { job_title: titleRegex },
      { position: titleRegex },
      { designation: titleRegex },
      { role: titleRegex },
      { 'attributes.title': titleRegex },
      { 'attributes.jobTitle': titleRegex },
      { 'attributes.job_title': titleRegex },
      { 'attributes.position': titleRegex },
      { 'attributes.designation': titleRegex },
      { 'attributes.role': titleRegex },
      { 'attributes.Role': titleRegex },
      { 'attributes.Job Title': titleRegex },
    ],
  })
    .select('_id email totalAccounts totalEntitlements totalPrivilegedEntitlements managerId manager managerEmail identityProfileId title department firstName lastName displayName attributes')
    .limit(pcConfig.maxPeers)
    .lean();

  const sodCounts = batchSodViolationCounts(tenantId, peers, tenantSodViolations);
  const peerScores = peers.map((peer) => scoreIdentityFromStats(peer, sodCounts, rules));
  const peerEntitlements = peers.map((peer) => peer.totalEntitlements ?? 0);

  const peerAvgPosture = peerScores.length
    ? peerScores.reduce((sum, score) => sum + score, 0) / peerScores.length
    : 0;
  const peerAvgEntitlementsRaw = peerEntitlements.length
    ? peerEntitlements.reduce((sum, count) => sum + count, 0) / peerEntitlements.length
    : 0;

  const userPostureScore = Math.round(targetPosture.finalPosture);
  const peerAvgPostureScore = Math.round(peerAvgPosture);
  const userEntitlements = targetPosture.groupCount;
  const peerAvgEntitlements = Math.round(peerAvgEntitlementsRaw);
  const indicator = peerComparisonIndicator(targetPosture.finalPosture, peerAvgPosture, pcConfig);

  return {
    enabled: true,
    jobTitle: title || '—',
    peerCount: peers.length,
    userPostureScore,
    peerAvgPostureScore,
    userEntitlements,
    peerAvgEntitlements,
    postureDelta: userPostureScore - peerAvgPostureScore,
    entitlementDelta: userEntitlements - peerAvgEntitlements,
    indicator,
    showEntitlements: pcConfig.showEntitlements,
    summary: buildPeerComparisonSummary({
      peerCount: peers.length,
      userPostureScore,
      peerAvgPostureScore,
      userEntitlements,
      peerAvgEntitlements,
      indicator,
      showEntitlements: pcConfig.showEntitlements,
    }),
  };
}

export async function computeOverallRanking(
  targetId,
  targetScore,
  tenantId,
  IdentityModel,
  rules = null,
  tenantSodViolations = null,
) {
  const allActive = await IdentityModel.find({
    tenantId,
    isActive: { $ne: false },
    lifecycleState: { $nin: ['TERMINATED', 'INACTIVE'] },
  })
    .select('_id email totalAccounts totalEntitlements totalPrivilegedEntitlements managerId manager managerEmail identityProfileId')
    .limit(MAX_RANKING_SCAN)
    .lean();

  const capped = allActive.length >= MAX_RANKING_SCAN;
  const sodCounts = batchSodViolationCounts(tenantId, allActive, tenantSodViolations);

  const scores = allActive.map((identity) => ({
    id: String(identity._id),
    score: scoreIdentityFromStats(identity, sodCounts, rules),
  }));

  scores.sort((a, b) => a.score - b.score);
  const total = scores.length;
  if (!total) {
    return { percentile: 0, totalUsers: 0, indicator: 'AVERAGE', capped };
  }

  const rank = scores.filter((entry) => entry.score <= targetScore).length;
  return {
    percentile: Math.round((rank / total) * 100),
    totalUsers: total,
    indicator: rankingIndicator(Math.round((rank / total) * 100)),
    capped,
  };
}
