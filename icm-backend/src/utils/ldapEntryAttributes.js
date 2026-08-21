/**
 * Read LDAP attributes from ldapts Entry objects (and legacy ldapjs SearchEntry shape).
 */

/** ldapts recursive search scope (ldapjs used the string "subtree"). */
export const LDAP_SEARCH_SCOPE_SUBTREE = "sub";
export const LDAP_SEARCH_SCOPE_BASE = "base";
export const LDAP_SEARCH_SCOPE_ONE = "one";

/**
 * Map framework searchScope (Base|OneLevel|Subtree) to ldapts scope.
 * @param {string} [searchScope]
 */
export function resolveLdaptsScope(searchScope) {
  const s = String(searchScope || "").trim();
  if (s === "Base" || s === "base") return LDAP_SEARCH_SCOPE_BASE;
  if (s === "OneLevel" || s === "one") return LDAP_SEARCH_SCOPE_ONE;
  return LDAP_SEARCH_SCOPE_SUBTREE;
}

const toStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

function decodeAttrValue(type, v) {
  if (v == null) return null;
  if (Buffer.isBuffer(v)) {
    if (type && type.toLowerCase() === "objectguid") return objectGuidToString(v);
    return v.toString("utf8");
  }
  if (Array.isArray(v)) {
    return v.map((x) => decodeAttrValue(type, x)).filter((x) => x != null && x !== "");
  }
  return String(v);
}

export function objectGuidToString(buf) {
  if (!buf) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 16) return b.toString("hex");
  const p = [
    b.readUInt32LE(0).toString(16).padStart(8, "0"),
    b.readUInt16LE(4).toString(16).padStart(4, "0"),
    b.readUInt16LE(6).toString(16).padStart(4, "0"),
    b.slice(8, 10).toString("hex"),
    b.slice(10, 16).toString("hex"),
  ];
  return `${p[0]}-${p[1]}-${p[2]}-${p[3]}-${p[4]}`.toUpperCase();
}

/**
 * ldapjs: entry.attributes[{ type, values }]. ldapts: Entry with dn + named keys.
 */
export function getAttrValues(entry, type) {
  if (!entry || !type) return [];

  if (Array.isArray(entry.attributes)) {
    const attr = entry.attributes.find(
      (a) => a.type?.toLowerCase() === String(type).toLowerCase(),
    );
    if (!attr) return [];
    const vals = attr.values ?? attr._vals ?? [];
    return vals
      .map((v) => decodeAttrValue(type, v))
      .flat()
      .map((x) => toStr(x))
      .filter(Boolean);
  }

  const want = String(type).toLowerCase();
  for (const key of Object.keys(entry)) {
    if (key === "dn" || key === "attributes") continue;
    if (key.toLowerCase() !== want) continue;
    const raw = entry[key];
    if (Array.isArray(raw)) {
      return raw
        .map((v) => decodeAttrValue(type, v))
        .flat()
        .map((x) => toStr(x))
        .filter(Boolean);
    }
    const one = decodeAttrValue(type, raw);
    if (one == null || one === "") return [];
    return Array.isArray(one) ? one.map((x) => toStr(x)).filter(Boolean) : [toStr(one)];
  }
  return [];
}

export function getAttrFirst(entry, type) {
  const v = getAttrValues(entry, type);
  return v.length ? v[0] : null;
}

function isMemberAttrName(name) {
  const n = String(name || "").toLowerCase();
  return n === "member" || n.startsWith("member;range=");
}

/**
 * ldapts exposes `member;range=0-N` as direct entry keys (not only entry.attributes).
 * @param {import('ldapts').Entry|object} entry
 */
function collectMemberDnsFromDirectEntry(entry) {
  const members = [];
  for (const key of Object.keys(entry)) {
    if (key === "dn" || key === "attributes") continue;
    if (!isMemberAttrName(key)) continue;
    const raw = entry[key];
    if (Array.isArray(raw)) {
      for (const v of raw) {
        const dn = decodeAttrValue("member", v);
        if (dn) members.push(String(dn).trim());
      }
      continue;
    }
    const dn = decodeAttrValue("member", raw);
    if (dn) members.push(String(dn).trim());
  }
  return members;
}

/**
 * Whether the LDAP entry included a member attribute (member or member;range=*).
 * @param {import('ldapts').Entry|object} entry
 */
export function hasLdapMemberAttribute(entry) {
  if (!entry) return false;
  if (Array.isArray(entry.attributes)) {
    return entry.attributes.some((a) => isMemberAttrName(a.type));
  }
  for (const key of Object.keys(entry)) {
    if (key === "dn" || key === "attributes") continue;
    if (isMemberAttrName(key)) return true;
  }
  return false;
}

/**
 * Collect direct member DNs from member and member;range=* attributes.
 * @param {import('ldapts').Entry|object} entry
 * @returns {string[]}
 */
export function getMemberDnsFromEntry(entry) {
  if (!entry) return [];
  const members = [];

  if (Array.isArray(entry.attributes)) {
    for (const a of entry.attributes) {
      const name = String(a.type || "").toLowerCase();
      if (!isMemberAttrName(name)) continue;
      const vals = a.values ?? a._vals ?? [];
      for (const v of vals) {
        const dn = decodeAttrValue("member", v);
        if (dn) members.push(String(dn).trim());
      }
    }
    return members;
  }

  return collectMemberDnsFromDirectEntry(entry);
}

/**
 * Build raw attribute map for ingestion (preserves multi-value arrays).
 */
export function buildRawDataFromEntry(entry) {
  const raw = {};
  if (!entry) return raw;

  if (Array.isArray(entry.attributes)) {
    for (const a of entry.attributes) {
      const vals = getAttrValues(entry, a.type);
      if (vals.length === 1) raw[a.type] = vals[0];
      else if (vals.length > 1) raw[a.type] = vals;
    }
    return raw;
  }

  for (const key of Object.keys(entry)) {
    if (key === "dn" || key === "attributes") continue;
    const vals = getAttrValues(entry, key);
    if (vals.length === 1) raw[key] = vals[0];
    else if (vals.length > 1) raw[key] = vals;
  }
  return raw;
}
