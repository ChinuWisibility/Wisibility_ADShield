/**
 * LDAP matching-rule helpers for Active Directory bitwise filters.
 * Use when a dedicated LDAP query is preferable to in-memory scans.
 *
 * OID 1.2.840.113556.1.4.803 — LDAP_MATCHING_RULE_BIT_AND
 * OID 1.2.840.113556.1.4.804 — LDAP_MATCHING_RULE_BIT_OR
 */

export const LDAP_MATCHING_RULE_BIT_AND = "1.2.840.113556.1.4.803";
export const LDAP_MATCHING_RULE_BIT_OR = "1.2.840.113556.1.4.804";

/**
 * @param {string} attribute LDAP attribute name (e.g. userAccountControl)
 * @param {number} bitValue bit mask to test
 * @param {string} [ruleOid]
 */
export function buildBitwiseFilter(attribute, bitValue, ruleOid = LDAP_MATCHING_RULE_BIT_AND) {
  const attr = String(attribute || "").trim();
  const bit = Number(bitValue);
  if (!attr || !Number.isFinite(bit)) return "";
  return `(${attr}:${ruleOid}:=${bit})`;
}

/**
 * Compose a filter with an optional base user filter.
 * @param {string} baseFilter e.g. (&(objectClass=user)(objectCategory=person))
 * @param {string} bitFilter from buildBitwiseFilter
 */
export function andWithBaseFilter(baseFilter, bitFilter) {
  const base = String(baseFilter || "").trim();
  const bit = String(bitFilter || "").trim();
  if (!bit) return base;
  if (!base) return bit.startsWith("(") ? bit : `(${bit})`;
  if (base.startsWith("(&")) {
    return base.replace(/\)\s*$/, `${bit})`);
  }
  return `(&${base}${bit})`;
}
