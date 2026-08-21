import ApplicationSecurityQueryOverride from "../../models/security/ApplicationSecurityQueryOverride.js";
import {
  getPostureFeatureRegistry,
  getPostureFeatureById,
} from "../posture/postureFeatureRegistry.js";
import {
  validateLdapQueryFields,
} from "../posture/ldapFilterValidator.js";
import {
  DEFAULT_LDAP_SEARCH_SCOPE,
  normalizeSearchScope,
} from "../posture/postureFeatureLdap.js";

/**
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export async function loadQueryOverrideMap(applicationId) {
  const rows = await ApplicationSecurityQueryOverride.find({ applicationId }).lean();
  return new Map(rows.map((r) => [r.featureKey, r]));
}

/**
 * Resolve effective LDAP filter for a feature (override or Wisbility default).
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {string} featureKey
 */
export async function resolveFeatureLdapFilter(applicationId, featureKey) {
  const feature = getPostureFeatureById(featureKey);
  if (!feature) return null;
  const row = await ApplicationSecurityQueryOverride.findOne({
    applicationId,
    featureKey,
  }).lean();
  if (row?.ldapFilter?.trim()) return row.ldapFilter.trim();
  return feature.ldapFilter || feature.defaultFilter || null;
}

/**
 * Build feature tiles payload for Security Center UI.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 */
export async function buildFeatureConfigPayload(applicationId) {
  const overrideMap = await loadQueryOverrideMap(applicationId);
  const features = getPostureFeatureRegistry();

  const tiles = features.map((f) => {
    const override = overrideMap.get(f.id);
    const defaultFilter = f.defaultFilter || f.ldapFilter || "";
    const defaultSearchBaseDn = f.defaultSearchBaseDn || "";
    const defaultSearchScope = f.searchScope || DEFAULT_LDAP_SEARCH_SCOPE;
    const effectiveFilter = override?.ldapFilter?.trim() || defaultFilter;
    const effectiveSearchBase =
      override?.searchBase?.trim() || defaultSearchBaseDn || "";
    const effectiveSearchScope = override?.searchScope?.trim()
      ? normalizeSearchScope(override.searchScope)
      : defaultSearchScope;

    return {
      featureKey: f.id,
      name: f.name,
      description: f.description,
      category: f.category,
      moduleId: f.moduleId,
      riskLevel: f.riskLevel,
      executionMode: f.executionMode,
      objectTypes: f.objectTypes || [],
      implemented: f.implemented,
      enabled: override?.enabled ?? f.defaultEnabled ?? false,
      ldapFilter: effectiveFilter,
      defaultLdapFilter: defaultFilter,
      defaultFilter,
      searchBase: effectiveSearchBase,
      defaultSearchBaseDn,
      searchScope: effectiveSearchScope,
      defaultSearchScope,
      modified: Boolean(override?.modified),
      hasOverride: Boolean(override?.ldapFilter?.trim()),
      hasSearchBaseOverride: Boolean(override?.searchBase?.trim()),
      settings: f.settings || [],
      requiredAttributes: f.requiredAttributes || [],
    };
  });

  return { features: tiles };
}

/**
 * @param {{
 *   applicationId: import('mongoose').Types.ObjectId|string,
 *   featureKey: string,
 *   ldapFilter?: string,
 *   searchBase?: string,
 *   searchScope?: string,
 *   enabled?: boolean,
 *   userId?: import('mongoose').Types.ObjectId|string,
 * }} params
 */
export async function upsertFeatureQueryOverride({
  applicationId,
  featureKey,
  ldapFilter,
  searchBase,
  searchScope,
  enabled,
  userId,
}) {
  const feature = getPostureFeatureById(featureKey);
  if (!feature) {
    const err = new Error(`Unknown security feature: ${featureKey}`);
    err.code = "UNKNOWN_FEATURE";
    throw err;
  }

  const existing = await ApplicationSecurityQueryOverride.findOne({
    applicationId,
    featureKey,
  }).lean();

  const defaultFilter = String(feature.defaultFilter || feature.ldapFilter || "").trim();
  const nextFilter =
    ldapFilter != null
      ? String(ldapFilter).trim()
      : String(existing?.ldapFilter ?? defaultFilter).trim();
  const nextSearchBase =
    searchBase != null
      ? String(searchBase).trim()
      : String(existing?.searchBase ?? "").trim();
  const nextSearchScope =
    searchScope != null
      ? String(searchScope).trim()
      : String(existing?.searchScope ?? "").trim();

  if (feature.executionMode === "LDAP" || feature.supportsSearchBase) {
    const validation = validateLdapQueryFields({
      ldapFilter:
        feature.executionMode === "LDAP"
          ? nextFilter
          : nextFilter || feature.ldapFilter || "(objectClass=*)",
      searchBase: nextSearchBase,
      searchScope: nextSearchScope,
      // HYBRID / graph features may save search base without requiring a custom filter.
      requireFilter: feature.executionMode === "LDAP",
    });
    if (!validation.valid) {
      const err = new Error(validation.errors[0] || "Invalid LDAP query configuration.");
      err.code = "INVALID_LDAP_QUERY";
      err.errors = validation.errors;
      throw err;
    }
  }

  const $set = {
    applicationId,
    featureKey,
    enabled: enabled !== false,
    modifiedBy: userId || null,
    ldapFilter: nextFilter,
    searchBase: nextSearchBase,
    searchScope: nextSearchScope,
    modified: defaultFilter !== nextFilter && Boolean(nextFilter),
  };

  const doc = await ApplicationSecurityQueryOverride.findOneAndUpdate(
    { applicationId, featureKey },
    { $set },
    { upsert: true, new: true },
  ).lean();

  return doc;
}

/**
 * Normalize query override payload from scan request body.
 * @param {Record<string, string|{ ldapFilter?: string, searchBase?: string, searchScope?: string }>|undefined} raw
 * @returns {Record<string, { ldapFilter?: string, searchBase?: string, searchScope?: string }>}
 */
export function normalizeBodyQueryOverrides(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [featureKey, value] of Object.entries(raw)) {
    if (!featureKey?.trim()) continue;
    if (typeof value === "string" && value.trim()) {
      out[featureKey] = { ldapFilter: value.trim() };
      continue;
    }
    if (!value || typeof value !== "object") continue;
    const entry = {};
    if (value.ldapFilter?.trim()) entry.ldapFilter = value.ldapFilter.trim();
    if (value.searchBase?.trim()) entry.searchBase = value.searchBase.trim();
    if (value.searchScope?.trim()) entry.searchScope = value.searchScope.trim();
    if (Object.keys(entry).length) out[featureKey] = entry;
  }
  return out;
}

/**
 * Merge DB-loaded overrides with request-body overrides (body wins per field).
 * @param {Record<string, { ldapFilter?: string, searchBase?: string, searchScope?: string }>} dbOverrides
 * @param {Record<string, { ldapFilter?: string, searchBase?: string, searchScope?: string }>} bodyOverrides
 */
export function mergeQueryOverrides(dbOverrides = {}, bodyOverrides = {}) {
  const out = { ...dbOverrides };
  for (const [featureKey, bodyEntry] of Object.entries(bodyOverrides || {})) {
    const merged = { ...(out[featureKey] || {}) };
    if (bodyEntry?.ldapFilter?.trim()) {
      merged.ldapFilter = bodyEntry.ldapFilter.trim();
    }
    if (bodyEntry?.searchBase?.trim()) {
      merged.searchBase = bodyEntry.searchBase.trim();
    }
    if (bodyEntry?.searchScope?.trim()) {
      merged.searchScope = bodyEntry.searchScope.trim();
    }
    out[featureKey] = merged;
  }
  return out;
}

/**
 * Load ldap filter overrides for scan execution.
 * @param {import('mongoose').Types.ObjectId|string} applicationId
 * @param {string[]} featureIds
 */
export async function loadQueryOverridesForFeatures(applicationId, featureIds) {
  const map = await loadQueryOverrideMap(applicationId);
  const out = {};
  for (const fid of featureIds || []) {
    const feature = getPostureFeatureById(fid);
    if (!feature) continue;
    const row = map.get(fid);
    const entry = {};
    const filter = row?.ldapFilter?.trim() || feature.ldapFilter || feature.defaultFilter;
    if (filter) {
      entry.ldapFilter = filter;
    }
    if (row?.searchBase?.trim()) {
      entry.searchBase = row.searchBase.trim();
    } else if (feature.defaultSearchBaseDn?.trim()) {
      entry.searchBase = feature.defaultSearchBaseDn.trim();
    }
    if (row?.searchScope?.trim()) {
      entry.searchScope = row.searchScope.trim();
    } else if (feature.searchScope) {
      entry.searchScope = feature.searchScope;
    }
    out[fid] = entry;
  }
  return out;
}
