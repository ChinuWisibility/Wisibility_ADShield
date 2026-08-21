/**
 * Mongo match helpers for privileged users / entitlements on dynamic app collections.
 * Aligned with data hygiene / access certification privilege normalization.
 * Discovery "Mark Privileged" writes `is_privileged: "TRUE"` on app users.
 */

const PRIVILEGE_STRING_TOKENS = ["true", "yes", "1", "y", "privileged"];

/**
 * Parse `isPrivileged` query param.
 * @param {unknown} raw
 * @returns {boolean|null} true/false to filter, null for no filter
 */
export function parseIsPrivilegedQuery(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return null;
}

/**
 * $or clause matching docs flagged as privileged (does not include applicationId).
 * @returns {{ $or: object[] }}
 */
export function buildPrivilegeOrClause() {
  const stringExpr = (fieldPath) => ({
    $expr: {
      $in: [
        {
          $toLower: {
            $trim: {
              input: {
                $convert: {
                  input: fieldPath,
                  to: "string",
                  onError: "",
                  onNull: "",
                },
              },
            },
          },
        },
        PRIVILEGE_STRING_TOKENS,
      ],
    },
  });

  return {
    $or: [
      { isPrivileged: true },
      { is_privilege: true },
      { is_privileged: true },
      { privileged: true },
      { classification: { $regex: /^privileged$/i } },
      // String / CSV forms ("TRUE", "yes", "1", …) — Discovery uses is_privileged
      stringExpr("$is_privilege"),
      stringExpr("$is_privileged"),
      stringExpr("$isPrivileged"),
      stringExpr("$privileged"),
      stringExpr("$isPrivilege"),
    ],
  };
}

/**
 * Full privilege match including applicationId (same shape as data hygiene).
 * @param {import("mongoose").Types.ObjectId|string} applicationId
 */
export function matchPrivilegedForApplication(applicationId) {
  return {
    applicationId,
    ...buildPrivilegeOrClause(),
  };
}

/**
 * Optional privilegeLevel exact / case-insensitive match.
 * @param {unknown} raw
 * @returns {object|null}
 */
export function buildPrivilegeLevelClause(raw) {
  const level = typeof raw === "string" ? raw.trim() : "";
  if (!level) return null;
  return {
    privilegeLevel: { $regex: new RegExp(`^${escapeRegex(level)}$`, "i") },
  };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Merge base filter with optional and-parts ($and when multiple).
 * @param {object} base
 * @param {object[]} andParts
 */
export function mergeFilterAnd(base, andParts) {
  const parts = (andParts || []).filter(Boolean);
  if (parts.length === 0) return { ...base };
  if (parts.length === 1) return { ...base, ...parts[0] };
  return { ...base, $and: parts };
}
