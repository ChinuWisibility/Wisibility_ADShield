import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Slider,
  Typography,
} from '@mui/material';
import {
  Close,
  DeleteOutline,
  PhotoCameraOutlined,
  RestartAlt,
} from '@mui/icons-material';
import {
  PROFILE_PHOTO_ACCEPT,
  PROFILE_PHOTO_MAX_BYTES,
} from './useIdentityProfilePhoto';
import { CATALOG } from './catalogTheme';

const VIEW = 280;
const OUTPUT = 512;

/**
 * Build a square JPEG blob from an image with zoom + pan offset.
 * offset is in view pixels (how far the image is dragged).
 */
export function cropImageToBlob(image, zoom, offset, outputSize = OUTPUT) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Canvas not supported'));
      return;
    }

    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const base = Math.max(VIEW / iw, VIEW / ih);
    const scale = base * zoom;
    const drawW = iw * scale;
    const drawH = ih * scale;
    const dx = (VIEW - drawW) / 2 + offset.x;
    const dy = (VIEW - drawH) / 2 + offset.y;

    // Map view-space crop square → source image
    const sx = (-dx) / scale;
    const sy = (-dy) / scale;
    const sSize = VIEW / scale;

    ctx.fillStyle = '#0B1220';
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.drawImage(image, sx, sy, sSize, sSize, 0, 0, outputSize, outputSize);

    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Failed to create image'));
        else resolve(blob);
      },
      'image/jpeg',
      0.92,
    );
  });
}

export default function ManageProfilePhotoDialog({
  open,
  onClose,
  photoSrc,
  uploading,
  hasPhoto,
  onSaveFile,
  onRemove,
}) {
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  const [sourceUrl, setSourceUrl] = useState(null);
  const [imgReady, setImgReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState('');
  const [dirty, setDirty] = useState(false);

  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });

  // Prefer newly chosen file; else current stored photo for re-framing
  useEffect(() => {
    if (!open) return;
    setLocalError('');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDirty(false);
    setImgReady(false);
    setImgSize({ w: 0, h: 0 });
    setSourceUrl(photoSrc || null);
  }, [open, photoSrc]);

  useEffect(() => () => {
    if (sourceUrl && sourceUrl.startsWith('blob:') && sourceUrl !== photoSrc) {
      URL.revokeObjectURL(sourceUrl);
    }
  }, [sourceUrl, photoSrc]);

  const pickFile = () => fileInputRef.current?.click();

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!PROFILE_PHOTO_ACCEPT.split(',').includes(file.type)) {
      setLocalError('Please choose a JPEG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setLocalError('Image must be 2 MB or smaller.');
      return;
    }
    setLocalError('');
    const url = URL.createObjectURL(file);
    if (sourceUrl && sourceUrl.startsWith('blob:') && sourceUrl !== photoSrc) {
      URL.revokeObjectURL(sourceUrl);
    }
    setSourceUrl(url);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDirty(true);
    setImgReady(false);
    setImgSize({ w: 0, h: 0 });
  };

  const onPointerDown = (e) => {
    if (!imgReady) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({
      x: dragRef.current.origX + dx,
      y: dragRef.current.origY + dy,
    });
    setDirty(true);
  };

  const onPointerUp = (e) => {
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const resetFrame = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setDirty(Boolean(sourceUrl && sourceUrl !== photoSrc));
  };

  const handleSave = useCallback(async () => {
    if (!imgRef.current || !sourceUrl) {
      setLocalError('Choose a photo first.');
      return;
    }
    setLocalError('');
    try {
      const blob = await cropImageToBlob(imgRef.current, zoom, offset);
      const file = new File([blob], 'profile-photo.jpg', { type: 'image/jpeg' });
      const ok = await onSaveFile(file);
      if (ok) onClose();
    } catch (err) {
      setLocalError(err.message || 'Could not save photo');
    }
  }, [sourceUrl, zoom, offset, onSaveFile, onClose]);

  const handleRemove = async () => {
    const ok = await onRemove?.();
    if (ok) onClose();
  };

  const imgStyle = (() => {
    if (!imgReady || !imgSize.w || !imgSize.h) {
      return { opacity: 0, position: 'absolute' };
    }
    const base = Math.max(VIEW / imgSize.w, VIEW / imgSize.h);
    const scale = base * zoom;
    return {
      position: 'absolute',
      width: imgSize.w * scale,
      height: imgSize.h * scale,
      left: (VIEW - imgSize.w * scale) / 2 + offset.x,
      top: (VIEW - imgSize.h * scale) / 2 + offset.y,
      pointerEvents: 'none',
      userSelect: 'none',
    };
  })();

  return (
    <Dialog open={open} onClose={uploading ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', pr: 1 }}>
        <Typography component="span" sx={{ fontWeight: 700, flex: 1 }}>
          Manage profile photo
        </Typography>
        <IconButton size="small" onClick={onClose} disabled={uploading} aria-label="Close">
          <Close fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkMuted, mb: 1.5 }}>
          Drag to reposition, use the slider to scale, then save. The circle is how the avatar will look.
        </Typography>

        <Box
          sx={{
            width: VIEW,
            height: VIEW,
            mx: 'auto',
            position: 'relative',
            borderRadius: '50%',
            overflow: 'hidden',
            bgcolor: CATALOG.surfaceAlt,
            border: `2px solid ${CATALOG.border}`,
            cursor: sourceUrl ? (dragging ? 'grabbing' : 'grab') : 'default',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {sourceUrl ? (
            <img
              ref={imgRef}
              src={sourceUrl}
              alt="Profile crop preview"
              draggable={false}
              onLoad={(e) => {
                setImgSize({
                  w: e.currentTarget.naturalWidth,
                  h: e.currentTarget.naturalHeight,
                });
                setImgReady(true);
              }}
              style={imgStyle}
            />
          ) : (
            <Box
              sx={{
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                color: CATALOG.inkFaint,
                textAlign: 'center',
                px: 2,
              }}
            >
              <Box>
                <PhotoCameraOutlined sx={{ fontSize: 36, mb: 1 }} />
                <Typography sx={{ fontSize: '0.8rem' }}>No photo selected</Typography>
              </Box>
            </Box>
          )}
        </Box>

        <Box sx={{ mt: 2.5, px: 1 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: CATALOG.inkMuted, mb: 0.5 }}>
            Scale
          </Typography>
          <Slider
            value={zoom}
            min={1}
            max={3}
            step={0.02}
            disabled={!sourceUrl || uploading}
            onChange={(_e, v) => {
              setZoom(v);
              setDirty(true);
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
          />
        </Box>

        {(localError) && (
          <Typography color="error" variant="caption" sx={{ display: 'block', mt: 1 }}>
            {localError}
          </Typography>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={PROFILE_PHOTO_ACCEPT}
          hidden
          onChange={handleFile}
        />
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        {hasPhoto ? (
          <Button
            color="error"
            startIcon={<DeleteOutline />}
            onClick={handleRemove}
            disabled={uploading}
            sx={{ mr: 'auto' }}
          >
            Remove
          </Button>
        ) : (
          <Box sx={{ mr: 'auto' }} />
        )}
        <Button
          startIcon={<RestartAlt />}
          onClick={resetFrame}
          disabled={!sourceUrl || uploading}
        >
          Reset
        </Button>
        <Button
          variant="outlined"
          startIcon={<PhotoCameraOutlined />}
          onClick={pickFile}
          disabled={uploading}
        >
          Choose photo
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!sourceUrl || uploading || (!dirty && sourceUrl === photoSrc)}
          startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {uploading ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
