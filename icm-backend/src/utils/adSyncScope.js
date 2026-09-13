import { DEFAULT_USER_FILTER } from "../services/ad/ldapNormalizer.js";

/** @typedef {'total'|'active'|'disabled'} AdSyncScope */

export const AD_SYNC_SCOPE_FILTERS = {
  total: DEFAULT_USER_FILTER,
  active:
    "(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
  disabled:
    "(&(objectClass=user)(objectCategory=person)(userAccountControl:1.2.840.113556.1.4.803:=2))",
};

/**
 * @param {string} [syncScope]
 * @returns {string}
 */
export function resolveUserSearchFilterForSyncScope(syncScope) {
  const key = String(syncScope || "total").trim().toLowerCase();
  return AD_SYNC_SCOPE_FILTERS[key] || AD_SYNC_SCOPE_FILTERS.total;
}

/**
 * @param {string} [syncScope]
 * @returns {AdSyncScope}
 */
export function normalizeAdSyncScope(syncScope) {
  const key = String(syncScope || "total").trim().toLowerCase();
  if (key === "active" || key === "disabled") return key;
  return "total";
}
