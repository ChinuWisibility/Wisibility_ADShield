import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Chip, Avatar, alpha,
  Toolbar, Divider, Tooltip, IconButton, Skeleton,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useOutletContext } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { activityAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';

const typeColors = {
  login: palette.status.success,
  logout: palette.status.warning,
  authentication: palette.status.success,
  create: palette.status.info,
  update: palette.brand.primary,
  delete: palette.status.error,
};

function resolveTypeColor(type, description = '') {
  const t = String(type || '').toLowerCase();
  if (typeColors[t]) return typeColors[t];
  const desc = String(description || '').toLowerCase();
  if (/logged out|logout|sign.?out/.test(desc)) return typeColors.logout;
  if (/logged in|login|sign.?in/.test(desc)) return typeColors.login;
  if (/create|created/.test(desc)) return typeColors.create;
  if (/update|updated|changed|reset/.test(desc)) return typeColors.update;
  if (/delete|deleted|removed/.test(desc)) return typeColors.delete;
  return palette.text.secondary;
}

function formatEntity(row) {
  if (row.entityType) {
    const id = row.entityId || row.metadata?.email || '';
    return id ? `${row.entityType}/${id}` : row.entityType;
  }
  if (row.metadata?.email) return `User/${row.metadata.email}`;
  const uid = row.userId?._id || (typeof row.userId === 'string' ? row.userId : '');
  if (uid) return `User/${uid}`;
  return '—';
}

function ToolbarMetric({ label, value, loading }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 72, mr: 2.5 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 600,
          letterSpacing: '0.04em',
          lineHeight: 1.2,
          textTransform: 'uppercase',
          fontSize: '0.65rem',
        }}
      >
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, color: palette.text.primary }}>
        {loading ? <Skeleton width={48} /> : value}
      </Typography>
    </Box>
  );
}

export default function ActivityLog() {
  const { enqueueSnackbar } = useSnackbar();
  const { embeddedInAuditHub = false } = useOutletContext() || {};
  const [activities, setActivities] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ type: '', userId: '', startDate: '', endDate: '' });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page: page + 1, limit: rowsPerPage };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await activityAPI.getFeed(params);
      setActivities(res.data.data.items);
      setTotal(res.data.data.total);
    } catch { enqueueSnackbar('Failed to load activities', { variant: 'error' }); }
    finally { setLoading(false); }
  }, [page, rowsPerPage, filters, enqueueSnackbar]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  const applyFilters = () => {
    setPage(0);
    if (page === 0) fetchActivities();
  };

  const clearFilters = () => {
    setFilters({ type: '', userId: '', startDate: '', endDate: '' });
    setPage(0);
  };

  const columns = [
    {
      field: 'createdAt', headerName: 'Timestamp', width: 170,
      renderCell: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      field: 'type', headerName: 'Type', width: 140,
      renderCell: (row) => {
        const color = resolveTypeColor(row.type, row.description);
        return (
          <Chip
            label={row.type || '—'}
            size="small"
            sx={{
              bgcolor: alpha(color, 0.12),
              color,
              fontWeight: 600,
              fontSize: '0.7rem',
              borderRadius: 1,
            }}
          />
        );
      },
    },
    {
      field: 'user', headerName: 'User', width: 200,
      renderCell: (row) => {
        const u = row.userId;
        if (!u || typeof u === 'string') return u || '—';
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar
              sx={{
                width: 24,
                height: 24,
                fontSize: '0.65rem',
                bgcolor: alpha(palette.brand.primary, 0.2),
                color: palette.brand.primary,
              }}
            >
              {(u.firstName?.[0] || '') + (u.lastName?.[0] || '')}
            </Avatar>
            <Typography variant="body2">{u.firstName} {u.lastName}</Typography>
          </Box>
        );
      },
    },
    { field: 'description', headerName: 'Description', minWidth: 300 },
    {
      field: 'tenant', headerName: 'Tenant', width: 170,
      renderCell: (row) => row.tenantId?.name || row.tenantId?.code || 'Global',
    },
    {
      field: 'entity', headerName: 'Entity', width: 220,
      renderCell: (row) => formatEntity(row),
    },
  ];

  return (
    <Box sx={{ p: embeddedInAuditHub ? 0 : undefined }}>
      {!embeddedInAuditHub ? (
        <Box sx={{ mb: 2 }}>
          <Typography variant="h4">Audit Feed</Typography>
          <Typography variant="body2" color="text.secondary">
            {BRANDING.name} {BRANDING.product} &mdash; User activity event stream for behaviour analytics
          </Typography>
        </Box>
      ) : null}

      <Paper
        elevation={0}
        sx={{
          borderRadius: embeddedInAuditHub ? 0 : 2,
          overflow: 'hidden',
          border: embeddedInAuditHub ? 'none' : `1px solid ${palette.border.default}`,
        }}
      >
        <Toolbar
          sx={{
            px: 2,
            gap: 1.5,
            borderBottom: `1px solid ${palette.border.default}`,
            flexWrap: 'wrap',
            alignItems: 'center',
            minHeight: 'auto !important',
            py: 1.5,
            bgcolor: 'grey.50',
          }}
        >
          <ToolbarMetric label="Events" value={total.toLocaleString()} loading={loading && total === 0} />

          <Divider
            orientation="vertical"
            flexItem
            sx={{ display: { xs: 'none', md: 'block' }, mx: 0.5 }}
          />

          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 1,
              alignItems: 'center',
              flex: 1,
              minWidth: 0,
            }}
          >
            <TextField
              size="small"
              label="Type"
              placeholder="login, create…"
              value={filters.type}
              onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
              sx={{ width: { xs: '100%', sm: 160 } }}
            />
            <TextField
              size="small"
              label="Start"
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              label="End"
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: 150 }}
            />
            <Button size="small" variant="contained" onClick={applyFilters}>Apply</Button>
            <Button size="small" variant="text" onClick={clearFilters}>Clear</Button>
          </Box>

          <Tooltip title="Refresh">
            <IconButton size="small" onClick={fetchActivities} sx={{ ml: 'auto' }}>
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>

        <Box sx={{ px: 1.5, pt: 1.5, pb: 1.5 }}>
          <DataTable
            columns={columns}
            rows={activities}
            loading={loading}
            onRefresh={null}
            emptyMessage="No activity recorded"
            searchable={false}
            serverPagination
            totalCount={total}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={(p) => setPage(p)}
            onRowsPerPageChange={(n) => {
              setRowsPerPage(n);
              setPage(0);
            }}
          />
        </Box>
      </Paper>
    </Box>
  );
}
