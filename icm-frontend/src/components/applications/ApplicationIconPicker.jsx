import { useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ClearIcon from '@mui/icons-material/Clear';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { applicationIconAPI, resolveServerBaseUrl } from '../../services/api';

export function resolveApplicationIconSrc(iconOrUrl) {
  if (!iconOrUrl) return null;
  const v = String(iconOrUrl).trim();
  if (!v) return null;
  let url = v;
  if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:')) {
    url = v;
  } else if (v.startsWith('/api/') || v.startsWith('/')) {
    url = `${resolveServerBaseUrl()}${v}`;
  } else {
    url = applicationIconAPI.imageUrl(v);
  }
  // Bust stale builtin artwork in app header / lists
  if (url && url.includes('/application-icons/') && url.includes('/image')) {
    const sep = url.includes('?') ? '&' : '?';
    if (!/[?&]v=/.test(url)) url = `${url}${sep}v=6`;
  }
  return url;
}

const COLOR_SWATCHES = [
  '#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c',
  '#0891b2', '#4f46e5', '#059669', '#ca8a04', '#dc2626', '#181717',
];

/**
 * Pick or upload an icon from the tenant Application Icon library.
 * value: { iconId, color } | null
 */
export default function ApplicationIconPicker({
  tenantId,
  value,
  onChange,
  disabled = false,
  compact = false,
}) {
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [search, setSearch] = useState('');

  const { data: icons = [], isLoading } = useQuery({
    queryKey: ['application-icons', tenantId],
    queryFn: async () => {
      const res = await applicationIconAPI.list({ tenantId });
      return res.data?.data || [];
    },
    enabled: Boolean(tenantId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file) => applicationIconAPI.upload(file, { tenantId }),
    onSuccess: (res) => {
      const created = res.data?.data;
      queryClient.invalidateQueries({ queryKey: ['application-icons', tenantId] });
      if (created?._id) {
        onChange?.({
          iconId: created._id,
          color: created.color || value?.color || null,
          icon: created.imageUrl,
        });
      }
      enqueueSnackbar('Icon uploaded to library', { variant: 'success' });
    },
    onError: (err) => {
      enqueueSnackbar(err.response?.data?.message || 'Upload failed', { variant: 'error' });
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return icons;
    return icons.filter(
      (i) =>
        String(i.name || '').toLowerCase().includes(q)
        || String(i.key || '').toLowerCase().includes(q),
    );
  }, [icons, search]);

  const selectedId = value?.iconId ? String(value.iconId) : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search icons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={disabled || !tenantId}
          sx={{ flex: 1, minWidth: 160 }}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={uploadMutation.isPending ? <CircularProgress size={14} /> : <CloudUploadIcon />}
          disabled={disabled || !tenantId || uploadMutation.isPending}
          onClick={() => fileRef.current?.click()}
          sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
        >
          Upload new
        </Button>
        <Button
          size="small"
          color="inherit"
          startIcon={<ClearIcon />}
          disabled={disabled || !selectedId}
          onClick={() => onChange?.({ iconId: null, color: null, icon: null })}
          sx={{ textTransform: 'none' }}
        >
          Clear
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) uploadMutation.mutate(file);
          }}
        />
      </Box>

      {!tenantId ? (
        <Typography variant="body2" color="text.secondary">
          Select a tenant context to load icons.
        </Typography>
      ) : isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: compact
              ? 'repeat(auto-fill, minmax(72px, 1fr))'
              : 'repeat(auto-fill, minmax(88px, 1fr))',
            gap: 1,
            maxHeight: compact ? 220 : 280,
            overflowY: 'auto',
            p: 0.5,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1.5,
            bgcolor: 'background.paper',
          }}
        >
          {filtered.map((icon) => {
            const active = selectedId === String(icon._id);
            return (
              <Box
                key={icon._id}
                component="button"
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange?.({
                    iconId: icon._id,
                    color: value?.color || icon.color || null,
                    icon: icon.imageUrl,
                  })
                }
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 0.5,
                  p: 1,
                  borderRadius: 1.25,
                  border: '2px solid',
                  borderColor: active ? 'primary.main' : 'transparent',
                  bgcolor: active ? (theme) => alpha(theme.palette.primary.main, 0.08) : 'transparent',
                  cursor: disabled ? 'default' : 'pointer',
                  background: 'none',
                  font: 'inherit',
                  '&:hover': disabled
                    ? undefined
                    : { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.04) },
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    p: 0.4,
                  }}
                >
                  <Box
                    component="img"
                    src={resolveApplicationIconSrc(icon.imageUrl)}
                    alt=""
                    sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                </Box>
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    lineHeight: 1.2,
                    textAlign: 'center',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {icon.name}
                </Typography>
                {icon.source === 'builtin' ? (
                  <Chip label="Built-in" size="small" sx={{ height: 16, fontSize: '0.58rem' }} />
                ) : null}
              </Box>
            );
          })}
          {!filtered.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1', p: 2, textAlign: 'center' }}>
              No icons match.
            </Typography>
          ) : null}
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.75 }}>
          Accent color (optional)
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          {COLOR_SWATCHES.map((c) => {
            const active = String(value?.color || '').toLowerCase() === c.toLowerCase();
            return (
              <Box
                key={c}
                component="button"
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange?.({
                    iconId: value?.iconId || null,
                    color: c,
                    icon: value?.icon || null,
                  })
                }
                title={c}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  bgcolor: c,
                  border: active ? '2px solid #0f172a' : '2px solid #fff',
                  boxShadow: active ? `0 0 0 2px ${c}` : '0 0 0 1px #cbd5e1',
                  cursor: disabled ? 'default' : 'pointer',
                  p: 0,
                }}
              />
            );
          })}
          <TextField
            size="small"
            placeholder="#hex"
            value={value?.color || ''}
            disabled={disabled}
            onChange={(e) =>
              onChange?.({
                iconId: value?.iconId || null,
                color: e.target.value,
                icon: value?.icon || null,
              })
            }
            sx={{ width: 110 }}
            inputProps={{ maxLength: 32 }}
          />
        </Box>
      </Box>
    </Box>
  );
}
