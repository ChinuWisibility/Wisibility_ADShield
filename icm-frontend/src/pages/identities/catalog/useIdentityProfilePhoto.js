import { useCallback, useEffect, useRef, useState } from 'react';
import { identityAPI } from '../../../services/api';

export const PROFILE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Load / upload / delete identity profile photo with stable blob URLs.
 * Skips GET unless the identity already has an uploaded photo (or one was just uploaded here).
 *
 * @param {string} identityId
 * @param {object} [options]
 * @param {boolean} [options.enabled=true]
 * @param {boolean} [options.hasUploadedPhoto=false]
 * @param {() => void} [options.onChanged]
 */
export function useIdentityProfilePhoto(identityId, {
  enabled = true,
  hasUploadedPhoto = false,
  onChanged,
} = {}) {
  const [photoSrc, setPhotoSrc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [cacheKey, setCacheKey] = useState(0);
  const [localHasPhoto, setLocalHasPhoto] = useState(false);
  const [fetchSuppressed, setFetchSuppressed] = useState(false);
  const displayUrlRef = useRef(null);
  const prevHintRef = useRef(Boolean(hasUploadedPhoto));

  // Parent identity refreshed after delete → hint cleared
  useEffect(() => {
    if (prevHintRef.current && !hasUploadedPhoto) {
      setFetchSuppressed(false);
      setLocalHasPhoto(false);
      setCacheKey(0);
    }
    prevHintRef.current = Boolean(hasUploadedPhoto);
  }, [hasUploadedPhoto]);

  const knownUploaded = !fetchSuppressed && (
    Boolean(hasUploadedPhoto) || localHasPhoto || cacheKey > 0
  );
  const shouldLoad = Boolean(identityId && enabled && knownUploaded);

  const replaceDisplayUrl = useCallback((nextUrl) => {
    if (displayUrlRef.current && displayUrlRef.current !== nextUrl) {
      URL.revokeObjectURL(displayUrlRef.current);
    }
    displayUrlRef.current = nextUrl;
    setPhotoSrc(nextUrl);
  }, []);

  const reload = useCallback(() => {
    setCacheKey(Date.now());
  }, []);

  // Reset only when switching identities
  useEffect(() => {
    setError('');
    setLocalHasPhoto(false);
    setFetchSuppressed(false);
    replaceDisplayUrl(null);
    setCacheKey(0);
  }, [identityId, replaceDisplayUrl]);

  useEffect(() => {
    let cancelled = false;
    let fetchedUrl = null;

    async function load() {
      if (!shouldLoad) {
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const res = await identityAPI.getProfilePhotoBlob(
          identityId,
          cacheKey || Date.now(),
        );
        const mime = String(res.headers?.['content-type'] || res.data?.type || '');
        if (mime && !mime.startsWith('image/')) {
          throw Object.assign(new Error('Invalid photo response'), { response: { status: 404 } });
        }
        fetchedUrl = URL.createObjectURL(res.data);
        if (!cancelled) {
          replaceDisplayUrl(fetchedUrl);
          setLocalHasPhoto(true);
          setError('');
        } else {
          URL.revokeObjectURL(fetchedUrl);
        }
      } catch (err) {
        if (!cancelled) {
          if (err?.response?.status === 404) {
            replaceDisplayUrl(null);
            setLocalHasPhoto(false);
          } else {
            setError('Could not load profile photo.');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (fetchedUrl && fetchedUrl !== displayUrlRef.current) {
        URL.revokeObjectURL(fetchedUrl);
      }
    };
  }, [identityId, shouldLoad, cacheKey, replaceDisplayUrl]);

  useEffect(() => () => {
    if (displayUrlRef.current) {
      URL.revokeObjectURL(displayUrlRef.current);
      displayUrlRef.current = null;
    }
  }, []);

  const uploadPhoto = useCallback(async (file) => {
    if (!file || !identityId) return false;

    const type = String(file.type || '').toLowerCase();
    if (!PROFILE_PHOTO_ACCEPT.split(',').includes(type)) {
      setError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return false;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError('Image must be 2 MB or smaller.');
      return false;
    }

    setError('');
    setUploading(true);

    try {
      await identityAPI.uploadProfilePhoto(identityId, file);
      setFetchSuppressed(false);
      setLocalHasPhoto(true);
      reload();
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to upload photo');
      return false;
    } finally {
      setUploading(false);
    }
  }, [identityId, onChanged, reload]);

  const deletePhoto = useCallback(async () => {
    if (!identityId) return false;
    setError('');
    setUploading(true);
    try {
      await identityAPI.deleteProfilePhoto(identityId);
      replaceDisplayUrl(null);
      setLocalHasPhoto(false);
      setCacheKey(0);
      setFetchSuppressed(true);
      onChanged?.();
      return true;
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to remove photo');
      return false;
    } finally {
      setUploading(false);
    }
  }, [identityId, onChanged, replaceDisplayUrl]);

  return {
    photoSrc,
    loading,
    uploading,
    error,
    hasPhoto: Boolean(photoSrc) || (knownUploaded && !fetchSuppressed),
    uploadPhoto,
    deletePhoto,
    reload,
    setError,
  };
}
