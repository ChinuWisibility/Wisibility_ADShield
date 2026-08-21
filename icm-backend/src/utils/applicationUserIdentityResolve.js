import {
  findRowValueForCsvColumn,
  getPrimaryKeyValueFromAccountDoc,
} from "./identityProfileMappingUtils.js";

/**
 * Mapping-first identity resolution for application users.
 * Prefer onboarded static fields (userMappings / csvImportMapping), then rawData via csvColumn.
 * Thin generic fallback only when mappings are missing — no vendor-specific field matrices.
 */

const DOC_META = new Set([
  "_id",
  "__v",
  "rawData",
  "applicationId",
  "tenantId",
  "createdAt",
  "updatedAt",
  "lastReconRunId",
]);

/** @param {unknown} value */
export function isLikelyMongoObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "").trim());
}

function str(val) {
  if (val == null) return "";
  if (val instanceof Date) return String(val).trim();
  return String(val).trim();
}

/**
 * Merge Application.userMappings with csvImportMapping.mappings.
 * userMappings wins on duplicate standardField.
 * @param {object[]|null|undefined} userMappings
 * @param {object|null|undefined} csvImportMapping
 */
export function mergeApplicationUserMappings(userMappings, csvImportMapping) {
  const bySf = new Map();
  for (const m of csvImportMapping?.mappings || []) {
    const sf = String(m?.standardField || "").trim();
    if (sf) bySf.set(sf, m);
  }
  for (const m of userMappings || []) {
    const sf = String(m?.standardField || "").trim();
    if (sf) bySf.set(sf, m);
  }
  return [...bySf.values()];
}

function readTopLevelField(doc, fieldName) {
  if (!doc || !fieldName) return "";
  const sf = String(fieldName).trim();
  if (!sf) return "";
  if (Object.prototype.hasOwnProperty.call(doc, sf)) {
    const v = str(doc[sf]);
    if (v) return v;
  }
  const want = sf.toLowerCase();
  for (const k of Object.keys(doc)) {
    if (DOC_META.has(k)) continue;
    if (String(k).toLowerCase() !== want) continue;
    const v = str(doc[k]);
    if (v) return v;
  }
  return "";
}

function readRawColumn(doc, csvColumn) {
  const col = String(csvColumn || "").trim();
  if (!col) return "";
  const raw =
    doc?.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? doc.rawData
      : null;
  if (!raw) return "";
  let v = str(raw[col]);
  if (v) return v;
  v = str(findRowValueForCsvColumn(raw, col));
  return v || "";
}

/**
 * Resolve one mapped standard field: top-level static field, then rawData[csvColumn].
 * @param {object} doc
 * @param {{ standardField?: string, csvColumn?: string }|null|undefined} mapping
 */
export function resolveMappedFieldValue(doc, mapping) {
  if (!doc || !mapping) return "";
  const sf = String(mapping.standardField || "").trim();
  const col = String(mapping.csvColumn || "").trim();
  if (sf) {
    const top = readTopLevelField(doc, sf);
    if (top) return top;
  }
  if (col) {
    const fromRaw = readRawColumn(doc, col);
    if (fromRaw) return fromRaw;
  }
  // Mapping may use same name for both
  if (sf && sf !== col) {
    const fromRawAsSf = readRawColumn(doc, sf);
    if (fromRawAsSf) return fromRawAsSf;
  }
  return "";
}

function findMapping(mappings, standardField) {
  const want = String(standardField || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "");
  return (mappings || []).find((m) => {
    const sf = String(m?.standardField || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "");
    return sf === want;
  });
}

/** Thin generic fallback when app has no usable mappings. */
function genericEmail(doc) {
  const raw =
    doc?.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? doc.rawData
      : {};
  for (const c of [doc?.email, raw.email, raw.Email, raw.mail]) {
    const s = str(c);
    if (s.includes("@")) return s.toLowerCase();
  }
  return "";
}

function genericDisplayName(doc) {
  const raw =
    doc?.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? doc.rawData
      : {};
  for (const c of [
    doc?.display_name,
    doc?.displayName,
    raw.display_name,
    raw.displayName,
    doc?.name,
    raw.name,
    [raw.first_name, raw.last_name].filter(Boolean).join(" "),
    [doc?.first_name, doc?.last_name].filter(Boolean).join(" "),
  ]) {
    const s = str(c);
    if (s && !s.includes("@") && !isLikelyMongoObjectId(s)) return s;
  }
  return "";
}

function genericLogin(doc) {
  const raw =
    doc?.rawData && typeof doc.rawData === "object" && !Array.isArray(doc.rawData)
      ? doc.rawData
      : {};
  for (const c of [
    doc?.username,
    doc?.user_id,
    raw.username,
    raw.user_id,
    raw.Username,
  ]) {
    const s = str(c);
    if (s && !isLikelyMongoObjectId(s)) return s.toLowerCase();
  }
  return "";
}

function composeFirstLast(doc, csvImportMapping) {
  if (String(csvImportMapping?.displayNameMode || "").toLowerCase() !== "first_last") {
    return "";
  }
  const firstCol = String(csvImportMapping?.displayNameFirstColumn || "").trim();
  const lastCol = String(csvImportMapping?.displayNameLastColumn || "").trim();
  const first =
    readRawColumn(doc, firstCol) ||
    readTopLevelField(doc, firstCol) ||
    readTopLevelField(doc, "first_name") ||
    readRawColumn(doc, "first_name");
  const last =
    readRawColumn(doc, lastCol) ||
    readTopLevelField(doc, lastCol) ||
    readTopLevelField(doc, "last_name") ||
    readRawColumn(doc, "last_name");
  return [first, last].filter(Boolean).join(" ").trim();
}

/**
 * @param {object|null|undefined} userDoc - application user document (may include rawData)
 * @param {{ userMappings?: object[], csvImportMapping?: object }|null|undefined} appSchema
 * @returns {{
 *   primaryKey: string,
 *   email: string,
 *   displayName: string,
 *   userKey: string,
 *   department: string,
 *   hasMappings: boolean,
 * }}
 */
export function resolveApplicationUserIdentity(userDoc, appSchema = {}) {
  const doc = userDoc && typeof userDoc === "object" ? userDoc : null;
  if (!doc) {
    return {
      primaryKey: "",
      email: "",
      displayName: "",
      userKey: "",
      department: "",
      hasMappings: false,
    };
  }

  const mappings = mergeApplicationUserMappings(
    appSchema?.userMappings,
    appSchema?.csvImportMapping,
  );
  const hasMappings = mappings.length > 0;

  let primaryKey = "";
  let email = "";
  let displayName = "";
  let department = "";

  if (hasMappings) {
    primaryKey = str(getPrimaryKeyValueFromAccountDoc(doc, mappings));
    // Prefer top-level-first for identity labels (plan order); PK helper may prefer raw —
    // re-resolve PK mapping explicitly when empty or ObjectId-like.
    const pkMapping = mappings.find((m) => m.isPrimaryKey);
    if (pkMapping) {
      const mappedPk = resolveMappedFieldValue(doc, pkMapping);
      if (mappedPk && !isLikelyMongoObjectId(mappedPk)) primaryKey = mappedPk;
      else if (!primaryKey || isLikelyMongoObjectId(primaryKey)) {
        primaryKey = mappedPk && !isLikelyMongoObjectId(mappedPk) ? mappedPk : primaryKey;
      }
    }
    if (isLikelyMongoObjectId(primaryKey)) primaryKey = "";

    const emailMap = findMapping(mappings, "email");
    if (emailMap) {
      const v = resolveMappedFieldValue(doc, emailMap);
      if (v.includes("@")) email = v.toLowerCase();
    }

    displayName = composeFirstLast(doc, appSchema?.csvImportMapping);
    if (!displayName) {
      const dnMap = findMapping(mappings, "display_name");
      if (dnMap) {
        const v = resolveMappedFieldValue(doc, dnMap);
        if (v && !v.includes("@") && !isLikelyMongoObjectId(v)) displayName = v;
      }
    }

    const deptMap = findMapping(mappings, "department");
    if (deptMap) department = resolveMappedFieldValue(doc, deptMap);
  }

  // Thin generic fallback when mappings missing or field not mapped
  if (!email) email = genericEmail(doc);
  if (!displayName) displayName = genericDisplayName(doc);
  if (!department) {
    department =
      readTopLevelField(doc, "department") || readRawColumn(doc, "department");
  }
  if (!primaryKey) {
    const login = genericLogin(doc);
    if (login) primaryKey = login;
  }

  let userKey = "";
  if (email.includes("@")) userKey = email;
  else if (primaryKey && !isLikelyMongoObjectId(primaryKey)) {
    userKey = primaryKey.toLowerCase();
  } else {
    const login = genericLogin(doc);
    if (login) userKey = login;
  }

  // Never prefer Mongo _id when a mapped PK/email exists; last resort only
  if (!userKey) {
    const id = doc._id?.toString?.() || "";
    if (id) userKey = String(id).trim().toLowerCase();
  }

  if (isLikelyMongoObjectId(displayName)) displayName = "";
  if (!displayName && email.includes("@")) {
    const local = email.split("@")[0];
    if (local && !isLikelyMongoObjectId(local)) {
      displayName = local
        .replace(/[._-]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }
  if (!displayName && primaryKey && !isLikelyMongoObjectId(primaryKey)) {
    displayName = primaryKey;
  }

  return {
    primaryKey,
    email,
    displayName,
    userKey,
    department,
    hasMappings,
  };
}
