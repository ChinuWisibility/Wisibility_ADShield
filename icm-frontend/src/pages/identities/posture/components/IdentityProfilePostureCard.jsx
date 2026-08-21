import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import { identityAPI } from '../../../../services/api';
import { postureCardAnimate, POSTURE_MATURITY_BADGE, POSTURE_COLORS } from './identityPostureTheme';

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function getPostureInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function IdentityProfilePostureCard({
  profile,
  animateIndex = 0,
  onPhotoUpdated,
}) {
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef(null);
  const [photoSrc, setPhotoSrc] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoCacheKey, setPhotoCacheKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const shouldLoadPhoto = Boolean(
    profile?.id && (profile?.profilePhotoUrl || photoCacheKey > 0),
  );

  useEffect(() => {
    setPhotoCacheKey(0);
    setUploadError('');
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, [profile?.id]);

  useEffect(() => {
    let objectUrl;
    let cancelled = false;

    async function loadPhoto() {
      if (!shouldLoadPhoto) {
        setPhotoSrc(null);
        setPhotoLoading(false);
        return;
      }

      setPhotoLoading(true);
      try {
        const res = await identityAPI.getProfilePhotoBlob(
          profile.id,
          photoCacheKey || profile.id,
        );
        objectUrl = URL.createObjectURL(res.data);
        if (!cancelled) {
          if (previewUrlRef.current) {
            URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
          }
          setPhotoSrc(objectUrl);
        }
      } catch (err) {
        if (!cancelled && err?.response?.status !== 404) {
          setUploadError('Could not load profile photo. Try uploading again.');
        }
        if (!cancelled && !previewUrlRef.current) {
          setPhotoSrc(null);
        }
      } finally {
        if (!cancelled) setPhotoLoading(false);
      }
    }

    loadPhoto();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profile?.id, profile?.profilePhotoUrl, photoCacheKey, shouldLoadPhoto]);

  useEffect(() => () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
  }, []);

  const handleAvatarClick = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !profile?.id) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('Image must be 2 MB or smaller.');
      return;
    }

    setUploadError('');
    setUploading(true);

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = URL.createObjectURL(file);
    setPhotoSrc(previewUrlRef.current);

    try {
      await identityAPI.uploadProfilePhoto(profile.id, file);
      setPhotoCacheKey(Date.now());
      onPhotoUpdated?.();
    } catch (err) {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPhotoSrc(null);
      setUploadError(err.response?.data?.message || err.message || 'Failed to upload photo');
    } finally {
      setUploading(false);
    }
  }, [profile?.id, onPhotoUpdated]);

  if (!profile) return null;

  const badge = POSTURE_MATURITY_BADGE[profile.maturityLevel] || POSTURE_MATURITY_BADGE.FAIR;
  const initials = getPostureInitials(profile.displayName);

  return (
    <Paper sx={{ ...postureCardAnimate(animateIndex), p: 3, height: '100%' }}>
      <Box sx={{ display: 'flex', gap: 2, mb: 2.5, alignItems: 'flex-start' }}>
        <Box sx={{ position: 'relative', flexShrink: 0 }}>
          <Tooltip title="Upload profile photo">
            <IconButton
              onClick={handleAvatarClick}
              disabled={uploading}
              aria-label="Upload profile photo"
              sx={{
                p: 0,
                borderRadius: '50%',
                '&:hover .profile-photo-overlay': { opacity: 1 },
              }}
            >
              <Avatar
                src={photoSrc || undefined}
                imgProps={{ style: { objectFit: 'cover' } }}
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: POSTURE_COLORS.blue,
                  fontWeight: 700,
                  fontSize: '1.25rem',
                  boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                }}
              >
                {!photoSrc && !photoLoading ? initials : null}
              </Avatar>
              <Box
                className="profile-photo-overlay"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  bgcolor: 'rgba(15, 23, 42, 0.45)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: uploading ? 1 : 0,
                  transition: 'opacity 0.2s ease',
                  pointerEvents: 'none',
                }}
              >
                {uploading || photoLoading ? (
                  <CircularProgress size={22} sx={{ color: '#fff' }} />
                ) : (
                  <PhotoCameraOutlinedIcon sx={{ color: '#fff', fontSize: 22 }} />
                )}
              </Box>
            </IconButton>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            hidden
            onChange={handleFileChange}
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: POSTURE_COLORS.blueDark }}>
            {profile.displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontWeight: 500 }}>
            {profile.title && profile.title !== '—' ? profile.title : profile.identityType || '—'}
          </Typography>
          {profile.department && profile.department !== '—' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, fontSize: '0.82rem' }}>
              {profile.department}
            </Typography>
          )}
        </Box>
        <Chip
          label={profile.maturityLevel}
          size="small"
          sx={{
            flexShrink: 0,
            height: 24,
            fontWeight: 700,
            fontSize: '0.65rem',
            bgcolor: badge.bg,
            color: badge.color,
            border: `1px solid ${badge.border}`,
          }}
        />
      </Box>

      {uploadError && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1.5 }}>
          {uploadError}
        </Typography>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {[
          ['Employee ID', profile.employeeId],
          ['Email', profile.email],
          ['Manager', profile.manager],
          ['Manager Email', profile.managerEmail],
        ].map(([label, value]) => (
          <Box key={label} sx={{ display: 'flex', gap: 1.5 }}>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ minWidth: 108, fontSize: '0.82rem', fontWeight: 500 }}
            >
              {label}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, fontSize: '0.82rem', wordBreak: 'break-word', color: 'text.primary' }}
            >
              {value || '—'}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
