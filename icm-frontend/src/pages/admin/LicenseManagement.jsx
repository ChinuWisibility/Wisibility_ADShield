import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { CloudUpload, Refresh } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { licenseAPI } from '../../services/api';
import { palette } from '../../theme/palette';

export default function LicenseManagement() {
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await licenseAPI.status();
      setStatus(res.data.data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to load license status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await licenseAPI.upload(file);
      setStatus(res.data.data);
      enqueueSnackbar('License activated — no restart required', { variant: 'success' });
      await load();
    } catch (err) {
      const msg = err?.response?.data?.message || 'License upload failed';
      setError(msg);
      enqueueSnackbar(msg, { variant: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const onReload = async () => {
    try {
      await licenseAPI.reload();
      enqueueSnackbar('License reloaded', { variant: 'success' });
      await load();
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || 'Reload failed', { variant: 'error' });
    }
  };

  const summary = status?.summary;

  return (
    <Box sx={{ p: 3, maxWidth: 840 }}>
      <Typography variant="h5" sx={{ mb: 1, fontWeight: 600, color: palette.text?.primary }}>
        Product License
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, color: 'text.secondary' }}>
        Upload a signed <code>.lic.json</code> file. Verification runs before the file is saved;
        features unlock immediately without restarting the service.
      </Typography>

      {loading ? (
        <CircularProgress size={28} />
      ) : (
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!status?.licensed ? (
            <Alert severity="warning">
              A valid license is required. The product is running in license-required mode.
            </Alert>
          ) : (
            <Alert severity="success">Product is licensed.</Alert>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
              <Chip
                label={status?.licensed ? 'Licensed' : 'Unlicensed'}
                color={status?.licensed ? 'success' : 'warning'}
                size="small"
              />
              {status?.licenseRequiredMode ? (
                <Chip label="Minimal mode" size="small" color="warning" variant="outlined" />
              ) : null}
            </Stack>
            {summary ? (
              <Stack spacing={0.75}>
                <Typography variant="body2">License ID: {summary.licenseId || '—'}</Typography>
                <Typography variant="body2">Customer: {summary.customer || '—'}</Typography>
                <Typography variant="body2">Edition: {summary.edition || '—'}</Typography>
                <Typography variant="body2">Issuer: {summary.issuer || '—'}</Typography>
                <Typography variant="body2">Audience: {summary.audience || '—'}</Typography>
                <Typography variant="body2">Expires: {summary.expiresAt || '—'}</Typography>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No license loaded.
              </Typography>
            )}
          </Paper>

          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              component="label"
              startIcon={<CloudUpload />}
              disabled={uploading}
            >
              {uploading ? 'Verifying…' : 'Upload license'}
              <input hidden type="file" accept=".json,.lic.json,application/json" onChange={onFile} />
            </Button>
            <Button variant="outlined" startIcon={<Refresh />} onClick={onReload} disabled={uploading}>
              Reload from disk
            </Button>
          </Stack>
        </Stack>
      )}
    </Box>
  );
}
