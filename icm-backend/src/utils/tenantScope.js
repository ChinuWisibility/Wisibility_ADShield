import mongoose from "mongoose";

/**
 * Normalize tenant/org ids to a stable string for queue + scheduler scoping.
 * Rejects null, undefined, empty, and literal "null"/"undefined" strings.
 */
export function normalizeTenantId(value) {
  if (value == null) return null;
  const tid = String(value).trim();
  if (!tid || tid === "null" || tid === "undefined") return null;
  return tid;
}

/**
 * Mongo filter for tenant-scoped documents.
 * Matches string tenantId and legacy ObjectId-stored tenantId values.
 */
export function tenantMatchFilter(tenantId, field = "tenantId") {
  const tid = normalizeTenantId(tenantId);
  if (!tid) return {};
  if (!mongoose.Types.ObjectId.isValid(tid)) {
    return { [field]: tid };
  }
  const oid = new mongoose.Types.ObjectId(tid);
  return {
    $or: [{ [field]: tid }, { [field]: oid }],
  };
}

export function isValidTenantId(value) {
  return normalizeTenantId(value) != null;
}
