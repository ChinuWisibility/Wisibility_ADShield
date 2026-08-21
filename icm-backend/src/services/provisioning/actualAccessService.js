/**
 * IGA-side actual access reader for the Access Delta Engine.
 *
 * Reads only already aggregated/correlated Mongo data. It never contacts a
 * target system and deliberately ignores uncorrelated accounts.
 *
 * Projection rows key `accountId` as DynamicUser `_id`. Correlation-engine
 * links often store AccountAggregation `_id` instead, so this reader resolves
 * projection membership through candidate keys + a single-account-per-app
 * fallback — never by inventing entitlements from uncorrelated accounts.
 *
 * Multi-account safety (P7):
 * - Distinct correlated accounts for the same application are NOT merged.
 * - Ambiguous applications are flagged in metadata; entitlements stay empty.
 */

import mongoose from "mongoose";
import IdentityAccountLink from "../../models/identity/IdentityAccountLink.js";
import AccountAggregation from "../../models/access/AccountAggregation.js";
import {
  loadProjectedEntitlementsByAccountForIdentity,
} from "../../utils/identityEntitlementProjectionRead.js";

function toOid(value) {
  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function normalizeAccountAttributes(rawAttributes) {
  if (!rawAttributes || typeof rawAttributes !== "object" || Array.isArray(rawAttributes)) {
    return {};
  }
  const out = {};
  for (const [key, value] of Object.entries(rawAttributes)) {
    if (/password|passwd|secret|token|credential|apikey|api_key|privatekey|private_key/i.test(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function accountKey(applicationId, accountId) {
  return `${String(applicationId)}:${String(accountId || "")}`;
}

function addCandidate(candidatesByApp, applicationId, accountId) {
  if (accountId == null || String(accountId).trim() === "") return;
  const appKey = String(applicationId);
  if (!candidatesByApp.has(appKey)) candidatesByApp.set(appKey, new Set());
  candidatesByApp.get(appKey).add(String(accountId).trim());
}

function dedupeEntitlements(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const id = row?.entitlementId != null ? String(row.entitlementId) : "";
    if (!id || byId.has(id)) continue;
    byId.set(id, {
      entitlementId: id,
      entitlementName: row.entitlementName || row.displayName || id,
      displayName: row.displayName || row.entitlementName || id,
      name: row.name || row.entitlementName || row.displayName || id,
    });
  }
  return [...byId.values()].sort((a, b) =>
    `${a.entitlementId}:${a.name || ""}`.localeCompare(`${b.entitlementId}:${b.name || ""}`),
  );
}

/**
 * Pure projection attach helper (exported for unit tests).
 *
 * Lookup order:
 * 1. Exact `(applicationId, candidateAccountId)` keys from links/aggregations
 *    — if multiple DISTINCT projection accounts match, return [] (do not merge)
 * 2. If none hit and the identity has exactly one projected account for that
 *    application, use that account (Aggregation↔DynamicUser id bridge)
 * 3. Otherwise return [] — never merge multiple accounts' memberships
 */
export function collectProjectionEntitlements(
  projection,
  applicationId,
  candidateAccountIds = [],
) {
  if (!projection || typeof projection.get !== "function") return [];

  const appId = String(applicationId);
  const matchedByAccount = new Map();
  for (const accountId of candidateAccountIds) {
    const key = accountKey(appId, accountId);
    const rows = projection.get(key);
    if (!rows?.length) continue;
    if (!matchedByAccount.has(key)) matchedByAccount.set(key, rows);
  }
  if (matchedByAccount.size === 1) {
    return dedupeEntitlements([...matchedByAccount.values()][0]);
  }
  if (matchedByAccount.size > 1) {
    // Distinct projection accounts matched — never merge unrelated memberships.
    return [];
  }

  const prefix = `${appId}:`;
  const matchingKeys = [...projection.keys()].filter(
    (key) => typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length,
  );
  const uniqueAccountIds = [
    ...new Set(matchingKeys.map((key) => key.slice(prefix.length)).filter(Boolean)),
  ];
  if (uniqueAccountIds.length === 1) {
    return dedupeEntitlements(projection.get(accountKey(appId, uniqueAccountIds[0])) || []);
  }
  return [];
}

/**
 * Load normalized ACTUAL access for a correlated identity.
 *
 * Projection entitlements are preferred. If unavailable, callers still obtain
 * account state with an empty entitlement list; Delta will not invent target
 * membership from uncorrelated data.
 */
export async function loadActualAccessForIdentity({ tenantId, identityId }) {
  const tenantOid = toOid(tenantId);
  const identityOid = toOid(identityId);
  if (!tenantOid || !identityOid) {
    throw new Error("Valid tenantId and identityId are required for actual access");
  }

  const [links, aggregations, projection] = await Promise.all([
    IdentityAccountLink.find({
      tenantId: tenantOid,
      identityId: identityOid,
      isActive: { $ne: false },
      correlationStatus: { $ne: "uncorrelated" },
      isOrphan: { $ne: true },
    })
      .select("applicationId accountId accountName correlationStatus")
      .lean(),
    AccountAggregation.find({
      tenantId: tenantOid,
      correlatedIdentityId: identityOid,
      isOrphan: { $ne: true },
    })
      .select("_id applicationId nativeAccountId accountName status rawAttributes")
      .lean(),
    loadProjectedEntitlementsByAccountForIdentity(identityOid, tenantOid).catch(() => null),
  ]);

  const byApplication = new Map();
  const candidatesByApp = new Map();
  /** Canonical account records keyed by aggregation `_id` when present. */
  const aggregationsByApp = new Map();
  /** Link-only account keys when no aggregation exists for the app. */
  const linksByApp = new Map();

  const ensureApplication = (applicationId) => {
    const key = String(applicationId);
    if (!byApplication.has(key)) {
      byApplication.set(key, {
        applicationId: key,
        account: { exists: false, nativeId: null, attributes: {} },
        entitlements: [],
      });
    }
    return byApplication.get(key);
  };

  // Only correlation-produced links and correlated aggregations are accepted.
  // A target account that was not correlated is intentionally invisible here.
  for (const link of links) {
    ensureApplication(link.applicationId);
    const appKey = String(link.applicationId);
    if (!linksByApp.has(appKey)) linksByApp.set(appKey, new Map());
    const linkKey = String(link.accountId || link.accountName || "").trim();
    if (linkKey) {
      linksByApp.get(appKey).set(linkKey, {
        exists: true,
        nativeId: link.accountName || link.accountId || null,
        attributes: {},
        projectionAccountId: link.accountId ? String(link.accountId) : null,
      });
    }
    addCandidate(candidatesByApp, link.applicationId, link.accountId);
  }

  for (const aggregation of aggregations) {
    ensureApplication(aggregation.applicationId);
    const appKey = String(aggregation.applicationId);
    if (!aggregationsByApp.has(appKey)) aggregationsByApp.set(appKey, new Map());
    const linkProjectionId =
      linksByApp.get(appKey)?.size === 1
        ? [...linksByApp.get(appKey).values()][0]?.projectionAccountId || null
        : null;
    aggregationsByApp.get(appKey).set(String(aggregation._id), {
      exists: true,
      nativeId: aggregation.nativeAccountId || aggregation.accountName || String(aggregation._id),
      attributes: normalizeAccountAttributes(aggregation.rawAttributes),
      status: aggregation.status || undefined,
      accountRecordId: String(aggregation._id),
      projectionAccountId: linkProjectionId,
    });
    addCandidate(candidatesByApp, aggregation.applicationId, aggregation._id);
    addCandidate(candidatesByApp, aggregation.applicationId, aggregation.nativeAccountId);
    addCandidate(candidatesByApp, aggregation.applicationId, aggregation.accountName);
  }

  const ambiguousApplicationIds = [];

  for (const [applicationId, target] of byApplication) {
    const aggRecords = aggregationsByApp.get(applicationId) || new Map();
    const linkRecords = linksByApp.get(applicationId) || new Map();
    const candidates = [...(candidatesByApp.get(applicationId) || [])];

    // Aggregation is canonical. Multiple aggregations for one app = ambiguous.
    // A single aggregation plus one or more links is the Aggregation↔DynamicUser
    // bridge — still one logical account. Link-only multi-account is ambiguous.
    if (aggRecords.size > 1 || (aggRecords.size === 0 && linkRecords.size > 1)) {
      ambiguousApplicationIds.push(applicationId);
      target.account = {
        exists: true,
        nativeId: null,
        attributes: {},
        ambiguous: true,
        accountCount: Math.max(aggRecords.size, linkRecords.size),
      };
      target.entitlements = [];
      continue;
    }

    if (aggRecords.size === 1) {
      const account = { ...[...aggRecords.values()][0] };
      delete account.projectionAccountId;
      target.account = account;
    } else if (linkRecords.size === 1) {
      const account = { ...[...linkRecords.values()][0] };
      delete account.projectionAccountId;
      target.account = account;
    }

    target.entitlements = collectProjectionEntitlements(
      projection,
      applicationId,
      candidates,
    );
  }

  ambiguousApplicationIds.sort();

  return {
    tenantId: String(tenantOid),
    identityId: String(identityOid),
    applications: [...byApplication.values()].sort((a, b) =>
      a.applicationId.localeCompare(b.applicationId),
    ),
    metadata: {
      source: "IGA_AGGREGATION_AND_CORRELATION",
      correlatedOnly: true,
      projectionEntitlementsAvailable: projection !== null,
      targetQueries: false,
      ambiguousApplicationIds,
      ambiguousAccounts: ambiguousApplicationIds.length > 0,
    },
  };
}
