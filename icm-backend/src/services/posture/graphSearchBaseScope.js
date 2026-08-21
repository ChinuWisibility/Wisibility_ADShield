/**
 * Search-base scoping for Identity Graph / HYBRID features.
 * Reuses resolveFeatureQuery + isDnUnderSearchBase — no parallel BaseDN logic.
 */

import { resolveFeatureQuery } from "./postureFeatureLdap.js";
import { isDnUnderSearchBase } from "./groupAnalysisCatalog.js";

/** Privileged + nested-adjacent graph features that honor Search Base overrides. */
export const SEARCH_BASE_SCOPED_GRAPH_FEATURES = new Set([
  "dormant_privileged_users",
  "excessive_privileges",
  "privilege_escalation_paths",
  "toxic_privilege_combinations",
  "shadow_admins",
]);

/**
 * @param {object} userDoc
 * @returns {string}
 */
export function resolveUserAdDn(userDoc) {
  const raw = userDoc?.rawData && typeof userDoc.rawData === "object" ? userDoc.rawData : {};
  return String(
    raw.distinguishedName || raw.dn || userDoc?.distinguishedName || "",
  ).trim();
}

/**
 * @param {object} entitlementDoc
 * @returns {string}
 */
export function resolveGroupAdDn(entitlementDoc) {
  const raw =
    entitlementDoc?.rawData && typeof entitlementDoc.rawData === "object"
      ? entitlementDoc.rawData
      : {};
  return String(
    raw.groupDN ||
      raw.source_dn ||
      raw.distinguishedName ||
      raw.dn ||
      entitlementDoc?.source_dn ||
      "",
  ).trim();
}

/**
 * Resolve effective search base for a graph/HYBRID feature via the platform framework.
 * @param {string} featureId
 * @param {object} ctx — identity graph scan context ({ queryOverrides, ldapCfg })
 */
export function resolveGraphFeatureSearchBase(featureId, ctx = {}) {
  return resolveFeatureQuery(
    featureId,
    ctx.queryOverrides || {},
    ctx.ldapCfg || {},
  );
}

/**
 * Whether a DN is in scope for the feature search base.
 * No search base → all objects in scope (identical to pre-override behavior).
 * Missing DN with an explicit override → out of scope (deterministic).
 * Missing DN with only app default base → in scope (avoid dropping synced rows without DN).
 *
 * @param {string} dn
 * @param {{ searchBaseDn?: string|null, overrideUsed?: boolean }} resolved
 */
export function isAdObjectInSearchScope(dn, resolved) {
  const base = String(resolved?.searchBaseDn || "").trim();
  if (!base) return true;
  const normalizedDn = String(dn || "").trim();
  if (!normalizedDn) {
    return !resolved?.overrideUsed;
  }
  return isDnUnderSearchBase(normalizedDn, base);
}
