import mongoose from 'mongoose';
import {
  getAppEntitlementsCollectionName,
  resolveTenantSlugFromTenantId,
  slugIgaSegment,
} from '../../utils/applicationDynamicCollections.js';

/**
 * Known columns (legacy / docs). Entitlement schema is tenant-defined; CSV import maps arbitrary technical names.
 * strict: false — persist any field from entitlementMappings (e.g. entitlement_type, application) instead of stripping it.
 */
const entitlementsSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    entitlement_id: { type: String },
    entitlement_name: { type: String },
    entitlement_description: { type: String },
    entitlement_type: { type: String },
    /** Target system / app code from import (not the same as applicationId ObjectId). */
    application: { type: String },
    is_privilege: { type: String },
    granted_via: { type: String },
    source: { type: String },
    granted_at: { type: String },
    valid_from: { type: String },
    valid_to: { type: String },
    is_active: { type: String },
    tags: { type: String },
    created_at: { type: String },
    updated_at: { type: String },
    owner: { type: String },
    rawData: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, strict: false },
);

/**
 * @param {string} appName
 * @param {string} tenantSlug Resolved tenant slug from `resolveTenantSlugFromTenantId` / `resolveTenantSlugSync`.
 * @throws {Error} when tenantSlug is missing — prevents creating misnamed `app_iga_unknown_*` collections.
 */
export const getDynamicEntitlementModel = (appName, tenantSlug) => {
  const appSeg = slugIgaSegment(appName) || 'app';
  const ts = typeof tenantSlug === 'string' && tenantSlug.trim() ? slugIgaSegment(tenantSlug) : '';
  // Delegates slug-missing error to getAppEntitlementsCollectionName (throws with a clear message).
  const collectionName = getAppEntitlementsCollectionName(appName, ts || null);
  const modelName = `App_iga_${ts}_${appSeg}_Entitlements`;

  if (mongoose.models[modelName]) {
    return mongoose.model(modelName);
  }
  return mongoose.model(modelName, entitlementsSchema, collectionName);
};

/**
 * @param {string} appName
 * @param {unknown} tenantId
 */
export async function getDynamicEntitlementModelForTenantId(appName, tenantId) {
  const slug = await resolveTenantSlugFromTenantId(tenantId);
  return getDynamicEntitlementModel(appName, slug);
}
