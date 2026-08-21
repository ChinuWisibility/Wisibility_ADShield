import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Snackbar,
  Alert,
  Chip,
  Tooltip,
  LinearProgress,
  TextField,
  InputAdornment,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Collapse,
  Toolbar,
  Divider,
  alpha,
  CircularProgress,
} from '@mui/material';
import {
  Hub,
  Search as SearchIcon,
  Refresh,
  KeyboardArrowDown,
  KeyboardArrowUp,
  Person,
} from '@mui/icons-material';
import { palette } from '../../theme/palette';
import { correlationAPI, applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  TruncatedCell,
  CorrelationTypeBadge,
  ConfidenceBadge,
  MatchRuleChips,
  appBadgeColor,
} from './correlationTableShared';

function ToolbarMetric({ label, value, loading }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 72, mr: 2.5 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.2, textTransform: 'uppercase', fontSize: '0.65rem' }}
      >
        {label}
      </Typography>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3, fontVariantNumeric: 'tabular-nums' }}>
        {loading ? '…' : value}
      </Typography>
    </Box>
  );
}

export default function CorrelatedAccounts() {
  const navigate = useNavigate();
  const { embeddedInCorrelationSummary = false } = useOutletContext() || {};
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalFiltered, setTotalFiltered] = useState(0);

  const [statsHydrated, setStatsHydrated] = useState(false);
  const [stats, setStats] = useState({
    distinctTargetApplications: null,
    lastCorrelationRunAt: null,
    correlatedLinksCached: null,
    totalWarehouseAccountsCount: null,
    correlatedCoveragePercent: null,
  });

  const [applications, setApplications] = useState([]);
  const [filterApplicationId, setFilterApplicationId] = useState('');
  const [filterCorrelationType, setFilterCorrelationType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });

  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, filterApplicationId, filterCorrelationType, tenantId]);

  const fetchApplications = useCallback(async () => {
    if (!tenantId) {
      setApplications([]);
      return;
    }
    try {
      const res = await applicationAPI.list({ tenantId, limit: 500, page: 1 });
      const list = res.data?.data || res.data?.docs || res.data || [];
      const arr = Array.isArray(list) ? list : list.data || [];
      setApplications(Array.isArray(arr) ? arr : []);
    } catch (e) {
      console.error(e);
      setApplications([]);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const fetchData = useCallback(async () => {
    if (!tenantId) {
      setRows([]);
      setTotalFiltered(0);
      setStatsHydrated(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = {
        tenantId,
        page,
        limit: rowsPerPage,
      };
      if (debouncedQ) params.q = debouncedQ;
      if (filterApplicationId) params.applicationId = filterApplicationId;
      if (filterCorrelationType) params.correlationType = filterCorrelationType;

      const corrRes = await correlationAPI.getCorrelatedAccounts(params);

      const payload = corrRes.data || {};
      const list = Array.isArray(payload.data) ? payload.data : [];
      setTotalFiltered(typeof payload.total === 'number' ? payload.total : 0);

      const st = payload.stats || {};
      setStats({
        distinctTargetApplications: typeof st.distinctTargetApplications === 'number' ? st.distinctTargetApplications : null,
        lastCorrelationRunAt: st.lastCorrelationRunAt || null,
        correlatedLinksCached: typeof st.correlatedLinksCached === 'number' ? st.correlatedLinksCached : null,
        totalWarehouseAccountsCount: typeof st.totalWarehouseAccountsCount === 'number' ? st.totalWarehouseAccountsCount : null,
        correlatedCoveragePercent: typeof st.correlatedCoveragePercent === 'number' ? st.correlatedCoveragePercent : null,
      });

      setRows(
        list.map((r) => ({
          ...r,
          id: r.linkId || r._id,
        })),
      );
    } catch (err) {
      console.error(err);
      showToast('Failed to load correlated accounts', 'error');
      setRows([]);
      setTotalFiltered(0);
    } finally {
      setLoading(false);
      setStatsHydrated(true);
    }
  }, [tenantId, page, rowsPerPage, debouncedQ, filterApplicationId, filterCorrelationType]);

  useEffect(() => {
    setStatsHydrated(false);
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statsLoading = loading && !statsHydrated;

  const statsNoFilters = !debouncedQ && !filterApplicationId && !filterCorrelationType;
  /** Prefer API rollups; if missing, same pattern as uncorrelated accounts — use unfiltered list total. */
  const totalCorrelatedDisplay =
    stats.correlatedLinksCached != null
      ? stats.correlatedLinksCached
      : statsNoFilters && typeof totalFiltered === 'number'
        ? totalFiltered
        : '—';
  const distinctAppsDisplay = stats.distinctTargetApplications != null ? stats.distinctTargetApplications : '—';
  // const lastRunDisplay = stats.lastCorrelationRunAt
  //   ? new Date(stats.lastCorrelationRunAt).toLocaleString()
  //   : '—';

  const coverageOptional =
    stats.correlatedCoveragePercent != null && stats.totalWarehouseAccountsCount != null
      ? `${stats.correlatedCoveragePercent}% · warehouse accounts ${stats.totalWarehouseAccountsCount.toLocaleString()}`
      : null;

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const identityRouteId = (row) => {
    const raw = row?.identityId;
    if (raw && typeof raw === 'object' && raw._id != null) return String(raw._id);
    return raw != null ? String(raw) : '';
  };

  const lifecycleChipColor = (s) => {
    const u = String(s || '').toUpperCase();
    if (u === 'ACTIVE') return 'success';
    if (['TERMINATED', 'INACTIVE', 'QUARANTINE', 'LEAVER'].includes(u)) return 'default';
    return 'info';
  };

  const auditAttributes = (obj) => {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj)
      .filter(([k]) => !String(k).startsWith('$'))
      .slice(0, 24)
      .map(([k, v]) => ({
        k,
        v: v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
      }));
  };

  const filterToolbar = useMemo(
    () => (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', py: 0.5 }}>
        <TextField
          size="small"
          placeholder="Search identity or account…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          sx={{ minWidth: 240, flex: '1 1 200px' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 18, color: palette.text.secondary }} />
              </InputAdornment>
            ),
          }}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Application</InputLabel>
          <Select
            label="Application"
            value={filterApplicationId}
            onChange={(e) => setFilterApplicationId(e.target.value)}
          >
            <MenuItem value="">All applications</MenuItem>
            {applications.map((app) => (
              <MenuItem key={app._id} value={app._id}>
                {app.name || app._id}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Correlation type</InputLabel>
          <Select
            label="Correlation type"
            value={filterCorrelationType}
            onChange={(e) => setFilterCorrelationType(e.target.value)}
          >
            <MenuItem value="">All types</MenuItem>
            <MenuItem value="AUTO">AUTO</MenuItem>
            <MenuItem value="MANUAL">MANUAL</MenuItem>
            <MenuItem value="RULE_BASED">RULE_BASED</MenuItem>
          </Select>
        </FormControl>
      </Box>
    ),
    [searchInput, applications, filterApplicationId, filterCorrelationType],
  );

  return (
    <Box>
      {!embeddedInCorrelationSummary && tenantId && loading ? (
        <LinearProgress
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 3,
            width: '100%',
            mb: 2,
            borderRadius: 1,
          }}
        />
      ) : null}

      {!embeddedInCorrelationSummary ? (
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Hub color="primary" /> Correlated accounts
        </Typography>
      ) : null}

      {!tenantId ? (
        <Paper sx={{ p: 6, textAlign: 'center', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
            No Tenant Associated
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your user account is not associated with any tenant.
          </Typography>
        </Paper>
      ) : (
        <>
          <Paper
            elevation={0}
            sx={{
              borderRadius: 2,
              overflow: 'hidden',
              border: `1px solid ${palette.border.default}`,
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
              <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, pr: 0.5 }}>
                <ToolbarMetric label="Correlated" value={totalCorrelatedDisplay} loading={statsLoading} />
                <ToolbarMetric label="Applications" value={distinctAppsDisplay} loading={statsLoading} />
                {coverageOptional ? (
                  <ToolbarMetric
                    label="Coverage"
                    value={`${stats.correlatedCoveragePercent}%`}
                    loading={false}
                  />
                ) : null}
              </Box>
              <Divider
                orientation="vertical"
                flexItem
                sx={{ display: { xs: 'none', md: 'block' }, mx: 0.5 }}
              />
              {filterToolbar}
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Refresh">
                <IconButton size="small" onClick={() => fetchData()}>
                  <Refresh fontSize="small" />
                </IconButton>
              </Tooltip>
            </Toolbar>

            <TableContainer sx={{ maxHeight: 'min(70vh, 720px)' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: palette.bg.secondary, zIndex: 3 }} />
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Identity</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Application</TableCell>
                    {/* <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Account</TableCell> */}
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Match rule</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Type</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Trust</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>
                      <Tooltip title="Last time this account was matched to identity">
                        <span>Last correlated</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                          <CircularProgress size={28} thickness={4} />
                          <Typography color="text.secondary">Loading data…</Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} align="center" sx={{ py: 6 }}>
                        <Typography color="text.secondary">
                          No correlated links match the current filters. Adjust filters or run correlation from the engine.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => {
                      const open = expandedId === row.id;
                      const bg = appBadgeColor(row.applicationName);
                      return (
                        <React.Fragment key={row.id}>
                          <TableRow
                            hover
                            selected={open}
                            onClick={() => toggleExpand(row.id)}
                            sx={{
                              cursor: 'pointer',
                              '&:hover': { bgcolor: alpha(palette.brand.primary, 0.04) },
                            }}
                          >
                            <TableCell padding="checkbox">
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleExpand(row.id); }}>
                                {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                              </IconButton>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                {row.identityLabel || '—'}
                              </Typography>
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5, alignItems: 'center' }}>
                                {row.identityLifecycleState ? (
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label={String(row.identityLifecycleState)}
                                    color={lifecycleChipColor(row.identityLifecycleState)}
                                    sx={{ height: 22, fontSize: '0.7rem', fontWeight: 600 }}
                                  />
                                ) : null}
                                {row.governanceOrphan ? (
                                  <Tooltip title={row.orphanReason || 'Governance review required'}>
                                    <Chip
                                      size="small"
                                      label="Orphan"
                                      color="warning"
                                      sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700 }}
                                    />
                                  </Tooltip>
                                ) : null}
                              </Box>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={row.applicationName || '—'}
                                size="small"
                                sx={{
                                  fontWeight: 600,
                                  bgcolor: bg,
                                  border: '1px solid',
                                  borderColor: alpha(palette.text.primary, 0.08),
                                }}
                              />
                            </TableCell>
                            {/* <TableCell>
                              <TruncatedCell
                                text={row.accountName}
                                monospace
                                copyable
                                onCopied={() => showToast('Account ID copied', 'success')}
                              />
                            </TableCell> */}
                            <TableCell sx={{ maxWidth: 320 }}>
                              <MatchRuleChips
                                identityKey={row.identityKeyAttr}
                                accountKey={row.accountKeyAttr}
                                tooltip={row.matchRuleTooltip}
                              />
                            </TableCell>
                            <TableCell>
                              <CorrelationTypeBadge type={row.correlationType} />
                            </TableCell>
                            <TableCell>
                              <ConfidenceBadge level={row.confidenceLevel} />
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {row.lastVerifiedAt ? new Date(row.lastVerifiedAt).toLocaleString() : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                              <Tooltip title="View identity">
                                <IconButton
                                  size="small"
                                  aria-label="View identity"
                                  onClick={() => navigate(`/identities/${identityRouteId(row)}`)}
                                >
                                  <Person fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={9} sx={{ py: 0, borderBottom: open ? undefined : 'none', bgcolor: alpha(palette.bg.elevated, 0.5) }}>
                              <Collapse in={open} timeout="auto" unmountOnExit>
                                <Box sx={{ py: 2, px: 1 }}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                                    Audit detail
                                  </Typography>
                                  <Grid container spacing={2}>
                                    <Grid item xs={12}>
                                      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                        <Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>
                                          Identity profile (from stored attributes)
                                        </Typography>
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                          <strong>Label:</strong> {row.identityLabel || '—'}
                                        </Typography>
                                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                                          <strong>Lifecycle:</strong>{' '}
                                          {row.identityLifecycleState ? String(row.identityLifecycleState) : '—'}
                                        </Typography>
                                        {row.governanceOrphan ? (
                                          <Typography variant="body2" sx={{ mt: 0.5 }} color="warning.main">
                                            <strong>Governance:</strong> {row.orphanReason || 'Orphan / anomaly'}
                                          </Typography>
                                        ) : null}
                                        <Box component="ul" sx={{ m: 0, pl: 2, mt: 1 }}>
                                          {auditAttributes(row.identityAttributes).length === 0 ? (
                                            <Typography variant="caption" color="text.secondary" component="li" sx={{ listStyle: 'none', ml: -2 }}>
                                              No profile attributes on this identity record.
                                            </Typography>
                                          ) : (
                                            auditAttributes(row.identityAttributes).map(({ k, v }) => (
                                              <li key={k}>
                                                <Typography variant="caption" component="span" sx={{ fontFamily: 'monospace' }}>
                                                  {k}: {v.length > 120 ? `${v.slice(0, 120)}…` : v}
                                                </Typography>
                                              </li>
                                            ))
                                          )}
                                        </Box>
                                      </Paper>
                                    </Grid>
                                    <Grid item xs={12}>
                                      <Paper variant="outlined" sx={{ p: 2, bgcolor: alpha(palette.brand.primary, 0.03) }}>
                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                          Correlation rule
                                        </Typography>
                                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                                          {row.matchRuleDisplay || row.correlationKeyLabel || '—'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                          Correlation type (engine):{' '}
                                          <CorrelationTypeBadge type={row.correlationType} /> · Method:{' '}
                                          {row.correlationMethod || '—'}
                                        </Typography>
                                      </Paper>
                                    </Grid>
                                  </Grid>
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            <TablePagination
              component="div"
              count={totalFiltered}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
              sx={{ borderTop: `1px solid ${palette.border.default}` }}
            />
          </Paper>
        </>
      )}

      <Snackbar
        open={toast.open}
        autoHideDuration={6000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setToast({ ...toast, open: false })} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
