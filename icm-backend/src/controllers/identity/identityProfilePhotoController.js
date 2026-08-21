import {
  deleteIdentityProfilePhoto,
  getIdentityProfilePhotoImage,
  uploadIdentityProfilePhoto,
} from '../../services/identity/identityProfilePhotoService.js';

export async function uploadProfilePhoto(req, res, next) {
  try {
    const data = await uploadIdentityProfilePhoto(
      req.params.id,
      req.file,
      req.scopedTenantId,
    );
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getProfilePhotoImage(req, res, next) {
  try {
    const photo = await getIdentityProfilePhotoImage(req.params.id, req.scopedTenantId);
    res.set('Content-Type', photo.mimeType);
    res.set('Cache-Control', 'private, no-cache, must-revalidate');
    res.send(photo.data);
  } catch (err) {
    next(err);
  }
}

export async function removeProfilePhoto(req, res, next) {
  try {
    const data = await deleteIdentityProfilePhoto(req.params.id, req.scopedTenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
