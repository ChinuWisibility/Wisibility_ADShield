import crypto from 'crypto';
import mongoose from 'mongoose';
import {
  getDynamicIdentityProfilePhotoModelForTenantId,
  getLegacyIdentityProfilePhotoModel,
} from '../../models/identity/IdentityProfilePhoto.js';
import {
  getDynamicIdentityModelForTenantId,
  getLegacyIdentityModel,
} from '../../models/identity/Identity.js';
import { AppError } from '../../middleware/errorHandler.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

async function loadIdentity(identityId, scopedTenantId) {
  if (!mongoose.Types.ObjectId.isValid(String(identityId))) {
    throw new AppError('Invalid identity ID', 400, 'INVALID_IDENTITY_ID');
  }

  let tenantId =
    scopedTenantId && mongoose.Types.ObjectId.isValid(String(scopedTenantId))
      ? scopedTenantId
      : null;

  if (!tenantId) {
    const LegacyIdentity = getLegacyIdentityModel();
    const stub = await LegacyIdentity.findById(identityId).select('tenantId').lean();
    tenantId = stub?.tenantId || null;
  }

  if (!tenantId) {
    throw new AppError('Identity not found', 404, 'IDENTITY_NOT_FOUND');
  }

  const IdentityModel = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await IdentityModel.findById(identityId).lean();
  if (!identity) {
    throw new AppError('Identity not found', 404, 'IDENTITY_NOT_FOUND');
  }

  if (
    scopedTenantId
    && mongoose.Types.ObjectId.isValid(String(scopedTenantId))
    && identity.tenantId
    && String(identity.tenantId) !== String(scopedTenantId)
  ) {
    throw new AppError('Identity not found', 404, 'IDENTITY_NOT_FOUND');
  }

  return { identity, tenantId, IdentityModel };
}

function toImageBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  if (value?.buffer instanceof ArrayBuffer) {
    return Buffer.from(value.buffer);
  }
  return null;
}

async function setIdentityProfilePhotoId(identityId, profilePhotoId, IdentityModel) {
  // Keep both shard + legacy in sync so GET /image resolves after refresh
  const LegacyIdentity = getLegacyIdentityModel();
  const [tenantResult] = await Promise.all([
    IdentityModel.findByIdAndUpdate(
      identityId,
      { $set: { profilePhotoId: profilePhotoId || null } },
      { new: true },
    ),
    LegacyIdentity.findByIdAndUpdate(
      identityId,
      { $set: { profilePhotoId: profilePhotoId || null } },
      { new: true },
    ),
  ]);
  return tenantResult;
}

async function deletePhotosForIdentity(identityId, tenantId) {
  const oid = mongoose.Types.ObjectId.isValid(String(identityId))
    ? new mongoose.Types.ObjectId(String(identityId))
    : identityId;
  const PhotoModel = await getDynamicIdentityProfilePhotoModelForTenantId(tenantId);
  await PhotoModel.deleteMany({ identityId: oid });
  const LegacyPhoto = getLegacyIdentityProfilePhotoModel();
  await LegacyPhoto.deleteMany({ identityId: oid });
}

async function deletePhotoById(profilePhotoId, tenantId) {
  if (!profilePhotoId) return;

  const PhotoModel = await getDynamicIdentityProfilePhotoModelForTenantId(tenantId);
  await PhotoModel.findByIdAndDelete(profilePhotoId);

  const LegacyPhoto = getLegacyIdentityProfilePhotoModel();
  await LegacyPhoto.findByIdAndDelete(profilePhotoId);
}

async function findPhotoById(profilePhotoId, tenantId) {
  if (!profilePhotoId) return null;

  const PhotoModel = await getDynamicIdentityProfilePhotoModelForTenantId(tenantId);
  let photo = await PhotoModel.findById(profilePhotoId).select('mimeType data');
  if (photo) return photo;

  const LegacyPhoto = getLegacyIdentityProfilePhotoModel();
  photo = await LegacyPhoto.findById(profilePhotoId).select('mimeType data');
  return photo || null;
}

export async function uploadIdentityProfilePhoto(identityId, file, scopedTenantId) {
  if (!file) throw new AppError('File is required', 400, 'MISSING_FILE');

  const mimeType = String(file.mimetype || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AppError(
      'Only JPEG, PNG, WebP, or GIF images are allowed',
      400,
      'INVALID_FILE_TYPE',
    );
  }

  const buffer = toImageBuffer(file.buffer);
  if (!buffer?.length) {
    throw new AppError('Uploaded file is empty or unreadable', 400, 'EMPTY_FILE');
  }

  const { identity, tenantId, IdentityModel } = await loadIdentity(identityId, scopedTenantId);
  const PhotoModel = await getDynamicIdentityProfilePhotoModelForTenantId(tenantId);

  // Remove any prior photos for this identity (avoids unique-index conflicts / orphan blobs)
  await deletePhotosForIdentity(identity._id, tenantId);
  if (identity.profilePhotoId) {
    await deletePhotoById(identity.profilePhotoId, tenantId);
  }

  const photo = await PhotoModel.create({
    identityId: identity._id,
    tenantId,
    fileName: file.originalname || `${crypto.randomUUID()}.jpg`,
    mimeType,
    data: buffer,
  });

  const updated = await setIdentityProfilePhotoId(identityId, photo._id, IdentityModel);
  if (!updated?.profilePhotoId) {
    // Fall through still — photo exists; retry link once
    await IdentityModel.findByIdAndUpdate(identityId, { $set: { profilePhotoId: photo._id } });
  }

  return {
    id: String(photo._id),
    identityId: String(identityId),
    fileName: photo.fileName,
    mimeType: photo.mimeType,
    profilePhotoUrl: `/api/identities/${identityId}/profile-photo/image`,
    profilePhotoId: String(photo._id),
    uploadedAt: photo.uploadedAt,
  };
}

export async function getIdentityProfilePhotoImage(identityId, scopedTenantId) {
  const { identity, tenantId } = await loadIdentity(identityId, scopedTenantId);
  if (!identity.profilePhotoId) {
    throw new AppError('Profile photo not found', 404, 'PHOTO_NOT_FOUND');
  }

  const photo = await findPhotoById(identity.profilePhotoId, tenantId);
  if (!photo) {
    throw new AppError('Profile photo not found', 404, 'PHOTO_NOT_FOUND');
  }

  const data = toImageBuffer(photo.data);
  if (!data?.length) {
    throw new AppError('Profile photo not found', 404, 'PHOTO_NOT_FOUND');
  }

  return {
    mimeType: photo.mimeType || 'application/octet-stream',
    data,
  };
}

export async function deleteIdentityProfilePhoto(identityId, scopedTenantId) {
  const { identity, tenantId, IdentityModel } = await loadIdentity(identityId, scopedTenantId);
  await deletePhotosForIdentity(identity._id, tenantId);
  if (identity.profilePhotoId) {
    await deletePhotoById(identity.profilePhotoId, tenantId);
  }
  await setIdentityProfilePhotoId(identityId, null, IdentityModel);
  return { deleted: true };
}
