import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  Paper,
  IconButton,
  Tooltip,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  CircularProgress,
  LinearProgress,
  InputLabel,
  FormControl,
  Select,
  Alert,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { Add, Delete, Close } from '@mui/icons-material';
import DataTable from '../../components/DataTable';
import { palette } from '../../theme/palette';
import { identityProfileAPI, applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

function sourceLabel(row) {
  const app = row.sourceApplicationId;
  if (app && typeof app === 'object' && app.name) return app.name;
  const legacy = row.hrmsSourceId;
  if (legacy && typeof legacy === 'object' && legacy.name) return legacy.name;
  return '—';
}

function ImpactTreeNode({ node, depth = 0 }) {
  if (!node) return null;
  return (
    <Box sx={{ pl: depth * 2, py: 0.35 }}>
      <Typography variant="body2" sx={{ fontWeight: depth === 0 ? 700 : 600, fontSize: depth === 0 ? '1rem' : '0.875rem' }}>
        {node.label}
      </Typography>
      {node.detail ? (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ pl: 0.25, maxWidth: 520 }}>
          {node.detail}
        </Typography>
      ) : null}
      {(node.children || []).map((ch) => (
        <ImpactTreeNode key={ch.id || ch.label} node={ch} depth={depth + 1} />
      ))}
    </Box>
  );
}

export default function IdentityProfileList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [sourceApps, setSourceApps] = useState([]);
  const [loadingSources, setLoadingSources] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', description: '', sourceApplicationId: '' });
  const [deleteDialog, setDeleteDialog] = useState({
    open: false,
    id: null,
    name: '',
    loading: false,
    deleting: false,
    impact: null,
    error: null,
    confirmed: false,
  });

  const fetchProfiles = async () => {
    if (!tenantId) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await identityProfileAPI.list({ tenantId });
      setProfiles(res.data?.data || []);
    } catch (err) {
      console.error('Failed to fetch identity profiles:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSourceApplications = useCallback(async () => {
    if (!tenantId) return;
    setLoadingSources(true);
    try {
      const res = await applicationAPI.list({ tenantId, limit: 500, page: 1 });
      const list = res.data?.data || res.data?.applications || [];
      setSourceApps(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      setSourceApps([]);
    } finally {
      setLoadingSources(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchProfiles();
  }, [tenantId]);

  useEffect(() => {
    if (createOpen && tenantId) loadSourceApplications();
  }, [createOpen, tenantId, loadSourceApplications]);

  const openDeleteDialog = async (id, name) => {
    setDeleteDialog({
      open: true,
      id,
      name,
      loading: true,
      deleting: false,
      impact: null,
      error: null,
      confirmed: false,
    });
    try {
      const res = await identityProfileAPI.getDeletionImpact(id);
      setDeleteDialog((d) => ({
        ...d,
        loading: false,
        impact: res.data?.data || null,
        error: null,
      }));
    } catch (err) {
      setDeleteDialog((d) => ({
        ...d,
        loading: false,
        error: err.response?.data?.message || err.message || 'Failed to load deletion impact.',
      }));
    }
  };

  const closeDeleteDialog = () => {
    if (deleteDialog.deleting) return;
    setDeleteDialog({
      open: false,
      id: null,
      name: '',
      loading: false,
      deleting: false,
      impact: null,
      error: null,
      confirmed: false,
    });
  };

  const confirmDeleteProfile = async () => {
    const { id, impact, confirmed } = deleteDialog;
    if (!id) return;
    const hasIdentities = (impact?.identities?.total || 0) > 0;
    if (hasIdentities && !confirmed) return;

    setDeleteDialog((d) => ({ ...d, deleting: true }));
    try {
      await identityProfileAPI.delete(id, {
        confirmDeletion: true,
        deleteLinkedIdentities: hasIdentities,
      });
      closeDeleteDialog();
      fetchProfiles();
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to delete profile.';
      alert(msg);
      console.error(err);
      setDeleteDialog((d) => ({ ...d, deleting: false }));
    }
  };

  const submitCreate = async () => {
    const name = createForm.name.trim();
    if (!name) {
      alert('Name is required.');
      return;
    }
    if (!createForm.sourceApplicationId) {
      alert('Source is required.');
      return;
    }
    setSaving(true);
    try {
      const res = await identityProfileAPI.create({
        tenantId,
        name,
        description: createForm.description.trim() || undefined,
        sourceApplicationId: createForm.sourceApplicationId,
      });
      const created = res.data?.data;
      setCreateOpen(false);
      setCreateForm({ name: '', description: '', sourceApplicationId: '' });
      fetchProfiles();
      if (created?._id) {
        navigate(`/identities/profiles/${created._id}?tab=mapping`);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create profile.');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      field: 'name',
      headerName: 'Name',
      minWidth: 200,
      renderCell: (row) => (
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: palette.brand.primary,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}
          onClick={() => navigate(`/identities/profiles/${row._id}`)}
        >
          {row.name}
        </Typography>
      ),
    },
    {
      field: 'source',
      headerName: 'Source',
      minWidth: 200,
      renderCell: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {sourceLabel(row)}
        </Typography>
      ),
    },
    {
      field: 'description',
      headerName: 'Description',
      minWidth: 260,
      renderCell: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap>
          {row.description || '—'}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      minWidth: 80,
      sortable: false,
      renderCell: (row) => (
        <Tooltip title="Delete profile (shows linked identities & correlation impact)">
          <IconButton size="small" onClick={() => openDeleteDialog(row._id, row.name)}>
            <Delete fontSize="small" sx={{ color: palette.status.error }} />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            Identity Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Link an authoritative HR application <strong>after</strong> the source exists (App Registry → schema → data).
            Then map attributes and run identity refresh.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => setCreateOpen(true)}
          disabled={!tenantId}
          sx={{ fontWeight: 600, px: 3, height: 40 }}
        >
          Create Profile
        </Button>
      </Box>

      {!tenantId ? (
        <Card
          elevation={0}
          sx={{
            border: `1px solid ${palette.border.default}`,
            p: 6,
            textAlign: 'center',
            backgroundColor: '#f8fafc',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
            No tenant associated
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your user account is not associated with any tenant.
          </Typography>
        </Card>
      ) : (
        <Card elevation={0} sx={{ border: `1px solid ${palette.border.default}` }}>
          <DataTable
            title="Profiles"
            columns={columns}
            rows={profiles}
            loading={loading}
            onRefresh={fetchProfiles}
            defaultSort="name"
            emptyMessage="No identity profiles yet. Create one to get started."
          />
        </Card>
      )}

      <Drawer
        anchor="right"
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 420 },
            maxWidth: '100%',
            p: 0,
            borderLeft: `1px solid ${palette.border.default}`,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 2,
            borderBottom: `1px solid ${palette.border.default}`,
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Create New Identity Profile
          </Typography>
          <IconButton aria-label="close" onClick={() => !saving && setCreateOpen(false)} disabled={saving}>
            <Close />
          </IconButton>
        </Box>

        <Box sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 2.5, flex: 1, overflow: 'auto' }}>
          {loadingSources ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <>
              <Alert severity="info" sx={{ py: 0.75 }}>
                Recommended order: HR source → Schema Management → Upload/API → <strong>Identity Profile</strong> →
                Mappings → Identity refresh.
              </Alert>
              <TextField
                label="Name"
                required
                fullWidth
                size="small"
                value={createForm.name}
                onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))}
              />
              <FormControl fullWidth size="small" required>
                <InputLabel id="ip-create-source-label">Source</InputLabel>
                <Select
                  labelId="ip-create-source-label"
                  label="Source"
                  value={createForm.sourceApplicationId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, sourceApplicationId: e.target.value }))}
                >
                  {sourceApps.length === 0 ? (
                    <MenuItem value="" disabled>
                      No applications for this tenant — add one in App Registry
                    </MenuItem>
                  ) : (
                    sourceApps.map((app) => (
                      <MenuItem key={app._id} value={app._id}>
                        {app.name}
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
              <TextField
                label="Description"
                fullWidth
                multiline
                minRows={4}
                size="small"
                value={createForm.description}
                onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))}
              />
            </>
          )}
        </Box>

        <Box
          sx={{
            mt: 'auto',
            p: 2.5,
            borderTop: `1px solid ${palette.border.default}`,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 1,
          }}
        >
          <Button variant="outlined" onClick={() => setCreateOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={submitCreate}
            disabled={saving || loadingSources || !sourceApps.length}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </Box>
      </Drawer>

      <Dialog open={deleteDialog.open} onClose={closeDeleteDialog} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle sx={{ fontWeight: 700 }}>Delete identity profile</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Profile: <strong>{deleteDialog.name}</strong>
          </Typography>
          {deleteDialog.loading ? (
            <Box sx={{ py: 2 }}>
              <LinearProgress />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Checking identities, account correlation links, entitlement correlation, role assignments…
              </Typography>
            </Box>
          ) : null}
          {deleteDialog.error ? <Alert severity="error">{deleteDialog.error}</Alert> : null}
          {!deleteDialog.loading && !deleteDialog.error && deleteDialog.impact?.tree?.length ? (
            <Box sx={{ mt: 1 }}>
              <Alert severity="warning" sx={{ mb: 2 }}>
                Deleting this profile can remove identities that were materialized from it, plus dependent
                correlation and access data. Review the tree below before confirming.
              </Alert>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50', maxHeight: 360, overflow: 'auto' }}>
                {deleteDialog.impact.tree.map((root) => (
                  <ImpactTreeNode key={root.id} node={root} depth={0} />
                ))}
              </Paper>
              {(deleteDialog.impact.identities?.total || 0) > 0 ? (
                <FormControlLabel
                  sx={{ mt: 2, alignItems: 'flex-start' }}
                  control={
                    <Checkbox
                      checked={deleteDialog.confirmed}
                      onChange={(e) => setDeleteDialog((d) => ({ ...d, confirmed: e.target.checked }))}
                    />
                  }
                  label={
                    <Typography variant="body2">
                      I understand this will permanently delete{' '}
                      <strong>{deleteDialog.impact.identities.total}</strong> linked identities and all dependent
                      account links, correlation-engine results, role assignments, hygiene / intelligence rows, and
                      related records shown above.
                    </Typography>
                  }
                />
              ) : (
                <Alert severity="info" sx={{ mt: 2 }}>
                  No identities are linked to this profile. Only the profile configuration will be removed.
                </Alert>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={closeDeleteDialog} disabled={deleteDialog.deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={
              deleteDialog.loading ||
              !!deleteDialog.error ||
              deleteDialog.deleting ||
              ((deleteDialog.impact?.identities?.total || 0) > 0 && !deleteDialog.confirmed)
            }
            onClick={confirmDeleteProfile}
          >
            {deleteDialog.deleting ? 'Deleting…' : 'Delete profile'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
