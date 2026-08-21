import api from "./api";

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

function keyFor(name) {
  return (name || "").trim().toLowerCase();
}

/** Aligns with access certification scope matching (see accessCertificationController). */
function normalizeScopeTokenForScope(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const dnMatch = text.match(/^CN=([^,]+)/i);
  const normalized = dnMatch ? dnMatch[1] : text;
  return normalized.toLowerCase();
}

const DN_INTERIOR_RE = /[,;]\s*(?:CN|OU|DC|O|L|ST|C)=/i;

function splitMultiValueMember(raw) {
  if (!raw) return [];
  const segments = [];
  if (Array.isArray(raw)) {
    segments.push(...raw.map((item) => String(item || "").trim()).filter(Boolean));
  } else if (typeof raw === "string") {
    const str = raw.trim();
    // JSON array strings (common in SAP / custom CSV imports)
    if (str.startsWith("[") && str.endsWith("]")) {
      try {
        const parsed = JSON.parse(str.replace(/'/g, '"'));
        if (Array.isArray(parsed)) {
          return parsed
            .flatMap((v) => splitMultiValueMember(v))
            .map((t) => String(t || "").trim())
            .filter(Boolean);
        }
      } catch {
        /* fall through to delimiter split */
      }
    }
    segments.push(str);
  } else if (typeof raw === "object") {
    Object.values(raw).forEach((v) => {
      if (Array.isArray(v)) segments.push(...v.map((i) => String(i || "").trim()));
      else if (typeof v === "string") segments.push(v);
    });
  }
  const tokens = [];
  for (const seg of segments) {
    if (!seg) continue;
    for (const pipePart of seg.split("|").map((p) => p.trim()).filter(Boolean)) {
      for (const semiPart of pipePart.split(";").map((s) => s.trim()).filter(Boolean)) {
        if (/^CN=/i.test(semiPart) || DN_INTERIOR_RE.test(semiPart)) {
          tokens.push(semiPart);
        } else {
          tokens.push(...semiPart.split(",").map((c) => c.trim()).filter(Boolean));
        }
      }
    }
  }
  return tokens;
}

function normalizeAccessDisplayLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const dnMatch = text.match(/^CN=([^,;]+)/i);
  return (dnMatch ? dnMatch[1] : text).trim();
}

function isOpaqueCatalogId(id) {
  const s = String(id || "");
  return /^[0-9a-f]{24}$/i.test(s) || /^[0-9a-f-]{36}$/i.test(s);
}

/**
 * Clean labels (strip CN=), split pipe-delimited composites into unique atomic rows,
 * and dedupe by normalized name so the certification wizard matches Access Items /
 * Privileged views.
 */
function buildPickerAccessItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const merged = new Map();

  for (const item of items) {
    const rawId = String(item.id ?? "");
    const rawName = String(item.name ?? "");
    const composite = rawName.includes("|") || rawId.includes("|");

    if (composite) {
      const raw = rawName || rawId;
      const tokens = splitMultiValueMember(raw)
        .map(normalizeAccessDisplayLabel)
        .filter(Boolean);
      const seenTok = new Set();
      for (const t of tokens) {
        const k = keyFor(t);
        if (seenTok.has(k)) continue;
        seenTok.add(k);
        const prev = merged.get(k);
        merged.set(k, {
          ...item,
          id: t,
          name: t,
          privileged: Boolean(prev?.privileged || item.privileged),
          userCount: Math.max(
            Number(prev?.userCount) || 0,
            Number(item.userCount) || 0,
          ),
        });
      }
    } else {
      const label = normalizeAccessDisplayLabel(rawName || rawId);
      if (!label) continue;

      let rowId = rawId;
      if (isOpaqueCatalogId(rawId)) {
        rowId = rawId;
      } else if (
        /^CN=/i.test(rawId) ||
        /,OU=/i.test(rawId) ||
        /,DC=/i.test(rawId)
      ) {
        rowId = label;
      } else if (!rawId) {
        rowId = label;
      }

      const mapKey = isOpaqueCatalogId(rawId) ? `id:${rawId}` : keyFor(label);
      const prev = merged.get(mapKey);
      merged.set(mapKey, {
        ...item,
        id: rowId,
        name: label,
        privileged: Boolean(prev?.privileged || item.privileged),
        userCount: Math.max(
          Number(prev?.userCount) || 0,
          Number(item.userCount) || 0,
        ),
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.privileged !== b.privileged) return b.privileged ? 1 : -1;
    return (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
    });
  });
}

/** Same truthiness as backend normalizeEntitlementItemFull / Discovery Mark Privileged. */
export function normalizePrivilegeBoolean(e) {
  if (!e || typeof e !== "object") return false;
  if (
    e.privileged === true ||
    e.isPrivileged === true ||
    e.is_privileged === true ||
    e.is_privilege === true
  ) {
    return true;
  }
  const candidates = [
    e.is_privileged,
    e.is_privilege,
    e.isPrivilege,
    e.isPrivileged,
    e.privileged,
  ];
  return candidates.some((pr) =>
    ["true", "yes", "1", "y", "privileged"].includes(
      String(pr ?? "")
        .trim()
        .toLowerCase(),
    ),
  );
}

function pickFromRawDataMembership(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  // Exact / preferred list-field names first (avoid scalar entitlement_id false positives)
  const preferredKeys = [
    "member_of_entitlements",
    "memberOf",
    "MemberOf",
    "sap_roles",
    "AGR_NAME",
    "agr_name",
    "activity_groups",
    "activity_group",
    "profiles",
    "profile",
    "groups",
    "roles",
    "entitlements",
    "responsibilities",
  ];
  for (const key of preferredKeys) {
    const val = raw[key];
    if (val !== undefined && val !== null && String(val).trim() !== "") {
      // Skip obvious scalar id fields
      if (/^entitlement_id$/i.test(key)) continue;
      return typeof val === "string" || typeof val === "number"
        ? String(val).trim()
        : Array.isArray(val)
          ? val.map((x) => String(x || "").trim()).filter(Boolean).join("|")
          : String(val).trim();
    }
  }
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    // Never treat a single entitlement_id / id column as the membership list
    if (
      lk === "entitlement_id" ||
      lk === "entitlementid" ||
      lk === "id" ||
      lk === "_id"
    ) {
      continue;
    }
    if (patterns.some((p) => lk.includes(p.toLowerCase()))) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        if (Array.isArray(val)) {
          return val.map((x) => String(x || "").trim()).filter(Boolean).join("|");
        }
        return String(val).trim();
      }
    }
  }
  return "";
}

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

/** Mirrors accessCertificationController.extractUserEntitlementAssignmentTokensFromRaw */
function extractAssignmentTokensFromRaw(raw) {
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

/** Mirrors mergeMemberGroupsWithStructuredAccess (GitHub / SaaS JSON arrays). */
function mergeStructuredAccessIntoTokens(user, raw, baseTokens) {
  const tokens = [...(baseTokens || [])];
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

  const arrayKeyHint =
    /permission|profile|role|group|membership|assignment|entitlement|license|package|app_role|duty|responsibilit|delegat|authority|access/i;
  for (const [k, v] of Object.entries(raw || {})) {
    if (!Array.isArray(v) || v.length === 0 || v.length > 250) continue;
    if (!arrayKeyHint.test(k)) continue;
    tryArr(v);
  }

  return tokens;
}

/**
 * All membership / role / assignment tokens for privilege matching (SAP, Oracle, GitHub, etc.).
 * Aligns with accessCertificationController.buildScopeDataForCampaign sources.
 */
export function collectPrivilegeMatchMemberTokens(u) {
  const raw = u?.rawData || u?._originalData || {};
  const memberOfStr =
    u?.member_of_entitlements ||
    raw.member_of_entitlements ||
    raw.memberOf ||
    raw.MemberOf ||
    raw.sap_roles ||
    u?.memberOf ||
    u?.MemberOf ||
    pickFromRawDataMembership(
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

  const splitFromString = splitMultiValueMember(memberOfStr);
  const mergedStructured = mergeStructuredAccessIntoTokens(
    u,
    raw,
    splitFromString,
  );
  const assignments = extractAssignmentTokensFromRaw(raw);
  const combined = [...assignments, ...mergedStructured];
  const seen = new Set();
  const out = [];
  for (const t of combined) {
    const s = String(t || "").trim();
    if (!s) continue;
    const k = normalizeScopeTokenForScope(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function tokensMatchPrivilegedKeySet(groups, privilegedKeys) {
  for (const g of groups) {
    if (privilegedKeys.has(normalizeScopeTokenForScope(g))) return true;
    const cnMatches = typeof g === "string" ? g.match(/CN=([^,;]+)/gi) : null;
    if (cnMatches) {
      for (const m of cnMatches) {
        const inner = m.replace(/^CN=/i, "");
        if (privilegedKeys.has(normalizeScopeTokenForScope(inner)))
          return true;
      }
    }
  }
  return false;
}

function userTokensMatchPrivilegedKeySet(u, privilegedKeys) {
  return tokensMatchPrivilegedKeySet(
    collectPrivilegeMatchMemberTokens(u),
    privilegedKeys,
  );
}

function entitlementRecordKeySet(row) {
  const keys = new Set();
  const id = String(row?.id ?? row?._id ?? "").trim();
  const name = String(
    row?.name ?? row?.entitlementName ?? row?.displayName ?? "",
  ).trim();
  for (const token of [id, name]) {
    if (!token) continue;
    keys.add(normalizeScopeTokenForScope(token));
    const inner = token.match(/CN=([^,;]+)/i)?.[1] || token;
    keys.add(normalizeScopeTokenForScope(inner));
  }
  return keys;
}

/** How many users hold this entitlement (name/id) per the same token rules as the report card. */
export function countUsersMatchingEntitlementRecord(users, row) {
  if (!Array.isArray(users) || !row) return 0;
  const keys = entitlementRecordKeySet(row);
  if (keys.size === 0) return 0;
  let n = 0;
  for (const u of users) {
    if (userTokensMatchPrivilegedKeySet(u, keys)) n += 1;
  }
  return n;
}

/**
 * Same as countUsersMatchingEntitlementRecord but reuses precomputed
 * `collectPrivilegeMatchMemberTokens(u)` per user (for Appendix D).
 */
export function countUsersMatchingEntitlementTokenLists(tokenLists, row) {
  if (!Array.isArray(tokenLists) || !row) return 0;
  const keys = entitlementRecordKeySet(row);
  if (keys.size === 0) return 0;
  let n = 0;
  for (const groups of tokenLists) {
    if (tokensMatchPrivilegedKeySet(groups, keys)) n += 1;
  }
  return n;
}

/** CN=… vs short name — same as Governance report entitlement dedupe. */
export function entitlementCatalogDedupeKey(nameOrId) {
  const s = String(nameOrId || "").trim();
  if (!s) return "";
  const cn = s.match(/CN=([^,;=]+)/i)?.[1];
  return (cn || s).toLowerCase();
}

function privilegeCatalogPrimaryKey(e) {
  const name = String(e?.name ?? e?.entitlementName ?? "").trim();
  const id = String(e?.id ?? e?._id ?? "").trim();
  return (
    entitlementCatalogDedupeKey(name) ||
    entitlementCatalogDedupeKey(id) ||
    ""
  );
}

/**
 * Merge certification dynamic entitlements with `/entitlements?isPrivileged=true` rows.
 * Same logical key: cert + API entries merge; API can set privileged when cert row exists but was unflagged.
 */
export function mergePrivilegedEntitlementCatalogs(
  certEntitlements,
  apiEntitlements,
) {
  const map = new Map();
  const cert = Array.isArray(certEntitlements) ? certEntitlements : [];
  const api = Array.isArray(apiEntitlements) ? apiEntitlements : [];

  for (const e of cert) {
    const pk = privilegeCatalogPrimaryKey(e);
    if (!pk) continue;
    const id = String(e.id ?? "").trim();
    const name = String(e.name ?? "").trim();
    const displayName =
      String(e.displayName || e.name || e.id || "").trim() || name || id;
    map.set(pk, {
      id: id || name,
      name: name || id,
      privileged: normalizePrivilegeBoolean(e),
      displayName,
    });
  }

  for (const row of api) {
    const name = String(
      row.name || row.entitlementName || row.displayName || "",
    ).trim();
    const id = String(row._id || row.id || "").trim();
    const norm = {
      id: id || name,
      name: name || id,
      privileged: true,
      displayName: String(
        row.displayName || row.name || row.entitlementName || id || name,
      ).trim(),
    };
    const pk = privilegeCatalogPrimaryKey(norm);
    if (!pk) continue;
    if (!map.has(pk)) {
      map.set(pk, norm);
    } else {
      const ex = map.get(pk);
      map.set(pk, {
        ...ex,
        privileged:
          Boolean(normalizePrivilegeBoolean(ex) || norm.privileged),
        displayName:
          ex.displayName || norm.displayName || ex.name || norm.name,
      });
    }
  }

  return Array.from(map.values());
}

export function catalogHasPrivilegedDefinition(entitlements) {
  return (
    Array.isArray(entitlements) && entitlements.some(normalizePrivilegeBoolean)
  );
}

function pickFromRawDataForDisplay(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    if (patterns.some((p) => lk.includes(p.toLowerCase()))) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

/**
 * Display name for report tables — mirrors backend certificationUserDisplay.resolveUserName.
 */
export function resolveUserDisplayName(user) {
  const raw = user?.rawData || user?._originalData || {};
  const name =
    user?.name ||
    user?.display_name ||
    raw["Display Name"] ||
    raw.displayName ||
    raw.display_name ||
    raw.FULL_NAME ||
    raw.cn ||
    raw.name ||
    pickFromRawDataForDisplay(
      raw,
      "fullname",
      "full_name",
      "person_full",
      "displayname",
      "person_name",
    ) ||
    user?.username ||
    raw.username ||
    raw.Username ||
    pickFromRawDataForDisplay(
      raw,
      "username",
      "user_name",
      "oracle_user",
      "account_id",
      "account",
      "sAMAccount",
      "samaccount",
      "login",
    ) ||
    user?.user_id ||
    raw.user_id ||
    user?.email ||
    raw.email ||
    raw["Email Address"] ||
    pickFromRawDataForDisplay(raw, "email", "mail") ||
    "";
  return name.trim() || "—";
}

/**
 * Users who have at least one membership matching an entitlement marked privileged
 * (is_privilege in catalog — same rules as access certification).
 */
export function countUsersWithPrivilegedEntitlements(users, entitlements) {
  if (!Array.isArray(users) || !Array.isArray(entitlements)) return 0;

  const privilegedKeys = new Set();
  for (const e of entitlements) {
    if (!normalizePrivilegeBoolean(e)) continue;
    const id = String(e.id ?? "").trim();
    const name = String(e.name ?? "").trim();
    for (const token of [id, name]) {
      if (!token) continue;
      privilegedKeys.add(normalizeScopeTokenForScope(token));
      const inner = token.match(/CN=([^,;]+)/i)?.[1] || token;
      privilegedKeys.add(normalizeScopeTokenForScope(inner));
    }
  }

  if (privilegedKeys.size === 0) return 0;

  let n = 0;
  for (const u of users) {
    if (
      tokensMatchPrivilegedKeySet(
        collectPrivilegeMatchMemberTokens(u),
        privilegedKeys,
      )
    )
      n += 1;
  }

  return n;
}

/**
 * Same matching logic as countUsersWithPrivilegedEntitlements but returns an
 * array of { user, matchedEntitlements: string[] } for every matched user so
 * the report appendix can show *which* groups/entitlements triggered privilege.
 */
export function listUsersWithPrivilegedEntitlements(users, entitlements) {
  if (!Array.isArray(users) || !Array.isArray(entitlements)) return [];

  const privilegedKeys = new Map();
  for (const e of entitlements) {
    if (!normalizePrivilegeBoolean(e)) continue;
    const displayName = String(e.displayName || e.name || e.id || "").trim();
    const id = String(e.id ?? "").trim();
    const name = String(e.name ?? "").trim();
    for (const token of [id, name]) {
      if (!token) continue;
      privilegedKeys.set(normalizeScopeTokenForScope(token), displayName);
      const inner = token.match(/CN=([^,;]+)/i)?.[1] || token;
      privilegedKeys.set(normalizeScopeTokenForScope(inner), displayName);
    }
  }

  if (privilegedKeys.size === 0) return [];

  const results = [];
  for (const u of users) {
    const groups = collectPrivilegeMatchMemberTokens(u);
    const matched = new Set();

    for (const g of groups) {
      const norm = normalizeScopeTokenForScope(g);
      if (privilegedKeys.has(norm)) {
        matched.add(privilegedKeys.get(norm));
      }
      const cnMatches = typeof g === "string" ? g.match(/CN=([^,;]+)/gi) : null;
      if (cnMatches) {
        for (const m of cnMatches) {
          const inner = m.replace(/^CN=/i, "");
          const normInner = normalizeScopeTokenForScope(inner);
          if (privilegedKeys.has(normInner)) {
            matched.add(privilegedKeys.get(normInner));
          }
        }
      }
    }

    if (matched.size > 0) {
      results.push({ user: u, matchedEntitlements: [...matched] });
    }
  }

  return results;
}

function normalizeBoolean(val) {
  if (val === undefined || val === null) return false;
  return ["yes", "true", "y", "1"].includes(String(val).trim().toLowerCase());
}

function toSafeString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  if (typeof value === "object") {
    // Best-effort extraction for common `{ name }` / `{ id }` shapes.
    const v = value;
    if (typeof v.name !== "undefined" && v.name !== null) return String(v.name);
    if (typeof v.label !== "undefined" && v.label !== null)
      return String(v.label);
    if (typeof v.value !== "undefined" && v.value !== null)
      return String(v.value);
    if (typeof v.id !== "undefined" && v.id !== null) return String(v.id);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  try {
    return String(value);
  } catch {
    return fallback;
  }
}

function pickFromOriginal(o, ...patterns) {
  if (!o || typeof o !== "object") return "";
  const compiledPatterns = patterns
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .map((p) => ({
      raw: p.toLowerCase(),
      normalized: p.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    }));
  for (const key of Object.keys(o)) {
    const lk = key.toLowerCase();
    const normalizedKey = lk.replace(/[^a-z0-9]+/g, "");
    if (
      compiledPatterns.some(
        ({ raw, normalized }) =>
          lk.includes(raw) || (normalized && normalizedKey.includes(normalized)),
      )
    ) {
      const val = o[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

/** Align wizard status pill with IdentitySelectionTable ACTIVE_STATUSES (lowercase tokens). */
function normalizeAccountStatusForWizard(o, user) {
  const raw =
    user.status ||
    user.accountStatus ||
    o["Account Status"] ||
    o.accountStatus ||
    o.Status ||
    o.status ||
    o.state ||
    o.user_state ||
    o.uflag ||
    o.Enabled ||
    o.enabled ||
    o.Active ||
    o.active ||
    o["Password Status"] ||
    (typeof o.suspended === "boolean" && o.suspended ? "suspended" : "") ||
    pickFromOriginal(
      o,
      "status",
      "state",
      "active",
      "enabled",
      "uflag",
      "flag",
      "suspend",
      "lock",
      "account",
    ) ||
    "";

  const sl = String(raw).trim().toLowerCase();
  if (!sl) return "unknown";

  const activeExact = new Set([
    "active",
    "enabled",
    "live",
    "ok",
    "true",
    "1",
    "yes",
    "valid",
    "open",
  ]);
  const inactiveExact = new Set([
    "inactive",
    "disabled",
    "suspended",
    "locked",
    "off",
    "false",
    "0",
    "no",
    "dormant",
    "terminated",
    "deleted",
  ]);
  if (activeExact.has(sl)) return "active";
  if (inactiveExact.has(sl)) return "inactive";
  if (sl.includes("suspend") || sl.includes("disable") || sl.includes("inactive"))
    return "inactive";
  if ((sl.includes("active") || sl.includes("enable")) && !sl.includes("inactive"))
    return "active";
  return sl;
}

function axiosErr(err) {
  const apiCode = err?.response?.data?.error?.code;
  const apiMsg = err?.response?.data?.error?.message;
  if (apiCode || apiMsg)
    return `${apiCode || "ERROR"}: ${apiMsg || "Unknown error"}`;
  return (
    apiMsg ||
    err?.response?.data?.message ||
    (typeof err?.response?.data?.error === "string"
      ? err?.response?.data?.error
      : null) ||
    err?.message ||
    "Request failed"
  );
}

export const accessCertificationAPI = {
  async getApplications() {
    try {
      const res = await api.get("/access-certification/applications");
      return { success: true, data: res.data?.data || [] };
    } catch (err) {
      return { success: false, data: [], error: axiosErr(err) };
    }
  },

  async getCampaigns() {
    try {
      const res = await api.get("/access-certification/campaigns");
      // Backend returns: { success: true, data: { items, total, page, totalPages } }
      // Ensure we always expose a plain array to the UI.
      const payload = res.data?.data ?? res.data;
      const items = Array.isArray(payload)
        ? payload
        : payload?.items && Array.isArray(payload.items)
          ? payload.items
          : [];
      return { success: true, data: items };
    } catch (err) {
      return { success: false, data: [], error: axiosErr(err) };
    }
  },

  async createCampaign(payload) {
    try {
      const res = await api.post("/access-certification/campaigns", payload);
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, data: null, error: axiosErr(err) };
    }
  },

  async getCertificationProfiles(params = {}) {
    try {
      const res = await api.get("/access-certification/profiles", { params });
      const payload = res.data?.data ?? [];
      return { success: true, data: Array.isArray(payload) ? payload : [] };
    } catch (err) {
      return { success: false, data: [], error: axiosErr(err) };
    }
  },

  async createCertificationProfile(payload) {
    try {
      const res = await api.post("/access-certification/profiles", payload);
      return { success: true, data: res.data?.data || res.data };
    } catch (err) {
      return { success: false, data: null, error: axiosErr(err) };
    }
  },

  async updateCertificationProfile(profileId, payload) {
    try {
      const res = await api.put(
        `/access-certification/profiles/${profileId}`,
        payload,
      );
      return { success: true, data: res.data?.data || res.data };
    } catch (err) {
      return { success: false, data: null, error: axiosErr(err) };
    }
  },

  async archiveCertificationProfile(profileId) {
    try {
      const res = await api.delete(
        `/access-certification/profiles/${profileId}`,
      );
      return { success: true, data: res.data?.data || res.data };
    } catch (err) {
      return { success: false, data: null, error: axiosErr(err) };
    }
  },

  async getCertificationData(appId) {
    try {
      const res = await api.get(`/access-certification/data/${appId}`);
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, data: {}, error: axiosErr(err) };
    }
  },

  async getApplicationUsers(appId) {
    return this.getCertificationData(appId);
  },

  async getOrgWideManagers() {
    try {
      const res = await api.get("/access-certification/managers");
      const managers = res.data?.data?.managers ?? res.data?.managers ?? [];
      return { success: true, data: { managers } };
    } catch (err) {
      return { success: false, data: { managers: [] }, error: axiosErr(err) };
    }
  },

  async getProfileIdentities(identityProfileId, params = {}) {
    try {
      const res = await api.get(
        `/profile-certification/identity-profiles/${identityProfileId}/identities`,
        { params },
      );
      const payload = res.data || {};
      const data = Array.isArray(payload?.data) ? payload.data : [];
      const meta = payload?.meta && typeof payload.meta === "object" ? payload.meta : {};
      return { success: true, data, meta };
    } catch (err) {
      return { success: false, data: [], meta: {}, error: axiosErr(err) };
    }
  },

  /**
   * Fetch all managers who have direct reports in the given identity profile.
   * Used for PROFILE + MANAGER certification manager selection step.
   * Returns: [{ managerId, managerName, managerEmail, department, directReportsCount, riskCount }]
   */
  async getProfileManagers(identityProfileId) {
    try {
      const res = await api.get(
        `/profile-certification/identity-profiles/${identityProfileId}/managers`,
      );
      const payload = res.data || {};
      const data = Array.isArray(payload?.data) ? payload.data : [];
      return { success: true, data };
    } catch (err) {
      return { success: false, data: [], error: axiosErr(err) };
    }
  },

  /**
   * Pre-activation readiness report for a PROFILE-scope campaign.
   * Returns coverage metrics shown in CampaignReadinessModal before the admin activates.
   */
  async checkCampaignReadiness(campaignId) {
    try {
      const res = await api.get(
        `/profile-certification/campaigns/${campaignId}/readiness`,
      );
      const payload = res.data || {};
      return { success: true, data: payload?.data ?? {} };
    } catch (err) {
      return { success: false, data: {}, error: axiosErr(err) };
    }
  },

  async getCampaignById(id, params = undefined) {
    try {
      // Bust HTTP caches so we never get 304 with an empty body (decisions looked "reverted" to Pending).
      const axiosRes = await api.get(`/access-certification/campaigns/${id}`, {
        params: { _: Date.now(), ...(params && typeof params === "object" ? params : {}) },
      });
      const res = axiosRes.data || axiosRes;
      if (!res) return { success: false, message: "Invalid response" };
      return { success: true, ...res };
    } catch (err) {
      return { success: false, message: axiosErr(err) };
    }
  },

  async updateReviewDecision(id, payload) {
    try {
      const res = await api.patch(
        `/access-certification/campaigns/${id}/review`,
        payload,
      );
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async applyEntitlementDecision(campaignId, reviewItemId, entitlementName, decision, comment, reviewerName, remediationWorkflowId) {
    try {
      const res = await api.patch(
        `/access-certification/campaigns/${campaignId}/review-items/${reviewItemId}/entitlement`,
        { entitlementName, decision, comment, reviewerName, remediationWorkflowId },
      );
      return { success: true, data: res.data };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async triggerCampaignReminder(campaignId) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/remind`,
      );
      const actualData = res.data || res;
      return { success: true, data: actualData };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async deleteCampaigns(ids = []) {
    try {
      if (!Array.isArray(ids)) ids = [ids];
      const clean = ids.map((id) => String(id).trim()).filter(Boolean);
      const res = await api.delete("/access-certification/campaigns", {
        data: { ids: clean },
      });
      return { success: true, data: res.data };
    } catch (err) {
      // Some stacks drop DELETE bodies; retry via query string.
      try {
        const clean = (Array.isArray(ids) ? ids : [ids])
          .map((id) => String(id).trim())
          .filter(Boolean);
        const q = encodeURIComponent(clean.join(","));
        const res2 = await api.delete(
          `/access-certification/campaigns?ids=${q}`,
        );
        return { success: true, data: res2.data };
      } catch (err2) {
        return { success: false, error: axiosErr(err2) };
      }
    }
  },

  async getReminderSettings() {
    try {
      const res = await api.get("/access-certification/settings/reminders");
      const actualData = res.data || res;
      return { success: true, data: actualData };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async updateReminderSettings(frequency) {
    try {
      const res = await api.put("/access-certification/settings/reminders", {
        frequency,
      });
      return { success: true, data: res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async runReminderNow() {
    try {
      const res = await api.post(
        "/access-certification/settings/reminders/run-now",
      );
      return { success: true, data: res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getCampaignReminderStatus(campaignId) {
    const paths = [
      `/access-certification/campaigns/${campaignId}/reminder-status`,
      `/certifications/campaigns/${campaignId}/reminder-status`,
    ];
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await api.get(path);
        const payload = res.data?.data || res.data || {};
        return { success: true, data: payload };
      } catch (err) {
        lastError = err;
      }
    }
    return { success: false, error: axiosErr(lastError) };
  },

  async getCampaignNotificationSummary(campaignId) {
    try {
      const res = await api.get(
        `/access-certification/campaigns/${campaignId}/notification-summary`,
      );
      return { success: true, data: res.data?.data || res.data || {} };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getCampaignNotifications(campaignId, params = {}) {
    const paths = (id) => [
      `/access-certification/campaigns/${id}/notifications`,
      `/certifications/campaigns/${id}/notifications`,
    ];
    let lastError = null;
    for (const path of paths(campaignId)) {
      try {
        const res = await api.get(path, { params });
        return { success: true, data: res.data?.data || res.data || {} };
      } catch (err) {
        lastError = err;
      }
    }
    return { success: false, error: axiosErr(lastError) };
  },

  async getNotificationJobLog(campaignId, jobId) {
    const paths = (id, jid) => [
      `/access-certification/campaigns/${id}/notifications/jobs/${jid}/log`,
      `/certifications/campaigns/${id}/notifications/jobs/${jid}/log`,
    ];
    let lastError = null;
    for (const path of paths(campaignId, jobId)) {
      try {
        const res = await api.get(path);
        return { success: true, data: res.data?.data || res.data || {} };
      } catch (err) {
        lastError = err;
      }
    }
    return { success: false, error: axiosErr(lastError) };
  },

  async getEmailQueueStats() {
    const paths = [
      "/access-certification/notifications/queue-stats",
      "/certifications/notifications/queue-stats",
    ];
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await api.get(path);
        return { success: true, data: res.data?.data || res.data || {} };
      } catch (err) {
        lastError = err;
      }
    }
    return { success: false, error: axiosErr(lastError) };
  },

  async getNotificationDashboard(params = {}) {
    const paths = [
      "/access-certification/notifications/dashboard",
      "/certifications/notifications/dashboard",
    ];
    let lastError = null;
    for (const path of paths) {
      try {
        const res = await api.get(path, { params });
        return { success: true, data: res.data?.data || res.data || {} };
      } catch (err) {
        lastError = err;
      }
    }
    return { success: false, error: axiosErr(lastError) };
  },

  async retryNotificationJob(jobId, campaignId) {
    try {
      const res = await api.post(
        `/access-certification/notifications/${jobId}/retry`,
        { campaignId },
      );
      return { success: true, data: res.data?.data || res.data || {} };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getAutoIdentitySettings() {
    try {
      const res = await api.get("/access-certification/settings/auto-identity");
      const actualData = res.data || res;
      return { success: true, data: actualData };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async updateAutoIdentitySettings(payload) {
    try {
      const res = await api.put(
        "/access-certification/settings/auto-identity",
        payload,
      );
      return { success: true, data: res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getAutoPrivilegedSettings() {
    try {
      const res = await api.get(
        "/access-certification/settings/auto-privileged",
      );
      const actualData = res.data || res;
      return { success: true, data: actualData };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async updateAutoPrivilegedSettings(payload) {
    try {
      const res = await api.put(
        "/access-certification/settings/auto-privileged",
        payload,
      );
      return { success: true, data: res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async activateCampaign(campaignId) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/activate`,
      );
      return { success: true, data: res.data?.data || res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async applyOwnerAction(campaignId, payload) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/owner-action`,
        payload,
      );
      return { success: true, data: res.data?.data || res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async ownerFinalizePending(campaignId, payload) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/owner-finalize-pending`,
        payload,
      );
      return { success: true, data: res.data?.data || res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async applyBulkOwnerDecision(campaignId, payload) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/owner-bulk-decision`,
        payload,
      );
      return { success: true, data: res.data?.data || res.data || res };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getDashboardStats() {
    try {
      // Bust HTTP caches so analytics always reflects latest campaigns.
      const res = await api.get("/access-certification/dashboard", {
        params: { _: Date.now() },
      });
      const data = res.data?.data || res.data || res;
      return { success: true, data };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },

  async getReviewerProgress(campaignId) {
    try {
      const res = await api.get(
        `/access-certification/campaigns/${campaignId}/reviewer-progress`,
      );
      const data = res.data?.data || res.data || {};
      return { success: true, data };
    } catch (err) {
      return {
        success: false,
        data: { reviewers: [], missingReviewerCount: 0 },
        error: axiosErr(err),
      };
    }
  },

  async repairReviewers(campaignId) {
    try {
      const res = await api.post(
        `/access-certification/campaigns/${campaignId}/repair-reviewers`,
      );
      return { success: true, data: res.data?.data || {} };
    } catch (err) {
      return { success: false, error: axiosErr(err) };
    }
  },
};

export const accessCertificationProcessor = {
  normalizeUser(user) {
    const o = user._originalData || user.originalData || user.rawData || {};

    const safeId =
      user._id?.toString() ||
      user.id ||
      user.user_id ||
      o["Employee ID"] ||
      o.employee_id ||
      o["SAM Account Name"] ||
      o.user_id ||
      o["Email Address"] ||
      o.email_addr ||
      o.SID ||
      o["Display Name"] ||
      o.display_name ||
      `user_${Math.random().toString(36).slice(2, 7)}`;

    const rawManager =
      user.manager_name ||
      o.Manager ||
      o.manager ||
      o.manager_uid ||
      user.manager ||
      user.manager_id ||
      o["Manager Distinguished Name"] ||
      o["Manager DistinguishedName"] ||
      pickFromOriginal(
        o,
        "manager",
        "supervisor",
        "reporting",
        "reports_to",
        "lead",
        "mgr",
      ) ||
      "";

    const managerName = cleanManagerName(rawManager);

    const managerEmail =
      user.manager_email ||
      o["Manager Email Address"] ||
      o.managerEmail ||
      o.ManagerEmail ||
      user.managerEmail ||
      pickFromOriginal(
        o,
        "manager_email",
        "supervisor_email",
        "mgr_email",
        "reportingmanager",
      ) ||
      "";

    const isNHI = normalizeBoolean(o.isNHI ?? o["PSO Applied"]);
    const isContractor = normalizeBoolean(o.isContractor ?? o["PSO Resultant"]);

    const memberOf =
      user.member_of_entitlements ||
      user.memberOf ||
      o.member_of_entitlements ||
      o.memberOf ||
      o.MemberOf ||
      o.sap_roles ||
      user.memberOf ||
      user.MemberOf ||
      pickFromOriginal(
        o,
        "memberof",
        "entitlement",
        "roles",
        "groups",
        "profile",
      ) ||
      "";

    const location =
      o.location ||
      o.Location ||
      o.location_code ||
      o.office_location ||
      user.location ||
      pickFromOriginal(o, "location", "office", "site", "city", "country") ||
      "";

    const phone =
      o.telephone ||
      o.tel_number ||
      o.Telephone ||
      o.Phone ||
      o.phone ||
      user.phone ||
      pickFromOriginal(o, "phone", "tel", "mobile", "contact") ||
      "";

    const distinguishedName =
      o.distinguishedName ||
      o["distinguishedName"] ||
      o.entryDN ||
      o["entryDN"] ||
      user.user_id ||
      "";
    const cnFromDn = distinguishedName.match(/CN=([^,]+)/i)?.[1] || "";

    const baseName = (
      user.display_name ||
      user.name ||
      user.displayName ||
      o.FULL_NAME ||
      o["Display Name"] ||
      o.display_name ||
      o.name_text ||
      pickFromOriginal(o, "name", "fullname", "full_name", "displayname") ||
      ""
    ).trim();

    const userIdFallback =
      (typeof user.user_id === "string" && user.user_id) ||
      (typeof o.user_id === "string" && o.user_id) ||
      (typeof user.userId === "string" && user.userId) ||
      (typeof o.userId === "string" && o.userId) ||
      (typeof user.username === "string" && user.username) ||
      (typeof o.username === "string" && o.username) ||
      (typeof o.sAMAccountName === "string" && o.sAMAccountName) ||
      (typeof o.samaccountname === "string" && o.samaccountname) ||
      "";

    const emailFallback =
      (typeof user.email === "string" && user.email) ||
      (typeof o.email === "string" && o.email) ||
      (typeof o["Email Address"] === "string" && o["Email Address"]) ||
      (typeof o.email_addr === "string" && o.email_addr) ||
      "";

    const name =
      baseName ||
      userIdFallback ||
      emailFallback ||
      cnFromDn ||
      (distinguishedName ? distinguishedName : "—");

    return {
      id: safeId,
      name,
      email: (
        user.email ||
        o["Email Address"] ||
        o.email_addr ||
        o.email ||
        pickFromOriginal(o, "email", "mail") ||
        ""
      ).trim(),
      department:
        user.department ||
        o.Department ||
        o.department ||
        o.operating_unit ||
        o.kostl ||
        pickFromOriginal(
          o,
          "department",
          "dept",
          "division",
          "kostl",
          "org",
          "operating_unit",
          "business_unit",
          "org_unit",
        ) ||
        "—",
      title: (() => {
        // Prefer explicit job-title fields first
        const explicit = o.job_title || o["Job Title"] || o.jobTitle;
        if (explicit) return explicit;
        // Skip Title/title/user.title if they look like an email (AD stores UPN there)
        const raw = user.title || o.Title || o.title || "";
        if (raw && !String(raw).includes("@")) return raw;
        // Last resort: scan for job/position/designation keys (avoids re-hitting email Title)
        return pickFromOriginal(o, "job", "position", "designation") || "—";
      })(),
      location,
      phone,
      managerRaw: rawManager,
      manager: managerName || "",
      managerEmail: (managerEmail || "").trim(),
      status: normalizeAccountStatusForWizard(o, user),
      memberOf,
      isNHI,
      isContractor,
      _originalData: o,
    };
  },

  extractManagers(users) {
    const mgrMap = new Map();

    users.forEach((u) => {
      const raw = u.managerRaw || u.manager || "";
      const mgrName = cleanManagerName(raw);
      if (!mgrName) return;

      const mgrEmail = u.managerEmail
        ? u.managerEmail.toLowerCase().trim()
        : "";
      const key = mgrEmail ? `email::${mgrEmail}` : `name::${keyFor(mgrName)}`;

      if (!mgrMap.has(key)) {
        mgrMap.set(key, {
          id: `mgr_${key.replace(/[^a-z0-9]/g, "_")}`,
          name: mgrName,
          emails: new Set(),
          titles: new Set(),
          departments: new Set(),
          companies: new Set(),
          directReportsCount: 0,
          reports: [],
        });
      }

      const mgr = mgrMap.get(key);

      if (u.managerEmail) mgr.emails.add(u.managerEmail);
      if (u.title) mgr.titles.add(u.title);
      if (u.department) mgr.departments.add(u.department);
      if (u.company || u._originalData?.Company)
        mgr.companies.add(u.company || u._originalData?.Company);

      mgr.directReportsCount++;
      mgr.reports.push({
        id: u.id,
        name: u.name,
        email: u.email,
        department: u.department,
        title: u.title,
      });
    });

    // Cross-reference: resolve manager emails from the user pool using a
    // priority-ordered, ambiguity-safe lookup. AD/SCIM apps store manager as
    // a DN (CN=John Doe,OU=Users) with no companion manager_email field.
    //
    // Priority 1 — exact username / sAMAccountName  (most specific)
    // Priority 2 — first.last dotKey derived from email prefix (unique only)
    // Priority 3 — full display name exact match   (unique only)
    // Ambiguous matches (count > 1) are skipped with a console.warn.
    const byUsername = new Map(); // key → { email, count }
    const byDotKey   = new Map();
    const byFullName = new Map();

    const _track = (map, key, email) => {
      if (!key) return;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { email, count: 1 });
      } else if (existing.email !== email) {
        existing.count++;          // same key, different email → ambiguous
      }
      // same key + same email: no-op (harmless duplicate record)
    };

    users.forEach((u) => {
      const email = (u.email || '').toLowerCase().trim();
      if (!email || !email.includes('@')) return;

      // Priority 1: username / sAMAccountName
      const username = (
        u.username ||
        u._originalData?.username ||
        u._originalData?.sAMAccountName ||
        ''
      ).toLowerCase().trim();
      if (username) _track(byUsername, username, email);

      // Priority 2: first.last from email prefix
      const prefix = email.split('@')[0].toLowerCase();
      if (prefix && prefix.includes('.')) _track(byDotKey, prefix, email);

      // Priority 3: full display name
      const name = (u.name || '').toLowerCase().trim();
      if (name) {
        _track(byFullName, name, email);
        // also index "first.last" derived from display name as a dotKey alias
        const nameDot = name.replace(/\s+/g, '.');
        if (nameDot !== name) _track(byDotKey, nameDot, email);
      }
    });

    const _resolve = (map, key) => {
      if (!key) return null;
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.count > 1) return 'AMBIGUOUS';
      return entry.email;
    };

    for (const mgr of mgrMap.values()) {
      if (mgr.emails.size > 0) continue;
      const nameLower = (mgr.name || '').toLowerCase().trim();
      if (!nameLower) continue;

      // P1: treat the manager name itself as a possible username/sAMAccountName
      let resolved = _resolve(byUsername, nameLower);

      // P2: treat as dotKey
      if (!resolved || resolved === 'AMBIGUOUS') {
        const p2 = _resolve(byDotKey, nameLower) || _resolve(byDotKey, nameLower.replace(/\s+/g, '.'));
        if (p2 && p2 !== 'AMBIGUOUS') resolved = p2;
        else if (p2 === 'AMBIGUOUS') resolved = 'AMBIGUOUS';
      }

      // P3: full name
      if (!resolved || resolved === 'AMBIGUOUS') {
        const p3 = _resolve(byFullName, nameLower);
        if (p3 && p3 !== 'AMBIGUOUS') resolved = p3;
        else if (p3 === 'AMBIGUOUS') resolved = 'AMBIGUOUS';
      }

      if (resolved === 'AMBIGUOUS') {
        console.warn(`[extractManagers] Ambiguous email match for manager "${mgr.name}" — skipping to avoid incorrect assignment`);
      } else if (resolved) {
        mgr.emails.add(resolved);
      }
    }

    const managers = Array.from(mgrMap.values()).map((m) => ({
      ...m,
      emails: Array.from(m.emails),
      titles: Array.from(m.titles),
      departments: Array.from(m.departments),
      companies: Array.from(m.companies),
    }));

    return managers.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  },

  extractAccessItems(users, privilegedGroups = []) {
    const privilegedSet = new Set(
      Array.isArray(privilegedGroups)
        ? privilegedGroups.map((g) => keyFor(g)).filter(Boolean)
        : [],
    );
    const items = new Map();

    users.forEach((u) => {
      const rawSource =
        u.memberOf ||
        u.MemberOf ||
        (u._originalData &&
          (u._originalData.memberOf ||
            u._originalData.MemberOf ||
            u._originalData.member_of_entitlements ||
            u._originalData.sap_roles)) ||
        "";

      const tokens = splitMultiValueMember(rawSource);
      if (tokens.length === 0) return;

      tokens.forEach((g) => {
        const cn = normalizeAccessDisplayLabel(g);
        if (!cn) return;
        const dedupeKey = keyFor(cn);

        const isPrivileged = dedupeKey ? privilegedSet.has(dedupeKey) : false;

        const existing = items.get(dedupeKey);
        if (!existing) {
          items.set(dedupeKey, {
            id: cn,
            name: cn,
            type: "group",
            source: "Active Directory",
            status: "Enabled",
            privileged: isPrivileged,
          });
        } else if (isPrivileged && !existing.privileged) {
          existing.privileged = true;
        }
      });
    });

    return Array.from(items.values());
  },

  async normalizeCertificationData(appId) {
    const res = await accessCertificationAPI.getApplicationUsers(appId);

    if (!res.success) throw new Error(res.error || "Failed to load users");

    const payload = res.data?.data || res.data || [];
    const rawUsers = Array.isArray(payload) ? payload : payload.users || [];
    const privilegedGroups = Array.isArray(payload.privilegedGroups)
      ? payload.privilegedGroups
      : [];
    const entitlementCatalog = Array.isArray(payload.entitlements)
      ? payload.entitlements
      : [];
    const privilegedEntitlements = Array.isArray(payload.privilegedEntitlements)
      ? payload.privilegedEntitlements
      : [];

    const users = rawUsers.map((u) => this.normalizeUser(u));

    const userMap = new Map();
    users.forEach((user) => {
      if (user.id && !userMap.has(user.id)) {
        userMap.set(user.id, user);
      }
    });
    const uniqueUsers = Array.from(userMap.values());

    const managers = this.extractManagers(uniqueUsers);

    const memberOfItems = this.extractAccessItems(
      uniqueUsers,
      privilegedGroups,
    );

    const catalogKeySet = new Set();
    const catalogById = new Map();

    entitlementCatalog.forEach((e) => {
      const canonicalId = toSafeString(
        e?.id ?? e?.entitlement_id ?? e?.name ?? e?.entitlement_name,
        "",
      );
      if (!canonicalId) return;

      const serverCount = Number(e?.userCount);
      const item = {
        id: canonicalId,
        name: toSafeString(
          e?.name ?? e?.entitlement_name ?? canonicalId,
          canonicalId,
        ),
        type: toSafeString(
          e?.type ?? e?.granted_via ?? "entitlement",
          "entitlement",
        ),
        source: toSafeString(e?.source ?? "Catalog", "Catalog"),
        status: toSafeString(e?.status ?? e?.is_active ?? "Enabled", "Enabled"),
        privileged: normalizeBoolean(e.privileged ?? e.is_privilege),
        ...(Number.isFinite(serverCount) ? { userCount: serverCount } : {}),
        ...(e?.mongoId ? { mongoId: String(e.mongoId) } : {}),
      };

      if (!catalogById.has(canonicalId)) {
        catalogById.set(canonicalId, item);
      }
      if (item.id) catalogKeySet.add(String(item.id).toLowerCase());
      if (item.name) catalogKeySet.add(String(item.name).toLowerCase());
    });

    privilegedEntitlements.forEach((e) => {
      const id = toSafeString(
        e?.id ?? e?.entitlement_id ?? e?.name ?? e?.entitlement_name,
        "",
      );
      if (!id) return;

      const serverCount = Number(e?.userCount);
      const existing = catalogById.get(id);
      const item = {
        id,
        name: toSafeString(e?.name ?? e?.entitlement_name ?? id, id),
        type: toSafeString(
          e?.type ?? e?.granted_via ?? "entitlement",
          "entitlement",
        ),
        source: toSafeString(e?.source ?? "Catalog", "Catalog"),
        status: toSafeString(e?.status ?? e?.is_active ?? "Enabled", "Enabled"),
        privileged: true,
        userCount: Math.max(
          Number.isFinite(serverCount) ? serverCount : 0,
          Number(existing?.userCount) || 0,
        ),
        ...(e?.mongoId || existing?.mongoId
          ? { mongoId: String(e?.mongoId || existing?.mongoId) }
          : {}),
      };

      if (!catalogById.has(id)) {
        catalogById.set(id, item);
      } else {
        catalogById.set(id, {
          ...existing,
          ...item,
          privileged: true,
          userCount: Math.max(
            Number(existing?.userCount) || 0,
            Number(item.userCount) || 0,
          ),
        });
      }

      catalogKeySet.add(String(item.id).toLowerCase());
      if (item.name) catalogKeySet.add(String(item.name).toLowerCase());
    });

    const allItemsMap = new Map(catalogById);
    memberOfItems.forEach((i) => {
      const idKey = String(i.id || "").toLowerCase();
      const nameKey = String(i.name || "").toLowerCase();
      if (catalogKeySet.has(idKey) || catalogKeySet.has(nameKey)) return;
      allItemsMap.set(i.id, i);
    });

    const accessItemsRaw = Array.from(allItemsMap.values()).sort((a, b) => {
      if (a.privileged !== b.privileged) return b.privileged ? 1 : -1;
      return (a.name || "").localeCompare(b.name || "");
    });

    const accessItems = buildPickerAccessItems(accessItemsRaw);

    const campaignTemplate = {
      generatedAt: new Date().toISOString(),
      totalIdentities: uniqueUsers.length,
      totalManagers: managers.length,
      totalAccessItems: accessItems.length,
    };

    return {
      identities: uniqueUsers,
      managers,
      accessItems,
      campaignTemplate,
    };
  },
};

export const accessCertificationController = {
  _cache: new Map(),

  async initializeCertification(
    setData,
    setError,
    appId,
    forceRefresh = false,
  ) {
    const cacheKey = appId || "__org_wide__";
    try {
      if (!appId) {
        if (this._cache.has(cacheKey) && !forceRefresh) {
          const cached = this._cache.get(cacheKey);
          if ((cached?.managers?.length || 0) > 0) {
            setData(cached);
            setError(null);
            return true;
          }
        }
        const res = await accessCertificationAPI.getOrgWideManagers();
        if (!res.success)
          throw new Error(res.error || "Failed to load managers");
        const data = {
          identities: [],
          managers: res.data?.managers || [],
          accessItems: [],
        };
        this._cache.set(cacheKey, data);
        setData(data);
        setError(null);
        return true;
      }

      if (this._cache.has(appId) && !forceRefresh) {
        const cached = this._cache.get(appId);
        const hasUsableData =
          (cached?.identities?.length || 0) > 0 ||
          (cached?.accessItems?.length || 0) > 0 ||
          (cached?.managers?.length || 0) > 0;
        if (hasUsableData) {
          setData(cached);
          setError(null);
          return true;
        }
      }

      const data =
        await accessCertificationProcessor.normalizeCertificationData(appId);
      this._cache.set(appId, data);
      setData(data);
      setError(null);
      return true;
    } catch (error) {
      setError(error.message);
      setData({ identities: [], managers: [], accessItems: [] });
      return false;
    }
  },

  clearCache(appId) {
    if (appId) this._cache.delete(appId);
    else this._cache.clear();
  },

  async createCampaign(payload) {
    const res = await accessCertificationAPI.createCampaign(payload);
    if (!res.success) throw new Error(res.error);
    this._cache.delete("__dashboard__");
    return res.data;
  },

  async getCertificationProfiles(params = {}) {
    const res = await accessCertificationAPI.getCertificationProfiles(params);
    if (!res.success) {
      throw new Error(res.error || "Failed to load certification profiles");
    }
    return res.data;
  },

  async createCertificationProfile(payload) {
    const res =
      await accessCertificationAPI.createCertificationProfile(payload);
    if (!res.success) {
      throw new Error(res.error || "Failed to create certification profile");
    }
    return res.data;
  },

  async updateCertificationProfile(profileId, payload) {
    const res = await accessCertificationAPI.updateCertificationProfile(
      profileId,
      payload,
    );
    if (!res.success) {
      throw new Error(res.error || "Failed to update certification profile");
    }
    return res.data;
  },

  async archiveCertificationProfile(profileId) {
    const res =
      await accessCertificationAPI.archiveCertificationProfile(profileId);
    if (!res.success) {
      throw new Error(res.error || "Failed to archive certification profile");
    }
    return res.data;
  },

  async deleteCampaigns(ids = [], options = { clearCache: true }) {
    if (!Array.isArray(ids)) ids = [ids];
    const res = await accessCertificationAPI.deleteCampaigns(ids);
    if (!res.success) throw new Error(res.error || "Failed to delete");
    if (options.clearCache !== false) this.clearCache();
    return res.data;
  },

  async loadDashboardStats(setData, setError, forceRefresh = false) {
    try {
      const cacheKey = "__dashboard__";

      if (this._cache.has(cacheKey) && !forceRefresh) {
        setData(this._cache.get(cacheKey));
        setError(null);
        return true;
      }

      const res = await accessCertificationAPI.getDashboardStats();
      if (!res.success) throw new Error(res.error);

      this._cache.set(cacheKey, res.data);
      setData(res.data);
      setError(null);
      return true;
    } catch (err) {
      setError(err.message);
      setData(null);
      return false;
    }
  },

  async triggerIndividualReminder(campaignId) {
    const res =
      await accessCertificationAPI.triggerCampaignReminder(campaignId);
    if (!res.success) {
      throw new Error(res.error || "Failed to trigger reminder");
    }
    const payload = res.data?.data || res.data || {};
    return {
      message: payload.message || "Reminder processed",
      emailsSent: payload.emailsSent ?? 0,
      skippedDuplicate: payload.skippedDuplicate ?? 0,
      skippedInWindow: Array.isArray(payload.skippedInWindow)
        ? payload.skippedInWindow
        : [],
      nextEligibleAt: payload.nextEligibleAt || null,
      failedDeliveries: payload.failedDeliveries ?? 0,
      lastError: payload.lastError || null,
      deliveryErrors: Array.isArray(payload.deliveryErrors)
        ? payload.deliveryErrors
        : [],
      reviewersWithPending: Array.isArray(payload.reviewersWithPending)
        ? payload.reviewersWithPending
        : [],
    };
  },

  async loadReminderSettings() {
    const res = await accessCertificationAPI.getReminderSettings();
    if (!res.success) throw new Error(res.error || "Failed to load settings");

    const raw = res.data || {};

    const frequency =
      raw.frequency ||
      raw.reminderSettings?.frequency ||
      raw.data?.frequency ||
      "WEEKLY";

    const lastReminderRunAt =
      raw.lastReminderRunAt ||
      raw.reminderSettings?.lastReminderRunAt ||
      raw.data?.lastReminderRunAt ||
      null;

    return {
      frequency,
      lastReminderRunAt,
      tenantName: raw.tenantName || raw.data?.tenantName || null,
      tenantId: raw.tenantId || raw.data?.tenantId || null,
      scope: raw.scope || raw.data?.scope || "tenant",
    };
  },

  async saveReminderSettings(frequency) {
    const res = await accessCertificationAPI.updateReminderSettings(frequency);
    if (!res.success) throw new Error(res.error || "Failed to save settings");
    return res.data;
  },

  async runReminderNow() {
    const res = await accessCertificationAPI.runReminderNow();
    if (!res.success) throw new Error(res.error || "Failed to run job");
    return res.data;
  },

  async loadAutoIdentitySettings() {
    const res = await accessCertificationAPI.getAutoIdentitySettings();
    if (!res.success)
      throw new Error(res.error || "Failed to load auto-identity settings");

    const raw = res.data || {};

    const enabled =
      raw.enabled ??
      raw.data?.enabled ??
      raw.autoIdentityCertification?.enabled ??
      false;

    const defaultDueDays =
      raw.defaultDueDays ??
      raw.data?.defaultDueDays ??
      raw.autoIdentityCertification?.defaultDueDays ??
      7;

    return { enabled, defaultDueDays };
  },

  async saveAutoIdentitySettings(payload) {
    const res =
      await accessCertificationAPI.updateAutoIdentitySettings(payload);
    if (!res.success)
      throw new Error(res.error || "Failed to update auto-identity settings");

    const raw = res.data || {};
    return {
      enabled:
        raw.enabled ??
        raw.data?.enabled ??
        raw.autoIdentityCertification?.enabled ??
        payload.enabled,
      defaultDueDays:
        raw.defaultDueDays ??
        raw.data?.defaultDueDays ??
        raw.autoIdentityCertification?.defaultDueDays ??
        payload.defaultDueDays,
    };
  },

  async loadAutoPrivilegedSettings() {
    const res = await accessCertificationAPI.getAutoPrivilegedSettings();
    if (!res.success)
      throw new Error(res.error || "Failed to load auto-privileged settings");

    const raw = res.data || {};

    const enabled =
      raw.enabled ??
      raw.data?.enabled ??
      raw.autoPrivilegedCertification?.enabled ??
      false;

    const defaultDueDays =
      raw.defaultDueDays ??
      raw.data?.defaultDueDays ??
      raw.autoPrivilegedCertification?.defaultDueDays ??
      7;

    const notifyTarget =
      raw.notifyTarget ??
      raw.data?.notifyTarget ??
      raw.autoPrivilegedCertification?.notifyTarget ??
      "OWNER";

    const includeAllAccessItems =
      raw.includeAllAccessItems ??
      raw.data?.includeAllAccessItems ??
      raw.autoPrivilegedCertification?.includeAllAccessItems ??
      false;

    return { enabled, defaultDueDays, notifyTarget, includeAllAccessItems };
  },

  async saveAutoPrivilegedSettings(payload) {
    const res =
      await accessCertificationAPI.updateAutoPrivilegedSettings(payload);
    if (!res.success)
      throw new Error(res.error || "Failed to update auto-privileged settings");

    const raw = res.data || {};
    return {
      enabled:
        raw.enabled ??
        raw.data?.enabled ??
        raw.autoPrivilegedCertification?.enabled ??
        payload.enabled,
      defaultDueDays:
        raw.defaultDueDays ??
        raw.data?.defaultDueDays ??
        raw.autoPrivilegedCertification?.defaultDueDays ??
        payload.defaultDueDays,
      notifyTarget:
        raw.notifyTarget ??
        raw.data?.notifyTarget ??
        raw.autoPrivilegedCertification?.notifyTarget ??
        payload.notifyTarget,
      includeAllAccessItems:
        raw.includeAllAccessItems ??
        raw.data?.includeAllAccessItems ??
        raw.autoPrivilegedCertification?.includeAllAccessItems ??
        payload.includeAllAccessItems,
    };
  },

  async activateCampaign(campaignId) {
    const res = await accessCertificationAPI.activateCampaign(campaignId);
    if (!res.success)
      throw new Error(res.error || "Failed to activate campaign");
    return res.data;
  },

  async applyOwnerAction(campaignId, payload) {
    const res = await accessCertificationAPI.applyOwnerAction(
      campaignId,
      payload,
    );
    if (!res.success) throw new Error(res.error || "Failed to update campaign");
    return res.data;
  },

  async ownerFinalizePending(campaignId, payload) {
    const res = await accessCertificationAPI.ownerFinalizePending(
      campaignId,
      payload,
    );
    if (!res.success)
      throw new Error(res.error || "Failed to finalize pending items");
    return res.data;
  },

  async applyBulkOwnerDecision(campaignId, payload) {
    const action = String(payload?.action || payload?.intent || "").toUpperCase();
    if (action === "APPROVE_ALL" || action === "REVOKE_ALL") {
      const res = await accessCertificationAPI.ownerFinalizePending(
        campaignId,
        { action },
      );
      if (!res.success)
        throw new Error(res.error || "Failed to finalize pending items");
      return res.data;
    }
    const res = await accessCertificationAPI.applyBulkOwnerDecision(
      campaignId,
      payload,
    );
    if (!res.success)
      throw new Error(res.error || "Failed to apply bulk decision");
    return res.data;
  },
};

const accessCertificationService = {
  api: accessCertificationAPI,
  processor: accessCertificationProcessor,
  controller: accessCertificationController,

  // Convenience methods for common operations
  async getReviewerProgress(campaignId) {
    return accessCertificationAPI.getReviewerProgress(campaignId);
  },

  async getCampaignReminderStatus(campaignId) {
    return accessCertificationAPI.getCampaignReminderStatus(campaignId);
  },

  async getCampaignNotificationSummary(campaignId) {
    return accessCertificationAPI.getCampaignNotificationSummary(campaignId);
  },

  async getCampaignNotifications(campaignId, params) {
    return accessCertificationAPI.getCampaignNotifications(campaignId, params);
  },

  async getNotificationJobLog(campaignId, jobId) {
    return accessCertificationAPI.getNotificationJobLog(campaignId, jobId);
  },

  async getEmailQueueStats() {
    return accessCertificationAPI.getEmailQueueStats();
  },

  async getNotificationDashboard(params) {
    return accessCertificationAPI.getNotificationDashboard(params);
  },

  async retryNotificationJob(jobId, campaignId) {
    return accessCertificationAPI.retryNotificationJob(jobId, campaignId);
  },
};

export default accessCertificationService;
