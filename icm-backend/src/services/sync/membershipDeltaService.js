import { normalizeDn } from "../ldapNormalizer.js";
import { memberGroupDnsForAdUser } from "../../utils/accountEntitlementCorrelation.js";

/**
 * Shared membership normalization — single pass over user docs for downstream consumers.
 * @param {object[]} userDocs
 * @returns {{
 *   byUserKey: Map<string, { userKey: string, memberDns: string[], membershipHash: string }>,
 *   totalMemberships: number,
 * }}
 */
export function buildMembershipDeltaIndex(userDocs) {
  const byUserKey = new Map();
  let totalMemberships = 0;

  for (const user of userDocs || []) {
    const userKey = String(
      user._id ||
        user.user_id ||
        user.rawData?.objectGUID ||
        user.rawData?.objectguid ||
        user.email ||
        "",
    ).trim();
    if (!userKey) continue;

    const memberDns = memberGroupDnsForAdUser(user);
    totalMemberships += memberDns.length;
    byUserKey.set(userKey, {
      userKey,
      memberDns,
      doc: user,
    });
  }

  return { byUserKey, totalMemberships };
}

/**
 * Build desired userId ↔ entitlementId pairs from in-memory user docs + DN index.
 * @param {object[]} userDocs - must include _id when available
 * @param {Map<string, object[]>} byDn normalized DN → entitlement ObjectId[]
 */
export function buildDesiredMembershipPairs(userDocs, byDn) {
  const pairs = [];
  const seen = new Set();

  for (const user of userDocs || []) {
    const userId = user._id;
    if (!userId) continue;

    for (const dn of memberGroupDnsForAdUser(user)) {
      const norm = normalizeDn(dn);
      if (!norm) continue;
      const entIds = byDn.get(norm);
      if (!entIds?.length) continue;
      for (const entId of entIds) {
        const key = `${String(userId)}|${String(entId)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ userId, entitlementId: entId });
      }
    }
  }

  return pairs;
}
