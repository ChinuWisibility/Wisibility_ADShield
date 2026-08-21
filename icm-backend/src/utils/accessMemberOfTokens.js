/**
 * Shared tokenizer / label normalizer for member-of / entitlement strings.
 *
 * Handles multiple delimiter styles produced by different connectors:
 *   "|"  – pipe-delimited app roles (ServiceNow, etc.)
 *   ";"  – AD LDAP serialization (adLdapService joins with "; ")
 *   ","  – plain comma-separated names (but NOT commas inside LDAP DNs)
 */

const DN_INTERIOR_RE = /[,;]\s*(?:CN|OU|DC|O|L|ST|C)=/i;

function looksLikeDN(segment) {
  return /^CN=/i.test(segment) || DN_INTERIOR_RE.test(segment);
}

/**
 * Tokenize a raw member-of / entitlement value (string or array) into
 * individual access tokens.  Supports "|", ";", and "," as delimiters while
 * preserving commas that are part of LDAP distinguished names.
 */
export function tokenizeMemberOfRaw(raw) {
  if (!raw) return [];

  const segments = [];
  if (Array.isArray(raw)) {
    segments.push(...raw.map((item) => String(item || "").trim()).filter(Boolean));
  } else if (typeof raw === "string") {
    segments.push(raw);
  } else if (typeof raw === "object") {
    Object.values(raw).forEach((v) => {
      if (Array.isArray(v)) segments.push(...v.map((i) => String(i || "").trim()));
      else if (typeof v === "string") segments.push(v);
    });
  }

  const tokens = [];

  for (const seg of segments) {
    if (!seg) continue;

    const pipeParts = seg.split("|").map((p) => p.trim()).filter(Boolean);

    for (const pipePart of pipeParts) {
      const semiParts = pipePart.split(";").map((s) => s.trim()).filter(Boolean);

      for (const semiPart of semiParts) {
        if (looksLikeDN(semiPart)) {
          tokens.push(semiPart);
        } else {
          const commaParts = semiPart.split(",").map((c) => c.trim()).filter(Boolean);
          tokens.push(...commaParts);
        }
      }
    }
  }

  return tokens;
}

/**
 * Convert a single access token into a clean display label.
 * Strips LDAP DN prefixes (CN=, OU=, DC=, …) and returns the human-readable
 * portion.  If the token isn't a DN it's returned as-is (trimmed).
 */
export function normalizeAccessDisplayLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const dnMatch = text.match(/^CN=([^,;]+)/i);
  return (dnMatch ? dnMatch[1] : text).trim();
}

/**
 * Convenience: tokenize + normalize + case-insensitive dedupe in one call.
 * Returns an array of unique display labels preserving the first-seen casing.
 */
export function tokenizeAndNormalize(raw) {
  const seen = new Map();
  for (const token of tokenizeMemberOfRaw(raw)) {
    const label = normalizeAccessDisplayLabel(token);
    if (!label) continue;
    const key = label.toLowerCase();
    if (!seen.has(key)) seen.set(key, label);
  }
  return Array.from(seen.values());
}
