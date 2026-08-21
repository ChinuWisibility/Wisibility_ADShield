/**
 * Pure classification for exact-rule identity id lists (and slow-rule candidate counts).
 * Used by correlation engine only — lifecycle must not influence this.
 *
 * @param {unknown[]} ids - identity ObjectIds from lookup (may be empty / multiple)
 * @returns {{ outcome: 'UNMATCHED' } | { outcome: 'MATCHED', identityId: unknown } | { outcome: 'AMBIGUOUS' }}
 */
export function classifyIdentityIdMatches(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (list.length === 0) return { outcome: "UNMATCHED" };
  if (list.length === 1) return { outcome: "MATCHED", identityId: list[0] };
  return { outcome: "AMBIGUOUS" };
}
