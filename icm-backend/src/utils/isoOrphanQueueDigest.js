/**
 * Compact OPEN-queue ↔ population matching for ISO governance charts (no full orphan rows to the browser).
 * Mirrors icm-frontend Iso2007Report orphan matching semantics.
 */
import { resolveUserName } from "./access-certification/certificationUserDisplay.js";

function displayNameKey(user) {
  const raw = user?.rawData || user?._originalData || {};
  return String(resolveUserName(user, raw)).trim().toLowerCase();
}

export function buildOrphanMatchedUserLookup(users) {
  const byAccountId = new Map();
  const byNorm = new Map();
  if (!Array.isArray(users)) return { byAccountId, byNorm };
  for (const u of users) {
    const id = u?._id != null ? String(u._id) : "";
    if (id) byAccountId.set(id, u);
    const raw = u?.rawData || u?._originalData || {};
    const fields = [
      u?.email,
      raw.email,
      u?.nativeIdentity,
      u?.username,
      u?.user_id,
      raw.sAMAccountName,
      raw.username,
      raw.mail,
      raw.userPrincipalName,
    ];
    for (const f of fields) {
      if (f == null) continue;
      const k = String(f).trim().toLowerCase();
      if (k && !byNorm.has(k)) byNorm.set(k, u);
    }
    const disp = displayNameKey(u);
    if (disp && !byNorm.has(disp)) byNorm.set(disp, u);
  }
  return { byAccountId, byNorm };
}

export function matchedUserForOrphanRow(row, lookup) {
  if (!lookup || !row) return undefined;
  const aid = String(row.accountId || "").trim();
  if (aid && lookup.byAccountId.has(aid)) return lookup.byAccountId.get(aid);
  const ck =
    typeof row.correlationKey === "string" && row.correlationKey.startsWith("v:")
      ? row.correlationKey.slice(2).trim().toLowerCase()
      : "";
  if (ck && lookup.byNorm.has(ck)) return lookup.byNorm.get(ck);
  return undefined;
}
