/**
 * Validates Application userMappings / entitlementMappings on save (Schema tab, Mapping Studio, API).
 */

function normalizeField(s) {
  return String(s || "").trim();
}

function technicalToDisplayName(fieldName) {
  return String(fieldName || "")
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const DEFAULT_PK_CANDIDATES = ["user_id", "employee_id", "username", "email"];

/**
 * Build a complete userMappings draft from detected CSV/schema headers
 * (same shape One-step Import persists: standardField = header name).
 * @param {string[]} headers
 * @param {{ primaryKey?: string }} [opts]
 * @returns {Array<object>}
 */
export function buildUserMappingsFromDetectedHeaders(headers, opts = {}) {
  const fields = (headers || []).map((h) => normalizeField(h)).filter(Boolean);
  if (!fields.length) return [];

  const preferredPk = normalizeField(opts.primaryKey);
  let pkField = "";
  if (preferredPk && fields.some((f) => f.toLowerCase() === preferredPk.toLowerCase())) {
    pkField = fields.find((f) => f.toLowerCase() === preferredPk.toLowerCase());
  } else {
    const hit = fields.find((f) => DEFAULT_PK_CANDIDATES.includes(f.toLowerCase()));
    pkField = hit || fields[0];
  }

  return fields.map((field) => {
    const row = {
      csvColumn: field,
      standardField: field,
      dataType: "String",
      isSensitive: false,
      isPrimaryKey: field === pkField,
      displayName: technicalToDisplayName(field),
    };
    return row;
  });
}

/**
 * Merge incoming schema rows into existing userMappings without dropping existing attributes.
 * Existing rows win on conflict (same standardField, case-insensitive). Incoming PK is used
 * only when existing has no primary key.
 * @param {unknown} existing
 * @param {unknown} incoming
 * @returns {Array<object>}
 */
export function mergeUserMappingsPreserveExisting(existing, incoming) {
  const base = Array.isArray(existing) ? existing : [];
  const add = Array.isArray(incoming) ? incoming : [];
  const byKey = new Map();

  for (const m of base) {
    const sf = normalizeField(m?.standardField);
    if (!sf) continue;
    byKey.set(sf.toLowerCase(), m);
  }

  const existingHasPk = [...byKey.values()].some((m) => m?.isPrimaryKey === true);

  for (const m of add) {
    const sf = normalizeField(m?.standardField);
    if (!sf) continue;
    const key = sf.toLowerCase();
    if (byKey.has(key)) continue;
    byKey.set(key, {
      ...m,
      // Do not introduce a second PK when existing already has one.
      isPrimaryKey: existingHasPk ? false : Boolean(m?.isPrimaryKey),
    });
  }

  return [...byKey.values()];
}

/**
 * Ensure Application.userMappings is populated from a *complete* detected schema.
 * - Never replaces non-empty userMappings with a strictly smaller / partial list.
 * - When empty, sets the complete schema.
 * - When non-empty, merges in any missing attributes from the complete schema.
 *
 * @param {unknown} existingUserMappings
 * @param {unknown} completeSchemaMappings  full detected schema (e.g. all CSV headers)
 * @returns {{ ok: true, userMappings: Array, changed: boolean } | { ok: false, message: string }}
 */
export function ensureUserMappingsFromCompleteSchema(existingUserMappings, completeSchemaMappings) {
  if (!Array.isArray(completeSchemaMappings) || completeSchemaMappings.length === 0) {
    return {
      ok: true,
      userMappings: Array.isArray(existingUserMappings) ? existingUserMappings : [],
      changed: false,
    };
  }

  const completeCheck = validateUserMappings(completeSchemaMappings);
  if (!completeCheck.ok) {
    return { ok: false, message: completeCheck.message };
  }

  const existing = Array.isArray(existingUserMappings) ? existingUserMappings : [];

  if (existing.length === 0) {
    return { ok: true, userMappings: completeCheck.normalized, changed: true };
  }

  // Refuse to shrink: if "complete" is a strict subset of existing keys, keep existing as-is.
  const existingKeys = new Set(
    existing.map((m) => normalizeField(m?.standardField).toLowerCase()).filter(Boolean),
  );
  const completeKeys = new Set(
    completeCheck.normalized.map((m) => normalizeField(m.standardField).toLowerCase()).filter(Boolean),
  );
  const completeIsSubset =
    completeKeys.size > 0 &&
    completeKeys.size < existingKeys.size &&
    [...completeKeys].every((k) => existingKeys.has(k));
  if (completeIsSubset) {
    return { ok: true, userMappings: existing, changed: false };
  }

  const merged = mergeUserMappingsPreserveExisting(existing, completeCheck.normalized);
  const mergedCheck = validateUserMappings(merged);
  if (!mergedCheck.ok) {
    return { ok: false, message: mergedCheck.message };
  }

  const changed =
    mergedCheck.normalized.length !== existing.length ||
    mergedCheck.normalized.some((m) => !existingKeys.has(normalizeField(m.standardField).toLowerCase()));

  return { ok: true, userMappings: mergedCheck.normalized, changed };
}

/**
 * @param {unknown} mappings
 * @returns {{ ok: true, normalized: Array } | { ok: false, message: string }}
 */
export function validateUserMappings(mappings) {
  if (mappings === undefined) return { ok: true, normalized: undefined };
  if (!Array.isArray(mappings)) {
    return { ok: false, message: "userMappings must be an array" };
  }
  if (mappings.length === 0) {
    return { ok: true, normalized: [] };
  }

  const seen = new Set();
  let pkCount = 0;

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i] || {};
    const standardField = normalizeField(m.standardField);
    const csvColumn = normalizeField(m.csvColumn);
    if (!standardField) {
      return { ok: false, message: `userMappings[${i}]: technical name (standardField) is required` };
    }
    if (!csvColumn) {
      return { ok: false, message: `userMappings[${i}]: CSV column (csvColumn) is required` };
    }
    const key = standardField.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: `Duplicate technical name: "${standardField}"` };
    }
    seen.add(key);
    if (m.isPrimaryKey === true) pkCount += 1;
  }

  if (pkCount !== 1) {
    return {
      ok: false,
      message:
        pkCount === 0
          ? "Select exactly one primary key attribute for application users."
          : "Only one attribute can be marked as primary key for application users.",
    };
  }

  const normalized = mappings.map((m) => {
    const row = {
      csvColumn: normalizeField(m.csvColumn),
      standardField: normalizeField(m.standardField),
      dataType: normalizeField(m.dataType) || "String",
      isSensitive: Boolean(m.isSensitive),
      isPrimaryKey: Boolean(m.isPrimaryKey),
    };
    const dn = m.displayName != null ? String(m.displayName).trim() : "";
    if (dn) row.displayName = dn;
    if (m.maxLength != null && m.maxLength !== "") {
      const n = Number.parseInt(String(m.maxLength), 10);
      if (!Number.isNaN(n) && n >= 0) row.maxLength = n;
    }
    return row;
  });

  return { ok: true, normalized };
}

/**
 * Extra required fields for IGA user schema.
 * - display_name + status required always
 * - manager_id OR manager_name required when authoritativeSource=true
 * @param {Array<{standardField?: string}>} userMappings
 * @param {{ authoritative?: boolean }} opts
 */
export function validateRequiredUserSchemaFields(userMappings, opts = {}) {
  const authoritative = Boolean(opts.authoritative);
  // Non-authoritative apps: only validateUserMappings rules (e.g. PK) apply.
  if (!authoritative) {
    return { ok: true };
  }

  const fields = new Set(
    (userMappings || [])
      .map((m) => normalizeField(m.standardField).toLowerCase())
      .filter(Boolean),
  );

  const missing = [];
  if (!fields.has("display_name")) missing.push("display_name");
  if (!fields.has("status")) missing.push("status");
  if (!fields.has("manager_id") && !fields.has("manager_name")) {
    missing.push("manager_id OR manager_name");
  }

  if (missing.length) {
    return {
      ok: false,
      message: `Missing required user schema field(s): ${missing.join(", ")}.`,
      missing,
    };
  }
  return { ok: true };
}

/**
 * Entitlements: unique standardField; exactly one primary key (same rules as user schema).
 */
export function validateEntitlementMappings(mappings) {
  if (mappings === undefined) return { ok: true, normalized: undefined };
  if (!Array.isArray(mappings)) {
    return { ok: false, message: "entitlementMappings must be an array" };
  }
  if (mappings.length === 0) {
    return { ok: true, normalized: [] };
  }

  const seen = new Set();
  let pkCount = 0;

  for (let i = 0; i < mappings.length; i++) {
    const m = mappings[i] || {};
    const standardField = normalizeField(m.standardField);
    const csvColumn = normalizeField(m.csvColumn);
    if (!standardField) {
      return { ok: false, message: `entitlementMappings[${i}]: technical name (standardField) is required` };
    }
    if (!csvColumn) {
      return { ok: false, message: `entitlementMappings[${i}]: CSV column (csvColumn) is required` };
    }
    const key = standardField.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, message: `Duplicate technical name: "${standardField}"` };
    }
    seen.add(key);
    if (m.isPrimaryKey === true) pkCount += 1;
  }

  if (pkCount !== 1) {
    return {
      ok: false,
      message:
        pkCount === 0
          ? "Select exactly one primary key attribute for entitlements."
          : "Only one attribute can be marked as primary key for entitlements.",
    };
  }

  const normalized = mappings.map((m) => {
    const row = {
      csvColumn: normalizeField(m.csvColumn),
      standardField: normalizeField(m.standardField),
      dataType: normalizeField(m.dataType) || "String",
      isSensitive: Boolean(m.isSensitive),
      isPrimaryKey: Boolean(m.isPrimaryKey),
    };
    const dn = m.displayName != null ? String(m.displayName).trim() : "";
    if (dn) row.displayName = dn;
    if (m.maxLength != null && m.maxLength !== "") {
      const n = Number.parseInt(String(m.maxLength), 10);
      if (!Number.isNaN(n) && n >= 0) row.maxLength = n;
    }
    return row;
  });

  return { ok: true, normalized };
}

/**
 * Strict user CSV (Manual Setup / userMappings): headers must match standardField set exactly (order-insensitive).
 */
export function validateUserCsvHeadersAgainstSchema(userMappings, headerFields) {
  const expected = new Set(
    (userMappings || []).map((m) => normalizeField(m.standardField)).filter(Boolean),
  );
  const actual = new Set(
    (headerFields || []).map((h) => normalizeField(h)).filter((h) => h !== ""),
  );

  if (expected.size === 0) {
    return {
      ok: false,
      message: "No user schema (userMappings) defined for this application.",
      missing: [],
      extra: headerFields || [],
    };
  }

  const missing = [...expected].filter((k) => !actual.has(k)).sort();
  const extra = [...actual].filter((k) => !expected.has(k)).sort();

  if (missing.length || extra.length) {
    return {
      ok: false,
      message: "CSV headers must match the application schema technical names exactly.",
      missing,
      extra,
    };
  }

  return { ok: true };
}

/**
 * Map & import CSV: headers must include each mapping's csvColumn (fallback standardField). Extra columns allowed.
 * @param {unknown} importCfg Optional `csvImportMapping` fragment: display name mode + first/last / fallback columns.
 */
export function validateMappedUserCsvHeaders(mappings, headerFields, importCfg = {}) {
  const expected = new Set(
    (mappings || [])
      .map((m) => normalizeField(m.csvColumn) || normalizeField(m.standardField))
      .filter(Boolean),
  );

  const mode = String(importCfg.displayNameMode || "").toLowerCase();
  if (mode === "first_last") {
    const a = normalizeField(importCfg.displayNameFirstColumn);
    const b = normalizeField(importCfg.displayNameLastColumn);
    if (a) expected.add(a);
    if (b) expected.add(b);
  } else {
    const fa = normalizeField(importCfg.displayNameFallbackFirstColumn);
    const fb = normalizeField(importCfg.displayNameFallbackLastColumn);
    if (fa) expected.add(fa);
    if (fb) expected.add(fb);
  }

  const actual = new Set(
    (headerFields || []).map((h) => normalizeField(h)).filter((h) => h !== ""),
  );

  if (expected.size === 0) {
    return {
      ok: false,
      message: "No CSV import mapping defined. Save a mapping in Map & import first.",
      missing: [],
      extra: headerFields || [],
    };
  }

  const missing = [...expected].filter((k) => !actual.has(k)).sort();
  const extra = [...actual].filter((k) => !expected.has(k)).sort();

  if (missing.length) {
    return {
      ok: false,
      message: "CSV headers must include all columns required by the saved import mapping.",
      missing,
      extra,
    };
  }

  return { ok: true };
}

/**
 * Strict entitlement CSV: headers must match entitlementMappings standardField set exactly (order-insensitive).
 */
export function validateEntitlementCsvHeadersAgainstSchema(entitlementMappings, headerFields) {
  const expected = new Set(
    (entitlementMappings || []).map((m) => normalizeField(m.standardField)).filter(Boolean),
  );
  const actual = new Set(
    (headerFields || []).map((h) => normalizeField(h)).filter((h) => h !== ""),
  );

  if (expected.size === 0) {
    return {
      ok: false,
      message: "No entitlement schema (entitlementMappings) defined for this application.",
      missing: [],
      extra: headerFields || [],
    };
  }

  const missing = [...expected].filter((k) => !actual.has(k)).sort();
  const extra = [...actual].filter((k) => !expected.has(k)).sort();

  if (missing.length || extra.length) {
    return {
      ok: false,
      message: "CSV headers must match the entitlement schema technical names exactly.",
      missing,
      extra,
    };
  }

  return { ok: true };
}
