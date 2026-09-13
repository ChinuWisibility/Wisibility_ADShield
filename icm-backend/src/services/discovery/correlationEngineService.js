import mongoose from 'mongoose';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import AccountAggregation from '../../models/access/AccountAggregation.js';
import CorrelationRule from '../../models/correlation/CorrelationRule.js';
import CorrelationResult from '../../models/correlation/CorrelationResult.js';
import IdentityAccountLink from '../../models/identity/IdentityAccountLink.js';
import Application from '../../models/application/Application.js';
import { evaluateGovernanceOrphan } from '../../utils/correlationGovernance.js';
import { classifyIdentityIdMatches } from '../../utils/correlationMatchOutcome.js';
import { getIdentityFieldValue } from '../../utils/correlationIdentityFields.js';
import { scheduleSyncAllForApplication } from '../../utils/identityEntitlementSyncTrigger.js';

/** Max identities loaded for CONTAINS/REGEX rules (linear scan per account). */
const MAX_IDENTITIES_FOR_SLOW_RULES = Number(
  process.env.CORRELATION_MAX_IDENTITIES_SLOW_RULES ?? 250_000,
);

const BULK_CHUNK = Number(process.env.CORRELATION_BULK_CHUNK ?? 500);

async function loadIdentityLifecycleMap(tenantId) {
  const tid = mongoose.Types.ObjectId.isValid(String(tenantId))
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tid);
  const rows = await Identity.find({ tenantId: tid }).select("_id lifecycleState").lean();
  const m = new Map();
  for (const r of rows) m.set(String(r._id), r.lifecycleState);
  return m;
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    cur = cur?.[p];
  }
  return cur;
}

function normalizeMatch(val) {
  if (val == null) return '';
  return String(val).trim().toLowerCase();
}

function valuesMatch(rule, a, b) {
  const na = normalizeMatch(a);
  const nb = normalizeMatch(b);
  if (!na || !nb) return false;
  if (rule.matchType === 'CONTAINS') {
    return na.includes(nb) || nb.includes(na);
  }
  return na === nb;
}

function correlationMethodFromRule(rule) {
  const ia = String(rule.identityAttribute || '').toLowerCase();
  if (ia.includes('email')) return 'EMAIL';
  return 'EMPLOYEE_ID';
}

function extractAccountValue(account, accountAttribute) {
  return (
    getByPath(account.rawAttributes, accountAttribute) ??
    getByPath(account, accountAttribute)
  );
}

/** EXACT (or missing matchType) uses hash maps; CONTAINS/REGEX need per-account linear scan over identities. */
function isExactRule(rule) {
  const t = rule.matchType;
  return !t || t === 'EXACT';
}

function identityProjectionForRules(rules) {
  const fields = new Set(['_id', 'attributes']);
  for (const r of rules) {
    const attr = String(r.identityAttribute || '').trim();
    if (!attr) continue;
    fields.add(attr.split('.')[0]);
  }
  return [...fields].join(' ');
}

/**
 * One pass over identities: build Map (normalized key -> ObjectId[]) per EXACT rule index.
 */
async function buildExactLookupMaps(rules, tenantId) {
  const tid = mongoose.Types.ObjectId.isValid(String(tenantId))
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tid);

  const exactRuleIndices = [];
  for (let i = 0; i < rules.length; i++) {
    if (isExactRule(rules[i])) exactRuleIndices.push(i);
  }

  const maps = rules.map(() => null);
  for (const idx of exactRuleIndices) {
    maps[idx] = new Map();
  }

  if (exactRuleIndices.length === 0) {
    return maps;
  }

  const select = identityProjectionForRules(rules);
  const cursor = Identity.find({ tenantId: tid })
    .select(select)
    .lean()
    .cursor({ batchSize: 5000 });

  for await (const idn of cursor) {
    for (const idx of exactRuleIndices) {
      const rule = rules[idx];
      const idVal = getIdentityFieldValue(idn, rule.identityAttribute);
      const k = normalizeMatch(idVal);
      if (!k) continue;
      const m = maps[idx];
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(idn._id);
    }
  }

  return maps;
}

/**
 * Loads identities when any rule needs linear matching (CONTAINS, or REGEX which is not hashable here).
 */
async function loadIdentitiesForSlowRules(rules, tenantId) {
  const needsSlow = rules.some((r) => !isExactRule(r));
  if (!needsSlow) return [];

  const tid = mongoose.Types.ObjectId.isValid(String(tenantId))
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tid);

  const count = await Identity.countDocuments({ tenantId: tid });
  if (count > MAX_IDENTITIES_FOR_SLOW_RULES) {
    throw new Error(
      `CONTAINS/REGEX correlation rules require loading identities for linear scans; count (${count}) exceeds CORRELATION_MAX_IDENTITIES_SLOW_RULES (${MAX_IDENTITIES_FOR_SLOW_RULES}). Prefer EXACT rules for large tenants.`,
    );
  }

  const select = identityProjectionForRules(rules);
  return Identity.find({ tenantId: tid }).select(select).lean();
}

async function flushBulkWrites({ accountAggOps, correlationResultOps, linkOps }) {
  const tasks = [];
  if (accountAggOps.length) {
    tasks.push(AccountAggregation.bulkWrite(accountAggOps, { ordered: false }));
  }
  if (correlationResultOps.length) {
    tasks.push(CorrelationResult.bulkWrite(correlationResultOps, { ordered: false }));
  }
  if (linkOps.length) {
    tasks.push(IdentityAccountLink.bulkWrite(linkOps, { ordered: false }));
  }
  if (tasks.length) await Promise.all(tasks);
}

async function maybeFlush(accountAggOps, correlationResultOps, linkOps) {
  if (
    accountAggOps.length < BULK_CHUNK &&
    correlationResultOps.length < BULK_CHUNK &&
    linkOps.length < BULK_CHUNK
  ) {
    return;
  }
  await flushBulkWrites({
    accountAggOps: accountAggOps.splice(0, accountAggOps.length),
    correlationResultOps: correlationResultOps.splice(0, correlationResultOps.length),
    linkOps: linkOps.splice(0, linkOps.length),
  });
}

/**
 * Pipeline: aggregate accounts → correlate (lifecycle-agnostic matching) → persist links → governance flags on links/aggregations.
 *
 * Match Identity rows to AccountAggregation rows using enabled CorrelationRules.
 *
 * Scalability (millions of rows):
 * - EXACT rules: O(identities + accounts) time; hash maps; identity stream uses cursor (no full-array load).
 * - CONTAINS/REGEX: loads all matching identities (capped by env); O(accounts × identities) — avoid at scale.
 * - Accounts: cursor + batched bulkWrite updates.
 */
export async function runCorrelationEngine({ tenantId, applicationId }) {
  const app = await Application.findById(applicationId).lean();
  if (!app || String(app.tenantId) !== String(tenantId)) {
    throw new Error('Application not found for this tenant.');
  }

  const rules = await CorrelationRule.find({
    applicationId,
    isEnabled: { $ne: false },
  })
    .sort({ priority: 1 })
    .lean();

  if (!rules.length) {
    throw new Error(
      'No correlation rules enabled. POST /api/correlation/rules with e.g. identityAttribute=employeeId, accountAttribute=employeeNumber, matchType=EXACT, applicationId=<AD app id>.',
    );
  }

  const tid = mongoose.Types.ObjectId.isValid(String(tenantId))
    ? new mongoose.Types.ObjectId(String(tenantId))
    : tenantId;
  const Identity = await getDynamicIdentityModelForTenantId(tid);
  const LegacyIdentity = getLegacyIdentityModel();

  const appOid = mongoose.Types.ObjectId.isValid(String(applicationId))
    ? new mongoose.Types.ObjectId(String(applicationId))
    : applicationId;

  const exactMaps = await buildExactLookupMaps(rules, tid);
  const identitiesForSlowRules = await loadIdentitiesForSlowRules(rules, tid);
  const identityLifecycleById = await loadIdentityLifecycleMap(tid);

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  let accountsProcessed = 0;

  const accountAggOps = [];
  const correlationResultOps = [];
  const linkOps = [];
  const identityIdsToMarkCorrelated = new Set();

  const accountCursor = AccountAggregation.find({
    applicationId: appOid,
    tenantId: tid,
  })
    .lean()
    .cursor({ batchSize: 2000 });

  for await (const account of accountCursor) {
    accountsProcessed += 1;
    let chosenIdentityId = null;
    let ruleUsed = null;
    let state = 'UNMATCHED';

    if (account.ambiguousDuplicateApplicationPk === true) {
      ambiguous += 1;
      accountAggOps.push({
        updateOne: {
          filter: { _id: account._id },
          update: { $set: { isOrphan: true }, $unset: { correlatedIdentityId: 1 } },
        },
      });
      correlationResultOps.push({
        updateOne: {
          filter: { accountId: account._id, applicationId: appOid },
          update: {
            $set: {
              matchScore: 0,
              status: 'AMBIGUOUS',
              isOrphan: true,
              correlatedAt: new Date(),
            },
            $unset: { identityId: 1 },
          },
          upsert: true,
        },
      });
      await maybeFlush(accountAggOps, correlationResultOps, linkOps);
      continue;
    }

    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      const accVal = extractAccountValue(account, rule.accountAttribute);
      if (accVal == null || accVal === '') continue;

      if (!isExactRule(rule)) {
        const candidates = identitiesForSlowRules.filter((idn) => {
          const idVal = getIdentityFieldValue(idn, rule.identityAttribute);
          return valuesMatch(rule, idVal, accVal);
        });
        const slowCls = classifyIdentityIdMatches(candidates.map((c) => c._id));
        if (slowCls.outcome === 'MATCHED') {
          chosenIdentityId = slowCls.identityId;
          ruleUsed = rule;
          state = 'MATCHED';
          break;
        }
        if (slowCls.outcome === 'AMBIGUOUS') {
          state = 'AMBIGUOUS';
          break;
        }
      } else {
        const map = exactMaps[ri];
        const k = normalizeMatch(accVal);
        const ids = map?.get(k);
        const exactCls = classifyIdentityIdMatches(ids);
        if (exactCls.outcome === 'UNMATCHED') continue;
        if (exactCls.outcome === 'MATCHED') {
          chosenIdentityId = exactCls.identityId;
          ruleUsed = rule;
          state = 'MATCHED';
          break;
        }
        state = 'AMBIGUOUS';
        break;
      }
    }

    if (state === 'AMBIGUOUS') {
      ambiguous += 1;
      accountAggOps.push({
        updateOne: {
          filter: { _id: account._id },
          update: { $set: { isOrphan: true }, $unset: { correlatedIdentityId: 1 } },
        },
      });
      correlationResultOps.push({
        updateOne: {
          filter: { accountId: account._id, applicationId: appOid },
          update: {
            $set: {
              matchScore: 0,
              status: 'AMBIGUOUS',
              isOrphan: true,
              correlatedAt: new Date(),
            },
            $unset: { identityId: 1 },
          },
          upsert: true,
        },
      });
      await maybeFlush(accountAggOps, correlationResultOps, linkOps);
      continue;
    }

    if (state === 'MATCHED' && chosenIdentityId && ruleUsed) {
      matched += 1;
      identityIdsToMarkCorrelated.add(String(chosenIdentityId));

      const ls = identityLifecycleById.get(String(chosenIdentityId));
      const gov = evaluateGovernanceOrphan({ lifecycleState: ls }, account);

      accountAggOps.push({
        updateOne: {
          filter: { _id: account._id },
          update: {
            $set: {
              correlatedIdentityId: chosenIdentityId,
              isOrphan: gov.isOrphan,
            },
          },
        },
      });

      const mongoAccountId = String(account._id);
      const nativeId =
        account.nativeAccountId != null && String(account.nativeAccountId).trim() !== ''
          ? String(account.nativeAccountId).trim()
          : null;
      const matchDisplay =
        accVal != null && String(accVal).trim() !== '' ? String(accVal).trim() : undefined;

      // Always key links by warehouse Mongo _id (same as manual link / Accounts tab).
      // Older runs stored nativeAccountId here — that created duplicate cards on re-correlate.
      linkOps.push({
        updateOne: {
          filter: {
            identityId: chosenIdentityId,
            applicationId: appOid,
            accountId: mongoAccountId,
          },
          update: {
            $set: {
              tenantId: tid,
              accountName: account.accountName,
              correlationMethod: correlationMethodFromRule(ruleUsed),
              correlationScore: 100,
              correlationStatus: "correlated",
              correlationConfidence: "high",
              isOrphan: gov.isOrphan,
              orphanReason: gov.orphanReason || null,
              isActive: true,
              lastVerifiedAt: new Date(),
              correlationIdentityAttribute: String(ruleUsed.identityAttribute || '').trim() || undefined,
              correlationAccountAttribute: String(ruleUsed.accountAttribute || '').trim() || undefined,
              correlationMatchDisplay: matchDisplay,
            },
          },
          upsert: true,
        },
      });

      // Retire legacy duplicate rows for the same identity+app that used native ids
      // or the same match display (prevents "Active (Fallback)" twin cards after re-runs).
      const staleOr = [];
      if (nativeId && nativeId !== mongoAccountId) {
        staleOr.push({ accountId: nativeId });
      }
      if (matchDisplay && matchDisplay !== mongoAccountId) {
        staleOr.push({ correlationMatchDisplay: matchDisplay });
      }
      if (staleOr.length) {
        linkOps.push({
          updateMany: {
            filter: {
              identityId: chosenIdentityId,
              applicationId: appOid,
              accountId: { $ne: mongoAccountId },
              $or: staleOr,
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

      correlationResultOps.push({
        updateOne: {
          filter: {
            identityId: chosenIdentityId,
            accountId: account._id,
            applicationId: appOid,
          },
          update: {
            $set: {
              matchScore: 100,
              status: 'MATCHED',
              isOrphan: gov.isOrphan,
              correlatedAt: new Date(),
            },
          },
          upsert: true,
        },
      });
      await maybeFlush(accountAggOps, correlationResultOps, linkOps);
      continue;
    }

    unmatched += 1;
    accountAggOps.push({
      updateOne: {
        filter: { _id: account._id },
        update: { $set: { isOrphan: true }, $unset: { correlatedIdentityId: 1 } },
      },
    });
    correlationResultOps.push({
      updateOne: {
        filter: { accountId: account._id, applicationId: appOid },
        update: {
          $set: {
            matchScore: 0,
            status: 'UNMATCHED',
            isOrphan: true,
            correlatedAt: new Date(),
          },
          $unset: { identityId: 1 },
        },
        upsert: true,
      },
    });
    await maybeFlush(accountAggOps, correlationResultOps, linkOps);
  }

  await flushBulkWrites({
    accountAggOps,
    correlationResultOps,
    linkOps,
  });

  if (identityIdsToMarkCorrelated.size > 0) {
    const oidList = [...identityIdsToMarkCorrelated].map((id) => new mongoose.Types.ObjectId(id));
    const filter = { _id: { $in: oidList } };
    const update = { $set: { isCorrelated: true } };
    await Promise.all([
      Identity.updateMany(filter, update),
      LegacyIdentity.updateMany(filter, update),
    ]);
  }

  const identityCount = await Identity.countDocuments({ tenantId: tid });

  scheduleSyncAllForApplication(applicationId);

  return {
    applicationId: String(applicationId),
    rulesEvaluated: rules.length,
    accountsProcessed,
    identitiesAvailable: identityCount,
    matched,
    ambiguous,
    unmatched,
  };
}
