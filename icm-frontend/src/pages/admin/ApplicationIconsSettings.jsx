import { useRef } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AppsIcon from '@mui/icons-material/Apps';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { applicationIconAPI } from '../../services/api';
import { resolveApplicationIconSrc } from '../../components/applications/ApplicationIconPicker';
import { useAuth } from '../../contexts/AuthContext';

export default function ApplicationIconsSettings() {
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  const { enqueueSnackbar } = useSnackbar();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);

  const { data: icons = [], isLoading, isFetching } = useQuery({
    queryKey: ['application-icons', tenantId],
    queryFn: async () => {
      const res = await applicationIconAPI.list({ tenantId });
      return res.data?.data || [];
    },
    enabled: Boolean(tenantId),
  });

  const uploadMutation = useMutation({
    mutationFn: (file) => applicationIconAPI.upload(file, { tenantId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-icons', tenantId] });
      enqueueSnackbar('Icon added to library', { variant: 'success' });
    },
    onError: (err) => {
      enqueueSnackbar(err.response?.data?.message || 'Upload failed', { variant: 'error' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => applicationIconAPI.delete(id, { tenantId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['application-icons', tenantId] });
      enqueueSnackbar('Icon removed', { variant: 'success' });
    },
    onError: (err) => {
      enqueueSnackbar(err.response?.data?.message || 'Delete failed', { variant: 'error' });
    },
  });

  const applyPackMutation = useMutation({
    mutationFn: () =>
      applicationIconAPI.seedBuiltins(tenantId, { force: true, apply: true, onlyMissing: false }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['application-icons', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['applications'] });
      const assigned = res.data?.data?.applied?.assigned ?? 0;
      enqueueSnackbar(
        assigned
          ? `Applied pack icons to ${assigned} application${assigned === 1 ? '' : 's'}`
          : 'Built-in pack refreshed; no matching applications to update',
        { variant: 'success' },
      );
    },
    onError: (err) => {
      enqueueSnackbar(err.response?.data?.message || 'Failed to apply icon pack', { variant: 'error' });
    },
  });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2.5, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.08 }}>
            Settings
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
            <AppsIcon color="primary" /> Application Icons
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
            Shared icon library for this tenant. Built-in brands are always available; upload custom marks and assign them when creating or editing applications.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            variant="outlined"
            startIcon={applyPackMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />}
            disabled={!tenantId || applyPackMutation.isPending}
            onClick={() => applyPackMutation.mutate()}
            sx={{ textTransform: 'none' }}
          >
            Apply pack to apps
          </Button>
          <Button
            variant="contained"
            startIcon={uploadMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
            disabled={!tenantId || uploadMutation.isPending}
            onClick={() => fileRef.current?.click()}
            sx={{ textTransform: 'none' }}
          >
            Upload icon
          </Button>
        </Stack>
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
        <Paper sx={{ p: 3 }}>
          <Typography color="text.secondary">
            A tenant context is required to manage the application icon library.
          </Typography>
        </Paper>
      ) : isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Library ({icons.length})
            </Typography>
            {isFetching ? <CircularProgress size={16} /> : null}
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 1.25,
            }}
          >
            {icons.map((icon) => (
              <Box
                key={icon._id}
                sx={{
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.9),
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 1.25,
                      border: '1px solid',
                      borderColor: 'divider',
                      bgcolor: '#fff',
                      p: 0.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    <Box
                      component="img"
                      src={resolveApplicationIconSrc(icon.imageUrl)}
                      alt=""
                      sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
                      {icon.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {icon.usageCount || 0} app{(icon.usageCount || 0) === 1 ? '' : 's'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.5 }}>
                  <Chip
                    size="small"
                    label={icon.source === 'builtin' ? 'Built-in' : 'Custom'}
                    color={icon.source === 'builtin' ? 'default' : 'primary'}
                    variant="outlined"
                    sx={{ height: 22, fontSize: '0.68rem' }}
                  />
                  {icon.source === 'upload' ? (
                    <Tooltip
                      title={
                        icon.usageCount > 0
                          ? `Used by ${icon.usageCount} application(s) — unassign first`
                          : 'Delete from library'
                      }
                    >
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={deleteMutation.isPending || icon.usageCount > 0}
                          onClick={() => deleteMutation.mutate(icon._id)}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
}
