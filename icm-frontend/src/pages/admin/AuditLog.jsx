import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Grid, Chip, Toolbar, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, InputLabel, Select, MenuItem, Tooltip, Skeleton,
} from '@mui/material';
import { Download, Refresh, Visibility, BarChart } from '@mui/icons-material';
import { keyframes } from '@mui/system';
import { useOutletContext } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import DataTable from '../../components/DataTable';
import { auditAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';
import { useAuth } from '../../contexts/AuthContext';
import { formatAuditAction } from '../../utils/auditActionLabel';

const methodColors = { GET: 'info', POST: 'success', PUT: 'warning', PATCH: 'warning', DELETE: 'error' };
const EMPTY_FILTERS = { action: '', userId: '', startDate: '', endDate: '', method: '' };
const refreshSpin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`;

/** Roles that may export audit logs (must have AUDIT_EXPORT on backend). */
const canExportAudit = (role) => role === 'admin' || role === 'superAdmin';

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

export default function AuditLog() {
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();
  const { embeddedInAuditHub = false } = useOutletContext() || {};
  const allowExport = canExportAudit(user?.role);
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Draft values in the filter inputs (not applied until Apply / Clear). */
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  /** Filters actually sent to the API. */
  const [appliedFilters, setAppliedFilters] = useState(EMPTY_FILTERS);
  const [stats, setStats] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [detailDialog, setDetailDialog] = useState({ open: false, entry: null });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [sortField, setSortField] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  /** Bumped on Refresh so the list reloads even when filters/page are unchanged. */
  const [refreshKey, setRefreshKey] = useState(0);
  const fetchSeqRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        sortField,
        sortDir,
        _t: Date.now(),
      };
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) params[k] = v; });
      const res = await auditAPI.list(params);
      if (seq !== fetchSeqRef.current) return;
      setLogs(res.data?.data?.items || []);
      setTotal(res.data?.data?.total || 0);
    } catch {
      if (seq !== fetchSeqRef.current) return;
      enqueueSnackbar('Failed to load audit logs', { variant: 'error' });
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [page, rowsPerPage, sortField, sortDir, appliedFilters, refreshKey, enqueueSnackbar]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const fetchStats = async () => {
    try {
      const res = await auditAPI.getStats();
      setStats(res.data.data);
      setShowStats(true);
    } catch { enqueueSnackbar('Failed to load stats', { variant: 'error' }); }
  };

  const handleExport = async (format) => {
    if (!allowExport) {
      enqueueSnackbar('Insufficient permissions — export is not available for your role.', {
        variant: 'error',
      });
      return;
    }
    try {
      const payload = { format };
      Object.entries(appliedFilters).forEach(([k, v]) => { if (v) payload[k] = v; });
      const res = await auditAPI.exportLog(payload);
      if (format === 'csv') {
        const blob = new Blob([res.data], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'audit-export.csv'; a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(res.data.data.content, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'audit-export.json'; a.click();
        URL.revokeObjectURL(url);
      }
      enqueueSnackbar('Export downloaded', { variant: 'success' });
    } catch (e) {
      const status = e?.response?.status;
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        (status === 403 ? 'Insufficient permissions' : 'Export failed');
      enqueueSnackbar(msg, { variant: 'error' });
    }
  };

  const handleViewDetail = async (id) => {
    try {
      const res = await auditAPI.getById(id);
      setDetailDialog({ open: true, entry: res.data.data });
    } catch { enqueueSnackbar('Failed to load details', { variant: 'error' }); }
  };

  const applyFilters = () => {
    setAppliedFilters({ ...filters });
    setPage(0);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters({ ...EMPTY_FILTERS });
    setPage(0);
  };

  const handleRefresh = () => {
    setAppliedFilters({ ...filters });
    setPage(0);
    setRefreshKey((k) => k + 1);
  };

  const columns = [
    {
      field: 'createdAt', headerName: 'Timestamp', width: 170,
      renderCell: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      field: 'method',
      headerName: 'Method',
      width: 108,
      minWidth: 108,
      renderCell: (row) => (
        <Chip
          label={row.method || '—'}
          size="small"
          color={methodColors[row.method] || 'default'}
          sx={{
            fontWeight: 700,
            fontSize: '0.75rem',
            letterSpacing: '0.02em',
            height: 28,
            px: 1.25,
            borderRadius: 1,
            '& .MuiChip-label': { px: 1.25 },
          }}
        />
      ),
    },
    { field: 'action', headerName: 'Action', minWidth: 250,
      renderCell: (row) => formatAuditAction(row.action, row.path, row.method),
    },
    { field: 'userEmail', headerName: 'User', width: 200 },
    {
      field: 'tenant', headerName: 'Tenant', width: 170, sortable: false,
      renderCell: (row) => row.tenantId?.name || row.tenantId?.code || 'Global',
    },
    { field: 'statusCode', headerName: 'Status', width: 80 },
    { field: 'ipAddress', headerName: 'IP', width: 130 },
    {
      field: 'actions', headerName: '', width: 60, sortable: false,
      renderCell: (row) => (
        <Button size="small" onClick={() => handleViewDetail(row._id)} sx={{ minWidth: 0, p: 0.5 }}>
          <Visibility fontSize="small" />
        </Button>
      ),
    },
  ];

  const actionButtons = (
    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexShrink: 0 }}>
      <Button size="small" variant="outlined" startIcon={<BarChart />} onClick={fetchStats}>
        Stats
      </Button>
      <Tooltip title={allowExport ? 'Export filtered results as CSV' : 'Insufficient permissions to export'}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download />}
            onClick={() => handleExport('csv')}
            disabled={!allowExport}
          >
            CSV
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={allowExport ? 'Export filtered results as JSON' : 'Insufficient permissions to export'}>
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Download />}
            onClick={() => handleExport('json')}
            disabled={!allowExport}
          >
            JSON
          </Button>
        </span>
      </Tooltip>
    </Box>
  );

  return (
    <Box sx={{ p: embeddedInAuditHub ? 0 : undefined }}>
      {!embeddedInAuditHub ? (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, px: 0.5 }}>
          <Box>
            <Typography variant="h4">Audit Log</Typography>
            <Typography variant="body2" color="text.secondary">
              {BRANDING.name} {BRANDING.product} &mdash; Platform API request and authentication audit trail
            </Typography>
          </Box>
          {actionButtons}
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
          <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <ToolbarMetric label="Events" value={total.toLocaleString()} loading={loading && total === 0} />
            {showStats && stats?.byMethod?.length ? (
              stats.byMethod.slice(0, 4).map((m) => (
                <ToolbarMetric
                  key={m._id || 'unknown'}
                  label={m._id || 'Other'}
                  value={m.count?.toLocaleString()}
                  loading={false}
                />
              ))
            ) : null}
          </Box>

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
              label="Action"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
              sx={{ width: { xs: '100%', sm: 140 } }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="audit-filter-method-label">Method</InputLabel>
              <Select
                labelId="audit-filter-method-label"
                value={filters.method}
                label="Method"
                onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))}
              >
                <MenuItem value="">All</MenuItem>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </Select>
            </FormControl>
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
            {embeddedInAuditHub ? actionButtons : null}
            <Button
              size="small"
              variant="outlined"
              onClick={handleRefresh}
              disabled={loading}
              startIcon={
                <Refresh
                  fontSize="small"
                  sx={loading ? { animation: `${refreshSpin} 0.75s linear infinite` } : undefined}
                />
              }
              aria-label="Refresh audit log"
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                minWidth: 108,
                bgcolor: 'background.paper',
              }}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </Box>
        </Toolbar>

        {showStats && stats && !embeddedInAuditHub ? (
          <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${palette.border.default}`, bgcolor: palette.bg.primary }}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                  Total events
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 700 }}>{stats.total?.toLocaleString()}</Typography>
              </Grid>
              {stats.byMethod?.map((m) => (
                <Grid key={m._id} size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                    {m._id || 'Unknown'}
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>{m.count?.toLocaleString()}</Typography>
                </Grid>
              ))}
            </Grid>
          </Box>
        ) : null}

        <Box sx={{ px: 1.5, pt: 1.5, pb: 1.5 }}>
          <DataTable
            columns={columns}
            rows={logs}
            loading={loading}
            onRefresh={null}
            emptyMessage="No audit entries found"
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
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(field, dir) => {
              setSortField(field);
              setSortDir(dir);
              setPage(0);
            }}
            defaultSort="createdAt"
            defaultSortDir="desc"
          />
        </Box>
      </Paper>

      <Dialog open={detailDialog.open} onClose={() => setDetailDialog({ open: false, entry: null })} maxWidth="md" fullWidth>
        <DialogTitle>Audit Entry Detail</DialogTitle>
        <DialogContent>
          {detailDialog.entry && (
            <Box
              component="pre"
              sx={{
                fontSize: '0.8rem',
                overflow: 'auto',
                maxHeight: 500,
                p: 2,
                bgcolor: palette.bg.primary,
                borderRadius: 1,
                border: `1px solid ${palette.border.default}`,
              }}
            >
              {JSON.stringify(detailDialog.entry, null, 2)}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailDialog({ open: false, entry: null })}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
