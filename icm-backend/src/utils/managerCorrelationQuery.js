/**
 * MongoDB aggregation helpers + short-lived facet cache for manager-correlation APIs
 * (paginated groups / counts — same role as entitlement correlation_stats + paginated lookups).
 */

/** @type {number} */
export const MANAGER_CORR_FACET_CACHE_MS = Number(process.env.MANAGER_CORR_FACET_CACHE_MS ?? 30000);

const FACET_CACHE_MS = MANAGER_CORR_FACET_CACHE_MS;

/** @type {Map<string, { exp: number, data: object }>} */
const facetCache = new Map();

export function escapeRegexForMongo(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Invalidate cached facet payloads for one application (call after manager correlation run completes).
 * @param {unknown} applicationId
 */
/**
 * @param {unknown} applicationId
 * @param {string} managerAttr
 * @param {string} [tenantIdStr]
 */
export function managerFacetCacheKey(applicationId, managerAttr, tenantIdStr = "") {
  return `${String(applicationId)}:${String(managerAttr)}:${tenantIdStr || ""}`;
}

export function invalidateManagerCorrelationFacetCache(applicationId) {
  const prefix = `${String(applicationId)}:`;
  for (const k of facetCache.keys()) {
    if (k.startsWith(prefix)) facetCache.delete(k);
  }
}

/**
 * @param {string} applicationIdKey
 * @param {string} managerAttr
 * @param {string} tenantKey
 */
function facetCacheKey(applicationIdKey, managerAttr, tenantKey) {
  return `${applicationIdKey}:${managerAttr}:${tenantKey}`;
}

/**
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withManagerFacetCache(key, fn) {
  const hit = facetCache.get(key);
  if (hit && Date.now() < hit.exp) return /** @type {T} */ (hit.data);
  const data = await fn();
  facetCache.set(key, { data, exp: Date.now() + FACET_CACHE_MS });
  return data;
}

/**
 * CSV / mapping alternate keys for a user standardField (same idea as entitlement correlation).
 * @param {{ userMappings?: { standardField?: string, csvColumn?: string }[] }} application
 * @param {string} standardField
 * @returns {string[]}
 */
export function alternateKeysForUserField(application, standardField) {
  const uf = String(standardField || "").trim();
  return (application?.userMappings || [])
    .filter((m) => String(m.standardField || "").trim() === uf)
    .map((m) => String(m.csvColumn || "").trim())
    .filter((c) => c && c !== uf);
}

/**
 * Coalesce application user manager attribute from top-level and rawData (all mapping keys).
 * @param {string} managerAppAttr
 * @param {string[]} alternateKeys
 */
export function buildManagerCoalesceExpr(managerAppAttr, alternateKeys = []) {
  const keys = [
    ...new Set(
      [managerAppAttr, ...alternateKeys].map((s) => String(s || "").trim()).filter(Boolean),
    ),
  ];
  const refs = [];
  for (const k of keys) {
    refs.push(`$${k}`);
    refs.push(`$rawData.${k}`);
  }
  let expr = null;
  for (let i = refs.length - 1; i >= 0; i--) {
    const r = refs[i];
    expr = expr === null ? r : { $ifNull: [r, expr] };
  }
  return { keys, coalesceExpr: expr };
}

/**
 * $project to only the fields used by `stagesEffectiveManagerFields` (coalesce) plus correlated id.
 * Strips unmapped app user fields and most of `rawData`, which cuts CPU/memory for large user blobs
 * (common when 2k+ accounts carry full source payloads).
 * Do not use for list endpoints that return full user rows to the client.
 * @param {string} managerAppAttr
 * @param {string[]} alternateKeys
 */
export function projectStageNarrowForManagerCoalesce(managerAppAttr, alternateKeys = []) {
  const { keys } = buildManagerCoalesceExpr(managerAppAttr, alternateKeys);
  /** @type {Record<string, 0 | 1>} */
  const p = { correlatedManagerIdentityId: 1 };
  for (const k of keys) {
    p[k] = 1;
    p[`rawData.${k}`] = 1;
  }
  return { $project: p };
}

/**
 * @param {string} managerAppAttr
 * @param {string[]} alternateKeys
 * @returns {object[]}
 */
export function stagesEffectiveManagerFields(managerAppAttr, alternateKeys = []) {
  const { coalesceExpr } = buildManagerCoalesceExpr(managerAppAttr, alternateKeys);
  if (!coalesceExpr) {
    return [
      {
        $addFields: {
          __mgrRaw: null,
          __mgrNorm: null,
        },
      },
    ];
  }

  return [
    {
      $addFields: {
        __mgrRaw: {
          $let: {
            vars: { v: coalesceExpr },
            in: {
              $cond: [
                { $or: [{ $eq: ["$$v", null] }, { $eq: ["$$v", ""] }] },
                null,
                { $trim: { input: { $toString: "$$v" } } },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        __mgrNorm: {
          $cond: [
            {
              $or: [
                { $eq: ["$__mgrRaw", null] },
                { $eq: [{ $strLenCP: { $ifNull: ["$__mgrRaw", ""] } }, 0] },
              ],
            },
            null,
            { $toLower: "$__mgrRaw" },
          ],
        },
      },
    },
  ];
}

/**
 * @param {import('mongoose').Types.ObjectId} applicationIdObj
 * @param {string} applicationIdStr
 */
export function matchApplicationUsersStage(applicationIdObj, applicationIdStr) {
  return {
    $match: {
      $or: [{ applicationId: applicationIdObj }, { applicationId: applicationIdStr }],
    },
  };
}
