/**
 * LDAP DN helpers — RFC 4514 attribute-value escaping for RDN construction.
 */

/**
 * Escape a single RDN attribute value for use in a DN.
 * Handles: , + " \ < > ; # = and leading/trailing space.
 * @param {string} value
 * @returns {string}
 */
export function escapeLdapDnValue(value) {
  let s = String(value ?? "");
  s = s
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/\+/g, "\\+")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/;/g, "\\;")
    .replace(/=/g, "\\=")
    .replace(/#/g, "\\#");
  if (s.startsWith(" ")) {
    s = `\\${s}`;
  }
  if (s.endsWith(" ")) {
    s = `${s.slice(0, -1)}\\ `;
  }
  return s;
}

/**
 * Escape a value for use inside an LDAP filter assertion.
 * @param {string} value
 * @returns {string}
 */
export function escapeLdapFilterValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\5c")
    .replace(/\*/g, "\\2a")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\0/g, "\\00");
}

/**
 * Build `CN=<escapedCn>,<parentDn>` without altering parentDn.
 * @param {string} cn
 * @param {string} parentDn
 * @returns {string}
 */
export function buildCnDn(cn, parentDn) {
  const parent = String(parentDn || "").trim();
  if (!parent) {
    throw new Error("Parent DN is required to build a user DN.");
  }
  const name = String(cn || "").trim();
  if (!name) {
    throw new Error("CN is required to build a user DN.");
  }
  return `CN=${escapeLdapDnValue(name)},${parent}`;
}
