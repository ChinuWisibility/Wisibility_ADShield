import { useState, useEffect } from 'react';
import {
  Box, Typography, IconButton, Tooltip,
} from '@mui/material';
import { Delete, Devices, Computer } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { sessionAPI, adminAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';
import CatalogCurvedTabs from '../identities/catalog/CatalogCurvedTabs';
import { CATALOG } from '../identities/catalog/catalogTheme';

const SESSION_TABS = [
  { id: 'mine', label: 'My Sessions', icon: <Devices sx={{ fontSize: 18 }} /> },
  { id: 'all', label: 'All Sessions (Admin)', icon: <Computer sx={{ fontSize: 18 }} /> },
];

function parseUA(ua) {
  if (!ua) return 'Unknown';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Edge')) return 'Edge';
  return 'Other';
}

export default function SessionsManagement() {
  const { enqueueSnackbar } = useSnackbar();
  const [tab, setTab] = useState(0);
  const [mySessions, setMySessions] = useState([]);
  const [allSessions, setAllSessions] = useState([]);
  const [allTotal, setAllTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchMySessions = async () => {
    setLoading(true);
    try {
      const res = await sessionAPI.listMySessions();
      setMySessions(res.data.data);
    } catch { enqueueSnackbar('Failed to load sessions', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  const fetchAllSessions = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.listAllSessions({ page: 1, limit: 50 });
      setAllSessions(res.data.data.items);
      setAllTotal(res.data.data.total);
    } catch { enqueueSnackbar('Failed to load sessions', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (tab === 0) fetchMySessions();
    else fetchAllSessions();
  }, [tab]);

  const handleRevokeSession = async (id) => {
    try {
      await sessionAPI.revokeSession(id);
      enqueueSnackbar('Session revoked', { variant: 'success' });
      fetchMySessions();
    } catch { enqueueSnackbar('Failed to revoke session', { variant: 'error' }); }
  };

  const myColumns = [
    {
      field: 'ipAddress', headerName: 'IP Address', width: 150,
      renderCell: (row) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Computer fontSize="small" sx={{ color: palette.text.secondary }} />
          {row.ipAddress || '—'}
        </Box>
      ),
    },
    {
      field: 'userAgent', headerName: 'Browser', width: 120,
      renderCell: (row) => parseUA(row.userAgent),
    },
    {
      field: 'createdAt', headerName: 'Created', width: 170,
      renderCell: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      field: 'expiresAt', headerName: 'Expires', width: 170,
      renderCell: (row) => row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '—',
    },
    {
      field: 'actions', headerName: '', width: 80, sortable: false,
      renderCell: (row) => (
        <Tooltip title="Revoke">
          <IconButton size="small" onClick={() => handleRevokeSession(row._id)} sx={{ color: palette.status.error }}>
            <Delete fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ];

  const allColumns = [
    {
      field: 'user', headerName: 'User', width: 200,
      renderCell: (row) => {
        const u = row.userId;
        if (!u || typeof u === 'string') return u || '—';
        return (
          <Box>
            <Typography variant="body2" fontWeight={600}>{u.firstName} {u.lastName}</Typography>
            <Typography variant="caption" color="text.secondary">{u.email}</Typography>
          </Box>
        );
      },
    },
    { field: 'ipAddress', headerName: 'IP', width: 140 },
    { field: 'userAgent', headerName: 'Browser', width: 120, renderCell: (row) => parseUA(row.userAgent) },
    { field: 'createdAt', headerName: 'Created', width: 170, renderCell: (row) => new Date(row.createdAt).toLocaleString() },
    { field: 'expiresAt', headerName: 'Expires', width: 170, renderCell: (row) => row.expiresAt ? new Date(row.expiresAt).toLocaleString() : '—' },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4">Sessions</Typography>
          <Typography variant="body2" color="text.secondary">{BRANDING.name} {BRANDING.product} &mdash; Manage active platform sessions</Typography>
        </Box>
      </Box>

      <CatalogCurvedTabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        tabs={SESSION_TABS}
      />

      <Box
        sx={{
          bgcolor: CATALOG.surface,
          border: `1px solid ${CATALOG.border}`,
          borderRadius: '0 0 12px 12px',
          mt: '-1px',
          position: 'relative',
          zIndex: 1,
          px: { xs: 1.5, md: 2 },
          pt: 2,
          pb: 2,
        }}
      >
        {tab === 0 ? (
          <DataTable columns={myColumns} rows={mySessions} loading={loading}
            onRefresh={fetchMySessions} emptyMessage="No active sessions" />
        ) : (
          <DataTable columns={allColumns} rows={allSessions} loading={loading}
            onRefresh={fetchAllSessions} emptyMessage="No active sessions" />
        )}
      </Box>
    </Box>
  );
}
