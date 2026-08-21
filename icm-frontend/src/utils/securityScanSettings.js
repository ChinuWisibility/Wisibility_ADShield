export const DEFAULT_INACTIVE_USERS_DAYS = 90;
export const INACTIVE_USERS_DAYS_MIN = 1;
export const INACTIVE_USERS_DAYS_MAX = 3650;

export function readInactiveUsersDays(application) {
  const raw = application?.securityScanSettings?.inactiveUsersDays;
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_INACTIVE_USERS_DAYS;
  return Math.min(INACTIVE_USERS_DAYS_MAX, Math.max(INACTIVE_USERS_DAYS_MIN, n));
}

export function buildInactiveUsersFeatureSettings(inactiveUsersDays) {
  const n = parseInt(String(inactiveUsersDays ?? ""), 10);
  const days = Number.isFinite(n)
    ? Math.min(INACTIVE_USERS_DAYS_MAX, Math.max(INACTIVE_USERS_DAYS_MIN, n))
    : DEFAULT_INACTIVE_USERS_DAYS;
  return {
    inactive_users: { inactiveDays: days },
  };
}

export function clampInactiveUsersDaysInput(value) {
  const n = parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(INACTIVE_USERS_DAYS_MAX, Math.max(INACTIVE_USERS_DAYS_MIN, n));
}
