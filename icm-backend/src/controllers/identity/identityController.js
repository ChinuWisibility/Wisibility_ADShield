import mongoose from 'mongoose'; // <-- FIX 1: ADDED MONGOOSE IMPORT
import { isPlatformPlaneUser } from '../../middleware/auth.js';
import Tenant from '../../models/platform/Tenant.js';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
  identitySchema,
  mirrorIdentityDocumentToLegacy,
} from '../../models/identity/Identity.js';
import Application from '../../models/application/Application.js';
// IMPORT YOUR DYNAMIC FACTORIES!
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { syncIdentityStats } from '../../utils/syncIdentityStats.js'; // <-- Import the utility
import IdentityTenantStats from '../../models/identity/IdentityTenantStats.js';
import { recomputeIdentityTenantStats, toTenantObjectId } from '../../services/identityTenantStatsService.js';

/**
 * ==========================================
 * 1. CORE CRUD & BULK OPERATIONS
 * ==========================================
 */

/** Fire-and-forget rollup refresh after identity mutations (keeps dashboard cache in sync). */
function scheduleIdentityStatsRefresh(tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) return;
  void recomputeIdentityTenantStats(tid).catch((err) =>
    console.error('[identity-tenant-stats] recompute failed', err?.message || err),
  );
}

function escapeRegexForIdentitySearch(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match word against concatenated primitive values in `attributes` (mapped profile fields like userName, etc.).
 */
function attributesHaystackMatchesWordExpr(word) {
  return {
    $expr: {
      $regexMatch: {
        input: {
          $reduce: {
            input: { $objectToArray: { $ifNull: ['$attributes', {}] } },
            initialValue: '',
            in: {
              $concat: [
                '$$value',
                {
                  $cond: [{ $eq: ['$$value', ''] }, '', ' '],
                },
                {
                  $switch: {
                    branches: [
                      { case: { $eq: [{ $type: '$$this.v' }, 'string'] }, then: '$$this.v' },
                      {
                        case: { $in: [{ $type: '$$this.v' }, ['double', 'int', 'long', 'decimal', 'bool', 'date']] },
                        then: { $toString: '$$this.v' },
                      },
                    ],
                    default: '',
                  },
                },
              ],
            },
          },
        },
        regex: word,
        options: 'i',
      },
    },
  };
}

/** One word → match any identity text field. Multiple words → each word must match at least one field (e.g. "aiden abe" finds firstName + lastName or attributes.userName + attributes…). */
export function buildIdentityTextSearchFilter(rawQ) {
  const trimmed = String(rawQ || '').trim();
  if (!trimmed) return null;
  const words = trimmed.split(/\s+/).filter(Boolean).map(escapeRegexForIdentitySearch);
  if (!words.length) return null;

  const orForWord = (word) => [
    { displayName: { $regex: word, $options: 'i' } },
    { email: { $regex: word, $options: 'i' } },
    { firstName: { $regex: word, $options: 'i' } },
    { lastName: { $regex: word, $options: 'i' } },
    { employeeId: { $regex: word, $options: 'i' } },
    { department: { $regex: word, $options: 'i' } },
    { title: { $regex: word, $options: 'i' } },
    { phoneNumber: { $regex: word, $options: 'i' } },
    { managerEmail: { $regex: word, $options: 'i' } },
    { managerEmployeeId: { $regex: word, $options: 'i' } },
    { managerKeyRaw: { $regex: word, $options: 'i' } },
    { sourceApplicationName: { $regex: word, $options: 'i' } },
    { identityProfile: { $regex: word, $options: 'i' } },
    { location: { $regex: word, $options: 'i' } },
    { costCenter: { $regex: word, $options: 'i' } },
    { division: { $regex: word, $options: 'i' } },
    // Login / username (top-level if present on document; schema is mostly attributes.*)
    { userName: { $regex: word, $options: 'i' } },
    { username: { $regex: word, $options: 'i' } },
    { uname: { $regex: word, $options: 'i' } },
    { 'attributes.uid': { $regex: word, $options: 'i' } },
    { 'attributes.userId': { $regex: word, $options: 'i' } },
    { 'attributes.user_id': { $regex: word, $options: 'i' } },
    { 'attributes.userName': { $regex: word, $options: 'i' } },
    { 'attributes.username': { $regex: word, $options: 'i' } },
    { 'attributes.uname': { $regex: word, $options: 'i' } },
    { 'attributes.email': { $regex: word, $options: 'i' } },
    { 'attributes.workEmail': { $regex: word, $options: 'i' } },
    { 'attributes.login': { $regex: word, $options: 'i' } },
    { 'attributes.user_login': { $regex: word, $options: 'i' } },
    { 'attributes.userPrincipalName': { $regex: word, $options: 'i' } },
    { 'attributes.samAccountName': { $regex: word, $options: 'i' } },
    { 'attributes.sAMAccountName': { $regex: word, $options: 'i' } },
    { 'attributes.gh_login': { $regex: word, $options: 'i' } },
    attributesHaystackMatchesWordExpr(word),
  ];

  if (words.length === 1) {
    return { $or: orForWord(words[0]) };
  }
  return { $and: words.map((w) => ({ $or: orForWord(w) })) };
}

/** Map list UI `targetKey` → safe Mongo sort path (top-level Identity field or `attributes.*`). */
export function buildIdentityListSort(sortByRaw, sortDirRaw) {
  const dir = String(sortDirRaw || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  const raw = String(sortByRaw || '').trim();
  if (!raw || raw === 'actions') return { displayName: dir, _id: 1 };

  const aliases = {
    status: 'lifecycleState',
    uid: 'attributes.uid',
  };
  let path = aliases[raw] || raw;

  if (path.startsWith('attributes.')) {
    if (/^attributes\.[a-zA-Z][a-zA-Z0-9_]*$/.test(path)) {
      return { [path]: dir, _id: 1 };
    }
    return { displayName: dir, _id: 1 };
  }

  const topLevel = new Set([
    'displayName',
    'firstName',
    'lastName',
    'email',
    'employeeId',
    'department',
    'title',
    'phoneNumber',
    'managerEmail',
    'managerEmployeeId',
    'managerKeyRaw',
    'lifecycleState',
    'identityProfile',
    'identityProfileId',
    'location',
    'costCenter',
    'division',
    'sourceApplicationName',
    'riskLevel',
    'identityType',
    'createdAt',
    'updatedAt',
  ]);

  if (path === 'managerId') {
    return { managerEmployeeId: dir, _id: 1 };
  }

  if (topLevel.has(path)) {
    return { [path]: dir, _id: 1 };
  }

  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(raw)) {
    return { [`attributes.${raw}`]: dir, _id: 1 };
  }

  return { displayName: dir, _id: 1 };
}

const IDENTITY_LIST_CORE_FIELDS = [
  "_id",
  "displayName",
  "firstName",
  "lastName",
  "email",
  "employeeId",
  "department",
  "title",
  "phoneNumber",
  "managerId",
  "managerEmail",
  "managerEmployeeId",
  "managerKeyRaw",
  "managerResolutionStatus",
  "lifecycleState",
  "startDate",
  "location",
  "country",
  "costCenter",
  "division",
];

const IDENTITY_LIST_FIELD_ALIASES = {
  displayName: ["displayName", "firstName", "lastName", "attributes.display_name", "attributes.displayName", "attributes.displayname"],
  firstname: ["firstName"],
  lastname: ["lastName"],
  email: ["email"],
  employeeId: ["employeeId"],
  department: ["department"],
  title: ["title"],
  phone: ["phoneNumber"],
  status: ["lifecycleState"],
  uid: ["email", "attributes.uid", "attributes.username"],
  managerId: ["managerId", "managerEmail", "managerEmployeeId", "managerKeyRaw", "attributes.managerId"],
  managerEmail: ["managerEmail"],
  managerEmployeeId: ["managerEmployeeId"],
  startDate: ["startDate"],
};

/**
 * Opt-in compact projection for list UIs. Calls without `fields` retain the
 * historic full-document response, so existing API consumers are unchanged.
 */
export function buildIdentityListProjection(fieldsRaw) {
  const source = Array.isArray(fieldsRaw) ? fieldsRaw.join(",") : String(fieldsRaw || "");
  const requested = source
    .split(",")
    .map((field) => field.trim())
    .filter((field) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(field))
    .slice(0, 100);
  if (requested.length === 0) return null;

  const selected = new Set(IDENTITY_LIST_CORE_FIELDS);
  for (const field of requested) {
    selected.add(field);
    selected.add(`attributes.${field}`);
    for (const alias of IDENTITY_LIST_FIELD_ALIASES[field] || []) {
      selected.add(alias);
    }
  }
  return [...selected].join(" ");
}

async function loadIdentityTenantStats(tid) {
  if (!tid) return null;
  let statsDoc = await IdentityTenantStats.findOne({ tenantId: tid }).lean();
  if (!statsDoc) {
    await recomputeIdentityTenantStats(tid);
    statsDoc = await IdentityTenantStats.findOne({ tenantId: tid }).lean();
  }
  return statsDoc;
}

async function resolveIdentityRecordById(identityId, req) {
  const idStr = String(identityId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(idStr)) {
    return { Identity: null, identity: null, legacyIdentity: null };
  }

  const scopedTenantOid = toTenantObjectId(
    req?.scopedTenantId ?? req?.user?.tenantId ?? req?.user?.tenant,
  );
  const LegacyIdentity = getLegacyIdentityModel();

  /** List API reads tenant shard collections; detail must not require legacy-only rows. */
  if (scopedTenantOid) {
    const Identity = await getDynamicIdentityModelForTenantId(scopedTenantOid);
    const identity = await Identity.findById(idStr);
    if (identity) {
      const legacyIdentity = await LegacyIdentity.findById(idStr).lean();
      if (
        legacyIdentity &&
        String(legacyIdentity.tenantId) !== String(scopedTenantOid) &&
        !isPlatformPlaneUser(req?.user)
      ) {
        return { Identity: null, identity: null, legacyIdentity: null };
      }
      return { Identity, identity, legacyIdentity: legacyIdentity || null };
    }
  }

  const legacyIdentity = await LegacyIdentity.findById(idStr).lean();
  if (!legacyIdentity) return { Identity: null, identity: null, legacyIdentity: null };

  if (
    scopedTenantOid &&
    String(scopedTenantOid) !== String(legacyIdentity.tenantId) &&
    !isPlatformPlaneUser(req?.user)
  ) {
    return { Identity: null, identity: null, legacyIdentity: null };
  }

  const Identity = await getDynamicIdentityModelForTenantId(legacyIdentity.tenantId);
  const identity = await Identity.findById(idStr);
  return { Identity, identity, legacyIdentity };
}

export const getIdentities = async (req, res) => {
  try {
    const page = Math.max(0, parseInt(req.query.page, 10) || 0);
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 2000) : 10;
    const skip = page * limit;

    const { tenantId, lifecycleState, department } = req.query;
    const sortBy = req.query.sortBy ?? req.query.sort;
    const sortDir = req.query.sortDir ?? req.query.order;
    const rawQ = (req.query.search ?? req.query.q ?? '').trim();
    const filter = {};

    /**
     * Tenant-bound JWTs must never list identities outside their tenant when `tenantId` is omitted
     * (e.g. Identity Graph Explorer search). Platform-plane users may omit it to query all tenants
     * or pass `tenantId` to narrow.
     */
    const scopedTenantOid = toTenantObjectId(req.scopedTenantId);
    const queryTenantOid =
      tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))
        ? new mongoose.Types.ObjectId(String(tenantId))
        : null;

    if (!isPlatformPlaneUser(req.user) && scopedTenantOid) {
      filter.tenantId = scopedTenantOid;
    } else if (queryTenantOid) {
      filter.tenantId = queryTenantOid;
    } else if (tenantId) {
      filter.tenantId = tenantId;
    }

    const lifecycle = String(lifecycleState || '').trim().toUpperCase();
    if (lifecycle === 'INACTIVE') {
      // Align with KPI "inactive" = any non-ACTIVE lifecycle state
      filter.lifecycleState = { $ne: 'ACTIVE' };
    } else if (lifecycle && lifecycle !== 'ALL') {
      filter.lifecycleState = lifecycle;
    }

    const andParts = [];
    const textSearch = buildIdentityTextSearchFilter(rawQ);
    if (textSearch) andParts.push(textSearch);

    const dept = String(department || '').trim();
    if (dept && dept.toUpperCase() !== 'ALL') {
      andParts.push({
        $or: [
          { department: dept },
          { 'attributes.department': dept },
        ],
      });
    }

    if (andParts.length === 1) {
      Object.assign(filter, andParts[0]);
    } else if (andParts.length > 1) {
      filter.$and = andParts;
    }

    const sortSpec = buildIdentityListSort(sortBy, sortDir);
    const listProjection = buildIdentityListProjection(req.query.fields);

    let listTotal = 0;
    let identities = [];
    const tid = filter.tenantId;
    const statsPromise = loadIdentityTenantStats(tid);

    if (filter.tenantId) {
      const Identity = await getDynamicIdentityModelForTenantId(filter.tenantId);
      const listQuery = Identity.find(filter)
        .populate({ path: "managerId", model: Identity, select: "displayName email" })
        .sort(sortSpec)
        .skip(skip)
        .limit(limit);
      if (listProjection) listQuery.select(listProjection);
      [listTotal, identities] = await Promise.all([
        Identity.countDocuments(filter),
        listQuery.lean(),
      ]);
    } else {
      const Identity = getLegacyIdentityModel();
      const listQuery = Identity.find(filter)
        .populate({ path: "managerId", select: "displayName email" })
        .sort(sortSpec)
        .skip(skip)
        .limit(limit);
      if (listProjection) listQuery.select(listProjection);
      [listTotal, identities] = await Promise.all([
        Identity.countDocuments(filter),
        listQuery.lean(),
      ]);
    }

    const statsDoc = await statsPromise;

    const stats = statsDoc
      ? {
          total: statsDoc.total ?? 0,
          active: statsDoc.active ?? 0,
          privileged: statsDoc.privileged ?? statsDoc.highRisk ?? 0,
          inactive: statsDoc.inactive ?? 0,
        }
      : { total: 0, active: 0, privileged: 0, inactive: 0 };

    res.status(200).json({
      success: true,
      count: identities.length,
      listTotal,
      stats,
      statsSource: 'cache',
      page,
      limit,
      skip,
      data: identities,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};



export const getIdentityById = async (req, res) => {
  try {
    // Recount accounts/entitlements in the background — do not block the response (sync scans all apps × user collections).
    void syncIdentityStats(req.params.id).catch((err) =>
      console.error('[getIdentityById] syncIdentityStats', err?.message || err),
    );

    const { Identity, identity } = await resolveIdentityRecordById(req.params.id, req);
    const populatedIdentity = identity
      ? await Identity.populate(identity, {
      path: "managerId",
      model: Identity,
      select: "displayName email firstName lastName",
      })
      : null;
    if (!populatedIdentity) return res.status(404).json({ success: false, message: 'Identity not found' });

    const data = typeof populatedIdentity.toObject === 'function'
      ? populatedIdentity.toObject()
      : populatedIdentity;
    if (data.profilePhotoId) {
      data.profilePhotoUrl = `/api/identities/${data._id}/profile-photo/image`;
    }

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createIdentity = async (req, res) => {
  try {
    const tenantId = resolveIdentityCreateTenantId(req);

    let doc;
    if (req.body.identityProfileId && req.body.values) {
      const built = await buildIdentityFromProfileValues({
        profileId: req.body.identityProfileId,
        values: req.body.values,
        referenceSelections: req.body.referenceSelections,
        tenantId,
      });
      if (built.error) {
        return res.status(built.status).json({ success: false, message: built.error });
      }
      doc = built.payload;
    } else {
      doc = { ...req.body, tenantId };
      delete doc.platformRole;
      delete doc.password;
      delete doc.passwordHash;
    }

    const {
      assertPortalOnboardingPreconditions,
      provisionPortalUserForIdentity,
    } = await import('../../services/identity/identityPortalOnboardingService.js');

    await assertPortalOnboardingPreconditions({
      identityPayload: doc,
      actor: req.user,
      platformRole: req.body.platformRole,
      tenantId,
    });

    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const identity = await Identity.create(doc);
    await mirrorIdentityDocumentToLegacy(identity);
    scheduleIdentityStatsRefresh(identity.tenantId);
    const lifecycle = await enqueueIdentityCreatedLifecycleEvents(identity, req);
    const portalOnboarding = await provisionPortalUserForIdentity({
      identity,
      actor: req.user,
      platformRole: req.body.platformRole,
      requestMeta: {
        requestedIp: req.ip || req.connection?.remoteAddress || null,
        userAgent: req.headers['user-agent'] || '',
      },
    });
    res.status(201).json({ success: true, data: identity, lifecycle, portalOnboarding });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';
    const message = error.isOperational ? error.message : (error.message || 'Failed to create identity');
    if (statusCode >= 500 && !error.isOperational) {
      console.error('[identity-create]', error.message);
    }
    res.status(statusCode).json({
      success: false,
      message,
      error: { code, message },
    });
  }
};

function resolveIdentityCreateTenantId(req) {
  if (!isPlatformPlaneUser(req.user) && req.scopedTenantId) {
    return req.scopedTenantId;
  }
  return req.body.tenantId ?? req.scopedTenantId ?? req.user?.tenantId ?? req.user?.tenant;
}

/**
 * Route form values through the profile's mappings so a hand-created identity is stored
 * identically to one produced by aggregation — same top-level columns, same `attributes.*`.
 * Doing this client-side would duplicate the refresh mapping rules and drift from them.
 */
async function buildIdentityFromProfileValues({
  profileId,
  values,
  referenceSelections,
  tenantId,
}) {
  if (!tenantId) return { error: 'tenantId is required', status: 400 };

  const {
    applyIdentityReferenceSelections,
    loadTenantProfile,
    findMissingRequiredValues,
    profileValuesToIdentityPayload,
  } =
    await import('../../services/identity/identityCreateSchemaService.js');

  const profile = await loadTenantProfile(profileId, tenantId);
  if (!profile) return { error: 'Identity Profile not found for this tenant', status: 404 };

  const missing = findMissingRequiredValues(profile, values);
  if (missing.length) {
    return { error: `Missing required attributes: ${missing.join(', ')}`, status: 400 };
  }

  let payload = await profileValuesToIdentityPayload({ profile, values, tenantId });
  const resolvedReferences = await applyIdentityReferenceSelections({
    profile,
    tenantId,
    values,
    selections: referenceSelections,
    payload,
  });
  if (resolvedReferences.error) {
    return { error: resolvedReferences.error, status: 400 };
  }
  payload = resolvedReferences.payload;
  if (!payload.displayName) {
    return { error: 'Could not derive a display name from the values provided', status: 400 };
  }
  return { payload };
}

/**
 * A directly created identity has no authoritative source row, so a later identity refresh
 * sees it as pre-existing and never classifies it as a Joiner. Emit the transition here so
 * JML orchestration observes the same `before: null` shape aggregation would have produced.
 */
async function enqueueIdentityCreatedLifecycleEvents(identity, req) {
  try {
    const { enqueueLifecycleEventsFromIdentityChange } = await import(
      '../../services/lifecycle/lifecycleEventService.js'
    );
    const after = typeof identity.toObject === 'function' ? identity.toObject() : identity;
    const result = await enqueueLifecycleEventsFromIdentityChange({
      tenantId: identity.tenantId,
      identityId: identity._id,
      before: null,
      after,
      syncJobId: `identity-ui-create:${identity._id}`,
      triggeredBy: 'MANUAL',
      metadata: { createdByUserId: req.user?.id || req.user?._id || null },
    });
    return { enqueued: result?.enqueued || [], skipped: result?.skipped || null };
  } catch (error) {
    console.error('[identity-create] lifecycle enqueue failed', error?.message || error);
    return { enqueued: [], error: error?.message || 'LIFECYCLE_ENQUEUE_FAILED' };
  }
}

export const updateIdentity = async (req, res) => {
  try {
    const { Identity, identity: existing } = await resolveIdentityRecordById(req.params.id, req);
    if (!existing) return res.status(404).json({ success: false, message: 'Identity not found' });
    const identity = await Identity.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!identity) return res.status(404).json({ success: false, message: 'Identity not found' });
    await mirrorIdentityDocumentToLegacy(identity);
    scheduleIdentityStatsRefresh(identity.tenantId);
    res.status(200).json({ success: true, data: identity });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteIdentity = async (req, res) => {
  try {
    const { Identity, identity } = await resolveIdentityRecordById(req.params.id, req);
    if (!identity) return res.status(404).json({ success: false, message: 'Identity not found' });

    const { hardDeletePortalUserLinkedToIdentity } = await import(
      '../../services/identity/identityPortalOnboardingService.js'
    );
    await hardDeletePortalUserLinkedToIdentity({
      identityId: identity._id,
      actorId: req.user?.id || req.user?._id || null,
      tenantId: identity.tenantId,
    });

    await Promise.all([
      Identity.findByIdAndDelete(req.params.id),
      getLegacyIdentityModel().findByIdAndDelete(req.params.id),
    ]);
    scheduleIdentityStatsRefresh(identity.tenantId);
    res.status(200).json({ success: true, message: 'Identity deleted successfully' });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const code = error.code || 'INTERNAL_ERROR';
    const message = error.isOperational
      ? error.message
      : (error.message || 'Failed to delete identity');
    res.status(statusCode).json({
      success: false,
      message,
      error: { code, message },
    });
  }
};

// --- BULK IMPORT WITH CORRELATION ENGINE ---
export const bulkImportIdentities = async (req, res) => {
  try {
    const { identities, tenantId } = req.body;

    if (!Array.isArray(identities) || identities.length === 0) {
      return res.status(400).json({ success: false, message: 'Identities array is required' });
    }

    let insertedCount = 0;
    let errors = [];
    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const LegacyIdentity = getLegacyIdentityModel();

    for (const rawData of identities) {
      try {
        // 1. Sanitize Enums
        let state = (rawData.lifecycleState || 'ACTIVE').toUpperCase();
        if (!['NEW', 'ACTIVE', 'MOVER', 'LEAVER', 'TERMINATED', 'QUARANTINE', 'INACTIVE'].includes(state)) state = 'ACTIVE';

        let risk = (rawData.riskLevel || 'LOW').toUpperCase();
        if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(risk)) risk = 'LOW';

        // FIX 2: Sanitize Identity Type to prevent "NHI" errors
        let type = (rawData.identityType || 'employee').toLowerCase();
        if (!['employee', 'contractor', 'vendor', 'nhi'].includes(type)) type = 'employee';

        // 2. Clean base data
        const cleanData = {
          ...rawData,
          tenantId,
          lifecycleState: state,
          riskLevel: risk,
          identityType: type, // <-- Assign the sanitized type here
          email: rawData.email ? rawData.email.toLowerCase().trim() : undefined
        };

        // 3. THE CORRELATION ENGINE (Find the Manager)
        cleanData.managerId = undefined;

        if (rawData.managerId && rawData.managerId.trim() !== '') {
          const csvManagerValue = rawData.managerId.trim();

          if (mongoose.Types.ObjectId.isValid(csvManagerValue)) {
            cleanData.managerId = csvManagerValue;
          } else {
            // Search DB by email or name
            const managerDoc = await Identity.findOne({
              tenantId,
              $or: [
                { email: csvManagerValue.toLowerCase() },
                { displayName: csvManagerValue }
              ]
            }).select('_id');

            if (managerDoc) {
              cleanData.managerId = managerDoc._id; // Link established!
            }
          }
        }

        // 4. UPSERT (Update if exists, Create if new)
        if (cleanData.email) {
          const query = { email: cleanData.email };
          if (tenantId) query.tenantId = tenantId;

          // Because our custom attributes use dot notation (e.g., attributes.deskNumber),
          // Mongoose's $set will beautifully update just that specific attribute inside the dictionary!
          await Promise.all([
            Identity.findOneAndUpdate(
              query,
              { $set: cleanData },
              { upsert: true, new: true, runValidators: true }
            ),
            LegacyIdentity.findOneAndUpdate(
              query,
              { $set: cleanData },
              { upsert: true, new: true, runValidators: true }
            ),
          ]);
          insertedCount++;
        } else {
          const created = await Identity.create(cleanData);
          await mirrorIdentityDocumentToLegacy(created);
          insertedCount++;
        }
      } catch (err) {
        errors.push({ email: rawData.email || 'Unknown', error: err.message });
      }
    }

    if (tenantId) scheduleIdentityStatsRefresh(tenantId);
    res.status(201).json({ success: true, insertedCount, errors: errors.slice(0, 5) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Fatal error during import.', error: error.message });
  }
};


// --- DISTINCT DEPARTMENTS (FOR LIST FILTERS) ---
export const getIdentityDepartments = async (req, res) => {
  try {
    const { tenantId } = req.query;
    const scopedTenantOid = toTenantObjectId(req.scopedTenantId);
    const queryTenantOid =
      tenantId && mongoose.Types.ObjectId.isValid(String(tenantId))
        ? new mongoose.Types.ObjectId(String(tenantId))
        : null;

    let resolvedTenant = null;
    if (!isPlatformPlaneUser(req.user) && scopedTenantOid) {
      resolvedTenant = scopedTenantOid;
    } else if (queryTenantOid) {
      resolvedTenant = queryTenantOid;
    } else if (tenantId) {
      resolvedTenant = tenantId;
    }

    if (!resolvedTenant) {
      return res.status(400).json({ success: false, message: 'tenantId is required' });
    }

    const Identity = await getDynamicIdentityModelForTenantId(resolvedTenant);
    const [topLevel, attrLevel] = await Promise.all([
      Identity.distinct('department', {
        tenantId: resolvedTenant,
        department: { $nin: [null, ''] },
      }),
      Identity.distinct('attributes.department', {
        tenantId: resolvedTenant,
        'attributes.department': { $nin: [null, ''] },
      }),
    ]);

    const departments = [
      ...new Set(
        [...topLevel, ...attrLevel]
          .map((d) => String(d || '').trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    res.status(200).json({ success: true, data: departments });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load departments',
      error: error.message,
    });
  }
};

// --- GET SCHEMA FIELDS (FOR CSV MAPPING UI) ---
export const getIdentitySchemaFields = async (req, res) => {
  try {
    const excludedFields = [
      '_id', '__v', 'createdAt', 'updatedAt', 'createdBy', 'tenantId',
      'managerId', 'totalAccounts', 'totalEntitlements', 'totalRoles', 'totalViolations',
      'riskScore', 'riskLevel', 'riskFactors',
      'sourceApplication', 'sourceApplicationName', 'isCorrelated',
      'attributes', 'lastLogin', 'isActive'
    ];

    const paths = identitySchema.paths;
    const fields = [];

    // 1. Fetch standard Hardcoded Schema Fields
    for (const key in paths) {
      if (!excludedFields.includes(key)) {
        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
        const isRequired = paths[key].isRequired;

        fields.push({
          key: key,
          label: isRequired ? `${label} (Required)` : label,
          type: paths[key].instance
        });
      }
    }

    res.status(200).json({ success: true, count: fields.length, data: fields });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * ==========================================
 * 2. DYNAMIC ACCESS & ACCOUNTS (Governance)
 * ==========================================
 */

/**
 * Linked accounts for an identity: match application user collections by email.
 * Scoped to the identity's tenant and queried in parallel (sequential per-app was very slow).
 */
export const getIdentityAccounts = async (req, res) => {
  try {
    const { Identity, identity } = await resolveIdentityRecordById(req.params.id, req);
    const leanIdentity = identity ? await Identity.findById(req.params.id).select('email tenantId').lean() : null;
    if (!leanIdentity) return res.status(404).json({ success: false, message: 'Identity not found' });

    const email = leanIdentity.email ? String(leanIdentity.email).toLowerCase().trim() : '';
    const appFilter = leanIdentity.tenantId ? { tenantId: leanIdentity.tenantId } : {};
    const applications = await Application.find(appFilter).select('name type').lean();

    const tasks = applications.map(async (app) => {
      if (!email) return null;
      try {
        const DynamicUserModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
        const accountFound = await DynamicUserModel.findOne({ email }).lean();
        if (!accountFound) return null;
        return {
          applicationId: app._id,
          applicationName: app.name,
          applicationType: app.type,
          accountData: accountFound,
        };
      } catch {
        return null;
      }
    });

    const settled = await Promise.all(tasks);
    const userAccounts = settled.filter(Boolean);

    res.status(200).json({ success: true, data: userAccounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- AUTO MAPPING FEATURE ---
export const autoMapIdentity = async (req, res) => {
  try {
    res.status(200).json({ success: true, message: 'Auto-mapping triggered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// --- NUCLEAR OPTION: DELETE ALL IDENTITIES ---
export const deleteAllIdentities = async (req, res) => {
  try {
    const q = req.query.tenantId;
    const LegacyIdentity = getLegacyIdentityModel();
    let deletedCount = 0;

    if (q && mongoose.Types.ObjectId.isValid(String(q))) {
      const tenantOid = new mongoose.Types.ObjectId(String(q));
      const Identity = await getDynamicIdentityModelForTenantId(tenantOid);
      const filter = { tenantId: tenantOid };
      const [result] = await Promise.all([
        Identity.deleteMany(filter),
        LegacyIdentity.deleteMany(filter),
      ]);
      deletedCount = result.deletedCount ?? 0;
      await recomputeIdentityTenantStats(tenantOid);
    } else if (q) {
      const filter = { tenantId: q };
      const result = await LegacyIdentity.deleteMany(filter);
      deletedCount = result.deletedCount ?? 0;
    } else {
      const tenants = await Tenant.find().select("_id").lean();
      await Promise.all(
        tenants.map(async (tenant) => {
          const Identity = await getDynamicIdentityModelForTenantId(tenant._id);
          await Identity.deleteMany({});
        }),
      );
      const legacyResult = await LegacyIdentity.deleteMany({});
      deletedCount = legacyResult.deletedCount ?? 0;
    }
    res.status(200).json({
      success: true,
      message: `Successfully deleted ${deletedCount} identities.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
