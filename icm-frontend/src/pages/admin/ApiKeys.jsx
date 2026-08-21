import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Button, IconButton, Chip, Tooltip, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Alert, CircularProgress,
} from '@mui/material';
import { Add, Delete, Autorenew, ContentCopy, VpnKey } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { adminAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';

export default function ApiKeys() {
  const { enqueueSnackbar } = useSnackbar();
  const [keys, setKeys] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [createDialog, setCreateDialog] = useState({ open: false, keyName: '', scopes: '', result: null, loading: false });
  const [rotateDialog, setRotateDialog] = useState({ open: false, key: null, result: null, loading: false });

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminAPI.listApiKeys({ page: 1, limit: 50 });
      setKeys(res.data.data.items);
      setTotal(res.data.data.total);
    } catch { enqueueSnackbar('Failed to load API keys', { variant: 'error' }); }
    finally { setLoading(false); }
  }, [enqueueSnackbar]);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    setCreateDialog((prev) => ({ ...prev, loading: true }));
    try {
      const scopes = createDialog.scopes ? createDialog.scopes.split(',').map((s) => s.trim()) : [];
      const res = await adminAPI.createApiKey({ keyName: createDialog.keyName, scopes });
      setCreateDialog((prev) => ({ ...prev, result: res.data.data, loading: false }));
      enqueueSnackbar('API key created', { variant: 'success' });
      fetchKeys();
    } catch (err) {
      setCreateDialog((prev) => ({ ...prev, loading: false }));
      enqueueSnackbar(err.response?.data?.error?.message || 'Failed to create key', { variant: 'error' });
    }
  };

  const handleRevoke = async (id) => {
    if (!window.confirm('Revoke this API key? This action cannot be undone.')) return;
    try {
      await adminAPI.revokeApiKey(id);
      enqueueSnackbar('API key revoked', { variant: 'success' });
      fetchKeys();
    } catch { enqueueSnackbar('Failed to revoke', { variant: 'error' }); }
  };

  const handleRotate = async () => {
    setRotateDialog((prev) => ({ ...prev, loading: true }));
    try {
      const res = await adminAPI.rotateApiKey(rotateDialog.key._id);
      setRotateDialog((prev) => ({ ...prev, result: res.data.data, loading: false }));
      enqueueSnackbar('API key rotated', { variant: 'success' });
      fetchKeys();
    } catch {
      setRotateDialog((prev) => ({ ...prev, loading: false }));
      enqueueSnackbar('Failed to rotate key', { variant: 'error' });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    enqueueSnackbar('Copied to clipboard', { variant: 'info' });
  };

  const columns = [
    {
      field: 'keyName', headerName: 'Name', minWidth: 200,
      renderCell: (row) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <VpnKey fontSize="small" sx={{ color: palette.brand.primary }} />
          <Typography variant="body2" fontWeight={600}>{row.keyName}</Typography>
        </Box>
      ),
    },
    {
      field: 'scopes', headerName: 'Scopes', width: 200,
      renderCell: (row) => row.scopes?.length ? row.scopes.map((s) => (
        <Chip key={s} label={s} size="small" variant="outlined" sx={{ mr: 0.5, fontSize: '0.65rem' }} />
      )) : <Typography variant="caption" color="text.secondary">All scopes</Typography>,
    },
    {
      field: 'issuedTo', headerName: 'Issued To', width: 180,
      renderCell: (row) => {
        const u = row.issuedTo;
        if (!u || typeof u === 'string') return '—';
        return `${u.firstName} ${u.lastName}`;
      },
    },
    {
      field: 'lastUsedAt', headerName: 'Last Used', width: 160,
      renderCell: (row) => row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : 'Never',
    },
    {
      field: 'createdAt', headerName: 'Created', width: 160,
      renderCell: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      field: 'actions', headerName: 'Actions', width: 120, sortable: false,
      renderCell: (row) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="Rotate">
            <IconButton size="small" onClick={() => setRotateDialog({ open: true, key: row, result: null, loading: false })}>
              <Autorenew fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Revoke">
            <IconButton size="small" onClick={() => handleRevoke(row._id)} sx={{ color: palette.status.error }}>
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">API Keys</Typography>
          <Typography variant="body2" color="text.secondary">{BRANDING.name} {BRANDING.product} &mdash; Manage service-to-service integration authentication keys</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />}
          onClick={() => setCreateDialog({ open: true, keyName: '', scopes: '', result: null, loading: false })}>
          Create Key
        </Button>
      </Box>

      <DataTable columns={columns} rows={keys} loading={loading} onRefresh={fetchKeys}
        emptyMessage="No API keys created" />

      {/* Create Dialog */}
      <Dialog open={createDialog.open} onClose={() => setCreateDialog({ open: false, keyName: '', scopes: '', result: null, loading: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Create API Key</DialogTitle>
        <DialogContent>
          {createDialog.result ? (
            <Box>
              <Alert severity="success" sx={{ mb: 2 }}>API key created successfully</Alert>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Copy the key now. It will not be shown again.
              </Alert>
              <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: palette.bg.primary }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
                  {createDialog.result.plainKey}
                </Typography>
                <IconButton size="small" onClick={() => copyToClipboard(createDialog.result.plainKey)}>
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Paper>
            </Box>
          ) : (
            <Box sx={{ mt: 1 }}>
              <TextField fullWidth size="small" label="Key Name" value={createDialog.keyName}
                onChange={(e) => setCreateDialog((prev) => ({ ...prev, keyName: e.target.value }))} sx={{ mb: 2 }} />
              <TextField fullWidth size="small" label="Scopes (comma-separated)" value={createDialog.scopes}
                onChange={(e) => setCreateDialog((prev) => ({ ...prev, scopes: e.target.value }))}
                helperText="Leave empty for all scopes" />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog({ open: false, keyName: '', scopes: '', result: null, loading: false })}>
            {createDialog.result ? 'Close' : 'Cancel'}
          </Button>
          {!createDialog.result && (
            <Button variant="contained" onClick={handleCreate} disabled={!createDialog.keyName || createDialog.loading}
              startIcon={createDialog.loading ? <CircularProgress size={16} /> : <Add />}>Create</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Rotate Dialog */}
      <Dialog open={rotateDialog.open} onClose={() => setRotateDialog({ open: false, key: null, result: null, loading: false })} maxWidth="sm" fullWidth>
        <DialogTitle>Rotate API Key</DialogTitle>
        <DialogContent>
          {rotateDialog.result ? (
            <Box>
              <Alert severity="success" sx={{ mb: 2 }}>Key rotated. Old key is now revoked.</Alert>
              <Alert severity="warning" sx={{ mb: 2 }}>Copy the new key now. It will not be shown again.</Alert>
              <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1, bgcolor: palette.bg.primary }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
                  {rotateDialog.result.plainKey}
                </Typography>
                <IconButton size="small" onClick={() => copyToClipboard(rotateDialog.result.plainKey)}>
                  <ContentCopy fontSize="small" />
                </IconButton>
              </Paper>
            </Box>
          ) : (
            <Typography variant="body2">
              Rotate key <strong>{rotateDialog.key?.keyName}</strong>? The old key will be revoked and a new one issued.
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRotateDialog({ open: false, key: null, result: null, loading: false })}>
            {rotateDialog.result ? 'Close' : 'Cancel'}
          </Button>
          {!rotateDialog.result && (
            <Button variant="contained" color="warning" onClick={handleRotate} disabled={rotateDialog.loading}
              startIcon={rotateDialog.loading ? <CircularProgress size={16} /> : <Autorenew />}>Rotate</Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
