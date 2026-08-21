import mongoose from "mongoose";
import Tenant from "../models/platform/Tenant.js";

/** In-memory cache: tenant ObjectId string → slug (avoids repeated Tenant lookups in tight loops). */
const tenantSlugByIdCache = new Map();

/**
 * Lowercase slug with single underscores (same style as `app_iga_*_*` collections).
 * @param {string} s
 */
export function slugIgaSegment(s) {
  const t = String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return t || "";
}

/**
 * Legacy app-only segment (no separators): "Active Directory" → "activedirectory".
 * @param {string} appName
 */
export function sanitizeAppNameSlug(appName) {
  return String(appName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Stable 24-char hex for Mongo ObjectId (document `tenantId` FK, not collection names).
 * @param {unknown} tenantId
 * @returns {string|null}
 */
export function tenantIdSegment(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  try {
    if (tenantId instanceof mongoose.Types.ObjectId) {
      return tenantId.toString();
    }
    if (typeof tenantId === "object" && tenantId._id != null) {
      return tenantIdSegment(tenantId._id);
    }
    const s = String(tenantId);
    if (mongoose.Types.ObjectId.isValid(s)) {
      return new mongoose.Types.ObjectId(s).toString();
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {unknown} tenantId
 * @returns {mongoose.Types.ObjectId|null}
 */
export function toTenantObjectId(tenantId) {
  const seg = tenantIdSegment(tenantId);
  if (!seg) return null;
  try {
    return new mongoose.Types.ObjectId(seg);
  } catch {
    return null;
  }
}

/**
 * Tenant display slug for `app_iga_<tenantSlug>_<appSlug>_users` from Tenant.name (fallback code).
 * Returns null when the tenantId is missing/invalid or the Tenant document does not exist.
 * @param {unknown} tenantId
 * @returns {Promise<string|null>}
 */
export async function resolveTenantSlugFromTenantId(tenantId, options = {}) {
  const oid = toTenantObjectId(tenantId);
  if (!oid) return null;
  const key = String(oid);
  if (tenantSlugByIdCache.has(key)) {
    options.exclusiveTimer?.record?.("resolveTenantSlug.cacheHit", 0);
    return tenantSlugByIdCache.get(key);
  }
  const run = async (name, fn) =>
    options.exclusiveTimer ? options.exclusiveTimer.span(name, fn) : fn();
  const t = await run("resolveTenantSlug.Tenant.findById", () =>
    Tenant.findById(oid).select("name code").lean(),
  );
  if (!t) return null;
  // Prefer name; fall back to code (both are required fields on Tenant).
  const slug = slugIgaSegment(t.name) || slugIgaSegment(t.code) || null;
  if (slug) tenantSlugByIdCache.set(key, slug);
  return slug;
}

/**
 * Sync: slug from populated `tenantId` on Application, or a Tenant-like `{ name, code }`.
 * @param {unknown} tenantRef
 * @returns {string|null}
 */
export function resolveTenantSlugSync(tenantRef) {
  if (tenantRef == null) return null;
  if (typeof tenantRef === "string") {
    const s = tenantRef.trim();
    if (!s) return null;
    if (s.length === 24 && mongoose.Types.ObjectId.isValid(s)) return null;
    return slugIgaSegment(s) || null;
  }
  if (typeof tenantRef === "object") {
    if (tenantRef.name != null && (tenantRef.code !== undefined || tenantRef.subscriptionTier !== undefined)) {
      return slugIgaSegment(tenantRef.name || tenantRef.code) || null;
    }
    const tid = tenantRef.tenantId;
    if (tid && typeof tid === "object" && !(tid instanceof mongoose.Types.ObjectId)) {
      if (tid.name || tid.code) return slugIgaSegment(tid.name || tid.code) || null;
    }
  }
  return null;
}

/**
 * @param {string} appName Application display name
 * @param {string|null|undefined} tenantSlug From `resolveTenantSlugFromTenantId` / `resolveTenantSlugSync`
 * @throws {Error} when tenantSlug cannot be resolved (prevents silent writes to misnamed collections)
 */
export function getAppUsersCollectionName(appName, tenantSlug) {
  const appSeg = slugIgaSegment(appName) || "app";
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      `Cannot build users collection name for application "${appName}": tenant slug is missing. ` +
      `Ensure the Application has a valid tenantId and the Tenant document exists with a name or code.`
    );
  }
  return `app_iga_${tenantSeg}_${appSeg}_users`;
}

/**
 * @param {string} appName
 * @param {string|null|undefined} tenantSlug
 * @throws {Error} when tenantSlug cannot be resolved
 */
export function getAppEntitlementsCollectionName(appName, tenantSlug) {
  const appSeg = slugIgaSegment(appName) || "app";
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      `Cannot build entitlements collection name for application "${appName}": tenant slug is missing. ` +
      `Ensure the Application has a valid tenantId and the Tenant document exists with a name or code.`
    );
  }
  return `app_iga_${tenantSeg}_${appSeg}_entitlements`;
}

/**
 * Precomputed identity × application × entitlement projection (Phase 1 read cube).
 * Example: tenant "AP-18" → `app_iga_ap_18_identity_entitlements`
 * @param {string|null|undefined} tenantSlug
 * @throws {Error} when tenantSlug cannot be resolved
 */
export function getAppIdentityEntitlementsCollectionName(tenantSlug) {
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      "Cannot build identity_entitlements collection name: tenant slug is missing. " +
      "Ensure the tenant exists and has a valid name or code.",
    );
  }
  return `app_iga_${tenantSeg}_identity_entitlements`;
}

/**
 * Tenant-scoped identity profile pictures (Identity Posture avatar uploads).
 * Example: tenant "AP-18" → `app_iga_ap_18_identityprofilepicture`
 * @param {string|null|undefined} tenantSlug
 * @throws {Error} when tenantSlug cannot be resolved
 */
export function getTenantIdentityProfilePhotoCollectionName(tenantSlug) {
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      "Cannot build identity profile photo collection name: tenant slug is missing. " +
      "Ensure the tenant exists and has a valid name or code.",
    );
  }
  return `app_iga_${tenantSeg}_identityprofilepicture`;
}

/**
 * Account ↔ entitlement correlation links (`executeCorrelation` / Run Engine).
 * Example: application "add" → `app_add_correlation`
 * @param {string} appName Application display name
 */
export function getAppCorrelationCollectionName(appName) {
  const slug = String(appName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
  if (!slug) {
    throw new Error(`Cannot build correlation collection name for application "${appName}".`);
  }
  return `app_${slug}_correlation`;
}

/**
 * CSV import / strict ingest: one document per app with target field → source CSV header names.
 * Mirrors {@link getAppUsersCollectionName} but uses suffix `_schema`.
 * @param {string} appName
 * @param {string|null|undefined} tenantSlug
 * @throws {Error} when tenantSlug cannot be resolved
 */
export function getAppSchemaCollectionName(appName, tenantSlug) {
  const appSeg = slugIgaSegment(appName) || "app";
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      `Cannot build schema collection name for application "${appName}": tenant slug is missing. ` +
      `Ensure the Application has a valid tenantId and the Tenant document exists with a name or code.`
    );
  }
  return `app_iga_${tenantSeg}_${appSeg}_schema`;
}

/**
 * Tenant-scoped identities collection.
 * Example: `app_test_tenant_identities`
 * @param {string|null|undefined} tenantSlug
 * @throws {Error} when tenantSlug cannot be resolved
 */
export function getTenantIdentityCollectionName(tenantSlug) {
  const tenantSeg = typeof tenantSlug === "string" ? slugIgaSegment(tenantSlug) : "";
  if (!tenantSeg) {
    throw new Error(
      "Cannot build identities collection name: tenant slug is missing. " +
      "Ensure the tenant exists and has a valid name or code.",
    );
  }
  return `app_${tenantSeg}_identities`;
}

export {
  getReconciliationRunsCollectionName,
  getAccountsSnapshotCollectionName,
  getDeltaChangesCollectionName,
  getEntitlementDeltaCollectionName,
  getStagingAccountsCollectionName,
  getReconciliationModels,
  ensureReconciliationIndexes,
  dropReconciliationCollections,
} from "./reconciliationCollections.js";
