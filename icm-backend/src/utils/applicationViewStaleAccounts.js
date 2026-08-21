import { isOlderThanDays, filetimeToDate } from "../services/posture/utils/adSecurityHelpers.js";

const STALE_ACCOUNT_DAYS = 90;

const ACTIVITY_KEYS = [
  "lastLogin",
  "lastLoginAt",
  "lastLogonTimestamp",
  "last_logon",
  "last_login",
  "lastActive",
  "last_active",
  "lastSignIn",
  "last_sign_in",
  "lastSuccessfulLogin",
  "LastLogon",
  "LastLogonTimestamp",
];

/**
 * Best-effort parse of activity / login timestamps from dynamic app user rows.
 * @param {unknown} value
 * @returns {Date|null}
 */
export function parseActivityDate(value) {
  if (value == null || value === "" || value === 0 || value === "0") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // ISO / locale date string
    if (/[T\-/:]/.test(trimmed) || /[a-zA-Z]/.test(trimmed)) {
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  // AD FILETIME (large integer) or unix ms/seconds
  const asNum = Number(value);
  if (Number.isFinite(asNum)) {
    if (asNum > 1e14) {
      return filetimeToDate(value);
    }
    if (asNum > 1e12) {
      const d = new Date(asNum);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (asNum > 1e9) {
      const d = new Date(asNum * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return filetimeToDate(value);
}

function pickActivityRaw(user) {
  if (!user || typeof user !== "object") return null;
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  for (const key of ACTIVITY_KEYS) {
    if (user[key] != null && user[key] !== "") return user[key];
    if (raw[key] != null && raw[key] !== "") return raw[key];
  }
  // Fuzzy scan rawData keys
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (
      lk.includes("lastlogon") ||
      lk.includes("lastlogin") ||
      lk.includes("lastsignin") ||
      lk.includes("lastactive")
    ) {
      if (raw[key] != null && String(raw[key]).trim() !== "") return raw[key];
    }
  }
  return null;
}

/**
 * Account has not been actively used for >= days (default 90).
 * Never-logged-in accounts older than the threshold also count as stale.
 * @param {object} user
 * @param {number} [days]
 */
export function isStaleApplicationUser(user, days = STALE_ACCOUNT_DAYS) {
  const activityRaw = pickActivityRaw(user);
  const activity = parseActivityDate(activityRaw);

  if (activity) {
    return Date.now() - activity.getTime() >= days * 86400000;
  }

  // Never logged in / missing activity — stale if account age >= threshold
  const createdCandidates = [
    user?.createdAt,
    user?.created_at,
    user?.join_date,
    user?.joinDate,
    user?.rawData?.createdAt,
    user?.rawData?.join_date,
  ];
  for (const c of createdCandidates) {
    const d = parseActivityDate(c) || (c instanceof Date ? c : null);
    const parsed = d || (typeof c === "string" || typeof c === "number" ? new Date(c) : null);
    if (parsed && !Number.isNaN(parsed.getTime())) {
      return Date.now() - parsed.getTime() >= days * 86400000;
    }
  }

  // Fallback: mongoose timestamps / updatedAt only when clearly old and no activity field exists
  if (user?.createdAt instanceof Date) {
    return isOlderThanDays(user.createdAt, days);
  }
  return false;
}

/**
 * Count stale accounts for an application user collection.
 * Caps scan for safety on very large apps.
 * @param {import("mongoose").Model} UsersModel
 * @param {import("mongoose").Types.ObjectId} applicationId
 * @param {{ days?: number, scanCap?: number }} [opts]
 */
export async function countStaleApplicationUsers(UsersModel, applicationId, opts = {}) {
  const days = opts.days ?? STALE_ACCOUNT_DAYS;
  const scanCap = opts.scanCap ?? 50000;
  let stale = 0;
  let scanned = 0;
  const cursor = UsersModel.find({ applicationId })
    .select(
      "lastLogin lastLoginAt lastLogonTimestamp last_logon last_login lastActive last_active lastSignIn createdAt created_at join_date updatedAt rawData",
    )
    .lean()
    .cursor({ batchSize: 500 });

  for await (const user of cursor) {
    scanned += 1;
    if (isStaleApplicationUser(user, days)) stale += 1;
    if (scanned >= scanCap) break;
  }
  return { staleAccounts: stale, scanned, staleDays: days };
}

export { STALE_ACCOUNT_DAYS };
