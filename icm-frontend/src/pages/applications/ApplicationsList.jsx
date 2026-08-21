import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Grid, Typography, Button, alpha,
} from '@mui/material';
import {
  Apps, CheckCircle, Warning, CloudUpload, Add, Download,
} from '@mui/icons-material';
import StatCard from '../../components/StatCard';
import DataTable from '../../components/DataTable';
import RiskBadge from '../../components/RiskBadge';
import StatusChip from '../../components/StatusChip';
import { palette } from '../../theme/palette';
import api from '../../services/api';

export default function ApplicationsList() {
  const navigate = useNavigate();
  const [apps, setApps] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, highRisk: 0, recentUploads: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, appsRes] = await Promise.all([
        api.get('/applications/stats'),
        api.get('/applications', { params: { limit: 50 } }),
      ]);
      setStats(statsRes.data);
      setApps(appsRes.data.applications || appsRes.data);
    } catch (err) {
      console.error('Failed to fetch applications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExport = () => {
    const csvContent = [
      ['Name', 'Type', 'Owner', 'Risk Level', 'Status', 'Users', 'Entitlements', 'Last Upload'].join(','),
      ...apps.map((app) =>
        [app.name, app.type, app.owner, app.riskLevel, app.status, app.userCount, app.entitlementCount, app.lastUpload].join(',')
      ),
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'applications_export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      field: 'name',
      headerName: 'Name',
      minWidth: 180,
      renderCell: (row) => (
        <Typography
          variant="body2"
          sx={{
            fontWeight: 600,
            color: palette.text.link,
            cursor: 'pointer',
            '&:hover': { textDecoration: 'underline' },
          }}
          onClick={() => navigate(`/applications/${row._id || row.id}`)}
        >
          {row.name}
        </Typography>
      ),
    },
    { field: 'type', headerName: 'Type', minWidth: 120 },
    { field: 'owner', headerName: 'Owner', minWidth: 150 },
    {
      field: 'riskLevel',
      headerName: 'Risk Level',
      minWidth: 110,
      renderCell: (row) => <RiskBadge level={row.riskLevel} />,
    },
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 100,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    { field: 'userCount', headerName: 'Users', minWidth: 80 },
    { field: 'entitlementCount', headerName: 'Entitlements', minWidth: 120 },
    {
      field: 'lastUpload',
      headerName: 'Last Upload',
      minWidth: 140,
      renderCell: (row) =>
        row.lastUpload ? new Date(row.lastUpload).toLocaleDateString() : '\u2014',
    },
  ];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>Applications</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage onboarded applications and their entitlements
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={() => navigate('/applications/onboard')}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Onboard Application
        </Button>
      </Box>

      {/* Stat Cards */}
      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="TOTAL APPS"
            value={stats.total}
            icon={<Apps />}
            color={palette.brand.primary}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="ACTIVE"
            value={stats.active}
            icon={<CheckCircle />}
            color={palette.status.success}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="HIGH RISK"
            value={stats.highRisk}
            icon={<Warning />}
            color={palette.status.error}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <StatCard
            title="RECENT UPLOADS"
            value={stats.recentUploads}
            icon={<CloudUpload />}
            color={palette.brand.secondary}
          />
        </Grid>
      </Grid>

      {/* Data Table */}
      <DataTable
        title="All Applications"
        columns={columns}
        rows={apps}
        loading={loading}
        onRefresh={fetchData}
        onExport={handleExport}
        defaultSort="name"
        emptyMessage="No applications onboarded yet"
      />
    </Box>
  );
}
