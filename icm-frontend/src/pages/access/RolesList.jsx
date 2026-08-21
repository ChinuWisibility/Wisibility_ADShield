import { useState, useEffect } from 'react';
import {
  Box, Grid, Typography, Button, Tabs, Tab, Chip, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, alpha,
} from '@mui/material';
import {
  GroupWork, CheckCircle, Warning, Add,
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { palette } from '../../theme/palette';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import RiskBadge from '../../components/RiskBadge';
import StatusChip from '../../components/StatusChip';
import api from '../../services/api';

const roleTypes = ['it', 'business', 'birthright', 'composite'];

export default function RolesList() {
  const [stats, setStats] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '', displayName: '', description: '', type: 'it', owner: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        api.get('/roles/stats'),
        api.get('/roles', { params: { limit: 50 } }),
      ]);
      setStats(statsRes.data);
      setRoles(listRes.data?.data || listRes.data || []);
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      await api.post('/roles', formData);
      setCreateOpen(false);
      setFormData({ name: '', displayName: '', description: '', type: 'it', owner: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to create role:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const byTypeData = stats?.byType || [];
  const typeColors = [palette.chart[0], palette.chart[1], palette.chart[2], palette.chart[3]];

  const columns = [
    { field: 'name', headerName: 'Name', minWidth: 180 },
    {
      field: 'type', headerName: 'Type', minWidth: 120,
      renderCell: (row) => (
        <Chip label={row.type || '—'} size="small" sx={{ borderRadius: 1, fontSize: '0.7rem', fontWeight: 600, textTransform: 'capitalize' }} />
      ),
    },
    {
      field: 'status', headerName: 'Status', minWidth: 100,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'riskLevel', headerName: 'Risk Level', minWidth: 110,
      renderCell: (row) => row.riskLevel ? <RiskBadge level={row.riskLevel} /> : '—',
    },
    { field: 'members', headerName: 'Members', minWidth: 90 },
    { field: 'entitlements', headerName: 'Entitlements', minWidth: 110 },
    { field: 'owner', headerName: 'Owner', minWidth: 140 },
    {
      field: 'sodConflicts', headerName: 'SoD Conflicts', minWidth: 120,
      renderCell: (row) => {
        const count = row.sodConflicts ?? 0;
        return (
          <Typography
            variant="body2"
            sx={{
              fontWeight: count > 0 ? 700 : 400,
              color: count > 0 ? palette.status.warning : palette.text.secondary,
            }}
          >
            {count}
            {count > 0 && <Warning sx={{ fontSize: 14, ml: 0.5, verticalAlign: 'text-bottom', color: palette.status.warning }} />}
          </Typography>
        );
      },
    },
  ];

  if (loading && !roles.length) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Role Catalog</Typography>
          <Typography variant="body2" color="text.secondary">Define and manage organizational roles</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>Create Role</Button>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="TOTAL ROLES" value={stats?.total ?? '—'} icon={<GroupWork />} color={palette.brand.primary} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="ACTIVE" value={stats?.active ?? '—'} icon={<CheckCircle />} color={palette.status.success} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {byTypeData.length > 0 ? (
            <Box sx={{ bgcolor: palette.bg.secondary, borderRadius: 2, p: 2, height: '100%' }}>
              <Typography variant="subtitle2" sx={{ color: palette.text.secondary, mb: 0.5 }}>BY TYPE</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ResponsiveContainer width={70} height={70}>
                  <PieChart>
                    <Pie data={byTypeData} cx="50%" cy="50%" innerRadius={18} outerRadius={32} dataKey="count" paddingAngle={3}>
                      {byTypeData.map((_, i) => <Cell key={i} fill={typeColors[i % typeColors.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: palette.bg.elevated, border: `1px solid ${palette.border.default}`, borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                  {byTypeData.map((item, i) => (
                    <Box key={item.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: typeColors[i % typeColors.length] }} />
                      <Typography variant="caption" color="text.secondary">{item.name} ({item.count})</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          ) : (
            <StatCard title="BY TYPE" value={stats?.typeCount ?? '—'} icon={<GroupWork />} color={palette.brand.secondary} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="SOD CONFLICTS" value={stats?.sodConflicts ?? '—'} icon={<Warning />} color={palette.status.warning} />
        </Grid>
      </Grid>

      {/* Data Table */}
      <DataTable
        columns={columns}
        rows={roles}
        loading={loading}
        onRefresh={fetchData}
        defaultSort="name"
        emptyMessage="No roles found"
      />

      {/* Create Role Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Create Role</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <TextField
            label="Name" fullWidth size="small" required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <TextField
            label="Display Name" fullWidth size="small"
            value={formData.displayName}
            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
          />
          <TextField
            label="Description" fullWidth size="small" multiline rows={3}
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <TextField
            label="Type" fullWidth size="small" select required
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          >
            {roleTypes.map((t) => (
              <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Owner" fullWidth size="small"
            value={formData.owner}
            onChange={(e) => setFormData({ ...formData, owner: e.target.value })}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={!formData.name || submitting}>
            {submitting ? <CircularProgress size={20} /> : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
