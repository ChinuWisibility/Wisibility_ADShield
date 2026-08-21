import mongoose from "mongoose";
import Campaign from "../../models/certification/Campaign.js";
import ReviewItem from "../../models/certification/ReviewItem.js";
import Application from "../../models/application/Application.js";
import Identity from "../../models/identity/Identity.js";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import CertificationProfile from "../../models/certification/CertificationProfile.js";
import { getDynamicEntitlementModel, getDynamicEntitlementModelForTenantId } from "../../models/application/Entitlements.js";
import { generateReviewerToken } from "../../services/access-certification/certificationTokenService.js";
import { collectScopeItemAliasCandidates, itemIdsMatch } from "../../utils/access-certification/certificationItemId.js";
import { tokenizeMemberOfRaw, normalizeAccessDisplayLabel, tokenizeAndNormalize } from "../../utils/accessMemberOfTokens.js";
import { pickFromRawData, resolveUserName } from "../../utils/access-certification/certificationUserDisplay.js";
import { resolveMappedUserModel, resolveMappedManagerEmail, loadMappedSchema, normalizeMappedUsers } from "../../utils/access-certification/mappedUserResolver.js";
import { buildIdentityScope, buildManagerScope } from "./profileCertificationScopeService.js";

function asObjectId(value) {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

async function resolveCertificationUserModel(applicationName, tenantId) {
  return resolveMappedUserModel({ name: applicationName, tenantId });
}

function normalizeCampaignApplication(campaign) {
  if (!campaign) return campaign;

  const appRef = campaign.applicationId;
  const appId = appRef?._id || appRef;
  const applicationName =
    campaign.applicationName || appRef?.name || campaign.appName || null;

  const tenantId = appRef?.tenantId?._id || appRef?.tenantId || null;
  const tenantName = appRef?.tenantId?.name || null;

  return {
    ...campaign,
    applicationId: appId,
    applicationName,
    tenantId,
    tenantName,
  };
}

function collectAppUserLookupKeys(u, raw) {
  const r = raw || {};
  return [
    u._id?.toString(),
    u.user_id,
    u.primaryKey,
    u.email,
    u.display_name,
    resolveUserEmail(u, r),
    r["Employee ID"],
    r.employee_id,
    r.Id,
    r.UserId,
    r.FederationIdentifier,
    pickFromRawData(r, "email", "mail"),
    pickFromRawData(
      r,
      "username",
      "user_name",
      "oracle_user",
      "tableau_user",
      "account_id",
      "account",
      "login",
      "samaccount",
      "federation",
      "alias",
      "nickname",
      "external_id",
    ),
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

/**
 * Superset of identifiers used to match a person row across connectors (Salesforce Id,
 * federation id, dotted name from display name, email local-part variants, etc.).
 */
function collectIdentityPoolKeys(user, raw) {
  const r = raw || {};
  const set = new Set(
    collectAppUserLookupKeys(user, r).map((k) => String(k || "").trim()),
  );
  const add = (v) => {
    const s = String(v ?? "").trim();
    if (s) set.add(s);
  };
  add(
    pickFromRawData(r, "employee_number", "person_number", "worker", "pernr"),
  );
  const fullName = String(resolveUserName(user, r) || "").trim();
  if (fullName && !/^unknown\s+user$/i.test(fullName)) {
    add(fullName);
    add(fullName.toLowerCase().replace(/\s+/g, "."));
  }
  const em = String(resolveUserEmail(user, r) || user?.email || "").trim();
  if (em.includes("@")) {
    const loc = em.split("@")[0];
    add(loc);
    add(loc.replace(/\./g, ""));
  }
  return [...set].filter(Boolean);
}

/**
 * When manager is stored as login / display (e.g. fang.chen) without a mailbox field,
 * resolve to that user's email in the same application directory.
 */
function findAppUserEmailByLoginOrLocalPart(appUsers, token, userEmailPool) {
  const t = String(token || "")
    .trim()
    .toLowerCase();
  if (!t) return "";
  for (const cand of appUsers || []) {
    const cr = cand.rawData || {};
    const resolved = String(resolveUserEmail(cand, cr) || cand.email || "")
      .trim()
      .toLowerCase();
    if (resolved && resolved.includes("@")) {
      const local = resolved.split("@")[0];
      if (local === t) return resolved;
    }
    const keys = [
      cand.user_id,
      cand._id?.toString(),
      pickFromRawData(
        cr,
        "username",
        "user_name",
        "login",
        "samaccount",
        "oracle_user",
        "tableau_user",
        "account_id",
        "account",
        "alias",
        "federation",
        "nickname",
        "employee_number",
      ),
    ]
      .map((v) =>
        String(v || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (keys.includes(t)) {
      const pooled = userEmailPool?.get?.(t);
      if (pooled) return String(pooled).trim().toLowerCase();
      if (resolved && resolved.includes("@")) return resolved;
    }
  }
  return "";
}

function looksLikeCloudRecordId(token) {
  const s = String(token || "").trim();
  if (s.length < 15 || s.length > 20) return false;
  return /^[a-z0-9]+$/i.test(s);
}

/** Match manager / peer when the connector stores a cloud user id (e.g. Salesforce 005…). */
function findAppUserEmailByRecordId(appUsers, token) {
  const t = String(token || "")
    .trim()
    .toLowerCase();
  if (!t || !looksLikeCloudRecordId(t)) return "";
  for (const cand of appUsers || []) {
    const cr = cand.rawData || {};
    const ids = [
      cand._id?.toString(),
      cr.Id,
      cr.UserId,
      cr.id,
      cr.User_ID,
      pickFromRawData(cr, "userid", "sf_id", "external_id"),
    ]
      .map((x) =>
        String(x || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (!ids.includes(t)) continue;
    const em = String(resolveUserEmail(cand, cr) || cand.email || "")
      .trim()
      .toLowerCase();
    if (em.includes("@")) return em;
  }
  return "";
}

function normalizeDottedPersonKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9.]/g, "");
}

/** Match manager login like `first.last` to directory display names (Salesforce, SaaS). */
function findAppUserEmailByDisplayNameToken(appUsers, token) {
  const want = normalizeDottedPersonKey(token);
  if (!want || want.length < 3 || want.includes("@")) return "";
  const wantFlat = want.replace(/\./g, "");
  for (const cand of appUsers || []) {
    const cr = cand.rawData || {};
    const resolved = String(resolveUserEmail(cand, cr) || cand.email || "")
      .trim()
      .toLowerCase();
    if (!resolved.includes("@")) continue;
    const nameCandidates = [
      resolveUserName(cand, cr),
      pickFromRawData(cr, "name", "displayname", "fullname", "firstname"),
      cand.name,
    ];
    for (const nm of nameCandidates) {
      const c = normalizeDottedPersonKey(nm);
      if (!c) continue;
      if (c === want || c.replace(/\./g, "") === wantFlat) return resolved;
    }
  }
  return "";
}

function resolveManagerPeerEmail(appUsers, token, userEmailPool) {
  let e = findAppUserEmailByLoginOrLocalPart(appUsers, token, userEmailPool);
  if (e) return e;
  e = findAppUserEmailByRecordId(appUsers, token);
  if (e) return e;
  return findAppUserEmailByDisplayNameToken(appUsers, token);
}

function findAppUserRowByItemId(sid, appUsers) {
  const trimmed = String(sid || "").trim();
  if (!trimmed) return null;
  for (const u of appUsers || []) {
    const raw = u.rawData || {};
    if (collectIdentityPoolKeys(u, raw).some((k) => itemIdsMatch(k, trimmed)))
      return { u, raw };
  }
  return null;
}

/**
 * Resolve each subject's line-manager email for manager-routed certification.
 * selectedIds may use email, ObjectId, employee id, etc.; managerByUserId keys are lowercased raw tokens.
 */
function resolveManagerEmailForCampaignItem(
  itemId,
  managerByUserId,
  appUsers,
  userEmailPool,
) {
  const sid = String(itemId || "").trim();
  if (!sid) return "";

  const lower = sid.toLowerCase();
  let mgEmail = managerByUserId.get(lower);
  if (mgEmail) return String(mgEmail).toLowerCase();

  for (const [mapKey, email] of managerByUserId.entries()) {
    if (itemIdsMatch(String(mapKey), sid)) {
      return String(email || "").toLowerCase();
    }
  }

  for (const u of appUsers || []) {
    const raw = u.rawData || {};
    const userKeys = collectAppUserLookupKeys(u, raw);

    if (!userKeys.some((k) => itemIdsMatch(k, sid))) continue;

    let e = String(resolveUserManagerEmail(u, raw) || "")
      .trim()
      .toLowerCase();
    if (!e) {
      const mgrIdRaw = pickRawManagerForeignKey(raw) || u?.manager_id || "";
      const mgrIdKey = String(mgrIdRaw || "")
        .trim()
        .toLowerCase();
      if (mgrIdKey) {
        e =
          userEmailPool.get(mgrIdKey) ||
          findAppUserEmailByRecordId(appUsers, mgrIdKey) ||
          "";
      }
      if (!e && mgrIdKey) {
        const userEmail = resolveUserEmail(u, raw);
        const emailDomain =
          userEmail && userEmail.includes("@") ? userEmail.split("@")[1] : "";
        if (emailDomain) e = `${mgrIdKey}@${emailDomain}`;
      }
    }
    if (!e) {
      const mgrRaw = resolveUserManager(u, raw);
      const mgrToken = cleanManagerName(mgrRaw).trim().toLowerCase();
      if (mgrToken && !mgrToken.includes("@")) {
        e = resolveManagerPeerEmail(appUsers, mgrToken, userEmailPool);
      }
    }
    if (e) return e.toLowerCase();
  }

  return "";
}

function normalizeEntitlementItem(entitlement) {
  const raw = entitlement?.rawData || {};
  const id =
    entitlement?.entitlement_id ||
    entitlement?._id?.toString?.() ||
    raw.entitlement_id ||
    raw.ENTITLEMENT_ID ||
    raw.id ||
    null;
  const name =
    entitlement?.entitlement_name ||
    raw.entitlement_name ||
    raw.ENTITLEMENT_NAME ||
    raw.name ||
    id ||
    "";
  const source = entitlement?.source || raw.source || "Catalog";
  const type = entitlement?.granted_via || raw.granted_via || "entitlement";
  const status = entitlement?.is_active || raw.is_active || "Enabled";

  const privilegeRaw =
    entitlement?.is_privilege ??
    raw.is_privilege ??
    raw.isPrivilege ??
    raw.privileged;
  const privileged = ["true", "yes", "1", "y", "privileged"].includes(
    String(privilegeRaw || "")
      .trim()
      .toLowerCase(),
  );

  return {
    id: String(id || name),
    name: String(name || id || "").trim(),
    type: String(type || "entitlement"),
    source: String(source || "Catalog"),
    status: String(status || "Enabled"),
    privileged,
    _originalData: raw,
  };
}

function splitMultiValue(raw) {
  return tokenizeMemberOfRaw(raw);
}

function normalizeScopeToken(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const dnMatch = text.match(/^CN=([^,]+)/i);
  const normalized = dnMatch ? dnMatch[1] : text;
  return normalized.toLowerCase();
}

/**
 * True if a user's member-of token should count as holding one of the campaign's selected accesses.
 * Uses normalized set membership plus alias/ObjectId matching so catalog ids (e.g. ENT0149) align with connector payloads.
 */
function memberGroupMatchesSelectedAccess(
  group,
  selectedAccessNameSet,
  selectedIds,
) {
  const norm = normalizeScopeToken(group);
  if (norm && selectedAccessNameSet.has(norm)) return true;
  const displayLabel = normalizeAccessDisplayLabel(group);
  const displayNorm = String(displayLabel || "")
    .trim()
    .toLowerCase();
  if (displayNorm && selectedAccessNameSet.has(displayNorm)) return true;

  for (const sid of selectedIds || []) {
    const s = String(sid || "").trim();
    if (!s) continue;
    if (itemIdsMatch(s, group) || itemIdsMatch(s, displayLabel)) return true;
    const sidNorm = normalizeScopeToken(s);
    if (sidNorm && displayNorm && sidNorm === displayNorm) return true;
    if (sidNorm && norm && sidNorm === norm) return true;
  }
  return false;
}

/** Flatten nested JSON from connectors into comparable string tokens. */
function flattenStringishValues(val, depth = 0) {
  if (depth > 12) return [];
  if (val == null) return [];
  if (typeof val === "string" || typeof val === "number") {
    const s = String(val).trim();
    return s ? [s] : [];
  }
  if (Array.isArray(val)) {
    return val.flatMap((x) => flattenStringishValues(x, depth + 1));
  }
  if (typeof val === "object") {
    const pref =
      val.email ||
      val.Email ||
      val.user_id ||
      val.userId ||
      val.Username ||
      val.username ||
      val.login ||
      val.Id ||
      val.id ||
      val.name;
    if (pref != null && pref !== val)
      return flattenStringishValues(pref, depth + 1);
    return Object.values(val).flatMap((x) =>
      flattenStringishValues(x, depth + 1),
    );
  }
  return [];
}

/** Tokens from user rawData that represent entitlement / role / assignment rows. */
function extractUserEntitlementAssignmentTokensFromRaw(raw) {
  const r = raw || {};
  const buckets = [
    r.entitlements,
    r.Entitlements,
    r.user_entitlements,
    r.userEntitlements,
    r.grants,
    r.assignments,
    r.access,
    r.Access,
    r.roles,
    r.Roles,
  ];
  const out = [];
  for (const b of buckets) {
    flattenStringishValues(b).forEach((s) => out.push(s));
  }
  for (const [k, v] of Object.entries(r)) {
    if (!Array.isArray(v) || v.length === 0 || v.length > 400) continue;
    if (
      !/entitle|grant|assign|permission|role|license|membership|access|package|privilege/i.test(
        k,
      )
    )
      continue;
    flattenStringishValues(v).forEach((s) => out.push(s));
  }
  return [...new Set(out.map((s) => String(s).trim()).filter(Boolean))];
}

/** Who holds this entitlement row (best-effort across connector shapes). */
function collectEntitlementHolderIdentifiers(ent) {
  const raw = ent?._originalData || ent?.rawData || {};
  const buckets = [
    raw.users,
    raw.Users,
    raw.user_list,
    raw.UserList,
    raw.assignees,
    raw.members,
    raw.member_list,
    raw.memberList,
    raw.account_ids,
    raw.user_emails,
    raw.userEmails,
    raw.memberships,
  ];
  const out = [];
  for (const b of buckets) {
    flattenStringishValues(b).forEach((s) => out.push(s));
  }
  for (const [k, v] of Object.entries(raw)) {
    if (
      !/user|member|assign|owner|holder|account|email|principal|subject/i.test(
        k,
      )
    )
      continue;
    flattenStringishValues(v).forEach((s) => out.push(s));
  }
  return [...new Set(out.map((s) => String(s).trim()).filter(Boolean))];
}

function entitlementMatchesAnySelected(selectedIds, ent) {
  const eid = String(ent?.id || "").trim();
  const ename = String(ent?.name || "").trim();
  for (const sid of selectedIds || []) {
    const s = String(sid || "").trim();
    if (!s) continue;
    if (itemIdsMatch(s, eid) || itemIdsMatch(s, ename)) return true;
  }
  return false;
}

function userListedOnEntitlementHolders(user, userRaw, ent) {
  const holders = collectEntitlementHolderIdentifiers(ent);
  if (holders.length === 0) return false;
  const userKeys = collectIdentityPoolKeys(user, userRaw || {}).map((k) =>
    String(k).trim().toLowerCase(),
  );
  return holders.some((h) => {
    const hl = String(h).trim().toLowerCase();
    if (!hl) return false;
    return userKeys.some((uk) => {
      if (!uk) return false;
      if (hl === uk) return true;
      return itemIdsMatch(uk, hl);
    });
  });
}

function cleanManagerName(value) {
  if (!value) return "";
  const v = String(value).trim();
  const dnMatch = v.match(/CN=([^,]+)/i);
  if (dnMatch) return dnMatch[1].trim();
  if (v.includes(",") && v.split(",").length === 2) {
    const [last, first] = v.split(",").map((s) => s.trim());
    if (first && last) return `${first} ${last}`;
  }
  return v;
}

function getUserIdentityFlags(user) {
  const raw = user?.rawData || {};
  const toBool = (v) =>
    ["yes", "true", "y", "1"].includes(
      String(v || "")
        .trim()
        .toLowerCase(),
    );

  return {
    isNHI: toBool(raw.isNHI ?? raw["PSO Applied"] ?? raw.is_nhi),
    isContractor: toBool(
      raw.isContractor ?? raw["PSO Resultant"] ?? raw.is_contractor,
    ),
  };
}

function resolveUserEmail(user, raw) {
  return (
    user?.email ||
    raw["Email Address"] ||
    raw.email ||
    raw.mail ||
    pickFromRawData(raw, "email", "mail") ||
    ""
  );
}

function resolveUserManager(user, raw) {
  return (
    raw.Manager ||
    raw.manager ||
    user?.manager_name ||
    user?.manager ||
    raw["Manager Distinguished Name"] ||
    pickFromRawData(
      raw,
      "manager",
      "supervisor_name",
      "supervisor",
      "mgr",
      "reports_to",
      "parent_user",
      "parent",
    ) ||
    ""
  );
}

function resolveUserManagerEmail(user, raw) {
  return (
    raw["Manager Email Address"] ||
    user?.manager_email ||
    raw.managerEmail ||
    user?.managerEmail ||
    pickFromRawData(
      raw,
      "manager_email",
      "manager_mail",
      "supervisor_email",
      "mgr_email",
    ) ||
    ""
  );
}

/** Foreign key / id pointing at the manager user row (varies widely by connector). */
function pickRawManagerForeignKey(raw) {
  const r = raw || {};
  return (
    pickFromRawData(
      r,
      "manager_id",
      "managerid",
      "reports_to",
      "supervisor_id",
      "mgr_id",
      "manager_uid",
      "parent_user",
    ) ||
    r.manager_uid ||
    r.ManagerId ||
    r.ReportsToId ||
    ""
  );
}

function resolveUserTitle(raw) {
  return (
    raw.Title ||
    raw.title ||
    raw["Job Title"] ||
    raw.job_title ||
    raw.Role ||
    raw.role ||
    pickFromRawData(raw, "title", "position", "job", "designation", "role") ||
    ""
  );
}

function resolveUserDepartment(raw) {
  return (
    raw.Department ||
    raw.department ||
    pickFromRawData(
      raw,
      "department",
      "dept",
      "division",
      "kostl",
      "org",
      "operating_unit",
      "unit",
      "business_unit",
    ) ||
    ""
  );
}

function normalizeLifecycleStatusValue(rawValue, sourceKey = "") {
  const key = String(sourceKey || "")
    .trim()
    .toLowerCase();
  const isNegativeFlagKey = [
    "accountdisabled",
    "disabled",
    "locked",
    "lockout",
    "terminationflag",
    "terminated",
    "isinactive",
  ].includes(key.replace(/[^a-z0-9]/g, ""));

  if (typeof rawValue === "boolean") {
    if (isNegativeFlagKey) return rawValue ? "INACTIVE" : "ACTIVE";
    return rawValue ? "ACTIVE" : "INACTIVE";
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  const s = raw.toUpperCase().replace(/\s+/g, "_");

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
    return isNegativeFlagKey ? "INACTIVE" : "ACTIVE";
  }
  if (["FALSE", "NO", "N", "0", "OFF", "DISABLED", "LOCKED"].includes(s)) {
    return isNegativeFlagKey ? "ACTIVE" : "INACTIVE";
  }
  if (
    s.includes("TERM") ||
    s.includes("RESIGN") ||
    s.includes("SEPARAT") ||
    s.includes("OFFBOARD") ||
    s.includes("EXIT")
  ) {
    return "TERMINATED";
  }
  if (s.includes("LEAV")) return "LEAVER";
  if (s.includes("MOVER") || s.includes("TRANSFER")) return "MOVER";
  if (
    s.includes("SUSPEND") ||
    s.includes("LOCK") ||
    s.includes("DISABL") ||
    s.includes("INACTIVE")
  ) {
    return "INACTIVE";
  }
  if (s.includes("NEW") || s.includes("ONBOARD") || s.includes("JOIN"))
    return "NEW";
  if (s.includes("ACTIVE") || s === "ACT") return "ACTIVE";

  return s;
}

function resolveUserLifecycleStatus(user, raw, lifecycleByUserKey = new Map()) {
  const statusCandidates = [
    ["status", raw.status],
    ["user_status", raw.user_status],
    ["account_status", raw.account_status],
    ["employment_status", raw.employment_status],
    ["worker_status", raw.worker_status],
    ["person_status", raw.person_status],
    ["lifecycleState", raw.lifecycleState],
    ["lifecycle", raw.lifecycle],
    ["state", raw.state],
    ["isActive", raw.isActive],
    ["active", raw.active],
    ["enabled", raw.enabled],
    ["accountDisabled", raw.accountDisabled],
    ["locked", raw.locked],
  ];

  const pickedStatus = pickFromRawData(
    raw,
    "status",
    "user_status",
    "account_status",
    "employment_status",
    "worker_status",
    "person_status",
    "lifecycle",
    "lifecycle_state",
    "state",
    "is_active",
    "enabled",
    "account_disabled",
    "locked",
  );
  if (pickedStatus != null && String(pickedStatus).trim() !== "") {
    const normalized = normalizeLifecycleStatusValue(pickedStatus, "status");
    if (normalized) return normalized;
  }

  for (const [k, v] of statusCandidates) {
    if (v == null || String(v).trim() === "") continue;
    const normalized = normalizeLifecycleStatusValue(v, k);
    if (normalized) return normalized;
  }

  const lookupKeys = [
    user?._id?.toString?.(),
    user?.user_id,
    user?.primaryKey,
    resolveUserEmail(user, raw),
    raw["Employee ID"],
    raw.employee_id,
    raw.user_id,
    raw.Id,
    raw.UserId,
    pickFromRawData(
      raw,
      "employee_id",
      "person_number",
      "worker",
      "pernr",
      "uid",
      "userid",
    ),
    pickFromRawData(raw, "email", "mail"),
  ]
    .map((v) => normalizeScopeToken(v))
    .filter(Boolean);

  for (const lk of lookupKeys) {
    const fromLookup = lifecycleByUserKey.get(lk);
    if (fromLookup) return fromLookup;
  }

  return "UNKNOWN";
}

async function buildIdentityLifecycleLookup(tenantId, users = []) {
  if (!tenantId || !Array.isArray(users) || users.length === 0)
    return new Map();

  const emailSet = new Set();
  const employeeIdSet = new Set();
  const uidSet = new Set();

  for (const u of users) {
    const raw = u?.rawData || {};
    const email = String(resolveUserEmail(u, raw) || "")
      .trim()
      .toLowerCase();
    if (email) emailSet.add(email);

    const emp = String(
      raw["Employee ID"] ||
        raw.employee_id ||
        pickFromRawData(
          raw,
          "employee_id",
          "person_number",
          "worker",
          "pernr",
        ) ||
        "",
    ).trim();
    if (emp) employeeIdSet.add(emp);

    const uid = String(
      u?.user_id ||
        u?.primaryKey ||
        raw.user_id ||
        raw.Id ||
        raw.UserId ||
        pickFromRawData(
          raw,
          "uid",
          "userid",
          "user_id",
          "username",
          "federationidentifier",
        ) ||
        "",
    ).trim();
    if (uid) uidSet.add(uid);
  }

  const or = [];
  if (emailSet.size) or.push({ email: { $in: [...emailSet] } });
  if (employeeIdSet.size) or.push({ employeeId: { $in: [...employeeIdSet] } });
  if (uidSet.size) or.push({ "attributes.uid": { $in: [...uidSet] } });
  if (!or.length) return new Map();

  const docs = await Identity.find({ tenantId, $or: or })
    .select("email employeeId lifecycleState attributes.uid")
    .lean();

  const map = new Map();
  for (const d of docs || []) {
    const status = normalizeLifecycleStatusValue(d?.lifecycleState || "");
    if (!status) continue;

    const keys = [d?.email, d?.employeeId, d?.attributes?.uid]
      .map((v) => normalizeScopeToken(v))
      .filter(Boolean);
    for (const k of keys) {
      if (!map.has(k)) map.set(k, status);
    }
  }

  return map;
}

/**
 * SaaS connectors (e.g. GitHub) often store memberships as JSON arrays instead of
 * LDAP-style memberOf strings. Merge those into the same token list used for review / email tables.
 */
function mergeMemberGroupsWithStructuredAccess(user, raw, memberGroups) {
  const tokens = [...(memberGroups || [])];
  const seen = new Set(
    tokens
      .map((t) => normalizeAccessDisplayLabel(String(t || "")).toLowerCase())
      .filter(Boolean),
  );
  const pushRaw = (val) => {
    if (val == null) return;
    if (typeof val === "string" || typeof val === "number") {
      const s = String(val).trim();
      if (!s) return;
      const lab = normalizeAccessDisplayLabel(s);
      if (!lab) return;
      const k = lab.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      tokens.push(s);
      return;
    }
    if (typeof val === "object") {
      const piece =
        val.name ||
        val.slug ||
        val.full_name ||
        val.login ||
        val.team ||
        val.title ||
        val.role ||
        val.id;
      if (piece != null) pushRaw(piece);
    }
  };
  const tryArr = (a) => {
    if (!Array.isArray(a)) return;
    for (const x of a) pushRaw(x);
  };

  tryArr(raw.teams);
  tryArr(raw.team_memberships);
  tryArr(raw.teamMemberships);
  tryArr(raw.repositories);
  tryArr(raw.repos);
  tryArr(raw.organizations);
  tryArr(raw.orgs);
  tryArr(raw.groups);
  tryArr(user?.teams);

  if (raw.github && typeof raw.github === "object") {
    tryArr(raw.github.teams);
    tryArr(raw.github.organizations);
    tryArr(raw.github.repos);
  }

  // Salesforce / ServiceNow / Workday-style: arrays on arbitrary keys (PermissionSets, UserRoles, …)
  const arrayKeyHint =
    /permission|profile|role|group|membership|assignment|entitlement|license|package|app_role|duty|responsibilit|delegat|authority|access/i;
  for (const [k, v] of Object.entries(raw || {})) {
    if (!Array.isArray(v) || v.length === 0 || v.length > 250) continue;
    if (!arrayKeyHint.test(k)) continue;
    tryArr(v);
  }

  return tokens;
}

function buildScopeDataForCampaign(
  campaign,
  users,
  entitlements,
  options = {},
) {
  const lifecycleByUserKey =
    options?.lifecycleByUserKey instanceof Map
      ? options.lifecycleByUserKey
      : new Map();

  const selectedIds = Array.isArray(campaign?.selectedIds)
    ? campaign.selectedIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  const selectedTokenSet = new Set(selectedIds.map(normalizeScopeToken));

  const entitlementById = new Map(
    (entitlements || []).map((ent) => [String(ent.id || "").trim(), ent]),
  );

  const selectedAccessNameSet = new Set();
  for (const selectedId of selectedIds) {
    const normalized = normalizeScopeToken(selectedId);
    if (normalized) selectedAccessNameSet.add(normalized);
    // Match each pipe/segment so composite catalog ids align with per-token memberOf
    for (const seg of tokenizeMemberOfRaw(selectedId)) {
      const t = normalizeScopeToken(seg);
      if (t) selectedAccessNameSet.add(t);
    }

    let matchEntitlement = entitlementById.get(String(selectedId).trim());
    if (!matchEntitlement) {
      for (const [k, ent] of entitlementById.entries()) {
        if (itemIdsMatch(String(selectedId), String(k))) {
          matchEntitlement = ent;
          break;
        }
      }
    }
    if (matchEntitlement?.name) {
      selectedAccessNameSet.add(normalizeScopeToken(matchEntitlement.name));
      for (const seg of tokenizeMemberOfRaw(matchEntitlement.name)) {
        const t = normalizeScopeToken(seg);
        if (t) selectedAccessNameSet.add(t);
      }
    }
  }

  // Add every alias of selected catalog rows so memberOf / assignment tokens can match.
  for (const ent of entitlements || []) {
    if (!entitlementMatchesAnySelected(selectedIds, ent)) continue;
    const eraw = ent?._originalData || ent?.rawData || {};
    for (const frag of [
      ent.id,
      ent.name,
      eraw.entitlement_id,
      eraw.entitlement_name,
      eraw.ENTITLEMENT_ID,
      eraw.ENTITLEMENT_NAME,
    ]) {
      if (!frag) continue;
      for (const seg of tokenizeMemberOfRaw(String(frag))) {
        const t = normalizeScopeToken(seg);
        if (t) selectedAccessNameSet.add(t);
      }
      selectedAccessNameSet.add(String(frag).trim().toLowerCase());
    }
  }

  const normalizeAccessLabel = normalizeAccessDisplayLabel;

  // Pre-build username/id → email pool for resolving manager emails via manager_id/supervisor_id
  const userEmailPool = new Map();
  for (const u of users || []) {
    const r = u?.rawData || {};
    const uEmail = String(resolveUserEmail(u, r) || "")
      .trim()
      .toLowerCase();
    if (!uEmail || !uEmail.includes("@")) continue;
    for (const key of collectIdentityPoolKeys(u, r)) {
      const kk = String(key).trim().toLowerCase();
      if (kk) userEmailPool.set(kk, uEmail);
    }
  }

  const baseRows = (users || []).map((user) => {
    const raw = user?.rawData || {};
    const mongoObjectId = user?._id?.toString?.() || "";
    const userId =
      user?.user_id ||
      user?.primaryKey ||
      mongoObjectId ||
      raw["Employee ID"] ||
      raw.employee_id ||
      raw.user_id ||
      raw.id ||
      raw["Email Address"] ||
      pickFromRawData(
        raw,
        "employee_id",
        "user_id",
        "userid",
        "username",
        "email",
      ) ||
      "";

    const name = resolveUserName(user, raw);

    const email = resolveUserEmail(user, raw);

    const memberOf =
      raw.member_of_entitlements ||
      raw.memberOf ||
      raw.MemberOf ||
      raw.sap_roles ||
      user.member_of_entitlements ||
      user.memberOf ||
      pickFromRawData(
        raw,
        "member_of",
        "memberof",
        "entitlement",
        "responsibilities",
        "roles",
        "groups",
        "data_access",
        "team",
        "repository",
        "collaborator",
      ) ||
      "";

    const department = String(
      user.department || resolveUserDepartment(raw) || "",
    ).trim();
    const title = String(user.title || resolveUserTitle(raw) || "").trim();
    const managerName = resolveUserManager(user, raw);
    const lifecycleStatus = resolveUserLifecycleStatus(
      user,
      raw,
      lifecycleByUserKey,
    );

    let managerEmail = resolveUserManagerEmail(user, raw);
    if (!managerEmail) {
      const mgrIdRaw = pickRawManagerForeignKey(raw) || user?.manager_id || "";
      const mgrIdKey = mgrIdRaw.trim().toLowerCase();
      if (mgrIdKey) {
        managerEmail =
          userEmailPool.get(mgrIdKey) ||
          findAppUserEmailByRecordId(users, mgrIdKey) ||
          "";
        // If manager not in app user pool, construct email from managerId@domain
        if (!managerEmail && mgrIdKey) {
          const userEmail = resolveUserEmail(user, raw);
          const emailDomain = userEmail ? userEmail.split("@")[1] : "";
          if (emailDomain) managerEmail = `${mgrIdKey}@${emailDomain}`;
        }
      }
    }

    const fromUserAssignmentRows =
      extractUserEntitlementAssignmentTokensFromRaw(raw);
    const fromCatalogHolders = [];
    if (
      campaign?.category === "ACCESS_ITEMS" ||
      campaign?.category === "ROLE_COMPOSITION"
    ) {
      for (const ent of entitlements || []) {
        if (!entitlementMatchesAnySelected(selectedIds, ent)) continue;
        if (!userListedOnEntitlementHolders(user, raw, ent)) continue;
        const label = String(ent.name || ent.id || "").trim();
        if (label) fromCatalogHolders.push(label);
      }
    }

    const mergedStructured = mergeMemberGroupsWithStructuredAccess(
      user,
      raw,
      splitMultiValue(memberOf),
    );

    const isAccessItemScopedCampaign =
      campaign?.category === "ACCESS_ITEMS" ||
      campaign?.category === "ROLE_COMPOSITION";
    const hasEntitlementCatalog =
      Array.isArray(entitlements) && entitlements.length > 0;

    const anchoredMemberGroups = [
      ...fromUserAssignmentRows,
      ...fromCatalogHolders,
    ];

    // With a loaded entitlement catalog, prefer holder list + explicit assignment payloads.
    // MemberOf / generic JSON merges often include directory-wide groups that are not actual
    // application-held entitlements for this user, which makes review rows look over-assigned.
    let memberGroups;
    if (isAccessItemScopedCampaign && hasEntitlementCatalog) {
      memberGroups =
        anchoredMemberGroups.length > 0
          ? anchoredMemberGroups
          : mergedStructured;
    } else {
      memberGroups = [...anchoredMemberGroups, ...mergedStructured];
    }
    const allAccess = memberGroups
      .map(normalizeAccessLabel)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
    const matchedAccess = memberGroups
      .filter((group) =>
        memberGroupMatchesSelectedAccess(
          group,
          selectedAccessNameSet,
          selectedIds,
        ),
      )
      .map(normalizeAccessLabel)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
    const isIdentityScoped =
      campaign?.category === "IDENTITY" ||
      campaign?.category === "UNCORRELATED_ACCOUNTS";

    // Show all user access when:
    //   • Identity/uncorrelated campaigns (certify the person, not specific access)
    //   • Any other campaign with no specific items selected (certify ALL access)
    // Only ACCESS_ITEMS / ROLE_COMPOSITION rely on selectedIds to filter access display.
    const showAllAccess =
      isIdentityScoped ||
      (selectedIds.length === 0 &&
        campaign?.category !== "ACCESS_ITEMS" &&
        campaign?.category !== "ROLE_COMPOSITION");

    return {
      id:
        String(mongoObjectId || userId || "").trim() || String(user?._id || ""),
      userId: String(userId || "").trim() || String(user?._id || ""),
      mongoId: String(mongoObjectId || "").trim(),
      name: String(name || "").trim() || "Unknown User",
      email: String(email || "").trim(),
      department,
      title,
      memberOf,
      manager: String(managerName || "").trim(),
      status: String(lifecycleStatus || "UNKNOWN").trim(),
      managerEmail: String(managerEmail || "").trim(),
      applicationName: campaign?.applicationName || "",
      displayAccess: showAllAccess ? allAccess : matchedAccess,
      displayGroupsLabel: showAllAccess ? allAccess : matchedAccess,
      targetIds: [
        String(mongoObjectId || userId || "").trim() || String(user?._id || ""),
      ],
      rawData: raw,
      ...getUserIdentityFlags(user),
    };
  });

  if (
    campaign?.category === "ACCESS_ITEMS" ||
    campaign?.category === "ROLE_COMPOSITION"
  ) {
    if (selectedAccessNameSet.size === 0) return baseRows;
    return baseRows.filter((row) => (row.displayAccess || []).length > 0);
  }

  if (
    campaign?.category === "IDENTITY" ||
    campaign?.category === "UNCORRELATED_ACCOUNTS"
  ) {
    let rows = baseRows;

    const identityFilter = String(
      campaign.identityFilter || "ALL",
    ).toUpperCase();
    if (identityFilter === "NHI") {
      rows = rows.filter((row) => row.isNHI === true);
    } else if (identityFilter === "CONTRACTOR") {
      rows = rows.filter((row) => row.isContractor === true);
    }

    if (selectedTokenSet.size > 0) {
      rows = rows.filter((row) => {
        const candidateTokens = [row.id, row.userId, row.mongoId, row.email]
          .map(normalizeScopeToken)
          .filter(Boolean);
        return candidateTokens.some((token) => selectedTokenSet.has(token));
      });
    }

    return rows;
  }

  if (campaign?.category === "MANAGER" && selectedTokenSet.size > 0) {
    return baseRows.filter((row) => {
      const mgrNorm = normalizeScopeToken(cleanManagerName(row.manager));
      const mgrEmailNorm = normalizeScopeToken(row.managerEmail || "");
      return (
        selectedTokenSet.has(mgrNorm) ||
        (mgrEmailNorm && selectedTokenSet.has(mgrEmailNorm))
      );
    });
  }

  return baseRows;
}

function buildFallbackScopeFromSelectedIds(campaign, users = []) {
  const selectedIds = Array.isArray(campaign?.selectedIds)
    ? campaign.selectedIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  const userLookup = new Map();
  for (const user of users || []) {
    const raw = user?.rawData || {};
    const tokens = [
      user?._id?.toString?.(),
      user?.user_id,
      user?.primaryKey,
      user?.email,
      raw["Employee ID"],
      raw.employee_id,
      raw.user_id,
      raw.id,
      raw["Email Address"],
      pickFromRawData(raw, "email", "mail"),
      pickFromRawData(raw, "employee_id", "user_id", "username"),
    ]
      .map((v) => String(v || "").trim())
      .filter(Boolean);

    const displayName = resolveUserName(user, raw);
    const manager = resolveUserManager(user, raw);
    const managerEmail = resolveUserManagerEmail(user, raw);
    const email = resolveUserEmail(user, raw);
    const status = resolveUserLifecycleStatus(user, raw);

    for (const token of tokens) {
      userLookup.set(normalizeScopeToken(token), {
        name: String(displayName || "").trim() || "Unknown User",
        email: String(email || "").trim(),
        manager: String(manager || "").trim(),
        managerEmail: String(managerEmail || "").trim(),
        status: String(status || "UNKNOWN").trim(),
      });
    }
  }

  return selectedIds.map((id, idx) => ({
    ...(userLookup.get(normalizeScopeToken(id)) || {}),
    id,
    userId: id,
    name: (userLookup.get(normalizeScopeToken(id)) || {}).name || id,
    email: (userLookup.get(normalizeScopeToken(id)) || {}).email || "",
    memberOf: "",
    manager: (userLookup.get(normalizeScopeToken(id)) || {}).manager || "",
    managerEmail:
      (userLookup.get(normalizeScopeToken(id)) || {}).managerEmail || "",
    status: (userLookup.get(normalizeScopeToken(id)) || {}).status || "UNKNOWN",
    applicationName: campaign?.applicationName || "",
    displayAccess:
      campaign?.category === "ACCESS_ITEMS" ||
      campaign?.category === "ROLE_COMPOSITION"
        ? [id]
        : [],
    displayGroupsLabel:
      campaign?.category === "ACCESS_ITEMS" ||
      campaign?.category === "ROLE_COMPOSITION"
        ? [id]
        : [],
    targetIds: [id],
    reviewContext:
      campaign?.category === "ACCESS_ITEMS" ||
      campaign?.category === "ROLE_COMPOSITION"
        ? "Selected Access"
        : "Selected Identity",
    _fallback: true,
    _order: idx,
  }));
}

async function loadScopedApplicationData(UsersModel, EntitlementsModel, appId) {
  // Dynamic collections are app-specific already; keep strict filtering first,
  // then fall back to collection-wide read if older rows missed applicationId.
  const strictFilter = appId ? { applicationId: appId } : {};

  let [users, entitlements] = await Promise.all([
    UsersModel.find(strictFilter).sort({ createdAt: -1 }).lean(),
    EntitlementsModel.find(strictFilter).sort({ createdAt: -1 }).lean(),
  ]);

  const usedFallback = { users: false, entitlements: false };

  // Legacy fallback: if older rows lack applicationId, try without filter but emit a breadcrumb.
  if (users.length === 0) {
    users = await UsersModel.find({}).sort({ createdAt: -1 }).lean();
    usedFallback.users = users.length > 0;
  }

  if (entitlements.length === 0) {
    entitlements = await EntitlementsModel.find({})
      .sort({ createdAt: -1 })
      .lean();
    usedFallback.entitlements = entitlements.length > 0;
  }

  return { users, entitlements };
}

async function loadOrgWideUsers(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  const applications = await Application.find(filter)
    .select("_id name tenantId")
    .lean();
  const seen = new Map();
  for (const app of applications || []) {
    try {
      const UsersModel = await resolveCertificationUserModel(
        app.name,
        app.tenantId,
      );
      const users = await UsersModel.find({}).lean();
      for (const u of users) {
        const key =
          u.user_id ||
          u.primaryKey ||
          u.email ||
          u.rawData?.["Employee ID"] ||
          u.rawData?.["Email Address"] ||
          u._id?.toString();
        if (key && !seen.has(key)) {
          seen.set(key, { ...u, rawData: u.rawData || {} });
        }
      }
    } catch {
      // Skip apps with no user collection
    }
  }
  return Array.from(seen.values());
}

async function enrichManagerEmailsFromIdentities(managers, knownDomain) {
  const needsEmail = managers.filter((m) => m.emails.length === 0 && m.name);
  if (needsEmail.length === 0) return managers;

  try {
    // Determine the email domain from managers that DO have emails, or from a known domain
    let domain = knownDomain || "";
    if (!domain) {
      for (const m of managers) {
        const e = m.emails?.[0];
        if (e && e.includes("@")) {
          domain = e.split("@")[1];
          break;
        }
      }
    }
    if (!domain) {
      const sampleIdentity = await Identity.findOne({
        email: { $exists: true, $ne: null },
      })
        .select("email")
        .lean();
      if (sampleIdentity?.email)
        domain = sampleIdentity.email.split("@")[1] || "";
    }

    // Build candidate emails: managerId@domain (fast $in lookup)
    const candidateEmails = [];
    const candidateToMgr = new Map();
    for (const m of needsEmail) {
      const name = (m.name || "").trim();
      if (!name) continue;
      const dotKey = name.toLowerCase().replace(/\s+/g, ".");
      const candidates = domain
        ? [
            `${dotKey}@${domain}`,
            `${name.toLowerCase().replace(/\s+/g, "_")}@${domain}`,
          ]
        : [];
      for (const c of candidates) {
        candidateEmails.push(c);
        candidateToMgr.set(c.toLowerCase(), m);
      }
    }

    if (candidateEmails.length > 0) {
      const identities = await Identity.find({
        email: { $in: candidateEmails },
      })
        .select("email")
        .limit(200)
        .lean();

      for (const id of identities) {
        if (!id.email) continue;
        const mgr = candidateToMgr.get(id.email.toLowerCase());
        if (mgr && mgr.emails.length === 0) {
          mgr.emails.push(id.email.toLowerCase());
        }
      }
    }

    // Fallback for remaining: try displayName $in query
    const stillNeeding = needsEmail.filter(
      (m) => m.emails.length === 0 && m.name,
    );
    if (stillNeeding.length > 0) {
      const names = stillNeeding.map((m) => m.name);
      const identities = await Identity.find({ displayName: { $in: names } })
        .select("email displayName")
        .limit(200)
        .lean();

      const byName = new Map();
      for (const id of identities) {
        if (id.email && id.displayName) {
          byName.set(id.displayName.toLowerCase(), id.email.toLowerCase());
        }
      }
      for (const m of stillNeeding) {
        const email = byName.get((m.name || "").toLowerCase());
        if (email) m.emails.push(email);
      }
    }
  } catch {
    // Identity lookup is best-effort
  }

  return managers;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildReviewerAssignmentMap — called once at campaign activation / scheduler.
// Returns Map<itemId, { reviewerEmail, assignedAt }> for ReviewItem generation.
// Assignment strategy:
//   MANAGER campaigns → match each user to their manager email via app user data
//   reviewerRoutingMode INTERNAL → one chosen manager for all items
//   reviewerRoutingMode EXTERNAL → external reviewer emails (round-robin)
//   All other campaigns → assign each selectedId to exactly one reviewer (round-robin)
// ─────────────────────────────────────────────────────────────────────────────

/** Identity item ids for PROFILE + IDENTITY assignment (ALL or SPECIFIC). */
async function resolveProfileIdentityAssignmentItemIds(campaign) {
  const certScope = String(campaign?.certificationScope || "").toUpperCase();
  const cat = String(campaign?.category || "").toUpperCase();
  if (certScope !== "PROFILE" || cat !== "IDENTITY") return [];

  const profileId = asObjectId(campaign.identityProfileId);
  const tenantId = campaign.tenantId;
  if (!profileId || !tenantId) return [];

  const identityMode = String(campaign.identityMode || "ALL").toUpperCase();
  const selectedIds = Array.isArray(campaign.selectedIds)
    ? campaign.selectedIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (identityMode === "SPECIFIC" && selectedIds.length > 0) {
    return selectedIds;
  }

  const query = { tenantId, identityProfileId: profileId };
  const identityFilter = String(campaign.identityFilter || "ALL")
    .trim()
    .toUpperCase();
  if (identityFilter === "NHI") {
    query.$or = [
      { isNHI: true },
      { identityType: { $in: ["nhi", "service"] } },
    ];
  } else if (identityFilter === "CONTRACTOR") {
    query.identityType = "contractor";
  }

  const identities = await Identity.find(query).select("_id").lean();
  return identities.map((i) => String(i._id));
}

export async function buildReviewerAssignmentMap(campaign) {
  let itemIds = Array.isArray(campaign.selectedIds)
    ? campaign.selectedIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  const routing = String(campaign.reviewerRoutingMode || "")
    .trim()
    .toUpperCase();

  if (itemIds.length === 0 && (routing === "EXTERNAL" || routing === "INTERNAL")) {
    itemIds = await resolveProfileIdentityAssignmentItemIds(campaign);
  }

  if (itemIds.length === 0) return new Map();

  const selectedIds = itemIds;

  const reviewers = Array.isArray(campaign.reviewersAssigned)
    ? campaign.reviewersAssigned
    : [];
  if (reviewers.length === 0) return new Map();

  const now = new Date();
  const currentReview =
    campaign.currentReview instanceof Map
      ? campaign.currentReview
      : new Map(Object.entries(campaign.currentReview || {}));

  // Explicit internal reviewer: every scope item goes to the selected manager.
  if (routing === "INTERNAL") {
    const internal = reviewers.find(
      (r) =>
        String(r.reviewerType || "").toUpperCase() === "MANAGER" &&
        String(r.email || r.reviewerEmail || "").trim(),
    );
    const targetEmail = internal
      ? String(internal.email || internal.reviewerEmail || "")
          .trim()
          .toLowerCase()
      : "";
    if (targetEmail) {
      for (const itemId of itemIds) {
        if (
          currentReview.has(itemId) &&
          currentReview.get(itemId)?.reviewerEmail
        )
          continue;
        const existing = currentReview.get(itemId) || {};
        currentReview.set(itemId, {
          ...existing,
          reviewerEmail: targetEmail,
          assignedAt: existing.assignedAt || now,
        });
      }
    }
    return currentReview;
  }

  // Explicit external reviewers only.
  if (routing === "EXTERNAL") {
    const externalEmails = reviewers
      .filter((r) => String(r.reviewerType || "").toUpperCase() === "EXTERNAL")
      .map((r) =>
        String(r.email || r.reviewerEmail || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (externalEmails.length > 0) {
      for (let i = 0; i < itemIds.length; i++) {
        const itemId = itemIds[i];
        const existing = currentReview.get(itemId) || {};
        if (existing.reviewerEmail) continue;
        const assignedEmail =
          externalEmails.length === 1
            ? externalEmails[0]
            : externalEmails[i % externalEmails.length];
        currentReview.set(itemId, {
          ...existing,
          reviewerEmail: assignedEmail,
          assignedAt: existing.assignedAt || now,
        });
      }
    }
    return currentReview;
  }

  const isManagerCampaign =
    campaign.category === "MANAGER" ||
    reviewers.some(
      (r) => String(r.reviewerType || "").toUpperCase() === "MANAGER",
    );

  if (isManagerCampaign && campaign.applicationName) {
    // Build a map: userId/mongoId → managerEmail from application user data
    try {
      const UsersModel = await resolveCertificationUserModel(
        campaign.applicationName,
        campaign.tenantId,
      );
      const appId = asObjectId(
        campaign.applicationId?._id || campaign.applicationId,
      );
      const query = appId ? { applicationId: appId } : {};
      const appUsers = await UsersModel.find(query)
        .select(
          "_id primaryKey display_name email manager_name manager_id manager_email rawData",
        )
        .lean();

      // Build user pool lookup: username/id → email (for resolving manager email from manager_id)
      const userEmailPool = new Map();
      for (const u of appUsers) {
        const raw = u.rawData || {};
        const uEmail = String(resolveUserEmail(u, raw) || "")
          .trim()
          .toLowerCase();
        if (!uEmail || !uEmail.includes("@")) continue;
        for (const key of collectIdentityPoolKeys(u, raw)) {
          const kk = String(key).trim().toLowerCase();
          if (kk) userEmailPool.set(kk, uEmail);
        }
      }

      // Build lookup: any user identifier → managerEmail
      const managerByUserId = new Map();
      for (const u of appUsers) {
        const raw = u.rawData || {};

        // Direct manager email fields
        let mgEmail = resolveUserManagerEmail(u, raw).toLowerCase();

        // Resolve via manager_id/supervisor_id → user pool email
        if (!mgEmail) {
          const mgrIdRaw = pickRawManagerForeignKey(raw) || u?.manager_id || "";
          const mgrIdKey = mgrIdRaw.trim().toLowerCase();
          if (mgrIdKey) {
            mgEmail =
              userEmailPool.get(mgrIdKey) ||
              findAppUserEmailByRecordId(appUsers, mgrIdKey) ||
              "";
          }
        }

        if (!mgEmail) continue;

        const keys = collectIdentityPoolKeys(u, raw).map((k) =>
          String(k || "")
            .trim()
            .toLowerCase(),
        );

        for (const k of keys) {
          if (k) managerByUserId.set(k, mgEmail);
        }
      }

      // Enrich managerByUserId from Identity warehouse for managers not found in app collection
      try {
        const unmappedItems = selectedIds.filter(
          (id) => !managerByUserId.has(String(id).trim().toLowerCase()),
        );
        if (unmappedItems.length > 0) {
          // For unmapped items, find their manager name/id from app data and look up in Identity
          const mgrNamesNeedingEmail = new Set();
          for (const u of appUsers) {
            const raw = u.rawData || {};
            const mgrIdRaw =
              pickRawManagerForeignKey(raw) || u?.manager_id || "";
            if (mgrIdRaw)
              mgrNamesNeedingEmail.add(mgrIdRaw.trim().toLowerCase());
          }

          if (mgrNamesNeedingEmail.size > 0) {
            // Derive domain from existing user emails for fast $in lookup
            let emailDomain = "";
            for (const u of appUsers) {
              const raw = u.rawData || {};
              const e = resolveUserEmail(u, raw);
              if (e && e.includes("@")) {
                emailDomain = e.split("@")[1];
                break;
              }
            }
            if (!emailDomain) {
              const sampleId = await Identity.findOne({
                email: { $exists: true, $ne: null },
              })
                .select("email")
                .lean();
              if (sampleId?.email)
                emailDomain = sampleId.email.split("@")[1] || "";
            }

            const mgrIds = [...mgrNamesNeedingEmail];
            const candidateEmails = emailDomain
              ? mgrIds.map((id) => `${id}@${emailDomain}`)
              : [];

            const identities =
              candidateEmails.length > 0
                ? await Identity.find({ email: { $in: candidateEmails } })
                    .select("email")
                    .limit(200)
                    .lean()
                : [];

            for (const identity of identities) {
              if (!identity.email) continue;
              const localPart = identity.email.split("@")[0].toLowerCase();
              // Map each user whose manager_id matches this identity
              for (const u of appUsers) {
                const raw = u.rawData || {};
                const mgrIdRaw = (
                  pickRawManagerForeignKey(raw) ||
                  u?.manager_id ||
                  ""
                )
                  .trim()
                  .toLowerCase();
                if (mgrIdRaw === localPart) {
                  const userKeys = collectIdentityPoolKeys(u, raw).map((k) =>
                    String(k || "")
                      .trim()
                      .toLowerCase(),
                  );
                  for (const k of userKeys) {
                    if (k && !managerByUserId.has(k)) {
                      managerByUserId.set(k, identity.email.toLowerCase());
                    }
                  }
                }
              }
            }
          }
        }
      } catch {
        // Identity enrichment is best-effort
      }

      // Build reviewer lookup: email → true, name → email (for reviewers stored without email)
      const reviewerEmailSet = new Set();
      const reviewerNameToEmail = new Map();
      for (const r of reviewers) {
        const email = String(r.email || r.reviewerEmail || "")
          .trim()
          .toLowerCase();
        const name = String(r.name || "")
          .trim()
          .toLowerCase();
        if (email) {
          reviewerEmailSet.add(email);
          if (name) reviewerNameToEmail.set(name, email);
          reviewerNameToEmail.set(name.replace(/\s+/g, "."), email);
        }
      }

      for (const itemId of selectedIds) {
        if (
          currentReview.has(itemId) &&
          currentReview.get(itemId)?.reviewerEmail
        )
          continue;

        const mgEmail = resolveManagerEmailForCampaignItem(
          itemId,
          managerByUserId,
          appUsers,
          userEmailPool,
        );
        if (!mgEmail) continue;

        const existing = currentReview.get(itemId) || {};
        currentReview.set(itemId, {
          ...existing,
          reviewerEmail: mgEmail,
          assignedAt: existing.assignedAt || now,
        });
      }

      // Identity warehouse: manager display names still missing assignment email
      const stillNeedingReviewer = selectedIds.filter(
        (id) => !String(currentReview.get(id)?.reviewerEmail || "").trim(),
      );
      if (stillNeedingReviewer.length > 0) {
        const byLowerName = new Map();
        for (const itemId of stillNeedingReviewer) {
          const hit = findAppUserRowByItemId(String(itemId), appUsers);
          if (!hit) continue;
          const mgrDisplay = cleanManagerName(
            resolveUserManager(hit.u, hit.raw),
          ).trim();
          if (!mgrDisplay || mgrDisplay.includes("@")) continue;
          const lk = mgrDisplay.toLowerCase();
          if (!byLowerName.has(lk))
            byLowerName.set(lk, { name: mgrDisplay, emails: [] });
        }
        const managersForEnrich = [...byLowerName.values()];
        let emailDomain = "";
        for (const u of appUsers) {
          const raw = u.rawData || {};
          const em = resolveUserEmail(u, raw);
          if (em && em.includes("@")) {
            emailDomain = em.split("@")[1];
            break;
          }
        }
        if (managersForEnrich.length > 0) {
          await enrichManagerEmailsFromIdentities(
            managersForEnrich,
            emailDomain,
          );
          const resolvedByName = new Map();
          for (const m of managersForEnrich) {
            const em0 = m.emails?.[0];
            if (em0)
              resolvedByName.set(
                (m.name || "").trim().toLowerCase(),
                String(em0).trim().toLowerCase(),
              );
          }
          for (const itemId of stillNeedingReviewer) {
            if (String(currentReview.get(itemId)?.reviewerEmail || "").trim())
              continue;
            const hit = findAppUserRowByItemId(String(itemId), appUsers);
            if (!hit) continue;
            const mgrDisplay = cleanManagerName(
              resolveUserManager(hit.u, hit.raw),
            ).trim();
            const emailHit = resolvedByName.get(mgrDisplay.toLowerCase());
            if (!emailHit) continue;
            const existing = currentReview.get(itemId) || {};
            currentReview.set(itemId, {
              ...existing,
              reviewerEmail: emailHit,
              assignedAt: existing.assignedAt || now,
            });
          }
        }
      }
    } catch (e) {
      console.warn(
        "[buildReviewerAssignmentMap] manager lookup failed:",
        e.message,
      );
    }
  }

  // For non-manager campaigns: assign each item to exactly ONE reviewer (round-robin).
  // This ensures reviewer-wise emails and strict token scoping.
  const reviewerEmails = reviewers
    .map((r) =>
      String(r.email || r.reviewerEmail || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  if (!isManagerCampaign && reviewerEmails.length > 0) {
    for (let i = 0; i < selectedIds.length; i++) {
      const itemId = selectedIds[i];
      const existing = currentReview.get(itemId) || {};
      if (existing.reviewerEmail) continue; // don't overwrite explicit/stamped assignment
      const assignedEmail =
        reviewerEmails.length === 1
          ? reviewerEmails[0]
          : reviewerEmails[i % reviewerEmails.length];
      currentReview.set(itemId, {
        ...existing,
        reviewerEmail: assignedEmail,
        assignedAt: existing.assignedAt || now,
      });
    }
  }

  return currentReview;
}

// Assignment / reminder emails: JWT-only review portal (no per-item opaque tokens).
// SECURITY: Pending rows come from ReviewItem scoped by reviewerEmail.
export async function buildReviewerEmailTokens(campaign, reviewerEmail) {
  const campaignId = campaign._id;
  const email = String(reviewerEmail ?? "")
    .trim()
    .toLowerCase();
  const itemDecisions = [];
  const approveAllToken = null;
  const revokeAllToken = null;

  const pendingRows = (
    await ReviewItem.find({
      campaignId,
      reviewerEmail: email,
    })
      .select(
        "itemId itemName itemEmail itemTitle itemManager itemManagerEmail " +
          "itemApplicationName itemAccessDetails entitlementDecisions userId reviewerId status",
      )
      .lean()
  ).filter((ri) => {
    const eds = Array.isArray(ri.entitlementDecisions)
      ? ri.entitlementDecisions
      : [];
    if (eds.length > 0) {
      return eds.some(
        (ed) => String(ed?.status || "PENDING").toUpperCase() === "PENDING",
      );
    }
    return String(ri.status || "").toUpperCase() === "PENDING";
  });

  if (pendingRows.length === 0) {
    return {
      itemDecisions,
      approveAllToken,
      revokeAllToken,
      scopeItems: [],
      reviewerJwt: null,
    };
  }

  const t = (v) => String(v ?? "").trim();

  const hasSnapshotData = pendingRows.some(
    (ri) => t(ri.itemName) || t(ri.itemEmail),
  );

  let scopeItems = [];

  if (hasSnapshotData) {
    for (const ri of pendingRows) {
      const base = {
        id: ri.itemId,
        identityName: t(ri.itemName) || t(ri.itemEmail) || "Unknown User",
        identityEmail: t(ri.itemEmail),
        role: t(ri.itemTitle) || "—",
        approveToken: null,
        revokeToken: null,
      };
      const eds = Array.isArray(ri.entitlementDecisions)
        ? ri.entitlementDecisions.filter((ed) => String(ed?.status || "PENDING").toUpperCase() === "PENDING")
        : [];
      if (eds.length > 0) {
        for (const ed of eds) {
          scopeItems.push({
            ...base,
            id: `${ri.itemId}::${ed.entitlementName}`,
            appName: t(ed.applicationName) || t(ri.itemApplicationName) || campaign.applicationName || "—",
            accessDetails: [t(ed.entitlementName)].filter(Boolean),
          });
        }
      } else {
        scopeItems.push({
          ...base,
          appName: t(ri.itemApplicationName) || campaign.applicationName || "—",
          accessDetails: Array.isArray(ri.itemAccessDetails)
            ? ri.itemAccessDetails
            : [],
        });
      }
    }
  } else {
    const pendingItemIds = pendingRows
      .map((r) => String(r.itemId))
      .filter(Boolean);
    try {
      const appName = campaign.applicationName;
      if (appName && pendingItemIds.length > 0) {
        const appId = asObjectId(
          campaign.applicationId?._id || campaign.applicationId,
        );
        const UsersModel = await resolveCertificationUserModel(
          appName,
          campaign.tenantId,
        );
        const EntitlementsModel = await getDynamicEntitlementModelForTenantId(
          appName,
          campaign.tenantId,
        );
        const { users: rawUsers, entitlements } =
          await loadScopedApplicationData(UsersModel, EntitlementsModel, appId);
        let users = rawUsers;
        try {
          const application = await Application.findById(appId)
            .select("name tenantId")
            .lean();
          if (application) {
            const schema = await loadMappedSchema(application);
            if (schema && Object.keys(schema).length > 0) {
              users = normalizeMappedUsers(rawUsers, schema);
            }
          }
        } catch (schemaErr) {
          console.warn(
            "[AccessCert] Backfill schema mapping failed:",
            schemaErr.message,
          );
        }
        const normalizedEntitlements = (entitlements || [])
          .map(normalizeEntitlementItem)
          .filter((e) => e.name || e.id);
        const scopeRows = buildScopeDataForCampaign(
          campaign,
          users,
          normalizedEntitlements,
        );

        const rawByMongoId = new Map();
        for (const u of users) {
          const mid = u._id?.toString?.();
          if (mid) rawByMongoId.set(mid, u.rawData || {});
        }

        const matchesPendingRow = (row) => {
          const candidates = collectScopeItemAliasCandidates(row);
          return pendingItemIds.some((pid) =>
            candidates.some((c) => itemIdsMatch(String(c), String(pid))),
          );
        };

        for (const row of scopeRows) {
          if (!matchesPendingRow(row)) continue;
          const raw = rawByMongoId.get(row.mongoId) || {};
          const role = (
            raw.Title ||
            raw.title ||
            raw.Role ||
            raw.role ||
            raw["Job Title"] ||
            raw.job_title ||
            raw.Department ||
            row.manager ||
            ""
          ).trim();
          scopeItems.push({
            id: row.id,
            identityName: row.name || row.email || "Unknown User",
            identityEmail: row.email || "",
            appName: row.applicationName || appName,
            role,
            accessDetails: Array.isArray(row.displayAccess)
              ? row.displayAccess
              : [],
            approveToken: null,
            revokeToken: null,
          });
        }
      }
    } catch {
      /* best-effort live resolution */
    }

    if (scopeItems.length === 0) {
      for (const ri of pendingRows) {
        scopeItems.push({
          id: ri.itemId,
          identityName: t(ri.itemName) || t(ri.itemEmail) || "Unknown User",
          identityEmail: t(ri.itemEmail),
          appName: campaign.applicationName || "—",
          role: "—",
          accessDetails: [],
          approveToken: null,
          revokeToken: null,
        });
      }
    }
  }

  let reviewerJwt = null;
  try {
    // Use reviewerId from any pending row as stable JWT subject (survives email renames).
    const reviewerId = pendingRows.find(r => r.reviewerId)?.reviewerId;
    reviewerJwt = generateReviewerToken(campaignId, email, { dueDate: campaign.dueDate, reviewerId });
  } catch {
    /* best-effort */
  }

  return {
    itemDecisions,
    approveAllToken,
    revokeAllToken,
    scopeItems,
    reviewerJwt,
  };
}

/**
 * Build scope rows for a campaign (shared by getCampaignById and activateCampaign).
 */
export async function loadScopeRowsForCampaign(campaign, { userTenantId }) {
  const normalizedCampaign = normalizeCampaignApplication(campaign);
  let scopeData = [];
  let meta = {};

  const appId = asObjectId(normalizedCampaign.applicationId);

  // ── PROFILE scope — delegate to profileCertificationScopeService ─────────────
  // This keeps certificationScopeService.js as a thin router.
  // All PROFILE scope-building logic lives in profileCertificationScopeService.js.
  const certScope   = String(normalizedCampaign?.certificationScope || "").toUpperCase();
  const certCategory = String(normalizedCampaign?.category || "").toUpperCase();

  if (certScope === "PROFILE" && certCategory === "IDENTITY") {
    const result = await buildIdentityScope(normalizedCampaign, userTenantId);
    return {
      scopeData: result.scopeData,
      meta: {
        usersInApplication: 0,
        entitlementsInApplication: 0,
        scopedItems: result.scopeData.length,
        readinessSummary: result.readinessSummary,
      },
      normalizedCampaign: result.normalizedCampaign,
    };
  }

  if (certScope === "PROFILE" && certCategory === "MANAGER") {
    const result = await buildManagerScope(normalizedCampaign, userTenantId);
    return {
      scopeData: result.scopeData,
      meta: {
        usersInApplication: 0,
        entitlementsInApplication: 0,
        scopedItems: result.scopeData.length,
        readinessSummary: result.readinessSummary,
      },
      normalizedCampaign: result.normalizedCampaign,
    };
  }
  // ─────────────────────────────────────────────────────────────────────────────

  if (
    normalizedCampaign.category === "MANAGER" &&
    (!appId || !normalizedCampaign.applicationName)
  ) {
    const users = await loadOrgWideUsers(userTenantId);
    const lifecycleByUserKey = await buildIdentityLifecycleLookup(
      userTenantId,
      users,
    );
    scopeData = buildScopeDataForCampaign(normalizedCampaign, users, [], {
      lifecycleByUserKey,
    });
    meta = {
      usersInApplication: users.length,
      entitlementsInApplication: 0,
      scopedItems: scopeData.length,
    };
  } else if (appId && normalizedCampaign.applicationName) {
    const UsersModel = await resolveCertificationUserModel(
      normalizedCampaign.applicationName,
      normalizedCampaign.tenantId,
    );
    const EntitlementsModel = await getDynamicEntitlementModelForTenantId(
      normalizedCampaign.applicationName,
      normalizedCampaign.tenantId,
    );

    const loaded = await loadScopedApplicationData(
      UsersModel,
      EntitlementsModel,
      appId,
    );
    let users = loaded.users;
    const entitlements = loaded.entitlements;

    // Apply dynamic application schema mapping (Replaces legacy backfill MappedUserModel)
    if (appId) {
      try {
        const application = await Application.findById(appId)
          .select("name tenantId")
          .lean();

        if (application) {
          const schema = await loadMappedSchema(application);

          if (schema && Object.keys(schema).length > 0) {
            users = normalizeMappedUsers(users, schema);
          }
        }
      } catch (err) {
        console.warn(
          "[AccessCert] Failed to apply schema mapping:",
          err.message,
        );
      }
    }
    const lifecycleByUserKey = await buildIdentityLifecycleLookup(
      userTenantId,
      users,
    );

    const normalizedEntitlements = entitlements
      .map(normalizeEntitlementItem)
      .filter((item) => item.name || item.id);

    scopeData = buildScopeDataForCampaign(
      normalizedCampaign,
      users,
      normalizedEntitlements,
      { lifecycleByUserKey },
    );

    if (
      scopeData.length === 0 &&
      Array.isArray(normalizedCampaign.selectedIds) &&
      normalizedCampaign.selectedIds.length > 0
    ) {
      scopeData = buildFallbackScopeFromSelectedIds(normalizedCampaign, users);
    }

    meta = {
      usersInApplication: users.length,
      entitlementsInApplication: normalizedEntitlements.length,
      scopedItems: scopeData.length,
    };
  }

  return { scopeData, meta, normalizedCampaign };
}
