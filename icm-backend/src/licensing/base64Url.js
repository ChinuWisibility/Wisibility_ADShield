/**
 * Base64URL helpers matching LMS Crypto::base64UrlEncode / base64UrlDecode.
 * Alphabet: A-Za-z0-9-_  (no padding).
 */
export function base64UrlEncode(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * @param {string} data
 * @returns {Buffer}
 */
export function base64UrlDecode(data) {
  if (typeof data !== "string" || !data) {
    throw new Error("Invalid Base64URL encoding");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(data)) {
    throw new Error("Invalid Base64URL encoding");
  }
  let normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  if (remainder) {
    normalized += "=".repeat(4 - remainder);
  }
  const decoded = Buffer.from(normalized, "base64");
  // Node Buffer.from is lenient; reject empty for non-empty input
  if (decoded.length === 0 && data.length > 0) {
    throw new Error("Invalid Base64URL encoding");
  }
  return decoded;
}

export function isBase64Url(value) {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}
