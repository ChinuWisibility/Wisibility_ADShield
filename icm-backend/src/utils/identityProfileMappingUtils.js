import mongoose from "mongoose";
import {
  getDynamicIdentityModelForTenantId,
  mirrorIdentityBulkWriteToLegacy,
} from "../models/identity/Identity.js";
import Transform from "../models/governance/Transform.js";
import { executeTransform } from "../services/transform/transformEngine.js";
import {
  TRANSFORM_OPTIONS,
  CORRELATION_KEY_SET,
} from "../constants/identityProfileTargets.js";
import { applyManagerCorrelationForProfile } from "./managerCorrelationEngine.js";

const LIFECYCLE_ENUM = [
  "NEW",
  "ACTIVE",
  "MOVER",
  "LEAVER",
  "TERMINATED",
  "QUARANTINE",
  "INACTIVE",
];

/** Spreadsheets / JSON may coerce phones and IDs to doubles or "1.46E+11"; store as plain digit text. */
function normalizeDigitLikeStoredString(val) {
  if (val === undefined || val === null || val === "") return "";
  if (typeof val === "number" && Number.isFinite(val)) {
    const r = Math.round(val);
    if (Number.isInteger(val) || Math.abs(val - r) < 1e-9) {
      try {
        return globalThis.BigInt(r).toString();
      } catch {
        return String(r);
      }
    }
    return String(val);
  }
  const s = String(val).trim();
  if (/^[+-]?(?:\d+\.?\d*|\d*\.\d+)[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return normalizeDigitLikeStoredString(n);
  }
  return s;
}

/** Strip BOM / trim for CSV header matching (Papa/csv-parser often preserve \ufeff on first column). */
function normalizeCsvHeaderKey(k) {
  return String(k ?? "")
    .replace(/^\ufeff/, "")
    .trim();
}

/** Resolve value from a raw CSV row using column name with case/BOM-tolerant key matching. */
export function findRowValueForCsvColumn(row, csvColumn) {
  if (!row || typeof row !== "object" || !csvColumn) return undefined;
  const want = normalizeCsvHeaderKey(csvColumn).toLowerCase();
  if (!want) return undefined;
  for (const k of Object.keys(row)) {
    if (normalizeCsvHeaderKey(k).toLowerCase() === want) return row[k];
  }
  return undefined;
}

export function applyMappingTransform(value, transform) {
  if (value == null || value === undefined) return "";
  const s = String(value);
  switch (transform) {
    case "toLower":
      return s.toLowerCase();
    case "toUpper":
      return s.toUpperCase();
    case "trim":
      return s.trim();
    default:
      return s;
  }
}

/** Resolve value for one mapping row (supports concatFirstLast / defaultIfEmpty). */
export function resolveMappedValue(m, row) {
  if (m.customTransformId) {
    return "";
  }
  let raw = row?.[m.sourceAttribute];
  if ((raw === undefined || raw === null) && row && m.sourceAttribute) {
    raw = findRowValueForCsvColumn(row, m.sourceAttribute);
  }
  if ((raw === undefined || raw === null || raw === "") && row) {
    const tk = canonicalIdentityMappingTargetKey(String(m.targetKey || "").trim());
    if (tk === "displayName") {
      raw =
        findFirstValueByKeyAliases(row, [
          "display_name",
          "displayName",
          "displayname",
          "Display Name",
          "DISPLAY NAME",
        ]) ?? raw;
    }
  }
  if (raw === undefined || raw === null) raw = "";
  if (raw instanceof Date) raw = String(raw);
  const t = m.transform || "none";
  if (t === "concatFirstLast") {
    const a = String(row.firstname ?? row.firstName ?? "").trim();
    const b = String(row.lastname ?? row.lastName ?? "").trim();
    return [a, b].filter(Boolean).join(" ").trim();
  }
  if (t === "defaultIfEmpty") {
    const base = applyMappingTransform(raw, "none");
    return base || String(m.transformDefault ?? "").trim();
  }
  return applyMappingTransform(raw, t);
}

/**
 * Resolve one mapping row including optional Transform Studio JSON (`customTransformId`).
 * @param {{ transform?: string, customTransformId?: string|null, sourceAttribute?: string, transformDefault?: string }} m
 * @param {Record<string, unknown>} row
 * @param {import('mongoose').Types.ObjectId|string} tenantId
 * @param {{ transformCache?: Map<string, object> }} [options]
 */
/** Prefetch Transform Studio documents used on mapping rows (one query per refresh/preview). */
export async function buildTransformCacheForMappings(mappings, tenantId) {
  const cache = new Map();
  const ids = [
    ...new Set(
      (mappings || [])
        .map((m) => m.customTransformId)
        .filter((id) => id && mongoose.Types.ObjectId.isValid(String(id)))
        .map((id) => String(id)),
    ),
  ];
  if (!ids.length) return cache;
  const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
  const docs = await Transform.find({ _id: { $in: oids }, tenantId }).lean();
  for (const d of docs) cache.set(String(d._id), d);
  return cache;
}

export async function resolveMappedValueAsync(m, row, tenantId, options = {}) {
  const cid = m.customTransformId;
  if (cid && mongoose.Types.ObjectId.isValid(String(cid))) {
    const idStr = String(cid);
    let doc = options.transformCache?.get(idStr);
    if (!doc) {
      doc = await Transform.findOne({
        _id: new mongoose.Types.ObjectId(idStr),
        tenantId,
      }).lean();
      if (doc && options.transformCache) options.transformCache.set(idStr, doc);
    }
    if (!doc?.transformJson) return "";
    try {
      const ctx = row && typeof row === "object" ? { ...row } : {};
      const out = executeTransform(doc.transformJson, ctx);
      if (out === null || out === undefined) return "";
      return typeof out === "string" ? out : String(out);
    } catch {
      return "";
    }
  }
  return resolveMappedValue(m, row);
}

export function mapLifecycleFromCsvValue(raw, lifecycleRules) {
  const rules =
    lifecycleRules && typeof lifecycleRules === "object"
      ? lifecycleRules
      : null;
  if (rules && Object.keys(rules).length) {
    const k = String(raw ?? "").trim();
    if (
      k &&
      rules[k] != null &&
      LIFECYCLE_ENUM.includes(String(rules[k]).toUpperCase())
    ) {
      return String(rules[k]).toUpperCase();
    }
    const upper = k.toUpperCase();
    if (
      upper &&
      rules[upper] != null &&
      LIFECYCLE_ENUM.includes(String(rules[upper]).toUpperCase())
    ) {
      return String(rules[upper]).toUpperCase();
    }
  }
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!s) return "ACTIVE";
  if (LIFECYCLE_ENUM.includes(s)) return s;
  if (
    [
      "TRUE",
      "YES",
      "Y",
      "1",
      "ON",
      "ENABLED",
      "OPEN",
      "CURRENT",
      "EMPLOYED",
    ].includes(s)
  ) {
    return "ACTIVE";
  }
  if (
    ["FALSE", "NO", "N", "0", "OFF", "LOCKED", "DISABLED", "DISABLE"].includes(
      s,
    )
  ) {
    return "INACTIVE";
  }
  if (
    ["RESIGNED", "SEPARATED", "SEPARATION", "OFFBOARDED", "EXITED"].includes(s)
  ) {
    return "TERMINATED";
  }
  if (["ON_LEAVE", "LEAVE_OF_ABSENCE", "LOA"].includes(s)) {
    return "LEAVER";
  }
  if (["NEW_HIRE", "ONBOARDING", "JOINING"].includes(s)) {
    return "NEW";
  }
  if (s.includes("LEAV")) return "LEAVER";
  if (s.includes("TERM")) return "TERMINATED";
  if (
    s.includes("SEPARAT") ||
    s.includes("RESIGN") ||
    s.includes("OFFBOARD") ||
    s.includes("EXIT")
  )
    return "TERMINATED";
  if (s.includes("SUSPEND") || s.includes("LOCK") || s.includes("DISABL"))
    return "INACTIVE";
  if (s.includes("PEND")) return "NEW";
  if (s.includes("INACTIVE") || s === "DISABLED") return "INACTIVE";
  if (s.includes("ACTIVE") || s === "ACT") return "ACTIVE";
  return "ACTIVE";
}

function normalizeLooseKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findFirstValueByKeyAliases(source, aliases) {
  if (!source || typeof source !== "object") return undefined;
  const aliasSet = new Set(
    (aliases || []).map((a) => normalizeLooseKey(a)).filter(Boolean),
  );
  if (!aliasSet.size) return undefined;
  for (const key of Object.keys(source)) {
    const nk = normalizeLooseKey(key);
    if (!nk || !aliasSet.has(nk)) continue;
    const v = source[key];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function inferLifecycleFromRowAndAttrs(row, attrs, lifecycleRules) {
  const lifecycleAliases = [
    "status",
    "user_status",
    "account_status",
    "employment_status",
    "worker_status",
    "person_status",
    "lifecycle",
    "lifecycle_state",
    "state",
    "active_status",
    "status_code",
    "employment_code",
  ];

  const negativeBooleanAliases = [
    "account_disabled",
    "is_disabled",
    "disabled",
    "is_inactive",
    "locked",
    "is_locked",
    "lockout",
    "termination_flag",
    "terminated",
  ];

  const positiveBooleanAliases = [
    "is_active",
    "active",
    "enabled",
    "is_enabled",
    "is_employed",
  ];

  const primary =
    findFirstValueByKeyAliases(row, lifecycleAliases) ??
    findFirstValueByKeyAliases(attrs, lifecycleAliases);
  if (primary !== undefined)
    return mapLifecycleFromCsvValue(primary, lifecycleRules);

  const negative =
    findFirstValueByKeyAliases(row, negativeBooleanAliases) ??
    findFirstValueByKeyAliases(attrs, negativeBooleanAliases);
  if (negative !== undefined) {
    const s = String(negative).trim().toLowerCase();
    if (["true", "1", "yes", "y", "locked", "disabled"].includes(s))
      return "INACTIVE";
    if (["false", "0", "no", "n"].includes(s)) return "ACTIVE";
  }

  const positive =
    findFirstValueByKeyAliases(row, positiveBooleanAliases) ??
    findFirstValueByKeyAliases(attrs, positiveBooleanAliases);
  if (positive !== undefined) {
    const s = String(positive).trim().toLowerCase();
    if (["true", "1", "yes", "y", "active", "enabled"].includes(s))
      return "ACTIVE";
    if (["false", "0", "no", "n", "inactive", "disabled"].includes(s))
      return "INACTIVE";
  }

  return null;
}

export function csvRowToAccountFields(row, userMappings) {
  const acc = {};
  for (const um of userMappings || []) {
    const col = String(um.csvColumn || "").trim();
    const sf = String(um.standardField || "").trim();
    if (!col || !sf) continue;
    let val = row[col];
    if (val === undefined || val === null)
      val = findRowValueForCsvColumn(row, col);
    if (val !== undefined && val !== null) acc[sf] = val;
  }
  return acc;
}

/**
 * Row object for identity profile mapping preview — aligns with identity refresh:
 * standardField keys from the schema blueprint, back-filled from raw sample when column names differ.
 * Merged with raw sample keys so resolveMappedValue can still match header-style keys.
 */
export function buildPreviewRowFromSample(
  sample,
  userMappings,
  mappingSourceMode,
) {
  if (!sample || typeof sample !== "object") return {};
  if (mappingSourceMode !== "application_account_schema") {
    return { ...sample };
  }
  if (!userMappings?.length) {
    return { ...sample };
  }
  const acc = csvRowToAccountFields(sample, userMappings);
  for (const um of userMappings || []) {
    const sf = String(um.standardField || "").trim();
    const col = String(um.csvColumn || "").trim();
    if (!sf || !col) continue;
    const existing = acc[sf];
    if (
      existing !== undefined &&
      existing !== null &&
      String(existing).trim() !== ""
    )
      continue;
    const v = findRowValueForCsvColumn(sample, col);
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      acc[sf] = v;
    }
  }
  return { ...sample, ...acc };
}

/**
 * One normalized row per application user for identity profile refresh.
 * Keys include schema standardFields (for profile sourceAttribute) plus raw connector/CSV fields.
 */
export function buildAccountUserRowForIdentityRefresh(doc, userMappings) {
  if (!doc) return {};
  const ums = userMappings || [];
  const raw =
    doc.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? doc.rawData
      : {};
  const fromDoc = accountDocToCsvRow(doc, ums);
  return buildPreviewRowFromSample(
    { ...raw, ...fromDoc },
    ums,
    "application_account_schema",
  );
}

/** Meta keys on user docs — not application schema fields. */
const DOC_FIELD_META = new Set([
  "_id",
  "rawData",
  "applicationId",
  "__v",
  "createdAt",
  "updatedAt",
]);

/**
 * Read a value for one schema standardField from a stored user doc (exact key, then case-insensitive).
 */
function readStandardFieldFromDoc(doc, standardField) {
  if (!doc || standardField == null) return undefined;
  const sf = String(standardField).trim();
  if (!sf) return undefined;
  if (Object.prototype.hasOwnProperty.call(doc, sf)) {
    const v = doc[sf];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  const want = sf.toLowerCase();
  for (const k of Object.keys(doc)) {
    if (DOC_FIELD_META.has(k)) continue;
    if (String(k).toLowerCase() !== want) continue;
    const v = doc[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

/**
 * Values keyed by standardField, following Application schema (userMappings).
 * Prefer **rawData** (original CSV row as imported) so preview shows the same strings as the file (e.g. 18-10-2019),
 * not normalized Date / ISO values stored on the document from connectors or Mongoose.
 * Fall back to top-level doc fields when rawData has no value for that column.
 */
function valuesByStandardFieldFromUserDoc(doc, userMappings) {
  if (!doc) return {};
  const out = {};
  for (const um of userMappings || []) {
    const sf = String(um.standardField || "").trim();
    const col = String(um.csvColumn || "").trim();
    if (!sf) continue;
    let v = undefined;
    if (
      col &&
      doc.rawData &&
      typeof doc.rawData === "object" &&
      !Array.isArray(doc.rawData)
    ) {
      const rd = doc.rawData;
      v = rd[col];
      if (v === undefined || v === null || String(v).trim() === "") {
        v = findRowValueForCsvColumn(rd, col);
      }
    }
    if (v === undefined || v === null || String(v).trim() === "") {
      v = readStandardFieldFromDoc(doc, sf);
    }
    if (v instanceof Date) {
      v = String(v);
    }
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      out[sf] = v;
    }
  }
  return out;
}

/**
 * Reconstruct a “CSV row” for mapping preview / refresh from a materialized app user doc.
 * Shape matches what identity refresh feeds into csvRowToAccountFields: keys = csvColumn, values from schema rules above.
 * When rawData exists, it is spread first so unmapped columns still appear; mapped columns overwrite with resolved values.
 */
export function accountDocToCsvRow(doc, userMappings) {
  if (!doc) return {};
  const ums = userMappings || [];
  if (!ums.length) {
    const raw =
      doc.rawData &&
      typeof doc.rawData === "object" &&
      !Array.isArray(doc.rawData)
        ? doc.rawData
        : {};
    return Object.keys(raw).length ? { ...raw } : {};
  }

  const vals = valuesByStandardFieldFromUserDoc(doc, ums);
  const row = {};
  for (const um of ums) {
    const sf = String(um.standardField || "").trim();
    const col = String(um.csvColumn || "").trim();
    if (!sf || !col) continue;
    const v = vals[sf];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    row[col] = v;
  }

  const raw =
    doc.rawData &&
    typeof doc.rawData === "object" &&
    !Array.isArray(doc.rawData)
      ? doc.rawData
      : {};
  return Object.keys(raw).length ? { ...raw, ...row } : row;
}

/**
 * Value of the Application userMappings row marked isPrimaryKey (auth source / schema PK during onboarding).
 */
export function getPrimaryKeyValueFromAccountDoc(doc, userMappings) {
  const pk = (userMappings || []).find((m) => m.isPrimaryKey);
  if (!pk) return "";
  const sf = String(pk.standardField || "").trim();
  if (!sf) return "";
  const vals = valuesByStandardFieldFromUserDoc(doc, userMappings || []);
  const v = vals[sf];
  return v != null && String(v).trim() !== "" ? String(v).trim() : "";
}

function looksLikeMongoObjectId(s) {
  return typeof s === "string" && /^[a-f\d]{24}$/i.test(s.trim());
}

/**
 * Human-readable account identifier for UI: schema PK first, then common account fields.
 * Does not prefer MongoDB ObjectId strings when other identifiers exist.
 */
export function resolveApplicationAccountDisplayName(
  doc,
  userMappings,
  accountIdStr,
) {
  const pk = getPrimaryKeyValueFromAccountDoc(doc, userMappings);
  if (pk) return pk;
  if (doc) {
    const d = doc;
    const fb =
      d.samAccountName ||
      d.userPrincipalName ||
      d.username ||
      d.user_id ||
      d.email ||
      d.employee_id ||
      d.display_name ||
      d.displayName ||
      "";
    if (fb && String(fb).trim()) return String(fb).trim();
  }
  const aid = accountIdStr != null ? String(accountIdStr).trim() : "";
  if (aid && !looksLikeMongoObjectId(aid)) return aid;
  return "";
}

export function validateCorrelationConfig(
  correlationTargetKey,
  correlationFallbackKey,
  mappings,
  options = {},
) {
  // Bypassed correlation configuration validation as correlation is now handled in a separate dedicated page.
  return null;
}

/**
 * Maps UI-generated keys (e.g. "Work Email" → workEmail) onto canonical Identity payload keys used in csvRowToIdentityPayload.
 * Without this, Work Email maps to attributes.workEmail and payload.email stays empty → synthetic @unmapped.local emails.
 */
/** Drop legacy attribute copies of manager id when top-level managerEmployeeId is authoritative. */
export function stripStaleManagerAttributeKeys(attrs, payload = {}) {
  if (!attrs || typeof attrs !== "object") return attrs;
  const mgr = String(payload.managerEmployeeId ?? "").trim();
  if (!mgr) return attrs;
  const out = { ...attrs };
  for (const k of [
    "managerid",
    "manager_id",
    "managerId",
    "managerID",
    "MANAGER_ID",
    "Manager ID",
  ]) {
    delete out[k];
  }
  return out;
}

export function canonicalIdentityMappingTargetKey(key) {
  const raw = String(key || "").trim();
  if (!raw) return raw;
  const n = raw.replace(/_/g, "").toLowerCase();
  const aliases = {
    workemail: "email",
    useremail: "email",
    primaryemail: "email",
    givenname: "firstname",
    familyname: "lastname",
    surname: "lastname",
    firstname: "firstname",
    lastname: "lastname",
    email: "email",
    uid: "uid",
    employeeid: "employeeId",
    department: "department",
    title: "title",
    phone: "phone",
    displayname: "displayName",
    manageremail: "managerEmail",
    manageremployeeid: "managerEmployeeId",
    startdate: "startDate",
    status: "status",
  };
  return Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : raw;
}

/**
 * Correlation / upsert key must always match {@link csvRowToIdentityPayload} (which canonicalizes target keys).
 * Otherwise filters point at `attributes.workEmail` while values landed in `payload.email` → duplicate identities.
 */
export function canonicalCorrelationKey(correlationTargetKey) {
  return (
    canonicalIdentityMappingTargetKey(
      String(correlationTargetKey || "email").trim(),
    ) || "email"
  );
}

/** Normalized correlation value for batch maps / $in queries (must match {@link buildIdentityUpsertFilter}). */
export function getCorrelationValueFromPayload(correlationTargetKey, payload) {
  const key = canonicalCorrelationKey(correlationTargetKey);
  if (key === "email")
    return String(payload.email || "")
      .toLowerCase()
      .trim();
  if (key === "employeeId") {
    return String(payload.employeeId != null ? payload.employeeId : "").trim();
  }
  if (key === "uid") return String(payload.attributes?.uid || "").trim();
  if (
    [
      "displayName",
      "firstName",
      "lastName",
      "department",
      "title",
      "phoneNumber",
    ].includes(key)
  ) {
    return String(payload[key] != null ? payload[key] : "").trim();
  }
  return String(
    payload.attributes?.[key] != null ? payload.attributes[key] : "",
  ).trim();
}

/**
 * Load existing identity docs keyed by {@link getCorrelationValueFromPayload} for batch refresh.
 */
const CORRELATION_PREFETCH_IN_CHUNK = 12000;

export async function fetchExistingIdentitiesForCorrelationValues(
  tenantId,
  correlationTargetKey,
  values,
) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const key = canonicalCorrelationKey(correlationTargetKey);
  const uniq = [
    ...new Set(
      (values || []).map((v) => String(v).trim()).filter((v) => v !== ""),
    ),
  ];
  if (!uniq.length) return new Map();

  const map = new Map();
  for (let off = 0; off < uniq.length; off += CORRELATION_PREFETCH_IN_CHUNK) {
    const slice = uniq.slice(off, off + CORRELATION_PREFETCH_IN_CHUNK);
    let query;
    if (key === "email") {
      const lowered = slice.map((e) => e.toLowerCase());
      query = { tenantId, email: { $in: lowered } };
    } else if (key === "employeeId") {
      query = { tenantId, employeeId: { $in: slice } };
    } else if (key === "uid") {
      query = { tenantId, "attributes.uid": { $in: slice } };
    } else if (
      [
        "displayName",
        "firstName",
        "lastName",
        "department",
        "title",
        "phoneNumber",
      ].includes(key)
    ) {
      query = { tenantId, [key]: { $in: slice } };
    } else {
      query = { tenantId, [`attributes.${key}`]: { $in: slice } };
    }

    const docs = await Identity.find(query).lean();
    for (const d of docs) {
      let mapKey;
      if (key === "email")
        mapKey = String(d.email || "")
          .toLowerCase()
          .trim();
      else if (key === "employeeId") mapKey = String(d.employeeId || "").trim();
      else if (key === "uid") mapKey = String(d.attributes?.uid || "").trim();
      else if (
        [
          "displayName",
          "firstName",
          "lastName",
          "department",
          "title",
          "phoneNumber",
        ].includes(key)
      ) {
        mapKey = String(d[key] || "").trim();
      } else mapKey = String(d.attributes?.[key] || "").trim();
      if (mapKey) map.set(mapKey, d);
    }
  }
  return map;
}

export function buildIdentityUpsertFilter(tenantId, correlationKey, payload) {
  const tid = tenantId;
  const key = canonicalCorrelationKey(correlationKey);

  if (key === "email") {
    return {
      tenantId: tid,
      email: String(payload.email || "")
        .toLowerCase()
        .trim(),
    };
  }
  if (key === "employeeId") {
    return {
      tenantId: tid,
      employeeId: String(
        payload.employeeId != null ? payload.employeeId : "",
      ).trim(),
    };
  }
  if (key === "uid") {
    return {
      tenantId: tid,
      "attributes.uid": String(payload.attributes?.uid || "").trim(),
    };
  }
  if (
    [
      "displayName",
      "firstName",
      "lastName",
      "department",
      "title",
      "phoneNumber",
    ].includes(key)
  ) {
    return {
      tenantId: tid,
      [key]: String(payload[key] != null ? payload[key] : "").trim(),
    };
  }
  return {
    tenantId: tid,
    [`attributes.${key}`]: String(
      payload.attributes?.[key] != null ? payload.attributes[key] : "",
    ).trim(),
  };
}

export function shouldSkipCorrelation(correlationTargetKey, payload) {
  const key = canonicalCorrelationKey(correlationTargetKey);
  if (key === "email") return !String(payload.email || "").trim();
  if (key === "employeeId")
    return !String(payload.employeeId != null ? payload.employeeId : "").trim();
  if (key === "uid") return !String(payload.attributes?.uid || "").trim();
  if (
    [
      "displayName",
      "firstName",
      "lastName",
      "department",
      "title",
      "phoneNumber",
    ].includes(key)
  ) {
    return !String(payload[key] != null ? payload[key] : "").trim();
  }
  return !String(
    payload.attributes?.[key] != null ? payload.attributes[key] : "",
  ).trim();
}

/**
 * Find existing identity: primary correlation first, then optional fallback (SailPoint-style).
 * Insert filter uses primary key when present; else fallback when configured.
 */
export async function findIdentityMatchForUpsert(
  tenantId,
  correlationTargetKey,
  correlationFallbackKey,
  payload,
) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const primarySkip = shouldSkipCorrelation(correlationTargetKey, payload);
  const fbOk =
    correlationFallbackKey &&
    correlationFallbackKey !== correlationTargetKey &&
    !shouldSkipCorrelation(correlationFallbackKey, payload);

  if (!primarySkip) {
    const primaryFilter = buildIdentityUpsertFilter(
      tenantId,
      correlationTargetKey,
      payload,
    );
    const doc = await Identity.findOne(primaryFilter).lean();
    if (doc) return { identity: doc, filter: primaryFilter };
  }
  if (fbOk) {
    const fbFilter = buildIdentityUpsertFilter(
      tenantId,
      correlationFallbackKey,
      payload,
    );
    const doc = await Identity.findOne(fbFilter).lean();
    if (doc) return { identity: doc, filter: fbFilter };
  }

  if (!primarySkip) {
    return {
      identity: null,
      filter: buildIdentityUpsertFilter(
        tenantId,
        correlationTargetKey,
        payload,
      ),
    };
  }
  if (fbOk) {
    return {
      identity: null,
      filter: buildIdentityUpsertFilter(
        tenantId,
        correlationFallbackKey,
        payload,
      ),
    };
  }
  return {
    identity: null,
    filter: buildIdentityUpsertFilter(tenantId, correlationTargetKey, payload),
  };
}

export async function csvRowToIdentityPayload(
  row,
  mappings,
  tenantId,
  options = {},
) {
  const lifecycleRules = options.lifecycleRules;
  const payload = { tenantId };
  const attrs = {};
  for (const m of mappings) {
    const val = await resolveMappedValueAsync(m, row, tenantId, options);
    const rawTk = String(m.targetKey || "").trim();
    const tk = canonicalIdentityMappingTargetKey(rawTk);
    switch (tk) {
      case "email":
        payload.email = val ? String(val).toLowerCase().trim() : "";
        break;
      case "firstname":
        payload.firstName = val || "";
        break;
      case "lastname":
        payload.lastName = val || "";
        break;
      case "displayName":
        payload.displayName = val || "";
        break;
      case "uid":
        if (val) attrs.uid = normalizeDigitLikeStoredString(val);
        break;
      case "employeeId":
        payload.employeeId = val ? normalizeDigitLikeStoredString(val) : "";
        break;
      case "department":
        payload.department = val ? String(val) : "";
        break;
      case "title":
        payload.title = val ? String(val) : "";
        break;
      case "phone":
        payload.phoneNumber = val ? normalizeDigitLikeStoredString(val) : "";
        break;
      case "managerEmail":
        payload.managerEmail = val ? String(val) : "";
        break;
      case "managerEmployeeId":
        payload.managerEmployeeId = val
          ? normalizeDigitLikeStoredString(val).trim()
          : "";
        break;
      case "startDate":
        if (val) {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) payload.startDate = d;
        }
        break;
      case "status":
        payload.lifecycleState = mapLifecycleFromCsvValue(val, lifecycleRules);
        break;
      default:
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          attrs[rawTk] = normalizeDigitLikeStoredString(val);
        }
        break;
    }
  }
  // If email landed only under a custom key (legacy rows / duplicate naming), promote to payload.email
  if (!payload.email || !String(payload.email).trim()) {
    const fromAttrs =
      attrs.email ||
      attrs.workEmail ||
      attrs.userEmail ||
      attrs.primaryEmail ||
      attrs.mail;
    if (fromAttrs && String(fromAttrs).trim()) {
      payload.email = String(fromAttrs).toLowerCase().trim();
      delete attrs.email;
      delete attrs.workEmail;
      delete attrs.userEmail;
      delete attrs.primaryEmail;
      delete attrs.mail;
    }
  }
  if (Object.keys(attrs).length) payload.attributes = attrs;
  if (String(payload.managerEmployeeId || "").trim()) {
    payload.attributes = stripStaleManagerAttributeKeys(payload.attributes || {}, payload);
  }
  if (!payload.lifecycleState) {
    const inferredLifecycle = inferLifecycleFromRowAndAttrs(
      row,
      attrs,
      lifecycleRules,
    );
    if (inferredLifecycle) payload.lifecycleState = inferredLifecycle;
  }
  if (!payload.displayName) {
    const parts = [payload.firstName, payload.lastName].filter(Boolean);
    if (parts.length) payload.displayName = parts.join(" ").trim();
  }
  if (!payload.displayName && payload.email) {
    const local = payload.email.split("@")[0];
    payload.displayName = local || payload.email;
  }
  return payload;
}

/**
 * Same as {@link csvRowToIdentityPayload} but synchronous — use when no mapping row uses
 * `customTransformId` (avoids per-row await / microtask overhead in bulk refresh).
 */
export function csvRowToIdentityPayloadSync(
  row,
  mappings,
  tenantId,
  options = {},
) {
  const lifecycleRules = options.lifecycleRules;
  const payload = { tenantId };
  const attrs = {};
  for (const m of mappings) {
    const val = resolveMappedValue(m, row);
    const rawTk = String(m.targetKey || "").trim();
    const tk = canonicalIdentityMappingTargetKey(rawTk);
    switch (tk) {
      case "email":
        payload.email = val ? String(val).toLowerCase().trim() : "";
        break;
      case "firstname":
        payload.firstName = val || "";
        break;
      case "lastname":
        payload.lastName = val || "";
        break;
      case "displayName":
        payload.displayName = val || "";
        break;
      case "uid":
        if (val) attrs.uid = normalizeDigitLikeStoredString(val);
        break;
      case "employeeId":
        payload.employeeId = val ? normalizeDigitLikeStoredString(val) : "";
        break;
      case "department":
        payload.department = val ? String(val) : "";
        break;
      case "title":
        payload.title = val ? String(val) : "";
        break;
      case "phone":
        payload.phoneNumber = val ? normalizeDigitLikeStoredString(val) : "";
        break;
      case "managerEmail":
        payload.managerEmail = val ? String(val) : "";
        break;
      case "managerEmployeeId":
        payload.managerEmployeeId = val
          ? normalizeDigitLikeStoredString(val).trim()
          : "";
        break;
      case "startDate":
        if (val) {
          const d = new Date(val);
          if (!Number.isNaN(d.getTime())) payload.startDate = d;
        }
        break;
      case "status":
        payload.lifecycleState = mapLifecycleFromCsvValue(val, lifecycleRules);
        break;
      default:
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          attrs[rawTk] = normalizeDigitLikeStoredString(val);
        }
        break;
    }
  }
  if (!payload.email || !String(payload.email).trim()) {
    const fromAttrs =
      attrs.email ||
      attrs.workEmail ||
      attrs.userEmail ||
      attrs.primaryEmail ||
      attrs.mail;
    if (fromAttrs && String(fromAttrs).trim()) {
      payload.email = String(fromAttrs).toLowerCase().trim();
      delete attrs.email;
      delete attrs.workEmail;
      delete attrs.userEmail;
      delete attrs.primaryEmail;
      delete attrs.mail;
    }
  }
  if (Object.keys(attrs).length) payload.attributes = attrs;
  if (String(payload.managerEmployeeId || "").trim()) {
    payload.attributes = stripStaleManagerAttributeKeys(payload.attributes || {}, payload);
  }
  if (!payload.lifecycleState) {
    const inferredLifecycle = inferLifecycleFromRowAndAttrs(
      row,
      attrs,
      lifecycleRules,
    );
    if (inferredLifecycle) payload.lifecycleState = inferredLifecycle;
  }
  if (!payload.displayName) {
    const parts = [payload.firstName, payload.lastName].filter(Boolean);
    if (parts.length) payload.displayName = parts.join(" ").trim();
  }
  if (!payload.displayName && payload.email) {
    const local = payload.email.split("@")[0];
    payload.displayName = local || payload.email;
  }
  return payload;
}

/** Coerce populated { _id } from Mongoose or string ids for API payloads. */
function coerceApplicationRef(ref) {
  if (ref == null || ref === "") return null;
  if (typeof ref === "object" && ref !== null && ref._id != null)
    return String(ref._id);
  return String(ref);
}

export function normalizeMappingsPayload(mappings) {
  return (mappings || []).map((m) => {
    const rawRef = m.applicationId ?? m.hrmsSourceId;
    const appId = coerceApplicationRef(rawRef);
    const customRaw = m.customTransformId;
    const customId =
      customRaw != null &&
      String(customRaw).trim() !== "" &&
      mongoose.Types.ObjectId.isValid(String(customRaw).trim())
        ? String(customRaw).trim()
        : undefined;
    const trIn = m.transform || "none";
    const transform = TRANSFORM_OPTIONS.includes(trIn) ? trIn : "none";
    return {
      targetKey: canonicalIdentityMappingTargetKey(String(m.targetKey || "").trim()) || String(m.targetKey || "").trim(),
      targetLabel: String(m.targetLabel || "").trim(),
      applicationId: appId || undefined,
      hrmsSourceId:
        m.hrmsSourceId && !m.applicationId
          ? coerceApplicationRef(m.hrmsSourceId)
          : undefined,
      sourceAttribute: String(m.sourceAttribute || "").trim(),
      transform: TRANSFORM_OPTIONS.includes(m.transform) ? m.transform : "none",
      transformDefault:
        m.transformDefault != null ? String(m.transformDefault) : "",
      transform: customId ? "none" : transform,
      transformDefault:
        m.transformDefault != null ? String(m.transformDefault) : "",
      ...(customId
        ? { customTransformId: new mongoose.Types.ObjectId(customId) }
        : {}),
    };
  });
}

function isOid24(raw) {
  const s = String(raw || "").trim();
  return s.length === 24 && mongoose.Types.ObjectId.isValid(s);
}

/**
 * Resolve managerId for identities belonging to this profile (second pass after upsert).
 * Batched lookups + bulkWrite — avoids N×4 findOne pattern that starves the DB pool on large profiles.
 */
export async function resolveManagersForProfile(
  tenantId,
  profileId,
  managerLinkBy,
) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const mode = managerLinkBy === "employeeId" ? "employeeId" : "email";
  const profileOid =
    profileId instanceof mongoose.Types.ObjectId
      ? profileId
      : new mongoose.Types.ObjectId(String(profileId));

  const identities = await Identity.find({
    tenantId,
    identityProfileId: profileOid,
  })
    .select("_id managerEmail managerEmployeeId managerId")
    .lean();

  const oidStrings = new Set();
  const emailLowerSet = new Set();
  const empSet = new Set();
  const displaySet = new Set();

  for (const ident of identities) {
    const raw =
      mode === "employeeId"
        ? String(ident.managerEmployeeId || "").trim()
        : String(ident.managerEmail || "").trim();
    if (!raw) continue;
    if (isOid24(raw)) {
      oidStrings.add(String(raw));
    } else if (mode === "employeeId") {
      empSet.add(raw);
    } else {
      emailLowerSet.add(raw.toLowerCase());
      displaySet.add(raw);
    }
  }

  const byOid = new Map();
  if (oidStrings.size) {
    const oids = [...oidStrings].map((s) => new mongoose.Types.ObjectId(s));
    const docs = await Identity.find({ tenantId, _id: { $in: oids } })
      .select("_id")
      .lean();
    for (const d of docs) {
      byOid.set(String(d._id), d._id);
    }
  }

  const byEmail = new Map();
  if (emailLowerSet.size && mode === "email") {
    const docs = await Identity.find({
      tenantId,
      email: { $in: [...emailLowerSet] },
    })
      .select("_id email")
      .lean();
    for (const d of docs) {
      if (d.email) byEmail.set(String(d.email).toLowerCase(), d._id);
    }
  }

  const byEmp = new Map();
  if (empSet.size && mode === "employeeId") {
    const docs = await Identity.find({
      tenantId,
      employeeId: { $in: [...empSet] },
    })
      .select("_id employeeId")
      .lean();
    for (const d of docs) {
      if (d.employeeId != null && String(d.employeeId).trim()) {
        byEmp.set(String(d.employeeId).trim(), d._id);
      }
    }
  }

  const byDisplay = new Map();
  if (displaySet.size && mode === "email") {
    const docs = await Identity.find({
      tenantId,
      displayName: { $in: [...displaySet] },
    })
      .select("_id displayName")
      .lean();
    for (const d of docs) {
      if (d.displayName != null) byDisplay.set(String(d.displayName), d._id);
    }
  }

  let linked = 0;
  const ops = [];

  const idEq = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return String(a) === String(b);
  };

  for (const ident of identities) {
    const raw =
      mode === "employeeId"
        ? String(ident.managerEmployeeId || "").trim()
        : String(ident.managerEmail || "").trim();

    if (!raw) {
      if (!ident.managerId) continue;
      ops.push({
        updateOne: {
          filter: { _id: ident._id },
          update: { $unset: { managerId: "" } },
        },
      });
      continue;
    }

    let managerId = null;
    if (isOid24(raw)) {
      managerId = byOid.get(String(raw)) || null;
    } else if (mode === "email") {
      managerId = byEmail.get(raw.toLowerCase()) || byDisplay.get(raw) || null;
    } else {
      managerId = byEmp.get(raw) || null;
    }

    if (managerId && String(managerId) !== String(ident._id)) {
      if (idEq(ident.managerId, managerId)) continue;
      ops.push({
        updateOne: {
          filter: { _id: ident._id },
          update: { $set: { managerId } },
        },
      });
      linked += 1;
    } else {
      if (!ident.managerId) continue;
      ops.push({
        updateOne: {
          filter: { _id: ident._id },
          update: { $unset: { managerId: "" } },
        },
      });
    }
  }

  const CHUNK = 250;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    await Identity.bulkWrite(chunk, { ordered: false });
    await mirrorIdentityBulkWriteToLegacy(chunk);
  }

  return { managersLinked: linked, processed: identities.length };
}

/**
 * After identity refresh upserts: deterministic manager correlation when enabled, else legacy managerLinkBy matching.
 */
export async function resolveManagersAfterRefresh(tenantId, profile) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const mc = profile.managerCorrelation;
  const ma = mc && String(mc.managerAttribute || "").trim();
  const ra = mc && String(mc.referenceAttribute || "").trim();
  if (ma && ra) {
    return applyManagerCorrelationForProfile(
      tenantId,
      profile._id,
      profile,
      Identity,
    );
  }
  return resolveManagersForProfile(
    tenantId,
    profile._id,
    profile.managerLinkBy || "email",
  );
}

/**
 * Apply attribute authority: lower priority number wins. Only applies when multiple rules match same targetKey.
 */
export function pickAttributeByAuthority(
  targetKey,
  valueBySourceId,
  attributeAuthority,
) {
  const list = (attributeAuthority || [])
    .filter((a) => a.targetKey === targetKey && a.sourceApplicationId)
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of list) {
    const sid = String(rule.sourceApplicationId);
    const v = valueBySourceId[sid];
    if (v != null && String(v).trim() !== "") return v;
  }
  const first = Object.values(valueBySourceId).find(
    (v) => v != null && String(v).trim() !== "",
  );
  return first;
}
