import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, CircularProgress, Box, Typography, Chip, TablePagination,
} from '@mui/material';
import { applicationAPI } from '../../services/api';
import { getStickyTableContainerSx } from '../../components/DataTable';
import { palette } from '../../theme/palette';

function formatDate(d) {
  if (!d) return '\u2014';
  try {
    return new Date(d).toLocaleString();
  } catch {
    return '\u2014';
  }
}

function statusColor(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'COMPLETED') return palette.status.success;
  if (s === 'FAILED') return palette.status.error;
  return palette.status.warning;
}

export default function ReconciliationHistoryTable({ applicationId, onSelectRun }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!applicationId) return;
    setLoading(true);
    try {
      const res = await applicationAPI.getReconciliationRuns(applicationId, {
        page: page + 1,
        limit: rowsPerPage,
      });
      setRows(res.data?.data || []);
      setTotal(res.data?.total ?? 0);
    } catch (e) {
      console.error(e);
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [applicationId, page, rowsPerPage]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
        Reconciliation history
      </Typography>
      <Typography variant="body2" sx={{ color: palette.text.secondary, mb: 2 }}>
        Each row is one reconciliation run. Click a row to filter delta changes for that run.
      </Typography>

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
                  <TableCell>Recon date</TableCell>
                  <TableCell align="right">Total users</TableCell>
                  <TableCell align="right">New</TableCell>
                  <TableCell align="right">Updated</TableCell>
                  <TableCell align="right">Removed</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      No reconciliation runs yet. Upload a CSV or sync a connector to create the first run.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.runId}
                      hover
                      sx={{ cursor: onSelectRun ? 'pointer' : 'default' }}
                      onClick={() => onSelectRun?.(row.runId)}
                    >
                      <TableCell>{formatDate(row.reconciliationDate || row.completedAt)}</TableCell>
                      <TableCell align="right">{row.totalUsers ?? 0}</TableCell>
                      <TableCell align="right">{row.newUsers ?? 0}</TableCell>
                      <TableCell align="right">{row.updatedUsers ?? 0}</TableCell>
                      <TableCell align="right">{row.removedUsers ?? 0}</TableCell>
                      <TableCell>{row.source || row.uploadedFileName || '\u2014'}</TableCell>
                      <TableCell>
                        <Chip
                          label={row.status || 'UNKNOWN'}
                          size="small"
                          sx={{
                            fontWeight: 600,
                            color: statusColor(row.status),
                          }}
                        />
                      </TableCell>
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
