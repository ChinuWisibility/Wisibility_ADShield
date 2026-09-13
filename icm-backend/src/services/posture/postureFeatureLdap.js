/**
 * Platform LDAP Query Framework — shared resolvers and scope helpers.
 */

import {
  DEFAULT_USER_FILTER,
  DEFAULT_GROUP_FILTER,
  DEFAULT_COMPUTER_FILTER,
} from "../ad/ldapNormalizer.js";
import { getPostureFeatureById } from "./postureFeatureRegistry.js";
import { GROUP_LDAP_SECURITY_FEATURES } from "./postureFeatureIds.js";
import { COMPUTER_SECURITY_FEATURES } from "./postureFeatureIds.js";

/** @typedef {"user"|"computer"|"group"} LdapObjectType */
/** @typedef {"Base"|"OneLevel"|"Subtree"} LdapSearchScope */

export const LDAP_SEARCH_SCOPES = Object.freeze(["Base", "OneLevel", "Subtree"]);
export const DEFAULT_LDAP_SEARCH_SCOPE = "Subtree";

/** Group features executed via LDAP with optional per-feature search base. */
export const GROUP_LDAP_FEATURE_IDS = new Set(GROUP_LDAP_SECURITY_FEATURES);

/** Computer features executed via LDAP with optional per-feature search base. */
export const COMPUTER_LDAP_FEATURE_IDS = new Set(COMPUTER_SECURITY_FEATURES);

/** Map UI/registry scope names to ldapts scope values. */
export function toLdaptsSearchScope(searchScope) {
  const s = String(searchScope || DEFAULT_LDAP_SEARCH_SCOPE).trim();
  if (s === "Base") return "base";
  if (s === "OneLevel") return "one";
  return "sub";
}

/**
 * @param {string} searchScope
 * @returns {LdapSearchScope}
 */
export function normalizeSearchScope(searchScope) {
  const s = String(searchScope || "").trim();
  if (LDAP_SEARCH_SCOPES.includes(s)) return /** @type {LdapSearchScope} */ (s);
  return DEFAULT_LDAP_SEARCH_SCOPE;
}

/**
 * Infer objectTypes from module / feature category when registry omits them.
 * @param {object} feature
 * @returns {LdapObjectType[]}
 */
export function inferObjectTypes(feature) {
  if (Array.isArray(feature?.objectTypes) && feature.objectTypes.length) {
    return feature.objectTypes.map(String);
  }
  const moduleId = String(feature?.moduleId || "");
  if (moduleId === "group_ldap_security") return ["group"];
  if (moduleId === "computer_security") return ["computer"];
  if (moduleId === "user_account_security") return ["user"];
  if (GROUP_LDAP_FEATURE_IDS.has(feature?.id)) return ["group"];
  if (COMPUTER_LDAP_FEATURE_IDS.has(feature?.id)) return ["computer"];
  return ["user"];
}

/**
 * Framework default filter when registry has none.
 * @param {string} featureId
 * @param {LdapObjectType[]} objectTypes
 */
export function frameworkDefaultFilter(featureId, objectTypes = []) {
  if (objectTypes.includes("group") || GROUP_LDAP_FEATURE_IDS.has(featureId)) {
    return DEFAULT_GROUP_FILTER;
  }
  if (objectTypes.includes("computer") || COMPUTER_LDAP_FEATURE_IDS.has(featureId)) {
    return DEFAULT_COMPUTER_FILTER;
  }
  return DEFAULT_USER_FILTER;
}

function readOverrideEntry(queryOverrides, featureId) {
  const override = queryOverrides?.[featureId];
  if (override == null) return null;
  if (typeof override === "string") {
    return { ldapFilter: override.trim() || undefined };
  }
  if (typeof override === "object") return override;
  return null;
}

/**
 * Resolve the LDAP filter for a posture feature (override → registry → default).
 * @param {string} featureId
 * @param {Record<string, string|object>} [queryOverrides]
 * @returns {string}
 */
export function resolveFeatureLdapFilter(featureId, queryOverrides = {}) {
  return resolveFeatureQuery(featureId, queryOverrides, {}).ldapFilter;
}

/**
 * Resolve the LDAP search base for a posture feature.
 * Precedence: override → registry defaultSearchBaseDn → application base DN.
 * @param {string} featureId
 * @param {Record<string, string|object>} [queryOverrides]
 * @param {{ baseDn?: string, baseDns?: string[] }} [cfg]
 * @returns {string|null}
 */
export function resolveFeatureSearchBase(featureId, queryOverrides = {}, cfg = {}) {
  return resolveFeatureQuery(featureId, queryOverrides, cfg).searchBaseDn;
}

/**
 * Four-layer resolve: User Override → Feature Registry → Application Config → Framework Default.
 * @param {string} featureId
 * @param {Record<string, string|object>} [queryOverrides]
 * @param {{ baseDn?: string, baseDns?: string[], defaultSearchScope?: string }} [cfg]
 */
export function resolveFeatureQuery(featureId, queryOverrides = {}, cfg = {}) {
  const feature = getPostureFeatureById(featureId) || {};
  const override = readOverrideEntry(queryOverrides, featureId);
  const objectTypes = inferObjectTypes({ ...feature, id: featureId });
  const executionMode = feature.executionMode || "LDAP";

  const registryDefaultFilter =
    String(feature.defaultFilter || feature.ldapFilter || "").trim() || null;
  const registryDefaultSearchBaseDn =
    String(feature.defaultSearchBaseDn || "").trim() || null;
  const registryDefaultScope = normalizeSearchScope(feature.searchScope);

  let ldapFilter = "";
  let filterFromOverride = false;
  if (typeof override?.ldapFilter === "string" && override.ldapFilter.trim()) {
    ldapFilter = override.ldapFilter.trim();
    filterFromOverride = true;
  } else if (registryDefaultFilter) {
    ldapFilter = registryDefaultFilter;
  } else {
    ldapFilter = frameworkDefaultFilter(featureId, objectTypes);
  }

  let searchBaseDn = null;
  let baseFromOverride = false;
  if (typeof override?.searchBase === "string" && override.searchBase.trim()) {
    searchBaseDn = override.searchBase.trim();
    baseFromOverride = true;
  } else if (registryDefaultSearchBaseDn) {
    searchBaseDn = registryDefaultSearchBaseDn;
  } else {
    searchBaseDn = cfg.baseDn || cfg.baseDns?.[0] || null;
  }

  let searchScope = DEFAULT_LDAP_SEARCH_SCOPE;
  let scopeFromOverride = false;
  if (override?.searchScope && String(override.searchScope).trim()) {
    searchScope = normalizeSearchScope(override.searchScope);
    scopeFromOverride = true;
  } else if (feature.searchScope) {
    searchScope = registryDefaultScope;
  } else if (cfg.defaultSearchScope) {
    searchScope = normalizeSearchScope(cfg.defaultSearchScope);
  } else {
    searchScope = DEFAULT_LDAP_SEARCH_SCOPE;
  }

  const overrideUsed = Boolean(filterFromOverride || baseFromOverride || scopeFromOverride);

  return {
    featureId,
    executionMode,
    objectTypes,
    searchBaseDn,
    ldapFilter,
    searchScope,
    registryDefaultFilter,
    registryDefaultSearchBaseDn,
    overrideUsed,
  };
}

/**
 * Count objects across a typed map.
 * @param {{ user?: object[], computer?: object[], group?: object[] }} objects
 */
export function countPostureObjects(objects = {}) {
  let total = 0;
  const byType = {};
  for (const [type, rows] of Object.entries(objects)) {
    const n = Array.isArray(rows) ? rows.length : 0;
    byType[type] = n;
    total += n;
  }
  return { total, byType };
}
