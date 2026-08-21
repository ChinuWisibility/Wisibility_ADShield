import mongoose from 'mongoose';
import {
  getAppUsersCollectionName,
  resolveTenantSlugFromTenantId,
  slugIgaSegment,
} from '../../utils/applicationDynamicCollections.js';

/**
 * Known columns + rawData. strict: false — persist any Application schema field (e.g. sap_roles) like Entitlements.
 */
const usersSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    /** Denormalized from Application for queries / audits. */
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    user_id: { type: String },
    employee_id: { type: String },
    username: { type: String },
    email: { type: String },
    display_name: { type: String },
    status: { type: String },
    user_type: { type: String },
    manager_id: { type: String },
    department: { type: String },
    title: { type: String },
    location: { type: String },
    member_of_entitlements: { type: String },
    telephone: { type: String },
    join_date: { type: String },
    end_date: { type: String },
    created_at: { type: String },
    updated_at: { type: String },
    rawData: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, strict: false },
);

usersSchema.index(
  { applicationId: 1, correlatedManagerIdentityId: 1 },
  { background: true, sparse: true },
);
usersSchema.index({ tenantId: 1, applicationId: 1 }, { background: true, sparse: true });

/**
 * @param {string} appName
 * @param {string} tenantSlug Resolved tenant slug from `resolveTenantSlugFromTenantId` / `resolveTenantSlugSync`.
 * @throws {Error} when tenantSlug is missing — prevents creating misnamed `app_iga_unknown_*` collections.
 */
export const getDynamicUserModel = (appName, tenantSlug) => {
  const appSeg = slugIgaSegment(appName) || 'app';
  const ts = typeof tenantSlug === 'string' && tenantSlug.trim() ? slugIgaSegment(tenantSlug) : '';
  // Delegates slug-missing error to getAppUsersCollectionName (throws with a clear message).
  const collectionName = getAppUsersCollectionName(appName, ts || null);
  const modelName = `App_iga_${ts}_${appSeg}_Users`;

  if (mongoose.models[modelName]) {
    return mongoose.model(modelName);
  }

  return mongoose.model(modelName, usersSchema, collectionName);
};

/**
 * Loads Tenant to build `app_iga_<tenantSlug>_<app>_users` collection name.
 * @param {string} appName
 * @param {unknown} tenantId Application.tenantId
 */
export async function getDynamicUserModelForTenantId(appName, tenantId) {
  const slug = await resolveTenantSlugFromTenantId(tenantId);
  return getDynamicUserModel(appName, slug);
}
