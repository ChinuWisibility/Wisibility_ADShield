import { useState, useEffect } from 'react';
import {
  Box, Grid, Typography, Button, Tabs, Tab, Chip, CircularProgress, alpha,
} from '@mui/material';
import {
  VpnKey, Warning, Shield, Apps, Add,
} from '@mui/icons-material';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { palette } from '../../theme/palette';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import RiskBadge from '../../components/RiskBadge';
import api from '../../services/api';

const riskTabs = ['all', 'critical', 'high', 'medium', 'low'];

export default function EntitlementsList() {
  const [stats, setStats] = useState(null);
  const [entitlements, setEntitlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        api.get('/entitlements/stats'),
        api.get('/entitlements', { params: { limit: 50 } }),
      ]);
      setStats(statsRes.data);
      setEntitlements(listRes.data?.data || listRes.data || []);
    } catch (err) {
      console.error('Failed to fetch entitlements:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filteredEntitlements = activeTab === 0
    ? entitlements
    : entitlements.filter((e) => e.riskLevel?.toLowerCase() === riskTabs[activeTab]);

  const columns = [
    { field: 'name', headerName: 'Name', minWidth: 180 },
    { field: 'application', headerName: 'Application', minWidth: 140 },
    {
      field: 'type', headerName: 'Type', minWidth: 110,
      renderCell: (row) => (
        <Chip label={row.type || '—'} size="small" sx={{ borderRadius: 1, fontSize: '0.7rem', fontWeight: 600 }} />
      ),
    },
    {
      field: 'riskLevel', headerName: 'Risk Level', minWidth: 110,
      renderCell: (row) => row.riskLevel ? <RiskBadge level={row.riskLevel} /> : '—',
    },
    { field: 'owner', headerName: 'Owner', minWidth: 140 },
    { field: 'usersCount', headerName: 'Users', minWidth: 80 },
    {
      field: 'privileged', headerName: 'Privileged', minWidth: 100,
      renderCell: (row) => row.privileged
        ? <Shield sx={{ fontSize: 18, color: palette.status.warning }} />
        : <Typography variant="caption" color="text.secondary">No</Typography>,
    },
    { field: 'classification', headerName: 'Classification', minWidth: 130 },
  ];

  const byAppData = stats?.byApplication || [];

  if (loading && !entitlements.length) {
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
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Entitlements Catalog</Typography>
          <Typography variant="body2" color="text.secondary">Manage and review all entitlements across applications</Typography>
        </Box>
        <Button variant="contained" startIcon={<Add />}>Add Entitlement</Button>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="TOTAL ENTITLEMENTS" value={stats?.total ?? '—'} icon={<VpnKey />} color={palette.brand.primary} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="HIGH RISK" value={stats?.highRisk ?? '—'} icon={<Warning />} color={palette.risk.high} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="PRIVILEGED" value={stats?.privileged ?? '—'} icon={<Shield />} color={palette.status.warning} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {byAppData.length > 0 ? (
            <Box sx={{ bgcolor: palette.bg.secondary, borderRadius: 2, p: 2, height: '100%' }}>
              <Typography variant="subtitle2" sx={{ color: palette.text.secondary, mb: 1 }}>BY APPLICATION</Typography>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={byAppData} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 10, fill: palette.text.secondary }} />
                  <Tooltip contentStyle={{ backgroundColor: palette.bg.elevated, border: `1px solid ${palette.border.default}`, borderRadius: 8 }} />
                  <Bar dataKey="count" fill={palette.brand.primary} radius={[0, 4, 4, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : (
            <StatCard title="BY APPLICATION" value={stats?.applicationCount ?? '—'} icon={<Apps />} color={palette.brand.secondary} />
          )}
        </Grid>
      </Grid>

      {/* Filter Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'capitalize', minHeight: 40 } }}
      >
        {riskTabs.map((tab) => (
          <Tab key={tab} label={tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)} />
        ))}
      </Tabs>

      {/* Data Table */}
      <DataTable
        columns={columns}
        rows={filteredEntitlements}
        loading={loading}
        onRefresh={fetchData}
        defaultSort="name"
        emptyMessage="No entitlements found"
      />
    </Box>
  );
}
