import { pickFromRawData } from "../access-certification/certificationUserDisplay.js";
import {
  isLikelyMongoObjectId as isOidFromMapping,
  resolveApplicationUserIdentity,
} from "../applicationUserIdentityResolve.js";

/**
 * Extract entitlement / role tokens from delimited application user rows (app_*_users).
 * Aligns with certification / mindmap patterns (pipe, semicolon, comma).
 */

function splitAccessString(s) {
  if (typeof s !== "string" || !s.trim()) return [];
  const str = s.trim();
  // JSON array strings (SAP / custom CSV imports often store roles this way)
  if (str.startsWith("[") && str.endsWith("]")) {
    try {
      const parsed = JSON.parse(str.replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        return parsed.flatMap((v) =>
          typeof v === "string" || typeof v === "number"
            ? splitAccessString(String(v))
            : flattenStringish(v),
        );
      }
    } catch {
      /* fall through to delimiter split */
    }
  }
  return str
    .split(/[|;,]+|\r?\n+/)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function flattenStringish(val, depth = 0) {
  if (depth > 12) return [];
  if (val == null) return [];
  if (typeof val === "string" || typeof val === "number") {
    const s = String(val).trim();
    return s ? splitAccessString(s) : [];
  }
  if (Array.isArray(val)) {
    return val.flatMap((x) => flattenStringish(x, depth + 1));
  }
  if (typeof val === "object") {
    return Object.values(val).flatMap((x) => flattenStringish(x, depth + 1));
  }
  return [];
}

/**
 * @param {object} user - dynamic app user document
 * @param {object} raw - user.rawData or {}
 * @returns {string[]} unique non-empty tokens
 */
export function extractEntitlementTokensFromAppUser(user, raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const out = [];

  for (const s of [
    u.member_of_entitlements,
    r.member_of_entitlements,
    r.memberOf,
    r.MemberOf,
    r.sap_roles,
    u.memberOf,
    r.member_of,
    r.entitlements,
    r.roles,
    r.groups,
    u.entitlements,
    u.roles,
    u.groups,
    u.organization_role,
    r.organization_role,
  ]) {
    if (typeof s === "string") out.push(...splitAccessString(s));
    else if (Array.isArray(s)) out.push(...flattenStringish(s));
  }

  for (const [k, v] of Object.entries(r)) {
    if (!Array.isArray(v) || v.length === 0 || v.length > 400) continue;
    if (
      !/entitle|grant|assign|permission|role|license|membership|access|package|privilege/i.test(
        String(k),
      )
    )
      continue;
    out.push(...flattenStringish(v));
  }

  const seen = new Set();
  const uniq = [];
  for (const t of out) {
    const x = String(t || "").trim();
    if (!x) continue;
    const k = x.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(x);
  }
  return uniq;
}

function asUserDoc(user, raw = {}) {
  const u = user && typeof user === "object" ? user : {};
  if (u.rawData && typeof u.rawData === "object") return u;
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (r && Object.keys(r).length) return { ...u, rawData: r };
  return u;
}

function hasAppSchema(appSchema) {
  if (!appSchema || typeof appSchema !== "object") return false;
  return Boolean(
    (Array.isArray(appSchema.userMappings) && appSchema.userMappings.length) ||
      (Array.isArray(appSchema.csvImportMapping?.mappings) &&
        appSchema.csvImportMapping.mappings.length),
  );
}

/**
 * Stable key for SoD evaluation (prefer email for identityEmail on violations).
 * When appSchema (userMappings / csvImportMapping) is provided, resolve via onboarded static fields.
 * @param {object} user
 * @param {object} [raw]
 * @param {{ userMappings?: object[], csvImportMapping?: object }|null} [appSchema]
 */
export function pickSodUserKeyFromAppUser(user, raw = {}, appSchema = null) {
  if (hasAppSchema(appSchema)) {
    const id = resolveApplicationUserIdentity(asUserDoc(user, raw), appSchema);
    if (id.userKey) return id.userKey;
  }

  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const emailCandidates = [u.email, r.email, r.Email, r.mail, r["Email Address"]];
  for (const c of emailCandidates) {
    const s = String(c || "").trim();
    if (s.includes("@")) return s.toLowerCase();
  }

  const loginCandidates = [
    u.username,
    u.user_id,
    r.username,
    r.user_id,
    r.Username,
    r.UserName,
    r.userid,
    u.employee_id,
    r.employee_id,
  ];
  for (const c of loginCandidates) {
    const s = String(c || "").trim();
    if (!s) continue;
    if (isLikelyMongoObjectId(s)) continue;
    return s.toLowerCase();
  }

  const id = u._id?.toString?.() || r.id || "";
  return id ? String(id).trim().toLowerCase() : "";
}

export function normalizeSodToken(t) {
  return String(t || "")
    .trim()
    .toLowerCase();
}

/** 24-char hex Mongo ObjectId — not a useful user label. */
export function isLikelyMongoObjectId(value) {
  return isOidFromMapping(value);
}

/** Title-case a login or email local-part for a readable fallback label. */
export function humanizeLocalPartFromEmail(addr) {
  const s = String(addr || "").trim();
  if (!s) return "";
  if (isLikelyMongoObjectId(s)) return "";
  const local = s.includes("@") ? s.split("@")[0] : s;
  if (!local || isLikelyMongoObjectId(local)) return "";
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * @param {object} user
 * @param {object} [raw]
 * @param {string} [userKey]
 * @param {{ userMappings?: object[], csvImportMapping?: object }|null} [appSchema]
 */
export function resolveEmailForAppUser(user, raw = {}, userKey = "", appSchema = null) {
  if (hasAppSchema(appSchema)) {
    const id = resolveApplicationUserIdentity(asUserDoc(user, raw), appSchema);
    if (id.email.includes("@")) return id.email;
  }

  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const candidates = [u.email, r.email, r.Email, r.mail, r["Email Address"]];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s.includes("@")) return s.toLowerCase();
  }
  const k = String(userKey || "").trim();
  if (k.includes("@")) return k.toLowerCase();
  if (isLikelyMongoObjectId(k)) return "";
  return k;
}

/**
 * @param {object} user
 * @param {object} [raw]
 * @param {string} [userKey]
 * @param {{ userMappings?: object[], csvImportMapping?: object }|null} [appSchema]
 */
export function resolveDisplayNameForAppUser(user, raw = {}, userKey = "", appSchema = null) {
  if (hasAppSchema(appSchema)) {
    const id = resolveApplicationUserIdentity(asUserDoc(user, raw), appSchema);
    if (id.displayName) return id.displayName;
  }

  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const key = String(userKey || "")
    .trim()
    .toLowerCase();
  const candidates = [
    u.display_name,
    u.displayName,
    r.display_name,
    r.displayName,
    r.DisplayName,
    r["Full Name"],
    r.full_name,
    r.name,
    u.name,
    r.cn,
    r.CommonName,
    [r.first_name, r.last_name].filter(Boolean).join(" "),
    [r.FirstName, r.LastName].filter(Boolean).join(" "),
    [u.first_name, u.last_name].filter(Boolean).join(" "),
    pickFromRawData(r, "displayname", "full_name", "person_name"),
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  for (const c of candidates) {
    const lower = c.toLowerCase();
    if (c.includes("@")) continue;
    if (isLikelyMongoObjectId(c)) continue;
    if (key && lower === key) continue;
    return c;
  }

  const login = String(
    u.username || r.username || r.Username || r.user_name || r.user_id || u.user_id || "",
  ).trim();
  if (
    login &&
    !login.includes("@") &&
    !isLikelyMongoObjectId(login) &&
    login.toLowerCase() !== key
  ) {
    return humanizeLocalPartFromEmail(login);
  }

  return (
    humanizeLocalPartFromEmail(resolveEmailForAppUser(u, r, userKey, appSchema)) ||
    humanizeLocalPartFromEmail(userKey) ||
    (!isLikelyMongoObjectId(userKey) ? String(userKey || "").trim() : "") ||
    ""
  );
}

export function resolveDepartmentForAppUser(user, raw = {}, appSchema = null) {
  if (hasAppSchema(appSchema)) {
    const id = resolveApplicationUserIdentity(asUserDoc(user, raw), appSchema);
    if (id.department) return id.department;
  }

  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const candidates = [
    u.department,
    r.department,
    r.Department,
    r["Department Name"],
    r["Department"],
    r.dept,
    r.Dept,
    r.division,
    r.Division,
    r.business_unit,
    r.cost_center,
    r.JobFamily,
    r.job_family,
    r.kostl,
    r.KOSTL,
    r.OrgUnit,
    r.orgUnit,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return (
    pickFromRawData(
      r,
      "department",
      "dept",
      "division",
      "kostl",
      "costcenter",
      "cost_center",
      "orgunit",
      "org_unit",
      "organization",
      "operating_unit",
      "businessunit",
      "business_unit",
      "company",
      "werk",
      "plant",
      "personnel_area",
      "personnelarea",
      "unit",
    ) || ""
  );
}

export function resolveManagerForAppUser(user, raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const u = user && typeof user === "object" ? user : {};
  const candidates = [
    u.manager,
    u.manager_name,
    r.manager,
    r.Manager,
    r.manager_name,
    r.ManagerName,
    r.supervisor,
    r.Supervisor,
    r.reports_to,
    r.ReportsTo,
    r["Manager Name"],
    r["Supervisor Name"],
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return (
    pickFromRawData(
      r,
      "manager",
      "manager_name",
      "supervisor",
      "reports_to",
      "line_manager",
      "mgr",
    ) || ""
  );
}
