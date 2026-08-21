import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  alpha,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBack,
  CheckCircle,
  Edit,
  PlayArrow,
  Search,
  Close,
} from '@mui/icons-material';
import { palette } from '../../../theme/palette';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { discoveryAPI } from '../../../services/discoveryService';
import { useAuth } from '../../../contexts/AuthContext';

/* ── Confidence color helper ─────────────────────────────────────── */
function confidenceColor(pct) {
  if (pct >= 90) return palette.status.error;
  if (pct >= 70) return palette.risk.high;
  if (pct >= 50) return palette.status.warning;
  return palette.status.success;
}

/* ── Avatar color from name ──────────────────────────────────────── */
const AVATAR_COLORS = ['#2563EB', '#7C3AED', '#0891B2', '#DC2626', '#D97706', '#16A34A', '#EA580C', '#9333EA'];
function nameToColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function nameInitial(name) {
  if (!name) return '?';
  const parts = name.trim().split(/[\s_.-]+/);
  return parts[0]?.[0]?.toUpperCase() || '?';
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function DiscoveryPolicyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();

  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Results
  const [results, setResults] = useState([]);
  const [totalResults, setTotalResults] = useState(0);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [searchQ, setSearchQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Selection
  const [selected, setSelected] = useState([]);

  // Eval
  const [evalRunning, setEvalRunning] = useState(false);

  useEffect(() => {
    if (!searchQ.trim()) { setDebouncedQ(''); setPage(0); return; }
    const t = setTimeout(() => { setDebouncedQ(searchQ); setPage(0); }, 320);
    return () => clearTimeout(t);
  }, [searchQ]);

  /* ── Load policy ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await discoveryAPI.getPolicy(id);
        setPolicy(res.data?.data || null);
      } catch (e) {
        setError(e.response?.data?.message || 'Failed to load policy.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* ── Load results for this policy ──────────────────────────────── */
  const loadResults = useCallback(async () => {
    if (!id) return;
    setResultsLoading(true);
    try {
      const res = await discoveryAPI.getResults({
        page: page + 1,
        limit: rowsPerPage,
        policyId: id,
        ...(debouncedQ.trim() ? { search: debouncedQ.trim() } : {}),
      });
      const d = res.data?.data || {};
      setResults(d.items || []);
      setTotalResults(d.total ?? 0);
    } catch {
      setResults([]);
      setTotalResults(0);
    } finally {
      setResultsLoading(false);
    }
  }, [id, page, rowsPerPage, debouncedQ]);

  useEffect(() => { loadResults(); }, [loadResults]);

  /* ── Run evaluation ────────────────────────────────────────────── */
  const handleEvaluate = async () => {
    if (!id || evalRunning) return;
    setEvalRunning(true);
    try {
      const res = await discoveryAPI.evaluatePolicy(id);
      const d = res.data?.data || {};
      enqueueSnackbar(`Matched ${d.matched ?? 0} of ${d.total ?? 0} entities`, { variant: 'success' });
      // Reload policy stats & results
      const pRes = await discoveryAPI.getPolicy(id);
      setPolicy(pRes.data?.data || null);
      loadResults();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Evaluation failed.', { variant: 'error' });
    } finally {
      setEvalRunning(false);
    }
  };

  /* ── Mark / Unmark handlers ────────────────────────────────────── */
  const handleMarkPrivileged = async () => {
    if (selected.length === 0) return;
    try {
      await discoveryAPI.markResults(selected);
      enqueueSnackbar(`${selected.length} entities marked as privileged`, { variant: 'success' });
      setSelected([]);
      loadResults();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Failed to mark results.', { variant: 'error' });
    }
  };

  const handleUnmark = async () => {
    if (selected.length === 0) return;
    try {
      await discoveryAPI.unmarkResults(selected);
      enqueueSnackbar(`${selected.length} entities dismissed`, { variant: 'success' });
      setSelected([]);
      loadResults();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Failed to unmark results.', { variant: 'error' });
    }
  };

  /* ── Selection ─────────────────────────────────────────────────── */
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelected(displayResults.map((r) => r._id));
    } else {
      setSelected([]);
    }
  };
  const handleSelect = (rId) => {
    setSelected((prev) => prev.includes(rId) ? prev.filter((x) => x !== rId) : [...prev, rId]);
  };

  /* ── Filtered results ──────────────────────────────────────────── */
  const displayResults = useMemo(() => {
    if (!statusFilter) return results;
    return results.filter((r) => r.reviewStatus === statusFilter);
  }, [results, statusFilter]);

  /* ── Compute confidence for each result ────────────────────────── */
  const getConfidence = (result) => {
    if (!result.matchedFields?.length || !policy?.steps?.length) return 60;
    // Confidence based on how many conditions matched
    const totalConditions = policy.steps.reduce((sum, s) =>
      sum + s.fieldConditions.reduce((sum2, fc) => sum2 + fc.conditions.length, 0), 0);
    const matchedCount = result.matchedFields.length;
    const pct = Math.min(100, Math.round((matchedCount / Math.max(totalConditions, 1)) * 100));
    return Math.max(40, pct);
  };

  /* ── Reason text ───────────────────────────────────────────────── */
  const getReasonText = (result) => {
    if (!result.matchedFields?.length) return '—';
    const first = result.matchedFields[0];
    const remaining = result.matchedFields.length - 1;
    const text = `${first.fieldName} "${first.operator}" "${first.conditionValue}"`;
    return remaining > 0 ? `${text} +${remaining} more` : text;
  };

  /* ── Get privileged groups ─────────────────────────────────────── */
  const getPrivilegedGroups = (result) => {
    const groups = result.matchedFields
      ?.filter((mf) => mf.matchedValue)
      .map((mf) => mf.matchedValue)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 3);
    return groups?.length ? groups.join(', ') : '—';
  };

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!policy) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{error || 'Policy not found.'}</Alert>
        <Button sx={{ mt: 2 }} onClick={() => navigate(-1)}>Go Back</Button>
      </Box>
    );
  }

  const isUser = policy.type === 'USER';
  const typeColor = isUser ? '#2563EB' : policy.type === 'AD_GROUP' ? '#0891B2' : '#7C3AED';

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
      {/* ── Header ── */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
        <IconButton onClick={() => navigate(-1)} size="small">
          <ArrowBack />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            {policy.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {policy.applicationName || '—'} • {policy.policyId} • {policy.totalMatches || 0} entities detected
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={evalRunning ? <CircularProgress size={16} /> : <PlayArrow />}
          onClick={handleEvaluate}
          disabled={evalRunning}
          sx={{ textTransform: 'none', fontWeight: 700, borderColor: typeColor, color: typeColor }}
        >
          {evalRunning ? 'Evaluating…' : 'Run Evaluation'}
        </Button>
        <Button
          variant="outlined"
          startIcon={<Edit />}
          onClick={() => {
            const slugMap = { USER: 'privileged-user', ENTITLEMENT: 'privileged-entitlement', AD_GROUP: 'ad-group' };
            navigate(`/governance/discovery/${slugMap[policy.type] || 'privileged-user'}/${policy._id}/edit`);
          }}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Edit
        </Button>
      </Stack>

      {evalRunning && (
        <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 3, '& .MuiLinearProgress-bar': { bgcolor: typeColor } }} />
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Detected Entities Table ── */}
      <Paper sx={{ borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
        {/* ── Table Toolbar ── */}
        <Box sx={{ p: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            size="small"
            placeholder="Search by name, email, group…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment> }}
            sx={{ minWidth: 240, flex: 1, maxWidth: 400 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} label="Status">
              <MenuItem value="">All Candidates</MenuItem>
              <MenuItem value="detected">New</MenuItem>
              <MenuItem value="confirmed">Privileged</MenuItem>
              <MenuItem value="dismissed">Dismissed</MenuItem>
            </Select>
          </FormControl>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            startIcon={<CheckCircle />}
            disabled={selected.length === 0}
            onClick={handleMarkPrivileged}
            sx={{
              textTransform: 'none', fontWeight: 700, borderRadius: 2,
              bgcolor: palette.status.success, '&:hover': { bgcolor: alpha(palette.status.success, 0.85) },
            }}
          >
            Mark Privileged ({selected.length})
          </Button>
          <Button
            variant="outlined"
            startIcon={<Close />}
            disabled={selected.length === 0}
            onClick={handleUnmark}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
          >
            Dismiss ({selected.length})
          </Button>
        </Box>

        {/* ── Table ── */}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: (t) => alpha(t.palette.action.hover, 0.04) }}>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={selected.length > 0 && selected.length < displayResults.length}
                    checked={displayResults.length > 0 && selected.length === displayResults.length}
                    onChange={handleSelectAll}
                  />
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Display Name</TableCell>
                {isUser && <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Email</TableCell>}
                {isUser && <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Title</TableCell>}
                {!isUser && <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Identifier</TableCell>}
                <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>
                  {policy?.type === 'ENTITLEMENT' ? 'Description' : 'Privileged Groups'}
                </TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }} align="center">Confidence</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Reason</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.78rem' }} align="center">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {resultsLoading ? (
                <TableRow>
                  <TableCell colSpan={isUser ? 8 : 7} sx={{ textAlign: 'center', py: 6 }}>
                    <CircularProgress size={28} />
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Loading detected entities…</Typography>
                  </TableCell>
                </TableRow>
              ) : displayResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isUser ? 8 : 7} sx={{ textAlign: 'center', py: 6 }}>
                    <Typography variant="body2" color="text.secondary">
                      {totalResults === 0 ? 'No entities detected yet. Run evaluation to detect privileged access.' : 'No results match your filter.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                displayResults.map((r) => {
                  const confidence = getConfidence(r);
                  const confColor = confidenceColor(confidence);
                  const isSelected = selected.includes(r._id);
                  const avatarColor = nameToColor(r.entityDisplayName);

                  return (
                    <TableRow
                      key={r._id}
                      hover
                      selected={isSelected}
                      sx={{ '&:last-child td': { borderBottom: 0 } }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox size="small" checked={isSelected} onChange={() => handleSelect(r._id)} />
                      </TableCell>

                      {/* Display Name with Avatar */}
                      <TableCell>
                        <Stack direction="row" alignItems="center" spacing={1.5}>
                          <Avatar
                            sx={{
                              width: 32, height: 32, fontSize: '0.8rem', fontWeight: 700,
                              bgcolor: alpha(avatarColor, 0.15), color: avatarColor,
                            }}
                          >
                            {nameInitial(r.entityDisplayName)}
                          </Avatar>
                          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                            {r.entityDisplayName || '—'}
                          </Typography>
                        </Stack>
                      </TableCell>

                      {/* User-specific: Email, Title */}
                      {isUser && (
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                            {r.entityIdentifier || '—'}
                          </Typography>
                        </TableCell>
                      )}
                      {isUser && (
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 160 }}>
                            {r.matchedFields?.find((m) => m.fieldName?.toLowerCase().includes('title'))?.matchedValue || '—'}
                          </Typography>
                        </TableCell>
                      )}

                      {/* Entitlement-specific: Identifier */}
                      {!isUser && (
                        <TableCell>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 200 }}>
                            {r.entityIdentifier || '—'}
                          </Typography>
                        </TableCell>
                      )}

                      {/* Privileged Groups (or Entitlement Description for ENTITLEMENT policies) */}
                      <TableCell>
                        <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220 }}>
                          {policy?.type === 'ENTITLEMENT'
                            ? (r.entityDescription || r.matchedFields?.find((m) => (/desc|description/i).test(m.fieldName))?.matchedValue || '—')
                            : getPrivilegedGroups(r)}
                        </Typography>
                      </TableCell>

                      {/* Confidence */}
                      <TableCell align="center">
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            color: confColor,
                            fontSize: '0.8rem',
                          }}
                        >
                          {confidence}%
                        </Typography>
                      </TableCell>

                      {/* Reason */}
                      <TableCell>
                        <Tooltip title={r.matchedFields?.map((m) => `${m.fieldName} ${m.operator} "${m.conditionValue}"`).join(' | ') || ''} arrow>
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 220, cursor: 'help' }}>
                            {getReasonText(r)}
                          </Typography>
                        </Tooltip>
                      </TableCell>

                      {/* Status */}
                      <TableCell align="center">
                        {r.reviewStatus === 'confirmed' ? (
                          <Chip
                            size="small"
                            label="Privileged"
                            sx={{
                              fontWeight: 700, fontSize: '0.65rem',
                              bgcolor: palette.status.errorBg, color: palette.status.error,
                              borderRadius: '16px',
                            }}
                          />
                        ) : r.reviewStatus === 'dismissed' ? (
                          <Chip
                            size="small"
                            label="Dismissed"
                            sx={{
                              fontWeight: 700, fontSize: '0.65rem',
                              bgcolor: alpha('#9e9e9e', 0.1), color: '#757575',
                              borderRadius: '16px',
                            }}
                          />
                        ) : (
                          <Chip
                            size="small"
                            label="New"
                            variant="outlined"
                            sx={{
                              fontWeight: 700, fontSize: '0.65rem',
                              borderColor: palette.status.warning, color: palette.status.warning,
                              borderRadius: '16px',
                            }}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination
          component="div"
          count={totalResults}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          sx={{ borderTop: `1px solid ${palette.border.default}` }}
        />
      </Paper>
    </Box>
  );
}
