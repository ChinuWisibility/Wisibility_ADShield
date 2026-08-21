import { useState, useEffect } from 'react';
import {
  Box, Grid, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, LinearProgress, Chip, IconButton,
  Tooltip, CircularProgress, alpha,
} from '@mui/material';
import {
  Add, PlayArrow, Campaign, CheckCircle, HourglassTop, TrendingUp,
} from '@mui/icons-material';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import RiskBadge from '../../components/RiskBadge';
import StatusChip from '../../components/StatusChip';
import { palette } from '../../theme/palette';
import api from '../../services/api';

const typeLabels = {
  manager: 'Manager',
  application_owner: 'App Owner',
  entitlement_owner: 'Entitlement Owner',
  role_owner: 'Role Owner',
};

const typeColors = {
  manager: palette.brand.primary,
  application_owner: palette.brand.secondary,
  entitlement_owner: palette.status.warning,
  role_owner: palette.status.info,
};

const defaultForm = {
  name: '', description: '', type: 'manager', priority: 'medium',
  reviewer: '', dueDate: '', reminderFrequency: 'GLOBAL',
  scope: { departments: '', riskLevels: '' },
};

export default function CertificationsList() {
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, avgCompletion: 0 });
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, campaignsRes] = await Promise.all([
        api.get('/certifications/campaigns/stats'),
        api.get('/certifications/campaigns', { params: { limit: 50 } }),
      ]);
      setStats(statsRes.data.data || statsRes.data);
      setCampaigns(campaignsRes.data.data || campaignsRes.data || []);
    } catch (err) {
      console.error('Failed to fetch certifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        scope: {
          departments: form.scope.departments ? form.scope.departments.split(',').map((s) => s.trim()) : [],
          riskLevels: form.scope.riskLevels ? form.scope.riskLevels.split(',').map((s) => s.trim()) : [],
        },
      };
      await api.post('/certifications/campaigns', payload);
      setDialogOpen(false);
      setForm(defaultForm);
      fetchData();
    } catch (err) {
      console.error('Failed to create campaign:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (id) => {
    try {
      await api.post(`/certifications/campaigns/${id}/activate`);
      fetchData();
    } catch (err) {
      console.error('Failed to activate campaign:', err);
    }
  };

  const columns = [
    { field: 'name', headerName: 'Name', minWidth: 180 },
    {
      field: 'type', headerName: 'Type', minWidth: 120,
      renderCell: (row) => {
        const t = row.type || '';
        return (
          <Chip
            label={typeLabels[t] || t}
            size="small"
            sx={{
              backgroundColor: alpha(typeColors[t] || palette.brand.primary, 0.15),
              color: typeColors[t] || palette.brand.primary,
              fontWeight: 600, fontSize: '0.7rem', borderRadius: 1,
            }}
          />
        );
      },
    },
    {
      field: 'status', headerName: 'Status', minWidth: 110,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'priority', headerName: 'Priority', minWidth: 100,
      renderCell: (row) => <RiskBadge level={row.priority} />,
    },
    { field: 'reviewer', headerName: 'Reviewer', minWidth: 150 },
    {
      field: 'progress', headerName: 'Progress', minWidth: 150,
      renderCell: (row) => {
        const pct = row.progress ?? 0;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <LinearProgress
              variant="determinate"
              value={pct}
              sx={{
                flex: 1, height: 6, borderRadius: 3,
                backgroundColor: alpha(palette.brand.primary, 0.15),
                '& .MuiLinearProgress-bar': {
                  borderRadius: 3,
                  backgroundColor: pct >= 80 ? palette.status.success : pct >= 50 ? palette.status.warning : palette.brand.primary,
                },
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 36 }}>{pct}%</Typography>
          </Box>
        );
      },
    },
    {
      field: 'dueDate', headerName: 'Due Date', minWidth: 110,
      renderCell: (row) => row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '\u2014',
    },
    { field: 'totalItems', headerName: 'Items', minWidth: 70 },
    {
      field: 'actions', headerName: 'Actions', sortable: false, minWidth: 80,
      renderCell: (row) =>
        ['pending', 'draft', 'Draft', 'Staged', 'staged'].includes(row.status) ? (
          <Tooltip title="Activate Campaign">
            <IconButton size="small" onClick={() => handleActivate(row._id || row.id)} sx={{ color: palette.status.success }}>
              <PlayArrow fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null,
    },
  ];

  if (loading && campaigns.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Access Certifications</Typography>
          <Typography variant="body2" color="text.secondary">Manage certification campaigns and reviews</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setDialogOpen(true)}>
          Create Campaign
        </Button>
      </Box>

      {/* Stats */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="TOTAL CAMPAIGNS" value={stats.total} icon={<Campaign />} color={palette.brand.primary} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="ACTIVE" value={stats.active} icon={<HourglassTop />} color={palette.status.warning} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="COMPLETED" value={stats.completed} icon={<CheckCircle />} color={palette.status.success} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="AVG COMPLETION" value={`${stats.avgCompletion || 0}%`} icon={<TrendingUp />} color={palette.brand.secondary} />
        </Grid>
      </Grid>

      {/* Table */}
      <DataTable
        title="Campaigns"
        columns={columns}
        rows={campaigns}
        loading={loading}
        onRefresh={fetchData}
        defaultSort="dueDate"
      />

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Certification Campaign</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField label="Campaign Name" fullWidth value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Description" fullWidth multiline rows={3} value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <TextField label="Type" select fullWidth value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <MenuItem value="manager">Manager</MenuItem>
            <MenuItem value="application_owner">Application Owner</MenuItem>
            <MenuItem value="entitlement_owner">Entitlement Owner</MenuItem>
            <MenuItem value="role_owner">Role Owner</MenuItem>
          </TextField>
          <TextField label="Priority" select fullWidth value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <MenuItem value="critical">Critical</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="low">Low</MenuItem>
          </TextField>
          <TextField label="Reviewer" fullWidth value={form.reviewer}
            onChange={(e) => setForm({ ...form, reviewer: e.target.value })} />
          <TextField label="Due Date" type="date" fullWidth InputLabelProps={{ shrink: true }}
            value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <TextField label="Reminder Frequency" select fullWidth value={form.reminderFrequency}
            onChange={(e) => setForm({ ...form, reminderFrequency: e.target.value })}>
            <MenuItem value="GLOBAL">Global (use system default)</MenuItem>
            <MenuItem value="WEEKLY">Weekly</MenuItem>
            <MenuItem value="MONTHLY">Monthly</MenuItem>
            <MenuItem value="TWO_DAYS_BEFORE_END">2 Days Before Due Date</MenuItem>
            <MenuItem value="DISABLED">Disabled (no reminders)</MenuItem>
          </TextField>
          <TextField label="Departments (comma separated)" fullWidth value={form.scope.departments}
            onChange={(e) => setForm({ ...form, scope: { ...form.scope, departments: e.target.value } })} />
          <TextField label="Risk Levels (comma separated)" fullWidth value={form.scope.riskLevels}
            onChange={(e) => setForm({ ...form, scope: { ...form.scope, riskLevels: e.target.value } })} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!form.name || submitting}>
            {submitting ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
