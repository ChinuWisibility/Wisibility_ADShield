export function normalizeLoginIdentifier(raw) {
  return String(raw || "").trim().toLowerCase();
}

/**
 * Resolve either an email or a generated username to the same User lookup.
 * Emails (contain "@") keep the historical email-only query so existing
 * accounts without a username continue to log in unchanged.
 */
export function buildActiveUserLoginQuery(identifier) {
  const value = normalizeLoginIdentifier(identifier);
  if (!value) return null;
  if (value.includes("@")) {
    return { email: value, isActive: true };
  }
  return { username: value, isActive: true };
}
