import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  CircularProgress,
  Chip,
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import { Add, Delete, Edit } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { applicationAPI, connectorsAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';

const CONNECTOR_TYPES = ['ACTIVE_DIRECTORY', 'LDAP', 'REST', 'SCIM', 'JDBC', 'SFTP', 'CSV'];
const SYNC_TYPES = ['FULL', 'DELTA', 'TRIGGERED'];
const syncStatusColor = {
  SUCCESS: palette.status.success,
  FAILED: palette.status.error,
  PARTIAL: palette.status.warning,
  RUNNING: palette.status.info,
};

function getConnectorId(row) {
  return row?._id || row?.id;
}

export default function ConnectorsManagement() {
  const { enqueueSnackbar } = useSnackbar();

  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [appsLoading, setAppsLoading] = useState(true);
  const [applications, setApplications] = useState([]);

  const [filterApplicationId, setFilterApplicationId] = useState('');

  const [createDialog, setCreateDialog] = useState({ open: false, form: null, saving: false });
  const [editDialog, setEditDialog] = useState({ open: false, connector: null, saving: false, form: null });

  const resetCreateForm = useCallback(() => {
    setCreateDialog({
      open: true,
      saving: false,
      form: {
        applicationId: '',
        connectorType: 'ACTIVE_DIRECTORY',
        connectorVersion: '',
        isEnabled: true,
        syncSchedule: '',
        syncType: 'FULL',
      },
    });
  }, []);

  const fetchApplications = useCallback(async () => {
    setAppsLoading(true);
    try {
      // backend `getApplications` returns `data: applications[]`
      const res = await applicationAPI.list({ page: 1, limit: 500 });
      const apps = Array.isArray(res?.data?.data) ? res.data.data : [];
      setApplications(apps);
    } catch {
      enqueueSnackbar('Failed to load applications for connector association', { variant: 'error' });
    } finally {
      setAppsLoading(false);
    }
  }, [enqueueSnackbar]);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: 1, limit: 200 };
      if (filterApplicationId) params.applicationId = filterApplicationId;

      const res = await connectorsAPI.list(params);
      setConnectors(res?.data?.data?.items || []);
    } catch {
      enqueueSnackbar('Failed to load connectors', { variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enqueueSnackbar, filterApplicationId]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const applicationNameById = useMemo(() => {
    const map = new Map();
    for (const app of applications) {
      if (app?._id) map.set(String(app._id), app.name || app.applicationName || app._id);
    }
    return map;
  }, [applications]);

  const columns = useMemo(() => {
    return [
      {
        field: 'connectorType',
        headerName: 'Connector Type',
        minWidth: 200,
        renderCell: (row) => (
          <Typography variant="body2" fontWeight={700}>
            {row.connectorType || '—'}
          </Typography>
        ),
      },
      {
        field: 'applicationId',
        headerName: 'Application',
        minWidth: 220,
        renderCell: (row) => (
          <Typography variant="body2" sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {applicationNameById.get(String(row.applicationId)) || '—'}
          </Typography>
        ),
      },
      { field: 'connectorVersion', headerName: 'Version', width: 120 },
      {
        field: 'syncType',
        headerName: 'Sync Type',
        width: 130,
        renderCell: (row) => <Chip label={row.syncType || '—'} size="small" variant="outlined" />,
      },
      {
        field: 'isEnabled',
        headerName: 'Enabled',
        width: 110,
        renderCell: (row) => (
          <Chip
            label={row.isEnabled ? 'Enabled' : 'Disabled'}
            size="small"
            color={row.isEnabled ? 'success' : 'error'}
            variant="outlined"
          />
        ),
      },
      {
        field: 'lastSyncStatus',
        headerName: 'Last Sync',
        width: 140,
        renderCell: (row) => {
          const label = row.lastSyncStatus || 'NEVER';
          const color = syncStatusColor[row.lastSyncStatus] || palette.status.info;
          return <Chip label={label} size="small" sx={{ fontWeight: 700, bgcolor: `${color}14`, color }} variant="filled" />;
        },
      },
      {
        field: 'actions',
        headerName: 'Actions',
        sortable: false,
        width: 160,
        renderCell: (row) => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Edit">
              <IconButton
                size="small"
                onClick={() => {
                  const id = getConnectorId(row);
                  const connector = connectors.find((c) => getConnectorId(c) === id) || row;
                  setEditDialog({
                    open: true,
                    connector,
                    saving: false,
                    form: {
                      applicationId: connector.applicationId || '',
                      connectorType: connector.connectorType || 'ACTIVE_DIRECTORY',
                      connectorVersion: connector.connectorVersion || '',
                      isEnabled: connector.isEnabled ?? true,
                      syncSchedule: connector.syncSchedule || '',
                      syncType: connector.syncType || 'FULL',
                    },
                  });
                }}
              >
                <Edit fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                onClick={() => handleDelete(getConnectorId(row))}
                sx={{ color: palette.status.error }}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationNameById, connectors]);

  const validateForm = useCallback((form) => {
    if (!form?.applicationId) return 'Application is required';
    if (!form?.connectorType) return 'Connector type is required';
    if (!form?.syncType) return 'Sync type is required';
    return '';
  }, []);

  const handleCreate = async () => {
    const err = validateForm(createDialog.form);
    if (err) {
      enqueueSnackbar(err, { variant: 'warning' });
      return;
    }
    setCreateDialog((prev) => ({ ...prev, saving: true }));
    try {
      await connectorsAPI.create(createDialog.form);
      enqueueSnackbar('Connector created', { variant: 'success' });
      setCreateDialog({ open: false, form: null, saving: false });
      fetchConnectors();
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.error?.message || 'Failed to create connector', { variant: 'error' });
      setCreateDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleUpdate = async () => {
    const err = validateForm(editDialog.form);
    if (err) {
      enqueueSnackbar(err, { variant: 'warning' });
      return;
    }
    setEditDialog((prev) => ({ ...prev, saving: true }));
    try {
      const id = getConnectorId(editDialog.connector);
      await connectorsAPI.update(id, editDialog.form);
      enqueueSnackbar('Connector updated', { variant: 'success' });
      setEditDialog({ open: false, connector: null, saving: false, form: null });
      fetchConnectors();
    } catch (e) {
      enqueueSnackbar(e?.response?.data?.error?.message || 'Failed to update connector', { variant: 'error' });
      setEditDialog((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    if (!window.confirm('Delete this connector? This cannot be undone.')) return;
    try {
      await connectorsAPI.delete(id);
      enqueueSnackbar('Connector deleted', { variant: 'success' });
      fetchConnectors();
    } catch {
      enqueueSnackbar('Failed to delete connector', { variant: 'error' });
    }
  };

  const connectorForm = (form, setForm, saving) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
      <FormControl fullWidth size="small" disabled={appsLoading}>
        <InputLabel>Application</InputLabel>
        <Select
          label="Application"
          value={form.applicationId}
          onChange={(e) => setForm((prev) => ({ ...prev, applicationId: e.target.value }))}
        >
          <MenuItem value="">
            <em>Choose application</em>
          </MenuItem>
          {applications.map((app) => (
            <MenuItem key={app._id} value={app._id}>
              {app.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth size="small">
        <InputLabel>Connector Type</InputLabel>
        <Select
          label="Connector Type"
          value={form.connectorType}
          onChange={(e) => setForm((prev) => ({ ...prev, connectorType: e.target.value }))}
        >
          {CONNECTOR_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        size="small"
        label="Connector Version"
        value={form.connectorVersion}
        onChange={(e) => setForm((prev) => ({ ...prev, connectorVersion: e.target.value }))}
      />

      <FormControl fullWidth size="small">
        <InputLabel>Sync Type</InputLabel>
        <Select
          label="Sync Type"
          value={form.syncType}
          onChange={(e) => setForm((prev) => ({ ...prev, syncType: e.target.value }))}
        >
          {SYNC_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        size="small"
        label="Sync Schedule (cron or text)"
        value={form.syncSchedule}
        onChange={(e) => setForm((prev) => ({ ...prev, syncSchedule: e.target.value }))}
        placeholder="e.g. 0 0 * * *"
      />

      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <FormControlLabel
          control={
            <Switch
              checked={!!form.isEnabled}
              onChange={(e) => setForm((prev) => ({ ...prev, isEnabled: e.target.checked }))}
              disabled={saving}
            />
          }
          label={form.isEnabled ? 'Enabled' : 'Disabled'}
        />
      </Paper>
    </Box>
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">Connectors</Typography>
          <Typography variant="body2" color="text.secondary">
            {BRANDING.name} {BRANDING.product} &mdash; Create and manage connector definitions
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} disabled={appsLoading} onClick={resetCreateForm}>
          Add Connector
        </Button>
      </Box>

      <DataTable
        title="Connector Configurations"
        columns={columns}
        rows={connectors}
        loading={loading || appsLoading}
        onRefresh={fetchConnectors}
        emptyMessage="No connectors configured"
        searchable
        toolbarLeft={
          <FormControl size="small" sx={{ minWidth: 240 }} disabled={appsLoading}>
            <InputLabel>Filter by Application</InputLabel>
            <Select
              label="Filter by Application"
              value={filterApplicationId}
              onChange={(e) => setFilterApplicationId(e.target.value)}
            >
              <MenuItem value="">
                <em>All</em>
              </MenuItem>
              {applications.map((app) => (
                <MenuItem key={app._id} value={app._id}>
                  {app.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        }
      />

      {appsLoading && (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="caption" color="text.secondary">
            Loading applications...
          </Typography>
        </Box>
      )}

      {/* Create Dialog */}
      <Dialog
        open={createDialog.open}
        onClose={() => setCreateDialog({ open: false, form: null, saving: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Create Connector</DialogTitle>
        <DialogContent>
          {!createDialog.form ? null : connectorForm(createDialog.form, (updater) => {
            setCreateDialog((prev) => ({ ...prev, form: updater(prev.form) }));
          }, createDialog.saving)}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialog({ open: false, form: null, saving: false })} disabled={createDialog.saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleCreate} disabled={createDialog.saving}>
            {createDialog.saving ? <CircularProgress size={16} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={editDialog.open}
        onClose={() => setEditDialog({ open: false, connector: null, saving: false, form: null })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Edit Connector</DialogTitle>
        <DialogContent>
          {!editDialog.form ? null : connectorForm(editDialog.form, (updater) => {
            setEditDialog((prev) => ({ ...prev, form: updater(prev.form) }));
          }, editDialog.saving)}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog({ open: false, connector: null, saving: false, form: null })} disabled={editDialog.saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleUpdate} disabled={editDialog.saving}>
            {editDialog.saving ? <CircularProgress size={16} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

