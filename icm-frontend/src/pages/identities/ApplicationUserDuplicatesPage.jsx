import React, { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Toolbar,
  Chip,
  TextField,
} from '@mui/material';
import { ContentCopy, Refresh } from '@mui/icons-material';
import { applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

function pickApplicationsList(res) {
  const list = res.data?.data || res.data?.docs || res.data || [];
  const arr = Array.isArray(list) ? list : list.data || [];
  return Array.isArray(arr) ? arr : [];
}

const SNAPSHOT_SKIP_TOP = new Set([
  '_id',
  '__v',
  'rawData',
  'applicationId',
  'createdAt',
  'updatedAt',
]);

/** Flatten one stored snapshot row: CSV `rawData` plus top-level mapped fields (for column union). */
function flattenSnapshotRow(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const raw =
    doc.rawData && typeof doc.rawData === 'object' && !Array.isArray(doc.rawData)
      ? { ...doc.rawData }
      : {};
  const out = { ...raw };
  for (const [k, v] of Object.entries(doc)) {
    if (SNAPSHOT_SKIP_TOP.has(k)) continue;
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) continue;
    if (out[k] === undefined || out[k] === null || String(out[k]).trim() === '') {
      out[k] = v;
    }
  }
  return out;
}

function formatSnapshotCell(val) {
  if (val == null || val === '') return '';
  if (typeof val === 'object' && !Array.isArray(val)) return JSON.stringify(val);
  if (Array.isArray(val)) return JSON.stringify(val);
  return String(val);
}

function buildSnapshotFieldKeys(detail) {
  const keys = new Set();
  const canon = flattenSnapshotRow(detail?.canonicalRow || {});
  Object.keys(canon).forEach((k) => keys.add(k));
  (detail?.rows || []).forEach((row) => {
    Object.keys(flattenSnapshotRow(row)).forEach((k) => keys.add(k));
  });
  const pk = String(detail?.primaryKeyField || '').trim();
  return [...keys].sort((a, b) => {
    if (pk) {
      if (a === pk) return -1;
      if (b === pk) return 1;
    }
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function DuplicateSnapshotComparisonTable({ detail }) {
  const fieldKeys = buildSnapshotFieldKeys(detail);
  const flatCanonical = flattenSnapshotRow(detail.canonicalRow || {});
  const flatDuplicates = (detail.rows || []).map((r) => flattenSnapshotRow(r));

  if (fieldKeys.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No comparable fields in this snapshot.
      </Typography>
    );
  }

  return (
    <TableContainer
      component={Paper}
      variant="outlined"
      sx={{ maxHeight: { xs: 360, sm: 480 }, borderRadius: 1 }}
    >
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 700, minWidth: 140, bgcolor: 'background.paper' }}>
              Field
            </TableCell>
            <TableCell sx={{ fontWeight: 700, minWidth: 160, bgcolor: 'background.paper' }}>
              Canonical (live)
            </TableCell>
            {flatDuplicates.map((_, i) => (
              <TableCell
                key={`dup-h-${i}`}
                sx={{ fontWeight: 700, minWidth: 160, bgcolor: 'background.paper' }}
              >
                {`Duplicate ${i + 1}`}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {fieldKeys.map((field) => {
            const canonStr = formatSnapshotCell(flatCanonical[field]);
            const dupStrs = flatDuplicates.map((d) => formatSnapshotCell(d[field]));
            const differs = dupStrs.some((s) => s !== canonStr);
            return (
              <TableRow
                key={field}
                hover
                sx={(theme) =>
                  differs
                    ? {
                        bgcolor:
                          theme.palette.mode === 'dark'
                            ? 'rgba(255, 180, 80, 0.12)'
                            : 'rgba(255, 152, 0, 0.08)',
                      }
                    : {}
                }
              >
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'top' }}
                >
                  {field}
                </TableCell>
                <TableCell sx={{ verticalAlign: 'top', wordBreak: 'break-word' }}>
                  {canonStr || '—'}
                </TableCell>
                {dupStrs.map((cell, i) => (
                  <TableCell key={`c-${field}-${i}`} sx={{ verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {cell || '—'}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function ApplicationUserDuplicatesPage() {
  const { embeddedInCorrelationSummary = false } = useOutletContext() || {};
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [applications, setApplications] = useState([]);
  const [applicationId, setApplicationId] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');
  const [loadingApps, setLoadingApps] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  const fetchApplications = useCallback(async () => {
    if (!tenantId) {
      setApplications([]);
      setLoadingApps(false);
      return;
    }
    setLoadingApps(true);
    setError('');
    try {
      const res = await applicationAPI.list({ tenantId, limit: 500, page: 1 });
      setApplications(pickApplicationsList(res));
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.message || e.message || 'Failed to load applications.');
      setApplications([]);
    } finally {
      setLoadingApps(false);
    }
  }, [tenantId]);

  const fetchDuplicates = useCallback(async () => {
    if (!applicationId) {
      setRows([]);
      setTotal(0);
      return;
    }
    setLoadingRows(true);
    setError('');
    try {
      const res = await applicationAPI.listUserDuplicates(applicationId, {
        page,
        limit: rowsPerPage,
      });
      const body = res.data || {};
      setRows(Array.isArray(body.data) ? body.data : []);
      setTotal(typeof body.total === 'number' ? body.total : 0);
    } catch (e) {
      console.error(e);
      setError(e.response?.data?.message || e.message || 'Failed to load duplicate groups.');
      setRows([]);
      setTotal(0);
    } finally {
      setLoadingRows(false);
    }
  }, [applicationId, page, rowsPerPage]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  useEffect(() => {
    fetchDuplicates();
  }, [fetchDuplicates]);

  const openDetail = async (groupId) => {
    if (!applicationId || !groupId) return;
    setDetailOpen(true);
    setDetail(null);
    setDetailLoading(true);
    try {
      const res = await applicationAPI.getUserDuplicateGroup(applicationId, groupId);
      setDetail(res.data?.data || null);
    } catch (e) {
      console.error(e);
      setDetail({ _error: e.response?.data?.message || e.message || 'Load failed' });
    } finally {
      setDetailLoading(false);
    }
  };

  const selectedApp = applications.find((a) => String(a._id) === String(applicationId));
  const searchValue = search.trim().toLowerCase();
  const filteredRows = searchValue
    ? rows.filter((r) => {
        const haystack = [r.primaryKeyValue, r.displayName, r.primaryKeyField, r.source]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase());
        return haystack.some((v) => v.includes(searchValue));
      })
    : rows;

  return (
    <Box sx={{ p: embeddedInCorrelationSummary ? 0 : 3 }}>
      {!embeddedInCorrelationSummary ? (
        <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
          Duplicate application accounts
        </Typography>
      ) : null}

      {error ? (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      ) : null}

      <Paper
        elevation={0}
        sx={{
          p: 2,
          mb: 2,
          borderRadius: 2,
          border: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Toolbar disableGutters sx={{ gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 280 }} disabled={loadingApps || !tenantId}>
            <InputLabel id="dup-app-select">Application</InputLabel>
            <Select
              labelId="dup-app-select"
              label="Application"
              value={applicationId}
              onChange={(e) => {
                setApplicationId(e.target.value);
                setPage(0);
              }}
            >
              <MenuItem value="">
                <em>Select an application</em>
              </MenuItem>
              {applications.map((a) => (
                <MenuItem key={a._id} value={String(a._id)}>
                  {a.name || String(a._id)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            label="Search user"
            placeholder="Primary key, field, or source"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            disabled={!applicationId || loadingRows}
            sx={{ minWidth: 260 }}
          />
          <Button
            startIcon={<Refresh />}
            onClick={() => {
              fetchApplications();
              fetchDuplicates();
            }}
            disabled={loadingApps || loadingRows}
          >
            Refresh
          </Button>
          {loadingApps ? <CircularProgress size={22} /> : null}
        </Toolbar>
      </Paper>

      {!tenantId ? (
        <Alert severity="info">Sign in with a tenant context to list applications.</Alert>
      ) : null}

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Primary key (display)</TableCell>
                <TableCell>Display name</TableCell>
                <TableCell>Field</TableCell>
                <TableCell align="right">Extra rows</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Observed</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loadingRows && applicationId ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : null}
              {!loadingRows && applicationId && filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography variant="body2" color="text.secondary">
                      {searchValue
                        ? 'No duplicate groups match this search on the current page.'
                        : 'No duplicate groups for this application (or none since the last full user refresh).'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {!loadingRows
                ? filteredRows.map((r) => (
                    <TableRow key={r.groupId} hover>
                      <TableCell>{r.primaryKeyValue}</TableCell>
                      <TableCell>{r.displayName || '—'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={r.primaryKeyField} variant="outlined" />
                      </TableCell>
                      <TableCell align="right">{r.duplicateCount}</TableCell>
                      <TableCell>{r.source}</TableCell>
                      <TableCell>
                        {r.observedAt ? new Date(r.observedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell align="right">
                        <Button size="small" onClick={() => openDetail(r.groupId)}>
                          View snapshot
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                : null}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={searchValue ? filteredRows.length : total}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50]}
        />
      </Paper>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>
          Duplicate group
          {selectedApp ? ` — ${selectedApp.name}` : ''}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : null}
          {!detailLoading && detail?._error ? (
            <Alert severity="error">{detail._error}</Alert>
          ) : null}
          {!detailLoading && detail && !detail._error ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Primary key:{' '}
                <strong>{detail.primaryKeyValue}</strong>
                {detail.primaryKeyField ? (
                  <>
                    {' '}
                    (<code>{detail.primaryKeyField}</code>)
                  </>
                ) : null}
                {' · '}
                {(detail.rows || []).length} duplicate row(s) stored — highlighted rows differ from canonical.
              </Typography>
              <DuplicateSnapshotComparisonTable detail={detail} />
              <Button
                sx={{ mt: 2 }}
                size="small"
                variant="outlined"
                startIcon={<ContentCopy />}
                onClick={() => {
                  void navigator.clipboard?.writeText(JSON.stringify(detail, null, 2));
                }}
              >
                Copy raw JSON
              </Button>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
