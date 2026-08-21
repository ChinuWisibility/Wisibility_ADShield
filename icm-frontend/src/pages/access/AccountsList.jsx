import { useState, useEffect } from 'react';
import {
  Box, Grid, Typography, Tabs, Tab, Chip, CircularProgress,
} from '@mui/material';
import {
  AccountCircle, PersonOff, Shield, CheckCircle,
} from '@mui/icons-material';
import { palette } from '../../theme/palette';
import DataTable from '../../components/DataTable';
import StatCard from '../../components/StatCard';
import RiskBadge from '../../components/RiskBadge';
import StatusChip from '../../components/StatusChip';
import api from '../../services/api';

const filterTabs = ['all', 'active', 'orphan', 'privileged', 'disabled'];

export default function AccountsList() {
  const [stats, setStats] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        api.get('/accounts/stats'),
        api.get('/accounts', { params: { limit: 50 } }),
      ]);
      setStats(statsRes.data);
      setAccounts(listRes.data?.data || listRes.data || []);
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const filteredAccounts = (() => {
    const tab = filterTabs[activeTab];
    if (tab === 'all') return accounts;
    if (tab === 'active') return accounts.filter((a) => a.status?.toLowerCase() === 'active');
    if (tab === 'orphan') return accounts.filter((a) => a.isOrphan);
    if (tab === 'privileged') return accounts.filter((a) => a.privileged);
    if (tab === 'disabled') return accounts.filter((a) => a.status?.toLowerCase() === 'disabled');
    return accounts;
  })();

  const columns = [
    { field: 'nativeIdentity', headerName: 'Native Identity', minWidth: 160 },
    { field: 'displayName', headerName: 'Display Name', minWidth: 160 },
    { field: 'application', headerName: 'Application', minWidth: 140 },
    {
      field: 'identity', headerName: 'Identity', minWidth: 150,
      renderCell: (row) => row.identity ? (
        <Typography variant="body2" sx={{ color: palette.text.link, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
          {row.identity}
        </Typography>
      ) : <Typography variant="caption" color="text.secondary">Unlinked</Typography>,
    },
    {
      field: 'status', headerName: 'Status', minWidth: 100,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    { field: 'type', headerName: 'Type', minWidth: 100 },
    {
      field: 'privileged', headerName: 'Privileged', minWidth: 100,
      renderCell: (row) => row.privileged
        ? <Shield sx={{ fontSize: 18, color: palette.status.warning }} />
        : <Typography variant="caption" color="text.secondary">No</Typography>,
    },
    {
      field: 'lastLogin', headerName: 'Last Login', minWidth: 140,
      renderCell: (row) => row.lastLogin
        ? new Date(row.lastLogin).toLocaleDateString()
        : '—',
    },
    {
      field: 'isOrphan', headerName: 'Orphan', minWidth: 90,
      renderCell: (row) => row.isOrphan
        ? <Chip label="Orphan" size="small" sx={{ bgcolor: `${palette.status.error}1A`, color: palette.status.error, fontWeight: 700, fontSize: '0.7rem', borderRadius: 1, height: 22 }} />
        : '—',
    },
  ];

  if (loading && !accounts.length) {
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
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Accounts</Typography>
          <Typography variant="body2" color="text.secondary">View and manage all application accounts</Typography>
        </Box>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="TOTAL ACCOUNTS" value={stats?.total ?? '—'} icon={<AccountCircle />} color={palette.brand.primary} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="ORPHAN ACCOUNTS" value={stats?.orphan ?? '—'} icon={<PersonOff />} color={palette.status.error} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="PRIVILEGED" value={stats?.privileged ?? '—'} icon={<Shield />} color={palette.status.warning} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard title="ACTIVE" value={stats?.active ?? '—'} icon={<CheckCircle />} color={palette.status.success} />
        </Grid>
      </Grid>

      {/* Filter Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'capitalize', minHeight: 40 } }}
      >
        {filterTabs.map((tab) => (
          <Tab key={tab} label={tab.charAt(0).toUpperCase() + tab.slice(1)} />
        ))}
      </Tabs>

      {/* Data Table */}
      <DataTable
        columns={columns}
        rows={filteredAccounts}
        loading={loading}
        onRefresh={fetchData}
        defaultSort="nativeIdentity"
        emptyMessage="No accounts found"
      />
    </Box>
  );
}
