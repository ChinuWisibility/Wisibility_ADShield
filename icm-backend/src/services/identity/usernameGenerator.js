const MAX_USERNAME_LEN = 64;

export function normalizeUsernamePart(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "");
}

export function buildUsernameBase({ firstName, lastName, displayName } = {}) {
  let first = normalizeUsernamePart(firstName);
  let last = normalizeUsernamePart(lastName);

  if (!first && displayName) {
    const parts = String(displayName)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    first = normalizeUsernamePart(parts[0] || "");
    if (!last && parts.length > 1) {
      last = normalizeUsernamePart(parts.slice(1).join(" "));
    }
  }

  if (!first && last) {
    return last.slice(0, MAX_USERNAME_LEN);
  }
  if (!first) return "";
  if (!last) return first.slice(0, MAX_USERNAME_LEN);

  const joined = `${first}.${last}`;
  return joined.slice(0, MAX_USERNAME_LEN);
}

/**
 * Collision-safe suffixes: base, base2, base3, ...
 * attemptIndex 0 → base, 1 → base2, 2 → base3.
 */
export function usernameWithCollisionSuffix(base, attemptIndex = 0) {
  const safeBase = String(base || "").trim().toLowerCase();
  if (!safeBase) return "";
  if (!attemptIndex || attemptIndex <= 0) {
    return safeBase.slice(0, MAX_USERNAME_LEN);
  }
  const suffix = String(attemptIndex + 1);
  const maxBase = Math.max(1, MAX_USERNAME_LEN - suffix.length);
  return `${safeBase.slice(0, maxBase)}${suffix}`;
}

export function isMongoDuplicateKey(err, field) {
  if (err?.code !== 11000) return false;
  if (err.keyPattern && Object.prototype.hasOwnProperty.call(err.keyPattern, field)) {
    return true;
  }
  if (err.keyValue && Object.prototype.hasOwnProperty.call(err.keyValue, field)) {
    return true;
  }
  const msg = String(err.message || err.errmsg || "");
  return (
    msg.includes(`index: ${field}`) ||
    msg.includes(`${field}_1`) ||
    msg.includes(`.${field}`)
  );
}
