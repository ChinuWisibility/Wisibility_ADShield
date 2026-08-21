import { normalizePrimaryKeyValue } from "../applicationUserIngestService.js";
import { classifyAccountStatusRaw } from "../applicationUserStatusCountsService.js";

const ENTITLEMENT_FIELD_HINTS = [
  "entitlement",
  "entitlements",
  "member_of",
  "role",
  "roles",
  "group",
  "groups",
  "permission",
  "permissions",
];

const CASE_INSENSITIVE_COMPARE_FIELDS = new Set(["status", "email", "mail"]);

/**
 * @param {object[]} userMappings
 * @returns {string[]}
 */
export function getCompareFieldNames(userMappings, compareFieldsMode = "userMappings") {
  const fields = new Set();
  for (const m of userMappings || []) {
    const sf = String(m.standardField || "").trim();
    if (!sf) continue;
    if (isEntitlementFieldName(sf)) continue;
    fields.add(sf);
  }
  if (compareFieldsMode === "userMappings" || fields.size === 0) {
    return [...fields];
  }
  return [...fields];
}

/**
 * @param {object[]} userMappings
 * @param {object} [csvImportMapping]
 */
export function resolveEntitlementFieldNames(userMappings, csvImportMapping) {
  const names = new Set();
  const entField = String(csvImportMapping?.entitlementsStandardField || "").trim();
  if (entField) names.add(entField);
  const importMappings = Array.isArray(csvImportMapping?.mappings)
    ? csvImportMapping.mappings
    : [];
  if (entField) {
    const mapped = importMappings.find(
      (m) => String(m?.standardField || "").trim() === entField,
    );
    const csv = String(mapped?.csvColumn || "").trim();
    if (csv) names.add(csv);
  }
  for (const m of userMappings || []) {
    const sf = String(m.standardField || "").trim();
    if (sf && isEntitlementFieldName(sf)) {
      names.add(sf);
      const csv = String(m.csvColumn || "").trim();
      if (csv && csv !== sf) names.add(csv);
    }
  }
  return [...names];
}

export function isEntitlementFieldName(fieldName) {
  const lower = String(fieldName || "").toLowerCase();
  return ENTITLEMENT_FIELD_HINTS.some((h) => lower.includes(h));
}

/**
 * Parse entitlement cell into normalized string set.
 * @param {unknown} value
 * @returns {Set<string>}
 */
export function parseEntitlementsValue(value) {
  const out = new Set();
  if (value == null || value === "") return out;
  const parts = Array.isArray(value)
    ? value.flatMap((v) => String(v).split(/[;,|]/))
    : String(value).split(/[;,|]/);
  for (const p of parts) {
    const t = String(p || "").trim();
    if (t) out.add(t.toLowerCase());
  }
  return out;
}

/**
 * @param {object} doc
 * @param {string[]} entitlementFields
 */
export function extractEntitlementsFromDoc(doc, entitlementFields) {
  const out = new Set();
  const raw = doc?.rawData && typeof doc.rawData === "object" ? doc.rawData : null;
  for (const f of entitlementFields) {
    const direct = doc ? doc[f] : undefined;
    if (direct != null && direct !== "") {
      for (const e of parseEntitlementsValue(direct)) out.add(e);
      continue;
    }
    if (raw && raw[f] != null && raw[f] !== "") {
      for (const e of parseEntitlementsValue(raw[f])) out.add(e);
    }
  }
  return out;
}

/**
 * Normalize connector raw values for hash/compare (UAC → active/disabled, empty → null).
 */
export function normalizeConnectorFieldValue(fieldName, rawValue) {
  if (rawValue == null || rawValue === "") return null;
  const field = String(fieldName || "").toLowerCase();
  if (field === "status") {
    const s = String(rawValue).trim();
    if (/^\d+$/.test(s)) {
      const bucket = classifyAccountStatusRaw(s);
      if (bucket === "active") return "active";
      if (bucket === "inactive") return "disabled";
    }
  }
  return normalizeValue(rawValue);
}

/**
 * Resolve a compare-field value from top-level doc or rawData via import/mapping columns.
 */
export function resolveCompareFieldValue(doc, fieldName, userMappings, csvImportMapping) {
  const direct = normalizeConnectorFieldValue(fieldName, doc?.[fieldName]);
  if (direct !== null) return direct;

  const raw = doc?.rawData && typeof doc.rawData === "object" ? doc.rawData : null;
  if (!raw) return null;

  const importMappings = Array.isArray(csvImportMapping?.mappings)
    ? csvImportMapping.mappings
    : [];
  const importMap = importMappings.find(
    (m) => String(m?.standardField || "").trim() === fieldName,
  );
  if (importMap) {
    const csvCol = String(importMap.csvColumn || "").trim();
    if (csvCol && raw[csvCol] != null && raw[csvCol] !== "") {
      const v = normalizeConnectorFieldValue(fieldName, raw[csvCol]);
      if (v !== null) return v;
    }
  }

  for (const m of userMappings || []) {
    if (String(m.standardField || "").trim() !== fieldName) continue;
    const csvCol = String(m.csvColumn || "").trim();
    if (csvCol && raw[csvCol] != null && raw[csvCol] !== "") {
      const v = normalizeConnectorFieldValue(fieldName, raw[csvCol]);
      if (v !== null) return v;
    }
  }

  if (raw[fieldName] != null && raw[fieldName] !== "") {
    return normalizeConnectorFieldValue(fieldName, raw[fieldName]);
  }

  const adAliases = {
    user_id: ["sAMAccountName", "samaccountname"],
    username: ["sAMAccountName", "givenName", "samaccountname", "givenname"],
    email: ["mail", "email"],
    display_name: ["displayName", "userPrincipalName", "cn"],
    employee_id: ["employeeNumber", "employeeID"],
    department: ["department"],
    title: ["title"],
    manager_id: ["manager"],
    telephone: ["telephoneNumber", "telephone"],
    status: ["userAccountControl", "useraccountcontrol"],
  };
  for (const alias of adAliases[fieldName] || []) {
    if (raw[alias] != null && raw[alias] !== "") {
      const v = normalizeConnectorFieldValue(fieldName, raw[alias]);
      if (v !== null) return v;
    }
  }

  return null;
}

/**
 * Build comparable attributes object from user doc.
 */
export function extractAttributes(doc, compareFields, userMappings, csvImportMapping) {
  const attrs = {};
  for (const f of compareFields) {
    attrs[f] =
      userMappings || csvImportMapping
        ? resolveCompareFieldValue(doc, f, userMappings, csvImportMapping)
        : normalizeValue(doc[f]);
  }
  return attrs;
}

export function normalizeValue(v) {
  if (v == null) return null;
  if (Array.isArray(v)) {
    return [...v]
      .map((x) => (x != null && typeof x === "object" ? JSON.stringify(x) : String(x).trim()))
      .filter(Boolean)
      .sort()
      .join("; ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * @param {string} field
 * @param {unknown} a
 * @param {unknown} b
 */
export function valuesEqual(field, a, b) {
  const na = normalizeValue(a);
  const nb = normalizeValue(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  if (CASE_INSENSITIVE_COMPARE_FIELDS.has(String(field).toLowerCase())) {
    return String(na).toLowerCase() === String(nb).toLowerCase();
  }
  return String(na) === String(nb);
}

/**
 * @param {object} doc
 * @param {object[]} userMappings
 * @param {string} pkField
 */
export function buildAccountEntryFromDoc(doc, userMappings, pkField, csvImportMapping) {
  const rawPk = doc[pkField];
  const identityKey = normalizePrimaryKeyValue(rawPk);
  const compareFields = getCompareFieldNames(userMappings);
  const entitlementFields = resolveEntitlementFieldNames(userMappings, csvImportMapping);
  return {
    identityKey,
    displayPk: rawPk != null ? String(rawPk).trim() : "",
    attributes: extractAttributes(doc, compareFields, userMappings, csvImportMapping),
    entitlements: extractEntitlementsFromDoc(doc, entitlementFields),
    rawDoc: doc,
  };
}

/**
 * @param {object[]} canonicalDocs
 */
export function buildAccountMap(canonicalDocs, userMappings, csvImportMapping) {
  const pk = (userMappings || []).find((m) => m.isPrimaryKey);
  const pkField = pk ? String(pk.standardField || "").trim() : "";
  if (!pkField) throw new Error("Primary key field is required for reconciliation");
  const map = new Map();
  for (const doc of canonicalDocs || []) {
    const entry = buildAccountEntryFromDoc(doc, userMappings, pkField, csvImportMapping);
    if (!entry.identityKey) continue;
    map.set(entry.identityKey, entry);
  }
  return { map, pkField };
}

/**
 * Count active/inactive from attributes using status field.
 */
export function countActiveInactive(accountMap, inactiveValues = []) {
  const inactiveSet = new Set(
    (inactiveValues || ["inactive", "disabled", "terminated"]).map((v) =>
      String(v).toLowerCase(),
    ),
  );
  let active = 0;
  let inactive = 0;
  for (const entry of accountMap.values()) {
    const status = String(entry.attributes?.status ?? entry.rawDoc?.status ?? "").toLowerCase();
    if (!status || inactiveSet.has(status)) inactive += 1;
    else active += 1;
  }
  return { active, inactive };
}

/**
 * Union of all entitlements across accounts in a map.
 * @param {Map<string, { entitlements: Set<string> }>} accountMap
 */
export function buildEntitlementCatalog(accountMap) {
  const catalog = new Set();
  for (const entry of accountMap.values()) {
    for (const e of entry.entitlements || []) catalog.add(e);
  }
  return catalog;
}
