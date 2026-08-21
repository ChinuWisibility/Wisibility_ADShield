import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  FormControl,
  Grid,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  ExpandLess,
  ExpandMore,
  FilterList,
  PersonSearch,
  Search,
  VpnKey,
} from '@mui/icons-material';
import DataTable from '../../../components/DataTable';
import { palette } from '../../../theme/palette';
import { useNavigate } from 'react-router-dom';
import { discoveryAPI } from '../../../services/discoveryService';
import { useAuth } from '../../../contexts/AuthContext';


export default function DiscoveryResults() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [filterType, setFilterType] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  useEffect(() => {
    if (!searchQ.trim()) { setDebouncedQ(''); setPage(0); return; }
    const t = setTimeout(() => { setDebouncedQ(searchQ); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [searchQ]);

  const loadResults = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [resResults, resSummary] = await Promise.all([
        discoveryAPI.getResults({
          page: page + 1,
          limit: rowsPerPage,
          ...(debouncedQ.trim() ? { search: debouncedQ.trim() } : {}),
          ...(filterType ? { entityType: filterType } : {}),
        }),
        discoveryAPI.getResultsSummary(),
      ]);
      const d = resResults.data?.data || {};
      setResults(d.items || []);
      setTotal(d.total ?? 0);
      setSummary(resSummary.data?.data || null);
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load results.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage, debouncedQ, filterType]);

  useEffect(() => { loadResults(); }, [loadResults]);

  const columns = useMemo(() => [
    {
      field: 'entityDisplayName', headerName: 'Entity', minWidth: 220,
      renderCell: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{row.entityDisplayName || '—'}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{row.entityIdentifier || ''}</Typography>
        </Box>
      ),
    },
    {
      field: 'entityType', headerName: 'Type', width: 130,
      renderCell: (row) => (
        <Chip
          size="small"
          icon={row.entityType === 'USER' ? <PersonSearch sx={{ fontSize: 14 }} /> : <VpnKey sx={{ fontSize: 14 }} />}
          label={row.entityType === 'USER' ? 'User' : 'Entitlement'}
          variant="outlined"
          sx={{ fontWeight: 600 }}
        />
      ),
    },
    {
      field: 'policyName', headerName: 'Policy', minWidth: 180,
      renderCell: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap>{row.policyName || '—'}</Typography>
      ),
    },
    {
      field: 'applicationName', headerName: 'Application', minWidth: 160,
      renderCell: (row) => (
        <Typography variant="body2" color="text.secondary" noWrap>{row.applicationName || '—'}</Typography>
      ),
    },

    {
      field: 'matchedFields', headerName: 'Matched', width: 100, sortable: false,
      renderCell: (row) => (
        <Chip size="small" label={`${(row.matchedFields || []).length} field${(row.matchedFields || []).length !== 1 ? 's' : ''}`} variant="outlined" sx={{ fontWeight: 600, fontSize: '0.7rem' }} />
      ),
    },
    {
      field: 'detectedAt', headerName: 'Detected', width: 160,
      renderCell: (row) => (
        <Typography variant="caption" color="text.secondary" noWrap>
          {row.detectedAt ? new Date(row.detectedAt).toLocaleString() : '—'}
        </Typography>
      ),
    },
    {
      field: '_expand', headerName: '', width: 50, sortable: false,
      renderCell: (row) => (
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setExpandedRow(expandedRow === row._id ? null : row._id); }}>
          {expandedRow === row._id ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </IconButton>
      ),
    },
  ], [expandedRow]);

  const statCardSx = {
    borderRadius: 2, border: 1, borderColor: 'divider', boxShadow: 'none', height: '100%',
    background: (theme) => theme.palette.mode === 'dark' ? alpha(theme.palette.common.white, 0.04) : theme.palette.background.paper,
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: 'auto' }}>
      {/* ── Header ── */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate('/governance/discovery')}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Discovery Results
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Entities detected as privileged by discovery policy evaluation.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Summary Cards ── */}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', mb: 0.5 }}>
                Total Results
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{summary?.totalResults ?? '—'}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', mb: 0.5 }}>
                By Type
              </Typography>
              {summary?.byType?.length ? summary.byType.map((t) => (
                <Typography key={t._id} variant="body2" sx={{ fontWeight: 600 }}>
                  {t._id}: {t.count}
                </Typography>
              )) : <Typography variant="body2" color="text.secondary">—</Typography>}
            </CardContent>
          </Card>
        </Grid>

      </Grid>

      {/* ── Filters ── */}
      <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search results…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 220, flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Entity Type</InputLabel>
          <Select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(0); }} label="Entity Type">
            <MenuItem value="">All</MenuItem>
            <MenuItem value="USER">User</MenuItem>
            <MenuItem value="ENTITLEMENT">Entitlement</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      {/* ── Results Table ── */}
      <DataTable
        columns={columns}
        rows={results}
        loading={loading}
        rowCount={total}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={(v) => { setRowsPerPage(v); setPage(0); }}
        emptyMessage="No discovery results found. Run an evaluation to detect privileged access."
        getRowId={(r) => r._id}
        renderExpandedRow={(row) => {
          if (expandedRow !== row._id) return null;
          return (
            <Box sx={{ p: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.02) }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>Matched Conditions</Typography>
              {(row.matchedFields || []).map((mf, i) => (
                <Paper key={i} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'inline-block', mr: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>{mf.fieldName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {mf.operator} "{mf.conditionValue}" → <strong>"{mf.matchedValue}"</strong>
                  </Typography>
                </Paper>
              ))}
              {(!row.matchedFields || row.matchedFields.length === 0) && (
                <Typography variant="body2" color="text.secondary">No condition details available.</Typography>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
}
