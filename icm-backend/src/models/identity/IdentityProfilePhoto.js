import mongoose from 'mongoose';
import {
  getTenantIdentityProfilePhotoCollectionName,
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from '../../utils/applicationDynamicCollections.js';

const LEGACY_IDENTITY_PROFILE_PHOTO_MODEL_NAME = 'IdentityProfilePhoto';
const LEGACY_IDENTITY_PROFILE_PHOTO_COLLECTION = 'identity_profile_photos';
const TENANT_IDENTITY_PROFILE_PHOTO_MODEL_PREFIX = 'TenantIdentityProfilePhoto__';

export const identityProfilePhotoSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      index: true,
    },
    fileName: { type: String },
    mimeType: { type: String },
    data: { type: Buffer },
    uploadedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

identityProfilePhotoSchema.index({ identityId: 1 }, { unique: true });

function getLegacyIdentityProfilePhotoModel() {
  return (
    mongoose.models[LEGACY_IDENTITY_PROFILE_PHOTO_MODEL_NAME]
    || mongoose.model(
      LEGACY_IDENTITY_PROFILE_PHOTO_MODEL_NAME,
      identityProfilePhotoSchema,
      LEGACY_IDENTITY_PROFILE_PHOTO_COLLECTION,
    )
  );
}

function getTenantPhotoModelName(collectionName) {
  return `${TENANT_IDENTITY_PROFILE_PHOTO_MODEL_PREFIX}${collectionName}`;
}

function getTenantIdentityProfilePhotoModelByCollectionName(collectionName) {
  const modelName = getTenantPhotoModelName(collectionName);
  return (
    mongoose.models[modelName]
    || mongoose.model(modelName, identityProfilePhotoSchema, collectionName)
  );
}

export function getIdentityProfilePhotoCollectionNameForTenantSlug(tenantSlug) {
  return getTenantIdentityProfilePhotoCollectionName(tenantSlug);
}

export async function getDynamicIdentityProfilePhotoModelForTenantId(tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) {
    throw new Error('Tenant id is required for identity profile photo storage');
  }

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) {
    throw new Error(`Could not resolve tenant slug for tenant ${String(tid)}`);
  }

  const collectionName = getIdentityProfilePhotoCollectionNameForTenantSlug(tenantSlug);
  return getTenantIdentityProfilePhotoModelByCollectionName(collectionName);
}

export { getLegacyIdentityProfilePhotoModel };

export default getLegacyIdentityProfilePhotoModel();
