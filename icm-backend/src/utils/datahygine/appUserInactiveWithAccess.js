import { extractEntitlementTokensFromAppUser } from "../sod/sodAppUserEntitlements.js";

/**
 * Detect coarse-grained "access" on a downstream application user document (dynamic app_users row).
 * @param {object|null|undefined} accountData
 * @returns {boolean}
 */
function accountDocumentHasDownstreamAccess(accountData) {
  if (!accountData || typeof accountData !== "object") return false;
  const accessKeys = [
    "member_of_entitlements",
    "groups",
    "roles",
    "entitlements",
    "profiles",
    "permissions",
    "organization_role",
  ];
  for (const key of accessKeys) {
    const val = accountData[key] ?? accountData.rawData?.[key];
    if (Array.isArray(val) && val.length > 0) return true;
    if (typeof val === "string" && val.trim() !== "") return true;
  }
  return false;
}

/** Normalized lifecycle/status values treated as inactive for data hygiene. */
const INACTIVE_STATUS_TOKENS = new Set([
  "INACTIVE",
  "TERMINATED",
  "LEAVER",
  "QUARANTINE",
  "DISABLED",
  "LOCKED",
  "EXPIRED",
  "SUSPENDED",
]);

/**
 * Coarse normalize for app user status / lifecycle fields (connector-agnostic).
 * @param {unknown} rawValue
 * @param {string} [sourceKey]
 * @returns {string}
 */
function normalizeAppUserStatusValue(rawValue, sourceKey = "") {
  const key = String(sourceKey || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const isNegativeFlagKey = [
    "accountdisabled",
    "disabled",
    "locked",
    "lockout",
    "terminationflag",
    "terminated",
    "isinactive",
  ].includes(key);

  if (typeof rawValue === "boolean") {
    if (isNegativeFlagKey) return rawValue ? "INACTIVE" : "ACTIVE";
    return rawValue ? "ACTIVE" : "INACTIVE";
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  const s = raw.toUpperCase().replace(/\s+/g, "_");

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
  if (
    s.includes("SUSPEND") ||
    s.includes("LOCK") ||
    s.includes("DISABL") ||
    s.includes("INACTIVE")
  ) {
    return "INACTIVE";
  }
  if (s.includes("QUARANT")) return "QUARANTINE";
  if (s.includes("EXPIR")) return "EXPIRED";

  return s;
}

/**
 * @param {object} raw
 * @param  {...string} patterns
 */
function pickFromRawData(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    if (patterns.some((p) => lk.includes(String(p || "").toLowerCase()))) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

/**
 * Whether an application user row (`app_iga_*_*_users`) is inactive / disabled.
 * @param {object|null|undefined} user
 */
export function isAppUserInactiveForHygiene(user) {
  if (!user || typeof user !== "object") return false;
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};

  const statusCandidates = [
    ["status", user.status ?? raw.status],
    ["user_status", user.user_status ?? raw.user_status],
    ["account_status", user.account_status ?? raw.account_status],
    ["profile_status", user.profile_status ?? raw.profile_status],
    ["lifecycleState", user.lifecycleState ?? raw.lifecycleState],
    ["lifecycle", user.lifecycle ?? raw.lifecycle],
    ["state", user.state ?? raw.state],
    ["isActive", user.isActive ?? raw.isActive],
    ["active", user.active ?? raw.active],
    ["enabled", user.enabled ?? raw.enabled],
    ["accountDisabled", user.accountDisabled ?? raw.accountDisabled],
    ["locked", user.locked ?? raw.locked],
  ];

  const pickedStatus = pickFromRawData(
    raw,
    "status",
    "user_status",
    "account_status",
    "profile_status",
    "lifecycle",
    "lifecycle_state",
    "state",
    "is_active",
    "enabled",
    "account_disabled",
    "locked",
  );
  if (pickedStatus) {
    const normalized = normalizeAppUserStatusValue(pickedStatus, "status");
    if (normalized && INACTIVE_STATUS_TOKENS.has(normalized)) return true;
  }

  for (const [k, v] of statusCandidates) {
    if (v == null || String(v).trim() === "") continue;
    const normalized = normalizeAppUserStatusValue(v, k);
    if (normalized && INACTIVE_STATUS_TOKENS.has(normalized)) return true;
  }

  return false;
}

/**
 * Whether the app user still has entitlement / group / role signals on the row.
 * @param {object|null|undefined} user
 */
export function appUserHasEntitlementsForHygiene(user) {
  if (!user || typeof user !== "object") return false;
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  if (accountDocumentHasDownstreamAccess(user)) return true;
  return extractEntitlementTokensFromAppUser(user, raw).length > 0;
}

/**
 * @param {object|null|undefined} user
 */
export function isInactiveAppUserWithAccess(user) {
  return isAppUserInactiveForHygiene(user) && appUserHasEntitlementsForHygiene(user);
}

/**
 * Best-effort raw ACCOUNT STATUS string for hygiene detail rows.
 * @param {object|null|undefined} user
 * @returns {string|null}
 */
export function pickAppUserAccountStatusDisplay(user) {
  if (!user || typeof user !== "object") return null;
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  const candidates = [
    user.status,
    raw.status,
    user.account_status,
    raw.account_status,
    user.user_status,
    raw.user_status,
    user.profile_status,
    raw.profile_status,
    user.lifecycleState,
    raw.lifecycleState,
    user.lifecycle,
    raw.lifecycle,
    user.state,
    raw.state,
    user.isActive,
    raw.isActive,
    user.active,
    raw.active,
    user.enabled,
    raw.enabled,
  ];
  for (const v of candidates) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") return v ? "ACTIVE" : "INACTIVE";
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * @param {object} user
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 * @param {string} applicationLabel
 */
export function mapAppUserToInactiveAccessHygieneItem(user, applicationId, applicationLabel) {
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  const tokens = extractEntitlementTokensFromAppUser(user, raw);
  const status =
    pickAppUserAccountStatusDisplay(user) ||
    user.status ||
    raw.status ||
    user.user_status ||
    raw.user_status ||
    "INACTIVE";

  return {
    kind: "inactiveAccess",
    userId: user._id?.toString?.() ?? "",
    accountId: user.user_id || user.username || user._id?.toString?.() || "",
    accountName:
      user.username ||
      user.display_name ||
      user.user_id ||
      user.email ||
      "",
    displayName:
      user.display_name ||
      user.username ||
      user.user_id ||
      user.email ||
      "",
    email: user.email || raw.email || raw.Email || "",
    lifecycleState: String(status),
    status: String(status),
    entitlementCount: tokens.length,
    entitlementsPreview: tokens.slice(0, 8).join("; "),
    applicationId: String(applicationId),
    applicationLabel: applicationLabel || "Application",
  };
}
