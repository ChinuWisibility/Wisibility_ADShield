import mongoose from "mongoose";
import { getDynamicUserModelForTenantId } from "../../models/application/Users.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import { resolveApplicationAccountDisplayName } from "../identityProfileMappingUtils.js";
import { resolveUncorrelatedTrustMapping } from "../../services/datahygine/uncorrelatedTrustMappingResolver.js";
import {
  loadPrivilegedEntitlementCatalog,
  resolveOrphanTrustFromAccountDoc,
} from "./orphanAccountTrust.js";

export function orphanDisplayFromCorrelationKey(correlationKey) {
  if (!correlationKey || typeof correlationKey !== "string") return "";
  if (correlationKey.startsWith("v:")) {
    const rest = correlationKey.slice(2);
    return rest || "";
  }
  return "";
}

export function looksLikeMongoObjectIdStr(s) {
  return typeof s === "string" && /^[a-f\d]{24}$/i.test(s.trim());
}

/**
 * Stable fields from the per-application `app_*_users` document (see Users.js schema + strict:false extras).
 * @param {Record<string, unknown> | null | undefined} doc
 */
export function pickUserRowFieldsFromAccountDoc(doc) {
  if (!doc || typeof doc !== "object") {
    return {
      userEmail: null,
      userEmployeeId: null,
      userUsername: null,
      userDisplayName: null,
    };
  }
  const d = doc;
  const str = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  return {
    userEmail: str(d.email),
    userEmployeeId: str(d.employee_id),
    userUsername: str(d.username || d.user_id || d.samAccountName || d.userPrincipalName),
    userDisplayName: str(d.display_name || d.displayName),
  };
}

/**
 * Persist trust → riskLevel when enrichment recalculates a different value.
 * Fire-and-forget; list response already carries the computed trust.
 * @param {{ _id: unknown, riskLevel?: string, trustLevel?: string }[]} enriched
 */
function scheduleOrphanRiskLevelSync(enriched) {
  const ops = [];
  for (const row of enriched || []) {
    if (!row?._id || !row.trustLevel) continue;
    const stored = String(row._previousRiskLevel || "").toUpperCase();
    const trust = String(row.trustLevel).toUpperCase();
    if (stored === trust) continue;
    ops.push({
      updateOne: {
        filter: { _id: row._id },
        update: { $set: { riskLevel: trust } },
      },
    });
  }
  if (!ops.length) return;
  void OrphanAccount.bulkWrite(ops, { ordered: false }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[enrichOrphanRowsForDisplay] riskLevel sync failed:", err?.message || err);
  });
}

/**
 * Resolve accountName using Application PK mapping + live user doc; attach user-table columns
 * and Trust Level (status + privileged entitlements) for list UIs.
 * @param {any[]} orphans
 * @param {{ persistRiskLevel?: boolean }} [options]
 */
export async function enrichOrphanRowsForDisplay(orphans, options = {}) {
  const persistRiskLevel = options.persistRiskLevel !== false;
  if (!orphans?.length) return orphans;
  const byApp = new Map();
  for (const o of orphans) {
    const app = o.applicationId;
    if (!app || typeof app !== "object" || !app.name) continue;
    const appKey = String(app._id);
    if (!byApp.has(appKey)) {
      byApp.set(appKey, { app, accountIds: [], tenantId: app.tenantId || o.tenantId });
    }
    if (o.accountId) byApp.get(appKey).accountIds.push(String(o.accountId));
    const bucket = byApp.get(appKey);
    if (!bucket.tenantId && o.tenantId) bucket.tenantId = o.tenantId;
  }

  const docLookup = new Map();
  /** @type {Map<string, { tokenSet: Set<string>, byToken: Map<string, { id: string, name: string }> }>} */
  const privilegedCatalogByApp = new Map();

  // Fetch Global Rule Set Trust Mapping once per enrichment (cache in resolver).
  let tenantTrustMapping = null;
  const tenantIdForMapping =
    orphans.find((o) => o?.tenantId)?.tenantId ||
    [...byApp.values()].find((b) => b.tenantId)?.tenantId ||
    null;
  if (tenantIdForMapping) {
    try {
      const resolved = await resolveUncorrelatedTrustMapping(tenantIdForMapping);
      tenantTrustMapping = resolved.effectiveMapping;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[enrichOrphanRowsForDisplay] Could not load trust mapping; using defaults:",
        e?.message || e,
      );
    }
  }

  for (const [appKey, { app, accountIds, tenantId }] of byApp) {
    const uniqueIds = [...new Set(accountIds)];
    const oids = uniqueIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const tenantIdForModel = tenantId || app?.tenantId;
    if (!tenantIdForModel) continue;

    if (oids.length) {
      try {
        const Model = await getDynamicUserModelForTenantId(app.name, tenantIdForModel);
        const docs = await Model.find({ _id: { $in: oids } }).lean();
        for (const d of docs) {
          docLookup.set(`${appKey}:${String(d._id)}`, d);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[enrichOrphanRowsForDisplay] Could not load application user docs for ${app.name}:`, e.message);
      }
    }

    try {
      const catalog = await loadPrivilegedEntitlementCatalog(app._id, app.name, tenantIdForModel);
      privilegedCatalogByApp.set(appKey, catalog);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[enrichOrphanRowsForDisplay] Could not load privileged entitlements for ${app.name}:`,
        e.message,
      );
      privilegedCatalogByApp.set(appKey, { tokenSet: new Set(), byToken: new Map() });
    }
  }

  const enriched = orphans.map((o) => {
    const app = o.applicationId;
    const appKey = app && typeof app === "object" && app._id ? String(app._id) : "";
    const aid = String(o.accountId || "");
    const accountDoc = appKey && aid ? docLookup.get(`${appKey}:${aid}`) : null;
    const um = app && typeof app === "object" ? app.userMappings : undefined;
    let name = resolveApplicationAccountDisplayName(accountDoc, um, aid);
    if (!name) name = orphanDisplayFromCorrelationKey(o.correlationKey);
    const stored = o.accountName && String(o.accountName).trim();
    if (!name && stored && !looksLikeMongoObjectIdStr(stored)) name = stored;
    const userFields = pickUserRowFieldsFromAccountDoc(accountDoc);
    const privilegedCatalog =
      privilegedCatalogByApp.get(appKey) || { tokenSet: new Set(), byToken: new Map() };
    const applicationName = app && typeof app === "object" ? app.name : null;
    const trust = resolveOrphanTrustFromAccountDoc(accountDoc, privilegedCatalog, {
      applicationName,
      trustMapping: tenantTrustMapping,
    });
    const previousRiskLevel = o.riskLevel;
    return {
      ...o,
      accountName: name || "",
      ...userFields,
      accountStatus: trust.accountStatus,
      hasPrivilegedEntitlement: trust.hasPrivilegedEntitlement,
      trustLevel: trust.trustLevel,
      trustScenario: trust.trustScenario,
      configuredTrustLevel: trust.configuredTrustLevel,
      trustReason: trust.trustReason,
      trustTooltipLines: trust.trustTooltipLines,
      trustAnalysisLines: trust.trustAnalysisLines,
      trustSummary: trust.trustSummary,
      appliedTrustMappingLabel: trust.appliedTrustMappingLabel,
      appliedTrustMappingLine: trust.appliedTrustMappingLine,
      trustScenarioLabel: trust.trustScenarioLabel,
      privilegedEntitlements: trust.privilegedEntitlements,
      normalEntitlements: trust.normalEntitlements,
      // Trust column historically read riskLevel; keep them aligned.
      riskLevel: trust.trustLevel,
      _previousRiskLevel: previousRiskLevel,
    };
  });

  if (persistRiskLevel) {
    scheduleOrphanRiskLevelSync(enriched);
  }

  return enriched.map(({ _previousRiskLevel, ...row }) => row);
}
