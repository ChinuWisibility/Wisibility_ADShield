import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, CircularProgress, Box, Typography, Chip, TablePagination,
  TextField, MenuItem, Stack,
} from '@mui/material';
import { applicationAPI } from '../../services/api';
import { getStickyTableContainerSx } from '../../components/DataTable';
import { palette } from '../../theme/palette';

const CHANGE_TYPES = ['', 'NEW_USER', 'UPDATED', 'REMOVED_USER'];

function formatDate(d) {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return '\u2014';
  }
}

function changeTypeColor(type) {
  const t = String(type || '').toUpperCase();
  if (t === 'NEW_USER') return palette.status.success;
  if (t === 'REMOVED_USER') return palette.status.error;
  if (t === 'UPDATED') return palette.status.info;
  return palette.text.secondary;
}

function formatVal(v) {
  if (v == null || v === '') return '\u2014';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export default function DeltaChangesTable({ applicationId, filterRunId = '' }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [loading, setLoading] = useState(true);
  const [runId, setRunId] = useState(filterRunId || '');
  const [changeType, setChangeType] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setRunId(filterRunId || '');
    setPage(0);
  }, [filterRunId]);

  /** Default to the latest reconciliation run so historical NEW_USER rows from the first baseline are not mixed in. */
  useEffect(() => {
    if (!applicationId || filterRunId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await applicationAPI.getReconciliationRuns(applicationId, {
          page: 1,
          limit: 1,
          status: 'COMPLETED',
        });
        const latest = res.data?.data?.[0];
        if (!cancelled && latest?.runId) {
          setRunId(latest.runId);
          setPage(0);
        }
      } catch {
        /* keep unfiltered */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, filterRunId]);

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const params = {
        page: page + 1,
        limit: rowsPerPage,
        flatten: 'true',
      };
      if (runId) params.runId = runId;
      if (changeType) params.changeType = changeType;
      if (search.trim()) params.search = search.trim();

      const res = await applicationAPI.getReconciliationDeltas(applicationId, params);
      const data = res.data?.data || [];
      setRows(Array.isArray(data) ? data : []);
      setTotal(res.data?.total ?? data.length);
    } catch (e) {
      console.error(e);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [applicationId, page, rowsPerPage, runId, changeType, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
        Delta changes
      </Typography>
      <Typography variant="body2" sx={{ color: palette.text.secondary, mb: 2 }}>
        Differences for one reconciliation run vs the immediate previous run (or vs live accounts on the first
        run). By default the latest run is selected — clear Run ID to browse all runs.
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        <TextField
          size="small"
          label="Run ID"
          value={runId}
          onChange={(e) => {
            setRunId(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 200 }}
        />
        <TextField
          select
          size="small"
          label="Change type"
          value={changeType}
          onChange={(e) => {
            setChangeType(e.target.value);
            setPage(0);
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {CHANGE_TYPES.filter(Boolean).map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          sx={{ flex: 1, minWidth: 180 }}
        />
      </Stack>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress size={32} />
        </Box>
      ) : (
        <>
          <TableContainer component={Paper} variant="outlined" sx={getStickyTableContainerSx()}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Identity</TableCell>
                  <TableCell>Change type</TableCell>
                  <TableCell>Attribute</TableCell>
                  <TableCell>Old value</TableCell>
                  <TableCell>New value</TableCell>
                  <TableCell>Recon date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      No delta changes found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, idx) => (
                    <TableRow key={`${row.runId}-${row.identityKey}-${row.attribute}-${idx}`} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                        {row.identityKey}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={row.changeType}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            color: changeTypeColor(row.changeType),
                            bgcolor: `${changeTypeColor(row.changeType)}18`,
                          }}
                        />
                      </TableCell>
                      <TableCell>{row.attribute || '\u2014'}</TableCell>
                      <TableCell sx={{ maxWidth: 220, wordBreak: 'break-word' }}>
                        {formatVal(row.oldValue)}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220, wordBreak: 'break-word' }}>
                        {formatVal(row.newValue)}
                      </TableCell>
                      <TableCell>{formatDate(row.reconciliationDate)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            count={total}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </>
      )}
    </Box>
  );
}
