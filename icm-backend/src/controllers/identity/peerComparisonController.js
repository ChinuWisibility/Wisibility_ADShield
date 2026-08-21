import mongoose from 'mongoose';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { fetchCorrelatedEntitlementsForAccount, resolveLiveApplicationUser } from '../correlation/identityAccountLinkController.js';
import { getAppEntitlementsCollectionName, resolveTenantSlugFromTenantId } from '../../utils/applicationDynamicCollections.js';
import { fetchCorrelatedEntitlementsWithProjectionFallback } from '../../utils/identityEntitlementProjectionRead.js';

/* ─── Constants ─────────────────────────────────────────────────────────── */

/** Max peers scanned to prevent timeout on large departments. */
const MAX_PEERS = 50;

/**
 * Raw entitlement field keys — used ONLY as fallback when no correlation
 * engine has been run for an account. Mirrors IdentityDetail.jsx + identityAccountLinkController.js.
 */
const RAW_ENTITLEMENT_KEYS = [
  'member_of_entitlements',
  'sap_roles',
  'groups',
  'roles',
  'entitlements',
  'profiles',
  'permissions',
  'data_access',
  'responsibilities',
];

const RAW_DEPARTMENT_KEYS = [
  'department',
  'dept',
  'division',
  'org',
  'unit',
  'business_unit',
  'businessUnit',
  'operating_unit',
  'costCenter',
  'cost_center',
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

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/**
 * Normalize an entitlement value: lowercase, collapse underscores/hyphens → spaces.
 * Prevents semantic duplicates like "DB_Write" vs "db write" vs "DB Write".
 */
function normalizeEntitlement(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstFilled(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeLooseKey(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findLooseValueDeep(source, aliases, maxDepth = 3) {
  if (!source || typeof source !== 'object') return '';
  const aliasSet = new Set((aliases || []).map((alias) => normalizeLooseKey(alias)).filter(Boolean));
  const visited = new Set();

  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > maxDepth || visited.has(node)) return '';
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return '';
    }

    for (const [key, value] of Object.entries(node)) {
      if (!aliasSet.has(normalizeLooseKey(key))) continue;
      const trimmed = firstFilled(value);
      if (trimmed) return trimmed;
    }

    for (const value of Object.values(node)) {
      const found = walk(value, depth + 1);
      if (found) return found;
    }

    return '';
  };

  return walk(source, 0);
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildExactTextRegex(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? new RegExp(`^\\s*${escapeRegex(trimmed)}\\s*$`, 'i') : null;
}

function buildOrTextMatch(paths, value) {
  const rx = buildExactTextRegex(value);
  const usablePaths = (paths || []).filter((path) => String(path || '').trim());
  if (!rx || usablePaths.length === 0) return null;
  return { $or: usablePaths.map((path) => ({ [path]: rx })) };
}

function addUniqueText(set, value) {
  const trimmed = String(value || '').trim();
  if (trimmed) set.add(trimmed);
}

function collectMappedAccountKeys(application, standardFields = [], fallbackAliases = []) {
  const keys = new Set();
  standardFields.forEach((field) => addUniqueText(keys, field));
  fallbackAliases.forEach((field) => addUniqueText(keys, field));

  const wanted = new Set(
    (standardFields || []).map((field) => normalizeLooseKey(field)).filter(Boolean),
  );
  const mappings = [
    ...(Array.isArray(application?.csvImportMapping?.mappings)
      ? application.csvImportMapping.mappings
      : []),
    ...(Array.isArray(application?.userMappings) ? application.userMappings : []),
  ];

  for (const mapping of mappings) {
    const standardField = String(mapping?.standardField || '').trim();
    if (!wanted.has(normalizeLooseKey(standardField))) continue;
    addUniqueText(keys, standardField);
    addUniqueText(keys, mapping?.csvColumn);
  }

  return [...keys];
}

function resolveMappedAccountValue(
  accountData,
  application,
  standardFields = [],
  fallbackAliases = [],
) {
  const candidateKeys = collectMappedAccountKeys(application, standardFields, fallbackAliases);

  for (const key of candidateKeys) {
    const direct = firstFilled(accountData?.[key]);
    if (direct) return direct;
  }

  for (const key of candidateKeys) {
    const fromRaw = firstFilled(accountData?.rawData?.[key]);
    if (fromRaw) return fromRaw;
  }

  return findLooseValueDeep(accountData?.rawData, candidateKeys, 3);
}

function buildMappedAccountPaths(application, standardFields = [], fallbackAliases = []) {
  const candidateKeys = collectMappedAccountKeys(application, standardFields, fallbackAliases);
  const paths = [];
  const seen = new Set();

  for (const key of candidateKeys) {
    const trimmed = String(key || '').trim();
    if (!trimmed || trimmed.includes('.')) continue;

    for (const path of [trimmed, `rawData.${trimmed}`]) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }

  return paths;
}

function resolveIdentityDepartment(identity) {
  return firstFilled(
    identity?.department,
    identity?.attributes?.department,
    identity?.attributes?.Department,
    findLooseValueDeep(identity?.attributes, RAW_DEPARTMENT_KEYS),
  );
}

function resolveIdentityTitle(identity) {
  return firstFilled(
    identity?.title,
    identity?.attributes?.title,
    identity?.attributes?.Title,
    identity?.attributes?.jobTitle,
    identity?.attributes?.job_title,
    findLooseValueDeep(identity?.attributes, RAW_TITLE_KEYS),
  );
}

function resolveAccountDepartment(accountData, application = null) {
  return firstFilled(
    resolveMappedAccountValue(accountData, application, ['department'], RAW_DEPARTMENT_KEYS),
    accountData?.department,
    accountData?.rawData?.department,
    accountData?.rawData?.Department,
    findLooseValueDeep(accountData?.rawData, RAW_DEPARTMENT_KEYS),
  );
}

function resolveAccountTitle(accountData, application = null) {
  return firstFilled(
    resolveMappedAccountValue(accountData, application, ['title', 'job_title'], RAW_TITLE_KEYS),
    accountData?.title,
    accountData?.job_title,
    accountData?.rawData?.title,
    accountData?.rawData?.Title,
    accountData?.rawData?.job_title,
    accountData?.rawData?.jobTitle,
    findLooseValueDeep(accountData?.rawData, RAW_TITLE_KEYS),
  );
}

async function loadAccountContextsForIdentity(identityId, appIdFilter = []) {
  if (!mongoose.Types.ObjectId.isValid(String(identityId))) return [];

  const linkQuery = {
    identityId: new mongoose.Types.ObjectId(String(identityId)),
    isActive: true,
  };
  if (appIdFilter.length > 0) {
    linkQuery.applicationId = {
      $in: appIdFilter
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  const links = await IdentityAccountLink.find(linkQuery)
    .populate('applicationId', 'name tenantId userMappings csvImportMapping')
    .lean();

  const contexts = await Promise.all(
    links.map(async (link) => {
      const appDoc = link.applicationId && typeof link.applicationId === 'object'
        ? link.applicationId
        : null;
      if (!appDoc?.name) return null;

      try {
        const DynModel = await getDynamicUserModelForTenantId(appDoc.name, appDoc.tenantId);
        const userDoc = await resolveLiveApplicationUser(DynModel, link, appDoc);
        return {
          link,
          appDoc,
          userDoc,
          department: resolveAccountDepartment(userDoc, appDoc),
          title: resolveAccountTitle(userDoc, appDoc),
        };
      } catch (err) {
        console.warn(
          `[peerComparison] Account profile lookup failed for identity ${identityId} / app ${appDoc.name}: ${err.message}`,
        );
        return { link, appDoc, userDoc: null, department: '', title: '' };
      }
    }),
  );

  return contexts.filter(Boolean);
}

async function resolveIdentityPeerProfile(identity, appIdFilter = [], existingContexts = null) {
  const resolved = {
    department: resolveIdentityDepartment(identity),
    title: resolveIdentityTitle(identity),
    accountContexts: Array.isArray(existingContexts) ? existingContexts : [],
  };

  if (resolved.department && resolved.title && resolved.accountContexts.length > 0) {
    return resolved;
  }

  if (
    (!resolved.department || !resolved.title || resolved.accountContexts.length === 0) &&
    identity?._id
  ) {
    resolved.accountContexts = resolved.accountContexts.length
      ? resolved.accountContexts
      : await loadAccountContextsForIdentity(String(identity._id), appIdFilter);
    for (const ctx of resolved.accountContexts) {
      if (!resolved.department) resolved.department = ctx.department;
      if (!resolved.title) resolved.title = ctx.title;
      if (resolved.department && resolved.title) break;
    }
  }

  return resolved;
}

function buildAppUserPeerQuery(application, department, title) {
  const deptMatch = buildOrTextMatch(
    buildMappedAccountPaths(application, ['department'], RAW_DEPARTMENT_KEYS),
    department,
  );

  const titleMatch = buildOrTextMatch(
    buildMappedAccountPaths(application, ['title', 'job_title'], RAW_TITLE_KEYS),
    title,
  );

  return {
    $and: [deptMatch, titleMatch].filter(Boolean),
  };
}

function buildIdentityPeerQuery(identityId, tenantId, department, title, filters = {}) {
  const query = {
    _id: { $ne: new mongoose.Types.ObjectId(String(identityId)) },
  };
  if (tenantId) query.tenantId = tenantId;

  const clauses = [
    buildOrTextMatch(
      ['department', 'attributes.department', 'attributes.Department', 'attributes.dept'],
      department,
    ),
    buildOrTextMatch(
      [
        'title',
        'attributes.title',
        'attributes.Title',
        'attributes.jobTitle',
        'attributes.job_title',
        'attributes.role',
      ],
      title,
    ),
  ].filter(Boolean);

  if (clauses.length === 1) Object.assign(query, clauses[0]);
  if (clauses.length > 1) query.$and = clauses;

  if (filters.location) query.location = filters.location;
  if (filters.managerId && mongoose.Types.ObjectId.isValid(String(filters.managerId))) {
    query.managerId = new mongoose.Types.ObjectId(String(filters.managerId));
  }
  if (filters.businessUnit) query.costCenter = filters.businessUnit;

  return query;
}

async function findPeersViaAccountContexts({
  IdentityModel,
  targetId,
  tenantId,
  department,
  title,
  filters = {},
  targetContexts = [],
  existingPeerIds = [],
}) {
  if (!tenantId || !department || !title || !targetContexts.length) return [];

  const seenIds = new Set([String(targetId), ...existingPeerIds.map((id) => String(id))]);
  const peers = [];
  const appSeen = new Set();
  const baseIdentityQuery = { tenantId };
  if (filters.location) baseIdentityQuery.location = filters.location;
  if (filters.managerId && mongoose.Types.ObjectId.isValid(String(filters.managerId))) {
    baseIdentityQuery.managerId = new mongoose.Types.ObjectId(String(filters.managerId));
  }
  if (filters.businessUnit) baseIdentityQuery.costCenter = filters.businessUnit;

  for (const ctx of targetContexts) {
    const appId = String(ctx?.appDoc?._id || '');
    const appName = ctx?.appDoc?.name;
    if (!appId || !appName || appSeen.has(appId)) continue;
    appSeen.add(appId);

    try {
      const DynModel = await getDynamicUserModelForTenantId(appName, ctx.appDoc.tenantId);
      const appUsers = await DynModel.find(buildAppUserPeerQuery(ctx.appDoc, department, title))
        .select('_id')
        .limit(MAX_PEERS * 4)
        .lean();
      const accountIds = [...new Set(appUsers.map((doc) => String(doc._id)).filter(Boolean))];
      if (!accountIds.length) continue;

      const links = await IdentityAccountLink.find({
        applicationId: new mongoose.Types.ObjectId(appId),
        isActive: true,
        accountId: { $in: accountIds },
      })
        .select('identityId')
        .lean();

      const candidateIds = [
        ...new Set(
          links
            .map((link) => String(link.identityId || ''))
            .filter((id) => id && !seenIds.has(id)),
        ),
      ];
      if (!candidateIds.length) continue;

      const docs = await IdentityModel.find({
        ...baseIdentityQuery,
        _id: { $in: candidateIds.map((id) => new mongoose.Types.ObjectId(id)) },
      })
        .select('email displayName firstName lastName department title attributes')
        .lean();

      for (const doc of docs) {
        const docId = String(doc._id);
        if (seenIds.has(docId)) continue;
        seenIds.add(docId);
        peers.push(doc);
        if (peers.length >= MAX_PEERS) return peers;
      }
    } catch (err) {
      console.warn(
        `[peerComparison] Account-context peer lookup failed for app ${appName}: ${err.message}`,
      );
    }
  }

  return peers;
}

/**
 * FALLBACK: Extract raw entitlement strings from an account document when
 * no correlation engine results exist.
 * Returns [{ raw, normalized, source: 'raw_field' }]
 */
function extractRawEntitlementsFromAccount(accountData) {
  if (!accountData || typeof accountData !== 'object') return [];
  const found = [];
  const seenNorm = new Set();

  const pushValue = (raw, field) => {
    const s = String(raw).trim();
    if (!s) return;
    const norm = normalizeEntitlement(s);
    if (!norm || seenNorm.has(norm)) return;
    seenNorm.add(norm);
    found.push({ raw: s, normalized: norm, field, source: 'raw_field' });
  };

  const scan = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    RAW_ENTITLEMENT_KEYS.forEach((key) => {
      const val = obj[key];
      if (!val) return;
      if (Array.isArray(val)) {
        val.forEach((v) => pushValue(v, key));
      } else if (typeof val === 'string') {
        val.split(/[;|,]/).forEach((v) => pushValue(v, key));
      }
    });
  };

  scan(accountData);
  if (accountData.rawData && typeof accountData.rawData === 'object') {
    scan(accountData.rawData);
  }
  return found;
}

/**
 * PRIMARY PATH: Load entitlements for one identity using IdentityAccountLink
 * + the Account/Entitlement correlation matrix (the "Run Engine" output).
 *
 * FALLBACK: When an account link exists but has no correlated entitlements
 * (engine not yet run), scans raw user doc fields — same as IdentityDetail.jsx.
 *
 * @param {string} identityId  MongoDB ObjectId string
 * @param {string[]} appIdFilter  If non-empty, restrict to these application IDs
 * @returns {Promise<Map<string, { appName: string, raw: string, source: 'correlated'|'raw_field' }[]>>}
 *          Map keyed by normalizedEntitlementName
 */
async function loadEntitlementsForIdentity(identityId, appIdFilter = []) {
  const db = mongoose.connection.db;

  // Build link query
  const linkQuery = { identityId: new mongoose.Types.ObjectId(String(identityId)), isActive: true };
  if (appIdFilter.length > 0) {
    linkQuery.applicationId = {
      $in: appIdFilter
        .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  const links = await IdentityAccountLink.find(linkQuery)
    .populate('applicationId', 'name type tenantId lastManualCorrelation')
    .lean();

  /** Map: normalizedKey → [{ appName, raw, source }] */
  const entitlementMap = new Map();

  const register = (normalized, appName, raw, source) => {
    if (!normalized) return;
    if (!entitlementMap.has(normalized)) entitlementMap.set(normalized, []);
    entitlementMap.get(normalized).push({ appName, raw, source });
  };

  await Promise.all(
    links.map(async (link) => {
      const appDoc = link.applicationId && typeof link.applicationId === 'object'
        ? link.applicationId
        : null;
      if (!appDoc) return;

      const appName = appDoc.name;
      const appId = appDoc._id;

      // ── 1. Try correlation engine first ──────────────────────────────
      let userDoc = null;
      try {
        // We MUST resolve the live account document _id (needed by fetchCorrelatedEntitlementsForAccount)
        // because link.accountId might be an email, samAccountName, or Employee ID.
        const DynModel = await getDynamicUserModelForTenantId(appName, appDoc.tenantId);
        userDoc = await resolveLiveApplicationUser(DynModel, link, appDoc);
        
        const userObjectId = userDoc ? userDoc._id : null;

        if (db && appId && userObjectId) {
          const correlated = await fetchCorrelatedEntitlementsWithProjectionFallback({
            identityId,
            applicationId: appId,
            accountId: userObjectId,
            tenantId: appDoc.tenantId,
            legacyFetch: () =>
              fetchCorrelatedEntitlementsForAccount(
                db,
                appName,
                appId,
                userObjectId,
                appDoc.tenantId,
              ),
          });

          if (correlated.length > 0) {
            correlated.forEach((ent) => {
              const raw = ent.displayName || ent.entitlementName || String(ent.entitlementId);
              const norm = normalizeEntitlement(raw);
              register(norm, appName, raw, 'correlated');
            });
            return; // ← Used correlation data; skip raw fallback for this account
          }
        }
      } catch (err) {
        // Correlation lookup failed — fall through to raw field scan
        console.warn(`[peerComparison] Correlated entitlement lookup failed for identity ${identityId} / app ${appName}: ${err.message}`);
      }

      // ── 2. Fallback: scan raw user doc fields ─────────────────────────
      try {
        // We already resolved userDoc in Step 1.
        if (userDoc) {
          const rawEnts = extractRawEntitlementsFromAccount(userDoc);
          rawEnts.forEach(({ raw, normalized }) => {
            register(normalized, appName, raw, 'raw_field');
          });
        }
      } catch (err) {
        console.warn(`[peerComparison] Raw field fallback failed for identity ${identityId} / app ${appName}: ${err.message}`);
      }
    }),
  );

  return entitlementMap;
}

/* ─── Risk Classification ─────────────────────────────────────────────────── */

/**
 * V1: Rarity-based risk only. SoD integration is future roadmap.
 *
 * - HIGH   : very rare (< 10% peers have it) — privilege outlier
 * - MEDIUM : somewhat rare (< threshold)
 * - LOW    : common (≥ threshold)
 */
function classifyRisk(peerCoverage, threshold) {
  if (peerCoverage < 0.1) return 'HIGH';
  if (peerCoverage < threshold) return 'MEDIUM';
  return 'LOW';
}

/** Default peer coverage threshold for “commonly held” baseline access (65%). */
export const DEFAULT_PEER_BASELINE_THRESHOLD = 0.65;

/**
 * Resolve threshold from request body.
 * Modes: baseline (0.65), majority (0.5), consensus (0.75), strict (1.0), custom (body.threshold).
 */
function resolveThreshold(body) {
  const mode = String(body.mode || '').toLowerCase();
  if (mode === 'baseline' || mode === 'standard' || mode === 'role_baseline') return DEFAULT_PEER_BASELINE_THRESHOLD;
  if (mode === 'majority') return 0.5;
  if (mode === 'consensus' || mode === 'strong_consensus') return 0.75;
  if (mode === 'strict') return 1.0;
  const t = parseFloat(body.threshold);
  if (!isNaN(t) && t > 0 && t <= 1) return t;
  return DEFAULT_PEER_BASELINE_THRESHOLD;
}

/**
 * Per-entitlement confidence that this item belongs in the peer baseline.
 */
function entitlementBaselineConfidence(peerCoverageRaw, groupConfidence, peerCount) {
  if (peerCount < 3) return 'LOW';
  if (peerCoverageRaw >= 0.85 && (groupConfidence === 'HIGH' || groupConfidence === 'MEDIUM')) return 'HIGH';
  if (peerCoverageRaw >= 0.65) return groupConfidence === 'HIGH' ? 'HIGH' : 'MEDIUM';
  return 'LOW';
}

/* ─── Controller ─────────────────────────────────────────────────────────── */

/**
 * POST /api/identities/:id/peer-comparison
 *
 * Body:
 * {
 *   threshold: 0.5,           // 0–1 numeric, used when mode = "custom"
 *   mode: "majority",         // majority | consensus | strict | custom
 *   applicationIds: [],       // optional app filter (empty = all apps)
 *   filters: {
 *     location: string,       // optional peer filter
 *     managerId: string,      // optional peer filter
 *     businessUnit: string,   // optional peer filter (maps to costCenter)
 *   },
 *   minPeers: 3,              // advisory minimum — non-blocking, shows confidence warning
 * }
 *
 * Data source priority:
 *  1. IdentityAccountLink → fetchCorrelatedEntitlementsForAccount (Run Engine output)
 *  2. Fallback: raw entitlement fields on app_*_users document
 */
export const peerComparison = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid identity ID' });
    }

    const body = req.body || {};
    const threshold = resolveThreshold(body);
    const applicationIds = Array.isArray(body.applicationIds) ? body.applicationIds : [];
    const filters = body.filters || {};
    const minPeers = parseInt(body.minPeers, 10) || 3;

    // ── 1. Load target identity ────────────────────────────────────────────
    const LegacyIdentity = getLegacyIdentityModel();
    const targetStub = await LegacyIdentity.findById(id).select('tenantId').lean();
    if (!targetStub?.tenantId) {
      return res.status(404).json({ success: false, message: 'Identity not found' });
    }

    const Identity = await getDynamicIdentityModelForTenantId(targetStub.tenantId);
    const target = await Identity.findById(id)
      .select('email displayName firstName lastName department title tenantId location managerId costCenter attributes')
      .lean();

    if (!target) {
      return res.status(404).json({ success: false, message: 'Identity not found' });
    }
    const targetProfile = await resolveIdentityPeerProfile(target, applicationIds);
    const effectiveDepartment = targetProfile.department;
    const effectiveTitle = targetProfile.title;
    if (!effectiveDepartment || !effectiveTitle) {
      return res.status(422).json({
        success: false,
        message: 'Target identity is missing department or job title — cannot determine peer group.',
      });
    }

    const tenantId = target.tenantId;

    // ── 2. Find peer group ────────────────────────────────────────────────
    const directPeers = await Identity.find(
      buildIdentityPeerQuery(id, tenantId, effectiveDepartment, effectiveTitle, filters),
    )
      .select('email displayName firstName lastName department title attributes')
      .limit(MAX_PEERS)
      .lean();
    const fallbackPeers =
      directPeers.length >= MAX_PEERS
        ? []
        : await findPeersViaAccountContexts({
            IdentityModel: Identity,
            targetId: id,
            tenantId,
            department: effectiveDepartment,
            title: effectiveTitle,
            filters,
            targetContexts: targetProfile.accountContexts,
            existingPeerIds: directPeers.map((peer) => peer._id),
          });
    const peers = [...directPeers, ...fallbackPeers].slice(0, MAX_PEERS);

    const peerCount = peers.length;
    const lowConfidence = peerCount < minPeers;

    // ── 3. Load entitlements via IdentityAccountLink + correlation engine ──
    //      (with raw-field fallback per account when engine not run)
    const [targetEntMap, ...peerEntMaps] = await Promise.all([
      loadEntitlementsForIdentity(id, applicationIds),
      ...peers.map((p) => loadEntitlementsForIdentity(String(p._id), applicationIds)),
    ]);

    // ── 4. Build universe of all unique entitlements ────────────────────
    /**
     * universe: Map<normalizedKey, {
     *   rawLabel    : string,         best human-readable label
     *   appSources  : Set<string>,    app names where this entitlement appears
     *   inTarget    : boolean,
     *   sourceType  : 'correlated' | 'raw_field' | 'mixed'
     *   peerCount   : number,
     * }>
     */
    const universe = new Map();

    const registerEnt = (norm, meta) => {
      if (!universe.has(norm)) {
        universe.set(norm, {
          normalizedKey: norm,
          rawLabel: meta[0]?.raw || norm,
          appSources: new Set(),
          inTarget: false,
          peerCount: 0,
          sourceType: meta[0]?.source || 'raw_field',
        });
      }
      const entry = universe.get(norm);
      meta.forEach((m) => {
        entry.appSources.add(m.appName);
        // Upgrade source label: correlated > raw_field > mixed
        if (entry.sourceType !== m.source) entry.sourceType = 'mixed';
        if (m.source === 'correlated') entry.sourceType = 'correlated';
      });
    };

    // Register target
    for (const [norm, meta] of targetEntMap.entries()) {
      registerEnt(norm, meta);
      universe.get(norm).inTarget = true;
    }

    // Register peers and count coverage
    const peerHasEnt = new Map(); // norm → Set of peerIdx
    peerEntMaps.forEach((peerMap, peerIdx) => {
      for (const [norm, meta] of peerMap.entries()) {
        registerEnt(norm, meta);
        if (!peerHasEnt.has(norm)) peerHasEnt.set(norm, new Set());
        peerHasEnt.get(norm).add(peerIdx);
      }
    });

    // Finalize peer counts
    for (const [norm, entry] of universe.entries()) {
      entry.peerCount = peerHasEnt.get(norm)?.size || 0;
    }

    // ── 5. Classify: peer baseline + user alignment vs baseline ───────────
    const comparison = { normal: [], unusual: [], recommendedMissing: [] };
    const peerBaseline = [];

    for (const [, entry] of universe.entries()) {
      const peerCoverage = peerCount > 0 ? entry.peerCount / peerCount : 0;
      const isCommonAmongPeers = peerCoverage >= threshold;
      const riskLevel = classifyRisk(peerCoverage, threshold);

      const record = {
        entitlement: entry.rawLabel,
        normalizedKey: entry.normalizedKey,
        application: [...entry.appSources].join(', ') || 'Unknown',
        peerCoverage: peerCount > 0 ? Math.round(peerCoverage * 100) : 0,
        peerCoverageRaw: peerCoverage,
        /** Peers that hold this entitlement */
        peersWithAccess: entry.peerCount,
        /** Size of the peer comparison group used for coverage % */
        peerGroupSize: peerCount,
        riskLevel,
        dataSource: entry.sourceType,
        inTarget: entry.inTarget,
      };

      // Peer baseline: entitlements commonly held across the peer group (expected access model)
      if (isCommonAmongPeers) {
        peerBaseline.push({ ...record });
      }

      // User alignment vs baseline (only classify when governance rules apply)
      if (entry.inTarget && isCommonAmongPeers) {
        comparison.normal.push(record);
      } else if (entry.inTarget && !isCommonAmongPeers) {
        comparison.unusual.push(record);
      } else if (!entry.inTarget && isCommonAmongPeers) {
        comparison.recommendedMissing.push(record);
      }
      // Below threshold and user lacks → omitted (not “missing”; too rare among peers)
    }

    // Re-score baseline confidence after group confidence is known
    let groupConfidence = 'HIGH';
    if (peerCount === 0) groupConfidence = 'NONE';
    else if (peerCount < 3) groupConfidence = 'LOW';
    else if (peerCount < 10) groupConfidence = 'MEDIUM';

    for (const row of peerBaseline) {
      row.baselineConfidence = entitlementBaselineConfidence(row.peerCoverageRaw, groupConfidence, peerCount);
    }

    peerBaseline.sort((a, b) => b.peerCoverageRaw - a.peerCoverageRaw);
    comparison.normal.sort((a, b) => b.peerCoverageRaw - a.peerCoverageRaw);
    comparison.recommendedMissing.sort((a, b) => b.peerCoverageRaw - a.peerCoverageRaw);
    comparison.unusual.sort((a, b) => a.peerCoverageRaw - b.peerCoverageRaw);

    // Legacy keys for API consumers
    comparison.match = comparison.normal;
    comparison.excess = comparison.unusual;
    comparison.missing = comparison.recommendedMissing;

    // ── 6. Confidence scoring ─────────────────────────────────────────────
    const confidence = groupConfidence;

    // ── 7. Data source quality summary ───────────────────────────────────
    const allRecords = [...comparison.normal, ...comparison.unusual, ...comparison.recommendedMissing];
    const correlatedCount = allRecords.filter((r) => r.dataSource === 'correlated').length;
    const rawCount = allRecords.filter((r) => r.dataSource === 'raw_field').length;
    const dataSourceSummary = {
      total: allRecords.length,
      fromCorrelationEngine: correlatedCount,
      fromRawFields: rawCount,
      quality: correlatedCount > 0 && rawCount === 0
        ? 'full_correlation'
        : correlatedCount > 0
          ? 'partial_correlation'
          : 'raw_fields_only',
    };

    // ── 8. Build response ─────────────────────────────────────────────────
    return res.status(200).json({
      success: true,
      data: {
        targetIdentity: {
          id: String(target._id),
          displayName:
            target.displayName ||
            [target.firstName, target.lastName].filter(Boolean).join(' ') ||
            target.email,
          email: target.email,
          department: effectiveDepartment,
          title: effectiveTitle,
        },
        peerGroup: {
          count: peerCount,
          maxScanned: MAX_PEERS,
          capped: peerCount >= MAX_PEERS,
          lowConfidence,
          confidence,
          minPeersRecommended: minPeers,
          peers: peers.map((p) => ({
            id: String(p._id),
            displayName:
              p.displayName ||
              [p.firstName, p.lastName].filter(Boolean).join(' ') ||
              p.email,
            email: p.email,
          })),
        },
        parameters: {
          threshold,
          thresholdPercent: Math.round(threshold * 100),
          mode: body.mode || 'baseline',
          applicationIds,
        },
        summary: {
          baselineCount: peerBaseline.length,
          alignedCount: comparison.normal.length,
          unusualCount: comparison.unusual.length,
          recommendedMissingCount: comparison.recommendedMissing.length,
          matchCount: comparison.normal.length,
          excessCount: comparison.unusual.length,
          missingCount: comparison.recommendedMissing.length,
          totalEntitlementsTarget: targetEntMap.size,
        },
        dataSourceSummary,
        peerBaseline,
        comparison,
      },
    });
  } catch (err) {
    console.error('[peerComparison] Fatal error:', err?.message || err);
    return res.status(500).json({ success: false, message: err.message || 'Comparison failed' });
  }
};
