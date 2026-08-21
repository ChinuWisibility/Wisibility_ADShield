import mongoose from "mongoose";

/**
 * Normalize a raw id for display/storage (trimmed string).
 */
export function normalizeItemIdKey(raw) {
  return String(raw ?? "").trim();
}

/**
 * Expand an identifier into a set of comparable tokens (exact, lower, CN extract, ObjectId canonical).
 */
export function expandAliasTokens(raw) {
  const t = normalizeItemIdKey(raw);
  const set = new Set();
  if (!t) return set;

  set.add(t);
  set.add(t.toLowerCase());

  const dnMatch = t.match(/^CN=([^,]+)/i);
  if (dnMatch) {
    const cn = dnMatch[1].trim();
    set.add(cn);
    set.add(cn.toLowerCase());
  }

  if (mongoose.Types.ObjectId.isValid(t)) {
    try {
      const oid = new mongoose.Types.ObjectId(t).toString();
      set.add(oid);
      set.add(oid.toLowerCase());
    } catch {
      /* ignore */
    }
  }

  return set;
}

/**
 * True if two ids refer to the same logical key (aliases / case / ObjectId / CN).
 */
export function itemIdsMatch(a, b) {
  const A = expandAliasTokens(a);
  const B = expandAliasTokens(b);
  for (const x of A) {
    if (B.has(x)) return true;
  }
  const lowerB = new Set([...B].map((x) => String(x).toLowerCase()));
  for (const x of A) {
    if (lowerB.has(String(x).toLowerCase())) return true;
  }
  return false;
}

function ensureMap(maybeMap) {
  if (maybeMap instanceof Map) return maybeMap;
  return new Map(Object.entries(maybeMap || {}));
}

/**
 * Pick the canonical key for currentReview mutations: prefer an existing map key or
 * selectedIds entry that matches the raw id, otherwise the trimmed raw id.
 */
export function resolveCanonicalItemKey({ rawId, campaign }) {
  const raw = normalizeItemIdKey(rawId);
  if (!raw) return raw;

  const cr = ensureMap(campaign?.currentReview);
  for (const key of cr.keys()) {
    if (itemIdsMatch(raw, key)) return String(key);
  }

  const selectedIds = Array.isArray(campaign?.selectedIds)
    ? campaign.selectedIds
    : [];
  for (const sid of selectedIds) {
    const ks = normalizeItemIdKey(sid);
    if (!ks) continue;
    if (itemIdsMatch(raw, ks)) return ks;
  }

  return raw;
}

/**
 * If currentReview has an entry under `fromKey`, merge it into `toKey` and delete `fromKey`.
 * Later fields in `from` win for reviewer/decision data.
 */
export function mergeCurrentReviewKeys(map, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  if (!map.has(fromKey)) return;

  const from = map.get(fromKey) || {};
  const to = map.get(toKey) || {};
  map.set(toKey, { ...to, ...from });
  map.delete(fromKey);
}

/**
 * Merge every currentReview entry whose key is an alias of `canonical` into `canonical`,
 * then remove those keys. Use after resolving the canonical key so decisions do not split
 * across duplicate map entries.
 */
export function mergeAllAliasKeysIntoCanonical(map, canonical) {
  const canon = normalizeItemIdKey(canonical);
  if (!canon || !map) return;

  const keysToMerge = [];
  for (const key of map.keys()) {
    const ks = String(key);
    if (ks === canon) continue;
    if (itemIdsMatch(ks, canon)) keysToMerge.push(ks);
  }
  for (const k of keysToMerge) {
    mergeCurrentReviewKeys(map, k, canon);
  }
}

/**
 * User / account identifiers for a scope row only (no entitlement labels).
 * Used to match ReviewItems by subject and to resolve assignment keys before shared group names.
 */
export function collectUserPrimaryIdentifiers(item) {
  if (!item || typeof item !== "object") return [];
  const pool = [
    item.id,
    item.userId,
    item.mongoId,
    item.email,
    item.itemId,
    item._id,
  ];
  if (Array.isArray(item.targetIds)) {
    for (const t of item.targetIds) pool.push(t);
  }
  const seen = new Set();
  const out = [];
  for (const v of pool) {
    const s = normalizeItemIdKey(v);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Collect identifier strings from a campaign scope row for matching against currentReview keys.
 */
export function collectScopeItemAliasCandidates(item) {
  if (!item || typeof item !== "object") return [];
  const pool = [
    item.id,
    item.userId,
    item.mongoId,
    item.email,
    item.itemId,
    item._id,
  ];
  if (Array.isArray(item.targetIds)) {
    for (const t of item.targetIds) pool.push(t);
  }
  if (Array.isArray(item.displayAccess)) {
    for (const t of item.displayAccess) pool.push(t);
  }
  if (Array.isArray(item.displayGroupsLabel)) {
    for (const t of item.displayGroupsLabel) pool.push(t);
  }
  const seen = new Set();
  const out = [];
  for (const v of pool) {
    const s = normalizeItemIdKey(v);
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Find the currentReview entry for a scope row using the same alias rules as apply/resolve
 * (ObjectId variants, email case, CN= DN labels, etc.).
 */
export function findCurrentReviewEntryForScopeItem(crObj, item) {
  if (!crObj || typeof crObj !== "object") return null;
  const candidates = collectScopeItemAliasCandidates(item);
  if (!candidates.length) return null;

  for (const key of Object.keys(crObj)) {
    const entry = crObj[key];
    if (!entry?.decision) continue;
    if (candidates.some((cid) => itemIdsMatch(String(key), cid))) {
      return { entry, matchedKey: key };
    }
  }
  return null;
}
