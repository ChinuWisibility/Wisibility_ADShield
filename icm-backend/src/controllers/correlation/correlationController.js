import mongoose from 'mongoose';
import {
  getDynamicIdentityModelForTenantId,
} from '../../models/identity/Identity.js';
import Application from '../../models/application/Application.js';
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import OrphanAccount from '../../models/identity/OrphanAccount.js';
import { getDynamicUserModelForTenantId } from '../../models/application/Users.js';
import { syncIdentityStats } from '../../utils/syncIdentityStats.js';
import {
  scheduleSyncAllForApplication,
} from '../../utils/identityEntitlementSyncTrigger.js';
import {
  recomputeTenantCorrelationStats,
  getCachedTenantCorrelationStats,
  getLiveTenantCorrelationRollups,
} from '../../services/tenantCorrelationStatsService.js';
import { scheduleDataHygieneSummaryRecompute } from '../../services/datahygine/dataHygieneSummaryCacheService.js';
import {
  enrichOrphanRowsForDisplay,
  looksLikeMongoObjectIdStr,
} from '../../utils/datahygine/orphanAccountDisplayEnrichment.js';
import {
  loadPrivilegedEntitlementTokenSet,
  resolveOrphanTrustFromAccountDoc,
} from '../../utils/datahygine/orphanAccountTrust.js';
import { resolveUncorrelatedTrustMapping } from '../../services/datahygine/uncorrelatedTrustMappingResolver.js';
import { evaluateGovernanceOrphan } from '../../utils/correlationGovernance.js';
import { buildOrphanMatchedUserLookup, matchedUserForOrphanRow } from '../../utils/isoOrphanQueueDigest.js';
import {
  resolveApplicationAccountDisplayName,
  getPrimaryKeyValueFromAccountDoc,
} from '../../utils/identityProfileMappingUtils.js';
import {
  orphanDocumentFilter,
  orphanPurgeFilter,
  buildOrphanUpsertOp,
} from './orphanAccountPersistence.js';
import {
  loadDuplicatePrimaryKeyNormalizedSet,
  normalizePrimaryKeyValue,
} from '../../services/applicationUserIngestService.js';
import {
  getDynamicValue,
  getIdentityFieldValue,
  identityTargetKeyToMongoPath,
} from '../../utils/correlationIdentityFields.js';

const ORPHAN_APP_POPULATE =
  'name type userMappings lastManualCorrelation tenantId';

const MANUAL_CORR_BULK = Number(process.env.CORRELATION_MANUAL_BULK_CHUNK ?? 400);
const ISO_ORPHAN_FULL_PAGE = Number(process.env.ISO_ORPHAN_FULL_PAGE ?? 500);

/** API row shape shared by GET /orphans and ISO full export. */
function mapEnrichedOrphansToClientRows(enriched) {
  return enriched.map((row) => {
    const app = row.applicationId;
    const lm = app && typeof app === "object" ? app.lastManualCorrelation : null;
    const ruleList = Array.isArray(lm?.rules) ? lm.rules : [];
    const identityKeyAttr = lm?.identityAttribute ? String(lm.identityAttribute).trim() : "";
    const accountKeyAttr = lm?.accountAttribute ? String(lm.accountAttribute).trim() : "";
    let matchRuleDisplay = null;
    let matchRuleTooltip =
      "Set identity ↔ account attributes via Identity & account correlation.";
    if (ruleList.length > 0) {
      const parts = ruleList
        .slice()
        .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
        .map((r) => {
          const ia = r.identityAttribute ? String(r.identityAttribute).trim() : "";
          const aa = r.accountAttribute ? String(r.accountAttribute).trim() : "";
          return ia && aa ? `${ia} → ${aa}` : "";
        })
        .filter(Boolean);
      if (parts.length) {
        matchRuleDisplay = parts.join(" · ");
        matchRuleTooltip = `Manual correlation rules (priority order): ${parts.join("; ")}`;
      }
    } else if (identityKeyAttr && accountKeyAttr) {
      matchRuleDisplay = `${identityKeyAttr} → ${accountKeyAttr}`;
      matchRuleTooltip = `Manual correlation rule configured for this application: ${identityKeyAttr} → ${accountKeyAttr}`;
    }
    const hasRule = Boolean(matchRuleDisplay);
    return {
      ...row,
      identityKeyAttr: identityKeyAttr || null,
      accountKeyAttr: accountKeyAttr || null,
      matchRuleDisplay: hasRule ? matchRuleDisplay : null,
      matchRuleTooltip,
      lastActivityAt: row.updatedAt || row.detectedAt,
      trustLevel: row.trustLevel || row.riskLevel || null,
      riskLevel: row.trustLevel || row.riskLevel || null,
      accountStatus: row.accountStatus || null,
      hasPrivilegedEntitlement: Boolean(row.hasPrivilegedEntitlement),
      trustScenario: row.trustScenario || null,
      configuredTrustLevel: row.configuredTrustLevel || row.trustLevel || row.riskLevel || null,
      trustReason: Array.isArray(row.trustReason) ? row.trustReason : [],
      trustTooltipLines: Array.isArray(row.trustTooltipLines) ? row.trustTooltipLines : [],
      trustAnalysisLines: Array.isArray(row.trustAnalysisLines) ? row.trustAnalysisLines : [],
      trustSummary: row.trustSummary || null,
      appliedTrustMappingLabel: row.appliedTrustMappingLabel || null,
      appliedTrustMappingLine: row.appliedTrustMappingLine || null,
      trustScenarioLabel: row.trustScenarioLabel || null,
      privilegedEntitlements: Array.isArray(row.privilegedEntitlements)
        ? row.privilegedEntitlements
        : [],
      normalEntitlements: Array.isArray(row.normalEntitlements) ? row.normalEntitlements : [],
    };
  });
}

// --- HELPER FUNCTIONS ---

function toAppOid(appId) {
  return mongoose.Types.ObjectId.isValid(appId) ? new mongoose.Types.ObjectId(String(appId)) : appId;
}

/** Scope dynamic app user rows to this Application (ObjectId or legacy string `applicationId`). */
function applicationUserScopeFilter(appOid) {
  const oid = toAppOid(appOid);
  return {
    $or: [{ applicationId: oid }, { applicationId: String(oid) }],
  };
}

/**
 * Descriptive correlation metadata for search/ISO display.
 * NOT document identity — multiple accounts may share the same key (e.g. service accounts).
 */
function normalizeCorrelationKey(accountValue, accountIdStr) {
  const aid = String(accountIdStr);
  if (accountValue != null && String(accountValue).trim() !== '') {
    return `v:${String(accountValue).trim().toLowerCase()}`;
  }
  return `aid:${aid}`;
}

const MAX_MANUAL_CORRELATION_RULES = Number(process.env.CORRELATION_MANUAL_MAX_RULES ?? 12);

/**
 * @param {object} body
 * @returns {{ rules: { identityAttribute: string, accountAttribute: string, priority: number }[] } | { error: string }}
 */
function parseCorrelationRulesFromRequestBody(body) {
  const rawRules = body?.rules;
  if (Array.isArray(rawRules) && rawRules.length > 0) {
    const out = [];
    for (let i = 0; i < rawRules.length; i++) {
      const r = rawRules[i];
      if (!r || typeof r !== "object") continue;
      const identityAttribute = String(r.identityAttribute ?? r.identityAttr ?? "").trim();
      const accountAttribute = String(r.accountAttribute ?? r.appAttr ?? "").trim();
      let priority = Number(r.priority);
      if (!Number.isFinite(priority)) priority = i + 1;
      priority = Math.floor(priority);
      if (!identityAttribute || !accountAttribute) continue;
      out.push({ identityAttribute, accountAttribute, priority });
    }
    if (out.length === 0) {
      return {
        error:
          "Each rule needs identityAttribute (or identityAttr) and accountAttribute (or appAttr).",
      };
    }
    if (out.length > MAX_MANUAL_CORRELATION_RULES) {
      return { error: `At most ${MAX_MANUAL_CORRELATION_RULES} correlation rules allowed.` };
    }
    out.sort((a, b) => a.priority - b.priority || String(a.identityAttribute).localeCompare(b.identityAttribute));
    const seen = new Set();
    const deduped = [];
    for (const r of out) {
      const k = `${r.identityAttribute}\0${r.accountAttribute}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(r);
    }
    const normalized = deduped.map((r, idx) => ({
      identityAttribute: r.identityAttribute,
      accountAttribute: r.accountAttribute,
      priority: idx + 1,
    }));
    return { rules: normalized };
  }

  const identityAttribute = String(body?.identityAttribute || "").trim();
  const accountAttribute = String(body?.accountAttribute || "").trim();
  if (!identityAttribute || !accountAttribute) {
    return {
      error: "Provide rules[] or both identityAttribute and accountAttribute for a single rule.",
    };
  }
  return {
    rules: [{ identityAttribute, accountAttribute, priority: 1 }],
  };
}

function getAccountFieldValueForCorrelation(account, accountAttribute) {
  if (!account) return undefined;
  let accountValue = getDynamicValue(account, accountAttribute);
  if (!accountValue && account.rawData) {
    accountValue = getDynamicValue(account.rawData, accountAttribute);
  }
  return accountValue;
}

/**
 * Try correlation rules in priority order (first match wins).
 * @param {object} account — lean app user row
 * @param {{ identityAttribute: string, accountAttribute: string, priority: number }[]} rules
 * @param {Map<string, Map<string, import('mongoose').Types.ObjectId[]>>} identityMapsByAttr
 */
function trySequentialCorrelationRules(account, rules, identityMapsByAttr) {
  let ambiguousForWinner = false;
  let lastNonEmptyAccountValue = null;

  for (const rule of rules) {
    const accountValue = getAccountFieldValueForCorrelation(account, rule.accountAttribute);
    if (!accountValue) continue;
    lastNonEmptyAccountValue = accountValue;

    const lookupKey = normalizeCorrelationLookupKey(accountValue);
    const identityMap = identityMapsByAttr.get(rule.identityAttribute);
    const candidates = lookupKey && identityMap ? identityMap.get(lookupKey) : null;
    if (candidates && candidates.length > 1) ambiguousForWinner = true;

    const matchedId = candidates && candidates.length > 0 ? candidates[0] : null;
    if (matchedId) {
      return {
        outcome: "linked",
        matchedId,
        winningRule: rule,
        accountValueForDisplay: accountValue,
        ambiguous: ambiguousForWinner,
      };
    }
  }

  if (lastNonEmptyAccountValue == null) {
    return { outcome: "all_fields_empty", ambiguous: false };
  }
  return {
    outcome: "no_identity_match",
    ambiguous: false,
    orphanAccountValue: lastNonEmptyAccountValue,
  };
}

/**
 * One Identity collection pass per distinct identity-side attribute in the rule set.
 */
async function buildIdentityMapsForDistinctAttributes(tenantId, rules) {
  const distinctIdentityAttrs = [...new Set(rules.map((r) => r.identityAttribute))];
  const identityMapsByAttr = new Map();
  let lifecycleById = new Map();
  for (let i = 0; i < distinctIdentityAttrs.length; i++) {
    const attr = distinctIdentityAttrs[i];
    const { map, lifecycleById: lc } = await buildManualCorrelationIdentityMapAndLifecycle(tenantId, attr);
    identityMapsByAttr.set(attr, map);
    if (i === 0) lifecycleById = lc;
  }
  return { identityMapsByAttr, lifecycleById };
}

function normalizeCorrelationLookupKey(val) {
  if (val == null) return '';
  return String(val).trim().toLowerCase();
}

/**
 * One streaming pass: map normalized key -> ObjectId[] (duplicates = multiple identities with same key).
 * Includes ALL lifecycle states — matching is lifecycle-agnostic; governance runs after (see correlationGovernance).
 */
async function buildManualCorrelationIdentityMapAndLifecycle(tenantId, identityAttribute) {
  const tid = mongoose.Types.ObjectId.isValid(String(tenantId))
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tid);

  const map = new Map();
  const lifecycleById = new Map();
  const cursor = Identity.find({ tenantId: tid })
    .lean()
    .cursor({ batchSize: 5000 });

  for await (const idn of cursor) {
    lifecycleById.set(String(idn._id), idn.lifecycleState);
    const raw = getIdentityFieldValue(idn, identityAttribute);
    const k = normalizeCorrelationLookupKey(raw);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(idn._id);
  }
  return { map, lifecycleById };
}

async function flushManualCorrelationBulks({ linkUpserts, orphanUpserts, linkDeletes }) {
  const tasks = [];
  if (linkUpserts.length) {
    tasks.push(IdentityAccountLink.bulkWrite(linkUpserts, { ordered: false }));
  }
  if (orphanUpserts.length) {
    tasks.push(OrphanAccount.bulkWrite(orphanUpserts, { ordered: false }));
  }
  if (linkDeletes.length) {
    tasks.push(IdentityAccountLink.bulkWrite(linkDeletes, { ordered: false }));
  }
  if (tasks.length) await Promise.all(tasks);
}

async function handleOrphan(
  tenantId,
  appId,
  account,
  accountIdStr,
  accountValueForCorrelation,
  userMappings,
  privilegedTokenSet = new Set(),
  trustMapping = null,
) {
  const appOid = toAppOid(appId);
  const aid = String(accountIdStr);
  const correlationKey = normalizeCorrelationKey(accountValueForCorrelation, aid);
  const displayName = resolveApplicationAccountDisplayName(account, userMappings, aid);
  const { trustLevel } = resolveOrphanTrustFromAccountDoc(account, privilegedTokenSet, {
    trustMapping,
  });

  // Identity: (applicationId, accountId) — correlationKey is metadata only.
  await OrphanAccount.findOneAndUpdate(
    orphanDocumentFilter(appOid, aid),
    {
      $set: {
        tenantId,
        applicationId: appOid,
        accountId: aid,
        accountName: displayName || '',
        correlationKey,
        status: 'OPEN',
        riskLevel: trustLevel,
        lastLoginAt: account.lastLogin || null,
      },
      $setOnInsert: { detectedAt: new Date() },
    },
    { upsert: true }
  );

  await IdentityAccountLink.findOneAndDelete({ applicationId: appOid, accountId: aid });
}

// --- CONTROLLERS ---

/**
 * Endpoint for the UI to fetch Target Application fields dynamically.
 * Eliminates the need for CSVs.
 */
export const getTargetApplicationFields = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const app = await Application.findById(applicationId);
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const DynamicAccountModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);
    
    // Extract paths, rigorously filtering out Mongo internals, timestamps, and raw CSV data
    const schemaPaths = Object.keys(DynamicAccountModel.schema.paths)
      .filter(path => {
        const isInternal = path.startsWith('_'); // Hides _id, __v
        const isTimestamp = path === 'createdAt' || path === 'updatedAt';
        const isRawData = path === 'rawData' || path.startsWith('rawData.'); // Hides CSV fields
        const isAppId = path === 'applicationId'; 
        
        return !isInternal && !isTimestamp && !isRawData && !isAppId;
      })
      .sort(); // Sorts them alphabetically for a cleaner UI experience

    res.status(200).json({ success: true, fields: schemaPaths });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const PREVIEW_MAX_LINKED_SAMPLES = 12;
const PREVIEW_MAX_MISSING_FIELD_SAMPLES = 8;
const PREVIEW_MAX_UNMATCHED_SAMPLES = 12;

/**
 * Dry-run the same manual correlation pass as POST /correlation/run/:applicationId — no DB writes.
 * Returns aggregate counts and small samples so users can validate the rule before running it.
 */
export const previewManualCorrelationForApp = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const parsed = parseCorrelationRulesFromRequestBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const { rules } = parsed;
    const primaryIdentityAttr = rules[0].identityAttribute;
    const primaryAccountAttr = rules[0].accountAttribute;

    const app = await Application.findById(applicationId).lean();
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const tenantId = app.tenantId;
    const appOid = toAppOid(app._id);
    const DynamicAccountModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);

    const { identityMapsByAttr } = await buildIdentityMapsForDistinctAttributes(tenantId, rules);

    const primaryMap = identityMapsByAttr.get(primaryIdentityAttr);
    let identitiesWithComparableKey = 0;
    if (primaryMap) {
      for (const [, ids] of primaryMap) {
        identitiesWithComparableKey += ids.length;
      }
    }

    const perRuleIdentityStats = [];
    for (const r of rules) {
      const m = identityMapsByAttr.get(r.identityAttribute);
      let sumIds = 0;
      if (m) {
        for (const [, ids] of m) {
          sumIds += ids.length;
        }
      }
      perRuleIdentityStats.push({
        priority: r.priority,
        identityAttribute: r.identityAttribute,
        accountAttribute: r.accountAttribute,
        identitiesWithComparableKey: sumIds,
        distinctLookupKeys: m ? m.size : 0,
      });
    }

    const linkedByRulePriority = {};
    let totalAccounts = 0;
    let wouldLink = 0;
    let wouldOrphanMissingAccountField = 0;
    let wouldOrphanNoIdentityMatch = 0;
    let ambiguousIdentityMatches = 0;

    const linkedTuples = [];
    const missingFieldTuples = [];
    const unmatchedTuples = [];
    const duplicatePkTuples = [];

    const duplicatePkSet = await loadDuplicatePrimaryKeyNormalizedSet(app._id);
    let skippedDuplicatePrimaryKey = 0;

    let accountCursor;
    try {
      accountCursor = DynamicAccountModel.find(applicationUserScopeFilter(appOid))
        .lean()
        .cursor({ batchSize: 2000 });
    } catch (err) {
      console.error('[Manual correlation preview] Failed to open account cursor:', err);
      return res.status(400).json({ success: false, message: 'No accounts found to preview.' });
    }

    for await (const account of accountCursor) {
      totalAccounts += 1;
      const accountIdStr = String(account._id || account.id);
      const accountDisplayName = resolveApplicationAccountDisplayName(account, app.userMappings, accountIdStr);

      const pkRaw = getPrimaryKeyValueFromAccountDoc(account, app.userMappings || []);
      const pkN = normalizePrimaryKeyValue(pkRaw);
      if (pkN && duplicatePkSet.has(pkN)) {
        skippedDuplicatePrimaryKey += 1;
        if (duplicatePkTuples.length < PREVIEW_MAX_MISSING_FIELD_SAMPLES) {
          duplicatePkTuples.push({
            accountId: accountIdStr,
            accountDisplayName: accountDisplayName || '',
            reason: 'ambiguous_duplicate_application_pk',
          });
        }
        continue;
      }

      const match = trySequentialCorrelationRules(account, rules, identityMapsByAttr);

      if (match.outcome === 'all_fields_empty') {
        wouldOrphanMissingAccountField += 1;
        if (missingFieldTuples.length < PREVIEW_MAX_MISSING_FIELD_SAMPLES) {
          missingFieldTuples.push({
            accountId: accountIdStr,
            accountDisplayName: accountDisplayName || '',
          });
        }
        continue;
      }

      if (match.outcome === 'linked') {
        wouldLink += 1;
        const pr = match.winningRule.priority;
        linkedByRulePriority[pr] = (linkedByRulePriority[pr] || 0) + 1;
        if (match.ambiguous) ambiguousIdentityMatches += 1;
        if (linkedTuples.length < PREVIEW_MAX_LINKED_SAMPLES) {
          linkedTuples.push({
            matchedId: String(match.matchedId),
            accountId: accountIdStr,
            accountDisplayName: accountDisplayName || '',
            targetFieldValue:
              match.accountValueForDisplay != null ? String(match.accountValueForDisplay).trim() : '',
            matchedRulePriority: match.winningRule.priority,
            matchedIdentityAttribute: match.winningRule.identityAttribute,
            matchedAccountAttribute: match.winningRule.accountAttribute,
          });
        }
        continue;
      }

      wouldOrphanNoIdentityMatch += 1;
      if (unmatchedTuples.length < PREVIEW_MAX_UNMATCHED_SAMPLES) {
        unmatchedTuples.push({
          accountId: accountIdStr,
          accountDisplayName: accountDisplayName || '',
          targetFieldValue:
            match.orphanAccountValue != null ? String(match.orphanAccountValue).trim() : '',
        });
      }
    }

    const matchedOidList = [...new Set(linkedTuples.map((t) => t.matchedId))]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    /** Full documents so getIdentityFieldValue can read attributes.* (preview was empty with a narrow .select()). */
    const Identity = await getDynamicIdentityModelForTenantId(tenantId);
    const idBriefs =
      matchedOidList.length > 0 ? await Identity.find({ _id: { $in: matchedOidList } }).lean() : [];
    const byId = new Map(idBriefs.map((d) => [String(d._id), d]));

    const sampleLinked = linkedTuples.map((t) => {
      const idn = byId.get(t.matchedId);
      const idAttr = t.matchedIdentityAttribute || primaryIdentityAttr;
      const identityFieldValue = idn ? getIdentityFieldValue(idn, idAttr) : '';
      return {
        accountId: t.accountId,
        accountDisplayName: t.accountDisplayName,
        targetFieldValue: t.targetFieldValue,
        identityId: t.matchedId,
        identityDisplayName:
          idn?.displayName ||
          [idn?.firstName, idn?.lastName].filter(Boolean).join(' ').trim() ||
          idn?.email ||
          t.matchedId,
        identityFieldValue: identityFieldValue != null ? String(identityFieldValue) : '',
        matchedRulePriority: t.matchedRulePriority,
        matchedIdentityAttribute: t.matchedIdentityAttribute,
        matchedAccountAttribute: t.matchedAccountAttribute,
      };
    });

    res.status(200).json({
      success: true,
      preview: {
        applicationId: String(app._id),
        applicationName: app.name,
        rules,
        identityAttribute: primaryIdentityAttr,
        accountAttribute: primaryAccountAttr,
        identitiesWithComparableKey,
        distinctLookupKeys: primaryMap ? primaryMap.size : 0,
        perRuleIdentityStats,
        linkedByRulePriority,
        totalAccounts,
        wouldCreateLinks: wouldLink,
        wouldFlagOrphansMissingTargetField: wouldOrphanMissingAccountField,
        wouldFlagOrphansNoIdentityMatch: wouldOrphanNoIdentityMatch,
        ambiguousIdentityMatches,
        skippedDuplicatePrimaryKey,
        sampleDuplicatePrimaryKey: duplicatePkTuples,
        sampleLinked,
        sampleMissingTargetField: missingFieldTuples,
        sampleNoIdentityMatch: unmatchedTuples,
      },
    });
  } catch (error) {
    console.error('[Manual correlation preview] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 1. RUN CORRELATION ENGINE FOR AN APP (Dynamic & Safe Version)
export const runCorrelationForApp = async (req, res) => {
  try {
    const { applicationId } = req.params;
    const parsed = parseCorrelationRulesFromRequestBody(req.body);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const { rules } = parsed;
    const primaryIdentityAttr = rules[0].identityAttribute;
    const primaryAccountAttr = rules[0].accountAttribute;

    const app = await Application.findById(applicationId).lean();
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const tenantId = app.tenantId;
    const appOid = toAppOid(app._id);
    const DynamicAccountModel = await getDynamicUserModelForTenantId(app.name, app.tenantId);

    const { identityMapsByAttr, lifecycleById } = await buildIdentityMapsForDistinctAttributes(
      tenantId,
      rules,
    );

    let linkedCount = 0;
    let orphanCount = 0;
    let accountsProcessed = 0;
    let skippedDuplicatePrimaryKey = 0;
    const modifiedIdentities = new Set();

    const duplicatePkSet = await loadDuplicatePrimaryKeyNormalizedSet(app._id);
    const privilegedTokenSet = await loadPrivilegedEntitlementTokenSet(
      appOid,
      app.name,
      tenantId,
    );
    let tenantTrustMapping = null;
    try {
      const resolved = await resolveUncorrelatedTrustMapping(tenantId);
      tenantTrustMapping = resolved.effectiveMapping;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Manual correlation] Could not load trust mapping; using defaults:',
        e?.message || e,
      );
    }

    const linkUpserts = [];
    const orphanUpserts = [];
    const linkDeletes = [];
    const orphanPurgeAccountIds = [];

    const flushOrphanPurges = async () => {
      if (!orphanPurgeAccountIds.length) return;
      const aids = orphanPurgeAccountIds.splice(0, orphanPurgeAccountIds.length);
      // Purge by accountId only — shared correlationKey must not delete sibling orphans.
      await OrphanAccount.deleteMany(orphanPurgeFilter(appOid, aids));
    };

    const queueOrphanPurgeForMatch = (accountIdStr) => {
      orphanPurgeAccountIds.push(accountIdStr);
    };

    const maybeFlush = async () => {
      const n = linkUpserts.length + orphanUpserts.length + linkDeletes.length;
      if (n >= MANUAL_CORR_BULK) {
        await flushManualCorrelationBulks({
          linkUpserts: linkUpserts.splice(0, linkUpserts.length),
          orphanUpserts: orphanUpserts.splice(0, orphanUpserts.length),
          linkDeletes: linkDeletes.splice(0, linkDeletes.length),
        });
      }
      if (orphanPurgeAccountIds.length >= 500) {
        await flushOrphanPurges();
      }
    };

    const pushOrphanUpsert = (account, accountIdStr, accountDisplayName, correlationKey) => {
      const { trustLevel } = resolveOrphanTrustFromAccountDoc(account, privilegedTokenSet, {
        trustMapping: tenantTrustMapping,
      });
      orphanUpserts.push(
        buildOrphanUpsertOp({
          applicationId: appOid,
          tenantId,
          accountId: accountIdStr,
          accountName: accountDisplayName,
          correlationKey,
          lastLoginAt: account.lastLogin || null,
          riskLevel: trustLevel,
        }),
      );
    };

    let accountCursor;
    try {
      // Never scan the whole collection: unrelated/stale rows (missing or mismatched `applicationId`)
      // inflated totalProcessed (e.g. 2× after re-import) while Overview still showed `totalUsers` from the Application doc.
      accountCursor = DynamicAccountModel.find(applicationUserScopeFilter(appOid))
        .lean()
        .cursor({ batchSize: 2000 });
    } catch (err) {
      console.error('[Manual correlation] Failed to open account cursor:', err);
      return res.status(400).json({ success: false, message: 'No accounts found to correlate.' });
    }

    for await (const account of accountCursor) {
      accountsProcessed += 1;
      const accountIdStr = String(account._id || account.id);
      const accountDisplayName = resolveApplicationAccountDisplayName(account, app.userMappings, accountIdStr);

      const pkRaw = getPrimaryKeyValueFromAccountDoc(account, app.userMappings || []);
      const pkN = normalizePrimaryKeyValue(pkRaw);
      if (pkN && duplicatePkSet.has(pkN)) {
        skippedDuplicatePrimaryKey += 1;
        linkDeletes.push({
          deleteOne: { filter: { applicationId: app._id, accountId: accountIdStr } },
        });
        await maybeFlush();
        continue;
      }

      const match = trySequentialCorrelationRules(account, rules, identityMapsByAttr);

      if (match.outcome === 'all_fields_empty') {
        orphanCount += 1;
        const correlationKey = normalizeCorrelationKey(null, accountIdStr);
        pushOrphanUpsert(account, accountIdStr, accountDisplayName, correlationKey);
        linkDeletes.push({
          deleteOne: { filter: { applicationId: app._id, accountId: accountIdStr } },
        });
        await maybeFlush();
        continue;
      }

      if (match.outcome === 'linked') {
        const matchedId = match.matchedId;
        const winningRule = match.winningRule;
        const accountValue = match.accountValueForDisplay;
        linkedCount += 1;
        modifiedIdentities.add(String(matchedId));
        const ls = lifecycleById.get(String(matchedId));
        const gov = evaluateGovernanceOrphan({ lifecycleState: ls }, account);
        linkUpserts.push({
          updateOne: {
            filter: { applicationId: app._id, accountId: accountIdStr },
            update: {
              $set: {
                tenantId,
                identityId: matchedId,
                accountName:
                  accountDisplayName ||
                  (accountValue != null && String(accountValue).trim() !== ''
                    ? String(accountValue).trim()
                    : ''),
                correlationMethod: 'MANUAL',
                correlationScore: 100,
                correlationStatus: 'correlated',
                correlationConfidence: 'high',
                isOrphan: gov.isOrphan,
                orphanReason: gov.orphanReason || null,
                // Link enablement is independent of account STATUS. Deriving isActive from
                // account.status hid identity-active / account-inactive pairs from hygiene.
                isActive: true,
                lastVerifiedAt: new Date(),
                correlationIdentityAttribute: winningRule.identityAttribute,
                correlationAccountAttribute: winningRule.accountAttribute,
                correlationRulePriority: winningRule.priority,
                correlationMatchDisplay:
                  accountValue != null && String(accountValue).trim() !== ''
                    ? String(accountValue).trim()
                    : undefined,
              },
            },
            upsert: true,
          },
        });
        // Collapse legacy duplicate links (native id / same match display) for this identity+app.
        if (matchedId && accountValue != null && String(accountValue).trim() !== '') {
          const md = String(accountValue).trim();
          linkUpserts.push({
            updateMany: {
              filter: {
                identityId: matchedId,
                applicationId: app._id,
                accountId: { $ne: accountIdStr },
                $or: [{ correlationMatchDisplay: md }, { accountId: md }],
              },
              update: {
                $set: {
                  isActive: false,
                  remediationStatus: 'superseded_by_correlation',
                  lastVerifiedAt: new Date(),
                },
              },
            },
          });
        }
        queueOrphanPurgeForMatch(accountIdStr, accountValue);
        queueOrphanPurgeForMatch(accountIdStr);
        await maybeFlush();
        continue;
      }

      orphanCount += 1;
      const orphanVal = match.orphanAccountValue;
      const correlationKey = normalizeCorrelationKey(orphanVal, accountIdStr);
      pushOrphanUpsert(account, accountIdStr, accountDisplayName, correlationKey);
      linkDeletes.push({
        deleteOne: { filter: { applicationId: app._id, accountId: accountIdStr } },
      });
      await maybeFlush();
    }

    await flushManualCorrelationBulks({ linkUpserts, orphanUpserts, linkDeletes });
    await flushOrphanPurges();

    let liveUserCount = accountsProcessed;
    try {
      liveUserCount = await DynamicAccountModel.countDocuments(applicationUserScopeFilter(appOid));
    } catch (e) {
      console.warn('[Manual correlation] countDocuments failed:', e.message);
    }

    await Application.findByIdAndUpdate(applicationId, {
      totalUsers: liveUserCount,
      lastManualCorrelationAt: new Date(),
      lastManualCorrelation: {
        identityAttribute: primaryIdentityAttr,
        accountAttribute: primaryAccountAttr,
        rules,
        totalProcessed: accountsProcessed,
        newlyLinked: linkedCount,
        orphansDetected: orphanCount,
        skippedDuplicatePrimaryKey,
      },
    });

    res.status(200).json({
      success: true,
      message: `Manual correlation complete for ${app.name}`,
      results: {
        totalProcessed: accountsProcessed,
        newlyLinked: linkedCount,
        orphansDetected: orphanCount,
        skippedDuplicatePrimaryKey,
        rules,
      },
    });

    setImmediate(() => {
      void recomputeTenantCorrelationStats(tenantId);
    });
    scheduleDataHygieneSummaryRecompute(tenantId);
    void import("../../services/datahygine/hygieneRollupService.js").then((mod) =>
      mod.emitHygieneDirty({
        tenantId,
        applicationId,
        widgetIds: [...mod.DEFAULT_APP_DIRTY_WIDGETS],
        reason: "manual_correlation",
      }),
    );
    void import("../../services/datahygine/applicationManagerMismatchSidecar.js").then((mod) => {
      mod.scheduleManagerMismatchSidecarRebuild(applicationId, tenantId, {
        skipDirtyEmit: true,
      });
    });
    void import("../../services/datahygine/applicationStatusMismatchSidecar.js").then((mod) => {
      mod.scheduleStatusMismatchSidecarRebuild(applicationId, tenantId, {
        skipDirtyEmit: true,
      });
    });

    // syncAllForApplication already rebuilds every identity×account for this app.
    // Do NOT also scheduleSyncForIdentities — that duplicated full catalog scans + per-identity work.
    scheduleSyncAllForApplication(applicationId);

    // Defer and run sequentially so we don't pin the Mongo pool with N parallel
    // syncIdentityStats calls (each touches every application collection).
    const idsToSync = Array.from(modifiedIdentities);
    setImmediate(() => {
      void (async () => {
        let applications;
        try {
          applications = await Application.find().lean();
        } catch (e) {
          console.error('[Manual correlation] Failed to load applications for stats sync:', e);
          return;
        }
        for (const id of idsToSync) {
          await syncIdentityStats(id, { applications });
        }
      })();
    });
  } catch (error) {
    console.error('[CRITICAL] Manual Correlation Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** UI / filter buckets: AUTO (engine), MANUAL, RULE_BASED (unknown / future). */
function normalizeCorrelationType(method) {
  if (method == null || method === "") return "RULE_BASED";
  const m = String(method).toUpperCase();
  if (m === "MANUAL") return "MANUAL";
  if (["EMAIL", "EMPLOYEE_ID", "AI"].includes(m)) return "AUTO";
  return "RULE_BASED";
}

function mapCorrelatedAggregationRow(r) {
  const lm = r.lastManualCorrelation;
  const identityAttr = r.correlationIdentityAttribute || lm?.identityAttribute;
  const accountAttr = r.correlationAccountAttribute || lm?.accountAttribute;
  const correlationKeyLabel =
    identityAttr && accountAttr
      ? `${identityAttr} → ${accountAttr}`
      : r.correlationMethod
        ? String(r.correlationMethod)
        : "—";
  const identityLabel =
    r.identityDisplayName ||
    [r.firstName, r.lastName].filter(Boolean).join(" ").trim() ||
    "—";
  const rulePri = typeof r.correlationRulePriority === "number" ? r.correlationRulePriority : null;
  const baseTooltip =
    identityAttr && accountAttr
      ? `Matched using rule: ${identityAttr} → ${accountAttr}`
      : `Matched using rule: ${correlationKeyLabel}`;
  const matchRuleTooltip =
    rulePri != null ? `${baseTooltip} (priority ${rulePri})` : baseTooltip;
  const lifecycle = r.identityLifecycleState != null ? String(r.identityLifecycleState) : null;
  const govOrphan = Boolean(r.governanceOrphan);
  return {
    _id: r.linkId,
    linkId: r.linkId,
    identityId: r.identityId,
    identityLabel,
    identityDisplayName: r.identityDisplayName,
    firstName: r.firstName,
    lastName: r.lastName,
    identityAttributes: r.identityAttributes || {},
    identityLifecycleState: lifecycle,
    applicationId: r.applicationId,
    applicationName: r.applicationName || "—",
    applicationType: r.applicationType,
    accountId: r.accountId,
    accountName: r.accountName,
    correlationMethod: r.correlationMethod,
    correlationScore: r.correlationScore,
    correlationKeyLabel,
    identityKeyAttr: identityAttr || null,
    accountKeyAttr: accountAttr || null,
    matchRuleDisplay: correlationKeyLabel,
    matchRuleTooltip,
    correlationRulePriority:
      typeof r.correlationRulePriority === "number" ? r.correlationRulePriority : null,
    correlationType: normalizeCorrelationType(r.correlationMethod),
    confidenceLevel: "HIGH",
    lastVerifiedAt: r.lastVerifiedAt,
    correlationStatus: r.correlationStatus || "correlated",
    correlationConfidence: r.correlationConfidence || "high",
    governanceOrphan: govOrphan,
    orphanReason: r.orphanReason || null,
  };
}

/**
 * Prefer tenantId on the link (IXSCAN). Fall back to identity join only when the tenant
 * has zero denormalized links (pre-backfill legacy data).
 */
function buildCorrelatedAccountsFilterStages(tid, { applicationId, correlationType, q, identityIdsForSearch, useTenantScoped }) {
  const linkMatch = {
    isActive: true,
    identityId: { $exists: true, $ne: null },
  };
  if (useTenantScoped) {
    linkMatch.tenantId = tid;
  }

  if (applicationId && mongoose.Types.ObjectId.isValid(String(applicationId))) {
    linkMatch.applicationId = new mongoose.Types.ObjectId(String(applicationId));
  }
  if (correlationType === "AUTO") {
    linkMatch.correlationMethod = { $in: ["EMAIL", "EMPLOYEE_ID", "AI"] };
  } else if (correlationType === "MANUAL") {
    linkMatch.correlationMethod = "MANUAL";
  } else if (correlationType === "RULE_BASED") {
    linkMatch.$or = [
      { correlationMethod: { $exists: false } },
      { correlationMethod: null },
      { correlationMethod: { $nin: ["EMAIL", "EMPLOYEE_ID", "AI", "MANUAL"] } },
    ];
  }

  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const searchOr = [{ accountName: rx }];
    if (Array.isArray(identityIdsForSearch) && identityIdsForSearch.length) {
      searchOr.push({ identityId: { $in: identityIdsForSearch } });
    }
    linkMatch.$and = [...(linkMatch.$and || []), { $or: searchOr }];
  }

  const stages = [{ $match: linkMatch }];

  if (!useTenantScoped) {
    // Legacy path: join identities then filter by tenant (slow — avoid after backfill).
    stages.push(
      {
        $lookup: {
          from: "identities",
          localField: "identityId",
          foreignField: "_id",
          as: "identityArr",
        },
      },
      { $unwind: { path: "$identityArr", preserveNullAndEmptyArrays: false } },
      { $match: { "identityArr.tenantId": tid } },
    );
    if (q && !identityIdsForSearch) {
      const rx = new RegExp(escapeRegex(q), "i");
      stages.push({
        $match: {
          $or: [
            { "identityArr.displayName": rx },
            { "identityArr.email": rx },
            { "identityArr.employeeId": rx },
            { accountName: rx },
          ],
        },
      });
    }
  }

  return stages;
}

/**
 * Paginate first, then enrich only the page (identity + application lookups).
 */
function correlatedAccountsDataPageStages(skip, limit, { identityAlreadyJoined = false } = {}) {
  const stages = [
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: limit },
  ];

  if (!identityAlreadyJoined) {
    stages.push(
      {
        $lookup: {
          from: "identities",
          localField: "identityId",
          foreignField: "_id",
          pipeline: [
            {
              $project: {
                displayName: 1,
                firstName: 1,
                lastName: 1,
                attributes: 1,
                lifecycleState: 1,
              },
            },
          ],
          as: "identityArr",
        },
      },
      { $unwind: { path: "$identityArr", preserveNullAndEmptyArrays: true } },
    );
  }

  stages.push(
    {
      $lookup: {
        from: "applications",
        localField: "applicationId",
        foreignField: "_id",
        pipeline: [
          {
            $project: {
              name: 1,
              type: 1,
              lastManualCorrelation: 1,
            },
          },
        ],
        as: "applicationArr",
      },
    },
    { $unwind: { path: "$applicationArr", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        linkId: "$_id",
        identityId: "$identityId",
        identityDisplayName: "$identityArr.displayName",
        firstName: "$identityArr.firstName",
        lastName: "$identityArr.lastName",
        identityAttributes: "$identityArr.attributes",
        identityLifecycleState: "$identityArr.lifecycleState",
        applicationId: "$applicationId",
        applicationName: "$applicationArr.name",
        applicationType: "$applicationArr.type",
        lastManualCorrelation: "$applicationArr.lastManualCorrelation",
        accountId: "$accountId",
        accountName: "$accountName",
        correlationMethod: "$correlationMethod",
        correlationScore: "$correlationScore",
        correlationIdentityAttribute: "$correlationIdentityAttribute",
        correlationAccountAttribute: "$correlationAccountAttribute",
        correlationRulePriority: "$correlationRulePriority",
        correlationMatchDisplay: "$correlationMatchDisplay",
        correlationStatus: "$correlationStatus",
        correlationConfidence: "$correlationConfidence",
        governanceOrphan: "$isOrphan",
        orphanReason: "$orphanReason",
        lastVerifiedAt: "$lastVerifiedAt",
        updatedAt: "$updatedAt",
      },
    },
  );
  return stages;
}

async function resolveIdentityIdsForCorrelatedSearch(tid, q) {
  if (!q) return [];
  const rx = new RegExp(escapeRegex(q), "i");
  const rows = await mongoose.connection.db
    .collection("identities")
    .find({
      tenantId: tid,
      $or: [{ displayName: rx }, { email: rx }, { employeeId: rx }],
    })
    .project({ _id: 1 })
    .limit(5000)
    .toArray();
  return rows.map((r) => r._id);
}

const CORRELATED_AGG_OPTS = {
  allowDiskUse: true,
  maxTimeMS: Number(process.env.CORRELATION_LIST_MAX_MS ?? 120000),
};

/**
 * Active identity ↔ target application account links for a tenant (paginated).
 * Performance (measured): tenantId on link + sort/skip/limit before $lookup.
 * Legacy fallback joins identities when tenantId is not yet backfilled.
 */
export const getCorrelatedAccounts = async (req, res) => {
  const t0 = Date.now();
  try {
    const { tenantId } = req.query;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
      return res.status(400).json({ success: false, message: "Valid tenantId is required" });
    }
    const tid = new mongoose.Types.ObjectId(String(tenantId));
    const page = Math.max(0, parseInt(String(req.query.page ?? "0"), 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const skip = page * limit;

    const filterOpts = {
      applicationId: req.query.applicationId,
      correlationType: req.query.correlationType ? String(req.query.correlationType).toUpperCase() : "",
      q: (req.query.q || "").trim(),
    };

    const scopedLinkCount = await IdentityAccountLink.countDocuments({
      tenantId: tid,
      isActive: true,
      identityId: { $exists: true, $ne: null },
    });
    const useTenantScoped = scopedLinkCount > 0;

    let identityIdsForSearch = [];
    if (filterOpts.q && useTenantScoped) {
      identityIdsForSearch = await resolveIdentityIdsForCorrelatedSearch(tid, filterOpts.q);
    }

    const preFacet = buildCorrelatedAccountsFilterStages(tid, {
      ...filterOpts,
      identityIdsForSearch,
      useTenantScoped,
    });
    const cached = await getCachedTenantCorrelationStats(tid);
    const noFilters = !filterOpts.applicationId && !filterOpts.correlationType && !filterOpts.q;
    const useCachedTotal =
      noFilters && cached != null && typeof cached.correlatedLinksCount === "number" && cached.correlatedLinksCount >= 0;

    const needsLiveRollups =
      !cached ||
      typeof cached.correlatedLinksCount !== "number" ||
      typeof cached.distinctTargetApplicationsCount !== "number" ||
      cached.lastCorrelationRunAt == null ||
      typeof cached.totalWarehouseAccountsCount !== "number";

    const liveRollups = needsLiveRollups ? await getLiveTenantCorrelationRollups(tid) : null;
    if (needsLiveRollups && liveRollups) {
      setImmediate(() => {
        void recomputeTenantCorrelationStats(tid);
      });
      scheduleDataHygieneSummaryRecompute(tid);
    }

    const statsCorrelatedCount =
      typeof cached?.correlatedLinksCount === "number" ? cached.correlatedLinksCount : liveRollups?.correlatedLinksCount ?? null;
    const statsDistinctApps =
      typeof cached?.distinctTargetApplicationsCount === "number"
        ? cached.distinctTargetApplicationsCount
        : liveRollups?.distinctTargetApplicationsCount ?? null;
    const statsLastRun = cached?.lastCorrelationRunAt ?? liveRollups?.lastActivityAt ?? null;
    const statsWarehouse =
      typeof cached?.totalWarehouseAccountsCount === "number"
        ? cached.totalWarehouseAccountsCount
        : liveRollups?.totalWarehouseAccountsCount ?? null;

    let total;
    let rows;
    const pageStages = correlatedAccountsDataPageStages(skip, limit, {
      identityAlreadyJoined: !useTenantScoped,
    });

    if (useCachedTotal && useTenantScoped && noFilters) {
      total = cached.correlatedLinksCount;
      rows = await IdentityAccountLink.aggregate([...preFacet, ...pageStages]).option(CORRELATED_AGG_OPTS);
    } else if (useTenantScoped && noFilters) {
      total = scopedLinkCount;
      rows = await IdentityAccountLink.aggregate([...preFacet, ...pageStages]).option(CORRELATED_AGG_OPTS);
    } else if (useTenantScoped) {
      const [countArr, dataRows] = await Promise.all([
        IdentityAccountLink.aggregate([...preFacet, { $count: "total" }]).option(CORRELATED_AGG_OPTS),
        IdentityAccountLink.aggregate([...preFacet, ...pageStages]).option(CORRELATED_AGG_OPTS),
      ]);
      total = countArr[0]?.total ?? 0;
      rows = dataRows;
    } else if (useCachedTotal) {
      total = cached.correlatedLinksCount;
      rows = await IdentityAccountLink.aggregate([...preFacet, ...pageStages]).option(CORRELATED_AGG_OPTS);
    } else {
      const pipeline = [
        ...preFacet,
        {
          $facet: {
            meta: [{ $count: "total" }],
            data: pageStages,
          },
        },
      ];
      const facetResult = await IdentityAccountLink.aggregate(pipeline).option(CORRELATED_AGG_OPTS);
      const fr = facetResult[0] || { meta: [], data: [] };
      total = fr.meta[0]?.total ?? 0;
      rows = fr.data || [];
    }

    const data = rows.map(mapCorrelatedAggregationRow);
    let correlatedCoveragePercent = null;
    if (typeof statsWarehouse === "number" && statsWarehouse > 0 && typeof statsCorrelatedCount === "number") {
      correlatedCoveragePercent = Math.min(100, Math.round((statsCorrelatedCount / statsWarehouse) * 100));
    }

    const durationMs = Date.now() - t0;
    if (durationMs > 2000 || process.env.CORRELATED_ACCOUNTS_TIMING === "1") {
      console.log("[getCorrelatedAccounts]", {
        tenantId: String(tid),
        durationMs,
        useTenantScoped,
        total,
        page,
        limit,
        q: Boolean(filterOpts.q),
      });
    }

    res.status(200).json({
      success: true,
      total,
      page,
      limit,
      count: data.length,
      data,
      stats: {
        distinctTargetApplications: statsDistinctApps,
        correlatedLinksCached: statsCorrelatedCount,
        lastCorrelationRunAt: statsLastRun,
        totalWarehouseAccountsCount: typeof statsWarehouse === "number" ? statsWarehouse : null,
        correlatedCoveragePercent,
      },
      meta: { durationMs, useTenantScoped },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


export function buildOrphanListFilters(tid, { applicationId, riskLevel, q }) {
  const query = { status: "OPEN", tenantId: tid };
  if (applicationId && mongoose.Types.ObjectId.isValid(String(applicationId))) {
    query.applicationId = new mongoose.Types.ObjectId(String(applicationId));
  }
  const rl = riskLevel && String(riskLevel).trim().toUpperCase();
  if (rl && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(rl)) {
    query.riskLevel = rl;
  }
  const qq = q && String(q).trim();
  if (qq) {
    const rx = new RegExp(escapeRegex(qq), "i");
    query.$or = [{ accountName: rx }, { correlationKey: rx }, { accountId: rx }];
  }
  return query;
}

/** High-risk count for stats: same app + search scope as list filters, ignoring risk dropdown. */
function buildOrphanHighRiskScopeFilters(tid, { applicationId, q }) {
  const query = { status: "OPEN", tenantId: tid, riskLevel: { $in: ["HIGH", "CRITICAL"] } };
  if (applicationId && mongoose.Types.ObjectId.isValid(String(applicationId))) {
    query.applicationId = new mongoose.Types.ObjectId(String(applicationId));
  }
  const qq = q && String(q).trim();
  if (qq) {
    const rx = new RegExp(escapeRegex(qq), "i");
    query.$or = [{ accountName: rx }, { correlationKey: rx }, { accountId: rx }];
  }
  return query;
}

/** Same scoping as certification ISO report user population (strict applicationId, then legacy unscoped). */
export async function loadApplicationUsersLeanForIso(appId, applicationName, tenantId) {
  const UsersModel = await getDynamicUserModelForTenantId(applicationName, tenantId);
  const oid = new mongoose.Types.ObjectId(String(appId));
  const strictFilter = { applicationId: oid };
  let users = await UsersModel.find(strictFilter).sort({ createdAt: -1 }).lean();
  if (users.length === 0) {
    users = await UsersModel.find({}).sort({ createdAt: -1 }).lean();
  }
  return users;
}

/**
 * @param {import('mongoose').Types.ObjectId} tid
 * @param {string} applicationId
 * @param {{ name: string }} application — lean doc with name
 */
export async function buildOrphanIsoSummaryForApplication(tid, applicationId, application) {
  const listQuery = buildOrphanListFilters(tid, {
    applicationId,
    riskLevel: undefined,
    q: undefined,
  });
  const highRiskQuery = buildOrphanHighRiskScopeFilters(tid, { applicationId, q: undefined });

  const [total, highRiskOpenTotal, cached, distinctOrphanAppsAgg, users] = await Promise.all([
    OrphanAccount.countDocuments(listQuery),
    OrphanAccount.countDocuments(highRiskQuery),
    getCachedTenantCorrelationStats(tid),
    OrphanAccount.aggregate([
      { $match: listQuery },
      { $group: { _id: "$applicationId" } },
      { $count: "total" },
    ]),
    loadApplicationUsersLeanForIso(applicationId, application.name, application.tenantId),
  ]);

  const distinctOrphanApplicationsFiltered = distinctOrphanAppsAgg[0]?.total ?? 0;

  const normalizedUsers = (users || []).map((u) => ({
    ...u,
    rawData: u?.rawData || u?._originalData || {},
  }));
  const lookup = buildOrphanMatchedUserLookup(normalizedUsers);
  const queueMatchUserIds = new Set();
  let matchedQueueRowCount = 0;
  const cursor = OrphanAccount.find(listQuery)
    .select("_id accountId correlationKey")
    .batchSize(2000)
    .cursor();
  for await (const doc of cursor) {
    const m = matchedUserForOrphanRow(doc, lookup);
    if (m?._id != null) {
      queueMatchUserIds.add(String(m._id));
      matchedQueueRowCount += 1;
    }
  }

  return {
    total,
    matchedQueueRowCount,
    queueMatchUserIds: Array.from(queueMatchUserIds),
    stats: {
      highRiskOpenTotal,
      orphansOpenCached: cached?.orphansOpenCount ?? null,
      orphansHighRiskCached: cached?.orphansHighRiskCount ?? null,
      distinctOrphanApplicationsFiltered,
    },
    applicationUsers: normalizedUsers,
  };
}

/**
 * ISO governance: totals + cached stats + queue↔population digest for charts (no enriched orphan rows).
 */
export const getOrphanAccountsIsoSummary = async (req, res) => {
  try {
    const { tenantId: tenantIdQuery } = req.query;
    let tenantId = tenantIdQuery || req.user?.tenantId;
    if (tenantId && typeof tenantId === "object" && tenantId._id) {
      tenantId = tenantId._id;
    }
    if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
      return res.status(400).json({ success: false, message: "Valid tenantId is required" });
    }
    const tid = new mongoose.Types.ObjectId(String(tenantId));
    const { applicationId } = req.params;
    if (!applicationId || !mongoose.Types.ObjectId.isValid(String(applicationId))) {
      return res.status(400).json({ success: false, message: "Valid applicationId is required" });
    }
    const appOid = new mongoose.Types.ObjectId(String(applicationId));
    const application = await Application.findById(appOid).select("name tenantId").lean();
    if (!application?.name) {
      return res.status(404).json({ success: false, message: "Application not found" });
    }
    if (String(application.tenantId) !== String(tid)) {
      return res.status(403).json({ success: false, message: "Application not in tenant scope" });
    }

    const payload = await buildOrphanIsoSummaryForApplication(tid, applicationId, application);
    const { applicationUsers: _u, ...rest } = payload;
    res.status(200).json({
      success: true,
      ...rest,
    });
  } catch (error) {
    console.error("[getOrphanAccountsIsoSummary]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * All OPEN uncorrelated rows for one application — paged on the server so the browser
 * does not run many sequential /correlation/orphans requests on the main thread.
 */
export async function loadAllOpenOrphansForIsoReportPayload(tid, applicationId) {
  if (!applicationId || !mongoose.Types.ObjectId.isValid(String(applicationId))) {
    throw new Error("Valid applicationId is required");
  }
  const listQuery = buildOrphanListFilters(tid, {
    applicationId,
    riskLevel: undefined,
    q: undefined,
  });
  const highRiskQuery = buildOrphanHighRiskScopeFilters(tid, { applicationId, q: undefined });

  const [total, highRiskOpenTotal, cached, distinctOrphanAppsAgg] = await Promise.all([
    OrphanAccount.countDocuments(listQuery),
    OrphanAccount.countDocuments(highRiskQuery),
    getCachedTenantCorrelationStats(tid),
    OrphanAccount.aggregate([
      { $match: listQuery },
      { $group: { _id: "$applicationId" } },
      { $count: "total" },
    ]),
  ]);

  const distinctOrphanApplicationsFiltered = distinctOrphanAppsAgg[0]?.total ?? 0;

  const allData = [];
  let skip = 0;
  while (skip < total && total > 0) {
    const orphans = await OrphanAccount.find(listQuery)
      .populate("applicationId", ORPHAN_APP_POPULATE)
      .sort({ detectedAt: -1 })
      .skip(skip)
      .limit(ISO_ORPHAN_FULL_PAGE)
      .lean();
    if (!orphans.length) break;
    const enriched = await enrichOrphanRowsForDisplay(orphans);
    allData.push(...mapEnrichedOrphansToClientRows(enriched));
    skip += orphans.length;
    if (orphans.length < ISO_ORPHAN_FULL_PAGE) break;
  }

  return {
    data: allData,
    total,
    stats: {
      highRiskOpenTotal,
      orphansOpenCached: cached?.orphansOpenCount ?? null,
      orphansHighRiskCached: cached?.orphansHighRiskCount ?? null,
      distinctOrphanApplicationsFiltered,
    },
  };
}

export const getOrphanAccountsIsoFull = async (req, res) => {
  try {
    const { tenantId: tenantIdQuery } = req.query;
    let tenantId = tenantIdQuery || req.user?.tenantId;
    if (tenantId && typeof tenantId === "object" && tenantId._id) {
      tenantId = tenantId._id;
    }
    if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
      return res.status(400).json({ success: false, message: "Valid tenantId is required" });
    }
    const tid = new mongoose.Types.ObjectId(String(tenantId));
    const { applicationId } = req.params;
    const payload = await loadAllOpenOrphansForIsoReportPayload(tid, applicationId);
    res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    console.error("[getOrphanAccountsIsoFull]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getOrphanAccounts = async (req, res) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) {
      return res.status(400).json({ success: false, message: "Valid tenantId is required" });
    }
    const tid = new mongoose.Types.ObjectId(String(tenantId));
    const page = Math.max(0, parseInt(String(req.query.page ?? "0"), 10) || 0);

    const q = (req.query.q || "").trim();
    const applicationId = req.query.applicationId;
    const riskLevel = req.query.riskLevel;

    /** Larger cap when filtered to one app (ISO report, exports). Global list stays at 100. */
    const limitCap =
      applicationId && mongoose.Types.ObjectId.isValid(String(applicationId)) ? 500 : 100;
    const limit = Math.min(limitCap, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10));
    const skip = page * limit;

    const listQuery = buildOrphanListFilters(tid, { applicationId, riskLevel, q });
    const highRiskQuery = buildOrphanHighRiskScopeFilters(tid, { applicationId, q });

    const sortMode = String(req.query.sort || "detectedAt").toLowerCase();
    const useSeveritySort = sortMode === "severity" || sortMode === "risk";

    const [total, highRiskOpenTotal, cached, distinctRow, distinctOrphanAppsAgg] = await Promise.all([
      OrphanAccount.countDocuments(listQuery),
      OrphanAccount.countDocuments(highRiskQuery),
      getCachedTenantCorrelationStats(tid),
      OrphanAccount.aggregate([
        { $match: { tenantId: tid, status: "OPEN" } },
        { $group: { _id: "$applicationId" } },
        { $count: "total" },
      ]),
      OrphanAccount.aggregate([
        { $match: listQuery },
        { $group: { _id: "$applicationId" } },
        { $count: "total" },
      ]),
    ]);

    let orphans;
    if (useSeveritySort) {
      const agg = await OrphanAccount.aggregate([
        { $match: listQuery },
        {
          $addFields: {
            _riskRank: {
              $switch: {
                branches: [
                  { case: { $eq: ["$riskLevel", "CRITICAL"] }, then: 4 },
                  { case: { $eq: ["$riskLevel", "HIGH"] }, then: 3 },
                  { case: { $eq: ["$riskLevel", "MEDIUM"] }, then: 2 },
                  { case: { $eq: ["$riskLevel", "LOW"] }, then: 1 },
                ],
                default: 0,
              },
            },
          },
        },
        { $sort: { _riskRank: -1, detectedAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { _riskRank: 0 } },
      ]);
      const ids = agg.map((d) => d._id).filter(Boolean);
      if (ids.length === 0) {
        orphans = [];
      } else {
        const found = await OrphanAccount.find({ _id: { $in: ids } })
          .populate("applicationId", ORPHAN_APP_POPULATE)
          .lean();
        const docMap = new Map(found.map((d) => [String(d._id), d]));
        orphans = ids.map((id) => docMap.get(String(id))).filter(Boolean);
      }
    } else {
      orphans = await OrphanAccount.find(listQuery)
        .populate("applicationId", ORPHAN_APP_POPULATE)
        .sort({ detectedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    }

    const distinctOrphanApplicationsTenantWide = distinctRow[0]?.total ?? 0;
    const distinctOrphanApplicationsFiltered = distinctOrphanAppsAgg[0]?.total ?? 0;

    let enriched;
    try {
      enriched = await enrichOrphanRowsForDisplay(orphans);
    } catch (enrichErr) {
      // eslint-disable-next-line no-console
      console.error("[getOrphanAccounts] enrichOrphanRowsForDisplay", enrichErr);
      enriched = orphans;
    }
    const data = mapEnrichedOrphansToClientRows(enriched);

    res.status(200).json({
      success: true,
      total,
      page,
      limit,
      count: data.length,
      data,
      stats: {
        highRiskOpenTotal,
        orphansOpenCached: cached?.orphansOpenCount ?? null,
        orphansHighRiskCached: cached?.orphansHighRiskCount ?? null,
        distinctOrphanApplications: distinctOrphanApplicationsTenantWide,
        distinctOrphanApplicationsFiltered,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[getOrphanAccounts]", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const remediateOrphan = async (req, res) => {
  try {
    const { orphanId } = req.params;
    const { action, identityId } = req.body;

    const orphan = await OrphanAccount.findById(orphanId);
    if (!orphan) return res.status(404).json({ success: false, message: 'Orphan account not found' });

    if (action === 'ASSIGN' && identityId) {
      let linkAccountName = orphan.accountName && String(orphan.accountName).trim();
      if (!linkAccountName || looksLikeMongoObjectIdStr(linkAccountName)) {
        try {
          const app = await Application.findById(orphan.applicationId).select("name userMappings").lean();
          if (app?.name) {
            const Model = await getDynamicUserModelForTenantId(app.name, app.tenantId);
            const accDoc = mongoose.Types.ObjectId.isValid(String(orphan.accountId))
              ? await Model.findById(orphan.accountId).lean()
              : null;
            const resolved = resolveApplicationAccountDisplayName(accDoc, app.userMappings, orphan.accountId);
            if (resolved) linkAccountName = resolved;
          }
        } catch (e) {
          console.warn("[remediateOrphan] Could not resolve account display name:", e.message);
        }
      }

      const Identity = await getDynamicIdentityModelForTenantId(orphan.tenantId);
      const identityDoc = await Identity.findById(identityId).select("lifecycleState").lean();
      let accDocForGov = null;
      try {
        const appRow = await Application.findById(orphan.applicationId).select("name tenantId").lean();
        if (appRow?.name && mongoose.Types.ObjectId.isValid(String(orphan.accountId))) {
          const Model = await getDynamicUserModelForTenantId(appRow.name, appRow.tenantId);
          accDocForGov = await Model.findById(orphan.accountId).lean();
        }
      } catch (e) {
        console.warn("[remediateOrphan] governance account load:", e.message);
      }
      const gov = evaluateGovernanceOrphan({ lifecycleState: identityDoc?.lifecycleState }, accDocForGov || {});

      await IdentityAccountLink.findOneAndUpdate(
        {
          applicationId: orphan.applicationId,
          accountId: String(orphan.accountId),
        },
        {
          tenantId: orphan.tenantId,
          identityId,
          accountName: linkAccountName || orphan.accountName,
          correlationMethod: "MANUAL",
          correlationScore: 100,
          correlationStatus: "correlated",
          correlationConfidence: "high",
          isOrphan: gov.isOrphan,
          orphanReason: gov.orphanReason || null,
          isActive: true,
          lastVerifiedAt: new Date(),
        },
        { new: true, upsert: true },
      );
      await syncIdentityStats(identityId);
      orphan.status = 'REMEDIATED';
      orphan.remediationAction = 'ASSIGN';
    } else if (action === 'IGNORE') {
      orphan.status = 'FALSE_POSITIVE';
      orphan.remediationAction = 'IGNORE';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action or missing identityId' });
    }

    orphan.remediatedAt = new Date();
    await orphan.save();

    void recomputeTenantCorrelationStats(orphan.tenantId);
    scheduleDataHygieneSummaryRecompute(orphan.tenantId);

    res.status(200).json({ success: true, message: `Orphan account remediated via ${action}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
