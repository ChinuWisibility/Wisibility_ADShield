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
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Autocomplete,
  Checkbox,
} from '@mui/material';
import {
  Troubleshoot,
  Link as LinkIcon,
  VisibilityOff,
  Search as SearchIcon,
  Refresh,
  KeyboardArrowDown,
  KeyboardArrowUp,
  Hub,
  PlayCircle,
  HourglassEmpty,
  CheckCircle,
  ErrorOutline,
  Assignment as TasksIcon,
} from '@mui/icons-material';
import { palette } from '../../theme/palette';
import { correlationAPI, identityAPI, applicationAPI, workflowAPI } from '../../services/api';
import QueueFirstRemediationRowAction from '../../components/remediation/QueueFirstRemediationRowAction';
import QueueFirstRemediationAction from '../../components/remediation/QueueFirstRemediationAction';
import { IAM_ORPHAN_QUEUE_MODAL_PIPELINE } from '../../features/remediation-events/utils/iamOrphanReviewPipeline';
import useQueueTaskPageStatus from '../../hooks/useQueueTaskPageStatus';
import OrphanIamDecisionDialog from './OrphanIamDecisionDialog';
import { useAuth } from '../../contexts/AuthContext';
import { iamOrphanReviewTaskPath } from '../../features/remediation-events/paths';
import RiskBadge from '../../components/RiskBadge';
import {
  TruncatedCell,
  UncorrelatedTypeBadge,
  MatchRuleChips,
  appBadgeColor,
} from './correlationTableShared';

/** MUI Tooltip title for Trust chip — presentation only; copy comes from API. */
function TrustChipTooltipTitle({ level, lines, appliedMappingLine }) {
  const trust = String(level || 'HIGH').toUpperCase();
  const bullets = Array.isArray(lines) && lines.length
    ? lines
    : ['Account is Uncorrelated', 'Trust explanation unavailable'];
  return (
    <Box sx={{ py: 0.25, maxWidth: 300 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75 }}>
        Trust Level: {trust}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.35 }}>
        Reason
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2, mb: appliedMappingLine ? 1 : 0 }}>
        {bullets.map((line) => (
          <Typography component="li" key={line} variant="caption" sx={{ display: 'list-item' }}>
            {line}
          </Typography>
        ))}
      </Box>
      {appliedMappingLine ? (
        <Box sx={{ mt: 0.75, pt: 0.75, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.35 }}>
            Applied Trust Mapping
          </Typography>
          <Typography variant="caption" sx={{ display: 'block' }}>
            {appliedMappingLine}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

function TrustEntitlementList({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        None
      </Typography>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
      {items.map((ent) => (
        <Chip
          key={ent.id || ent.name}
          label={ent.name || ent.id || '—'}
          size="small"
          variant="outlined"
          sx={{ height: 22, fontWeight: 600, fontSize: '0.7rem' }}
        />
      ))}
    </Box>
  );
}

/** Expanded-row Trust Analysis — data from list enrichment only (no extra API calls). */
function TrustAnalysisPanel({ row }) {
  const trustLevel = row.trustLevel || row.riskLevel || 'HIGH';
  const accountStatus = row.accountStatus || '—';
  const analysisLines = Array.isArray(row.trustAnalysisLines) ? row.trustAnalysisLines : [];
  const privileged = Array.isArray(row.privilegedEntitlements) ? row.privilegedEntitlements : [];
  const normal = Array.isArray(row.normalEntitlements) ? row.normalEntitlements : [];
  const showNormalEntitlements = privileged.length === 0;
  const scenarioLabel = row.trustScenarioLabel || null;
  const configuredTrust = row.configuredTrustLevel || trustLevel;

  return (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>
        Trust Analysis
      </Typography>

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Account Status
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 600 }}>
          {accountStatus}
        </Typography>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Trust Level
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <RiskBadge level={trustLevel} />
        </Box>
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Trust Reason
        </Typography>
        {analysisLines.length ? (
          analysisLines.map((line) => (
            <Typography key={line} variant="body2" sx={{ mt: 0.35 }}>
              {line}
            </Typography>
          ))
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
            —
          </Typography>
        )}
      </Box>

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Privileged Entitlements
        </Typography>
        <TrustEntitlementList items={privileged} />
      </Box>

      {showNormalEntitlements && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Entitlements
          </Typography>
          <TrustEntitlementList items={normal} />
        </Box>
      )}

      {scenarioLabel && (
        <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${palette.border.default}` }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Applied Trust Mapping
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mt: 1 }}>
            Scenario
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.25 }}>
            {scenarioLabel}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mt: 1 }}>
            Configured Trust
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            <RiskBadge level={configuredTrust} />
          </Box>
        </Box>
      )}

      <Box sx={{ mt: 1.5, pt: 1.5, borderTop: `1px solid ${palette.border.default}` }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Summary
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          {row.trustSummary || '—'}
        </Typography>
      </Box>
    </Paper>
  );
}

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

function extractArray(resData) {
  if (!resData) return [];
  if (Array.isArray(resData)) return resData;
  if (Array.isArray(resData.data)) return resData.data;
  if (Array.isArray(resData.docs)) return resData.docs;
  if (resData.data && typeof resData.data === 'object' && !Array.isArray(resData.data)) {
    if (Array.isArray(resData.data.docs)) return resData.data.docs;
    if (Array.isArray(resData.data.data)) return resData.data.data;
  }
  return [];
}

export default function OrphanAccounts() {
  const navigate = useNavigate();
  const { embeddedInCorrelationSummary = false } = useOutletContext() || {};
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [rows, setRows] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalFiltered, setTotalFiltered] = useState(0);

  const [statsHydrated, setStatsHydrated] = useState(false);
  const [stats, setStats] = useState({
    highRiskOpenTotal: 0,
    distinctOrphanApplications: null,
    distinctOrphanApplicationsFiltered: null,
    orphansOpenCached: null,
    orphansHighRiskCached: null,
  });

  const [applications, setApplications] = useState([]);
  const [filterApplicationId, setFilterApplicationId] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  const [expandedId, setExpandedId] = useState(null);
  const [selectedOrphanIds, setSelectedOrphanIds] = useState(() => new Set());
  const [remediateModal, setRemediateModal] = useState({
    open: false,
    orphanId: null,
    accountName: '',
    action: 'ASSIGN',
    identityId: null,
  });
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const [iamDecisionModal, setIamDecisionModal] = useState({
    open: false, orphanId: null, accountName: '',
  });

  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(0);
  }, [debouncedQ, filterApplicationId, filterRiskLevel, tenantId]);

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
      if (filterRiskLevel) params.riskLevel = filterRiskLevel;

      const orphanRes = await correlationAPI.getOrphans(params);
      const payload = orphanRes.data || {};
      const list = extractArray(payload);
      setTotalFiltered(typeof payload.total === 'number' ? payload.total : 0);

      const st = payload.stats || {};
      setStats({
        highRiskOpenTotal: typeof st.highRiskOpenTotal === 'number' ? st.highRiskOpenTotal : 0,
        distinctOrphanApplications:
          typeof st.distinctOrphanApplications === 'number' ? st.distinctOrphanApplications : null,
        distinctOrphanApplicationsFiltered:
          typeof st.distinctOrphanApplicationsFiltered === 'number' ? st.distinctOrphanApplicationsFiltered : null,
        orphansOpenCached: st.orphansOpenCached ?? null,
        orphansHighRiskCached: st.orphansHighRiskCached ?? null,
      });

      setRows(
        list.map((r) => ({
          ...r,
          id: r._id,
        })),
      );
    } catch (err) {
      console.error('Failed to load data', err);
      showToast('Failed to load uncorrelated accounts', 'error');
      setRows([]);
      setTotalFiltered(0);
    } finally {
      setLoading(false);
      setStatsHydrated(true);
    }
  }, [tenantId, page, rowsPerPage, debouncedQ, filterApplicationId, filterRiskLevel]);

  useEffect(() => {
    setStatsHydrated(false);
  }, [tenantId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!remediateModal.open || remediateModal.action !== 'ASSIGN' || !tenantId) {
      return undefined;
    }
    let cancelled = false;
    setIdentitiesLoading(true);
    (async () => {
      try {
        const identRes = await identityAPI.list({ limit: 500, page: 1, tenantId });
        if (!cancelled) {
          setIdentities(extractArray(identRes.data));
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setIdentities([]);
      } finally {
        if (!cancelled) setIdentitiesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [remediateModal.open, remediateModal.action, tenantId]);

  const executeRemediation = async () => {
    if (remediateModal.action === 'ASSIGN' && !remediateModal.identityId) {
      return showToast('You must select a user to assign this account to.', 'warning');
    }

    try {
      await correlationAPI.remediateOrphan(remediateModal.orphanId, {
        action: remediateModal.action,
        identityId: remediateModal.identityId?.id || remediateModal.identityId?._id,
      });

      showToast('Account updated successfully.', 'success');
      setRemediateModal({ open: false, orphanId: null, accountName: '', action: 'ASSIGN', identityId: null });
      fetchData();
    } catch (err) {
      showToast('Failed to remediate account', 'error');
    }
  };

  const statsLoading = loading && !statsHydrated;
  const statsNoFilters = !debouncedQ && !filterApplicationId && !filterRiskLevel;

  const totalOpenDisplay =
    statsNoFilters && stats.orphansOpenCached != null ? stats.orphansOpenCached : totalFiltered;

  const distinctAppsDisplay =
    stats.distinctOrphanApplications != null
      ? stats.distinctOrphanApplications
      : statsNoFilters && stats.distinctOrphanApplicationsFiltered != null
        ? stats.distinctOrphanApplicationsFiltered
        : '—';

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const accountLabel = (row) => {
    const n = row.accountName?.trim();
    if (n) return n;
    return '—';
  };

  const isWrqSelectable = (row) =>
    !['IN_PROGRESS', 'WAITING_IAM', 'PENDING'].includes(row.workflowStatus);

  const pageSelectableOrphans = useMemo(
    () =>
      rows
        .filter(isWrqSelectable)
        .map((row) => ({ id: String(row.id), label: accountLabel(row) })),
    [rows],
  );

  const selectedOrphanItems = useMemo(
    () => pageSelectableOrphans.filter((item) => selectedOrphanIds.has(item.id)),
    [pageSelectableOrphans, selectedOrphanIds],
  );

  const allOrphansPageSelected =
    pageSelectableOrphans.length > 0
    && pageSelectableOrphans.every((item) => selectedOrphanIds.has(item.id));

  const toggleOrphanSelection = (id) => {
    setSelectedOrphanIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllOrphans = () => {
    if (allOrphansPageSelected) {
      setSelectedOrphanIds(new Set());
      return;
    }
    setSelectedOrphanIds(new Set(pageSelectableOrphans.map((item) => item.id)));
  };

  useEffect(() => {
    setSelectedOrphanIds(new Set());
  }, [page, rowsPerPage, debouncedQ, filterApplicationId, filterRiskLevel]);

  const pageTargetIds = useMemo(
    () => pageSelectableOrphans.map((item) => item.id),
    [pageSelectableOrphans],
  );

  const { getQueuedInfo, refresh: refreshQueueStatus } = useQueueTaskPageStatus({
    action: 'IAM_ORPHAN_REVIEW',
    targetIds: pageTargetIds,
    enabled: pageTargetIds.length > 0,
  });

  const filterToolbar = useMemo(
    () => (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', py: 0.5 }}>
        <TextField
          size="small"
          placeholder="Search account or correlation key…"
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
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Risk level</InputLabel>
          <Select label="Risk level" value={filterRiskLevel} onChange={(e) => setFilterRiskLevel(e.target.value)}>
            <MenuItem value="">All levels</MenuItem>
            <MenuItem value="LOW">LOW</MenuItem>
            <MenuItem value="MEDIUM">MEDIUM</MenuItem>
            <MenuItem value="HIGH">HIGH</MenuItem>
            <MenuItem value="CRITICAL">CRITICAL</MenuItem>
          </Select>
        </FormControl>
      </Box>
    ),
    [searchInput, applications, filterApplicationId, filterRiskLevel],
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
          <Troubleshoot color="primary" /> Uncorrelated accounts
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
                <ToolbarMetric label="Open" value={totalOpenDisplay} loading={statsLoading} />
                <ToolbarMetric label="High risk" value={stats.highRiskOpenTotal} loading={statsLoading} />
                <ToolbarMetric label="Applications" value={distinctAppsDisplay} loading={statsLoading} />
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

            {selectedOrphanItems.length > 0 && (
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  flexWrap: 'wrap',
                  borderBottom: `1px solid ${palette.border.default}`,
                  bgcolor: alpha(palette.brand.primary, 0.04),
                }}
              >
                <Chip label={`${selectedOrphanItems.length} selected`} size="small" color="primary" />
                <QueueFirstRemediationAction
                  queueAction="IAM_ORPHAN_REVIEW"
                  eventTypeLabel="IAM Orphan Review"
                  pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
                  selectedItems={selectedOrphanItems.filter((item) => !getQueuedInfo(item.id))}
                  onClearSelection={() => setSelectedOrphanIds(new Set())}
                  onQueuedRefresh={refreshQueueStatus}
                  size="small"
                  variant="contained"
                />
                <Button
                  size="small"
                  onClick={() => setSelectedOrphanIds(new Set())}
                  sx={{ textTransform: 'none' }}
                >
                  Clear selection
                </Button>
              </Box>
            )}

            <TableContainer sx={{ maxHeight: 'min(70vh, 720px)' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: palette.bg.secondary, zIndex: 3 }}>
                      <Checkbox
                        size="small"
                        checked={allOrphansPageSelected}
                        indeterminate={
                          selectedOrphanItems.length > 0 && !allOrphansPageSelected
                        }
                        disabled={!pageSelectableOrphans.length}
                        onChange={toggleSelectAllOrphans}
                        inputProps={{ 'aria-label': 'Select all on page' }}
                      />
                    </TableCell>
                    <TableCell padding="checkbox" sx={{ bgcolor: palette.bg.secondary, zIndex: 3 }} />
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Account</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Application</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Match rule</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Type</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Trust</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>
                      <Tooltip title="Detected or last updated">
                        <span>Last activity</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Status</TableCell>
                    <TableCell sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>Task</TableCell>
                    <TableCell align="right" sx={{ bgcolor: palette.bg.secondary, fontWeight: 600, zIndex: 3 }}>
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading && rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} align="center" sx={{ py: 6 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                          <CircularProgress size={28} thickness={4} />
                          <Typography color="text.secondary">Loading data…</Typography>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} align="center" sx={{ py: 6 }}>
                        <Typography color="text.secondary">
                          No uncorrelated accounts match the current filters — all target accounts may already match an identity,
                          or adjust filters.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => {
                      const open = expandedId === row.id;
                      const appName = row.applicationId?.name || '—';
                      const bg = appBadgeColor(appName);
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
                            <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                              {isWrqSelectable(row) ? (
                                <Checkbox
                                  size="small"
                                  checked={selectedOrphanIds.has(String(row.id))}
                                  onChange={() => toggleOrphanSelection(String(row.id))}
                                  inputProps={{ 'aria-label': `Select ${accountLabel(row)}` }}
                                />
                              ) : null}
                            </TableCell>
                            <TableCell padding="checkbox">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(row.id);
                                }}
                              >
                                {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
                              </IconButton>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                                {accountLabel(row)}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={appName}
                                size="small"
                                sx={{
                                  fontWeight: 600,
                                  bgcolor: bg,
                                  border: '1px solid',
                                  borderColor: alpha(palette.text.primary, 0.08),
                                }}
                              />
                            </TableCell>
                            <TableCell sx={{ maxWidth: 320 }}>
                              <MatchRuleChips
                                identityKey={row.identityKeyAttr}
                                accountKey={row.accountKeyAttr}
                                tooltip={row.matchRuleTooltip}
                              />
                            </TableCell>
                            <TableCell>
                              <UncorrelatedTypeBadge />
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Tooltip
                                arrow
                                placement="top"
                                title={
                                  <TrustChipTooltipTitle
                                    level={row.trustLevel || row.riskLevel || 'HIGH'}
                                    lines={row.trustTooltipLines}
                                    appliedMappingLine={row.appliedTrustMappingLine}
                                  />
                                }
                              >
                                <span>
                                  <RiskBadge level={row.trustLevel || row.riskLevel || 'HIGH'} />
                                </span>
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">
                                {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              {row.workflowStatus === 'PENDING' && (
                                <Chip icon={<HourglassEmpty sx={{ fontSize: '0.8rem !important' }} />} label="Pending" size="small" sx={{ bgcolor: alpha('#94a3b8', 0.15), color: '#64748b', fontWeight: 600 }} />
                              )}
                              {row.workflowStatus === 'IN_PROGRESS' && (
                                <Chip label="In Progress" size="small" sx={{ bgcolor: alpha('#3b82f6', 0.15), color: '#1d4ed8', fontWeight: 600 }} />
                              )}
                              {row.workflowStatus === 'WAITING_IAM' && (
                                <Chip icon={<HourglassEmpty sx={{ fontSize: '0.8rem !important' }} />} label="Awaiting IAM" size="small" sx={{ bgcolor: alpha('#f59e0b', 0.15), color: '#b45309', fontWeight: 600 }} />
                              )}
                              {row.workflowStatus === 'COMPLETED' && (
                                <Chip icon={<CheckCircle sx={{ fontSize: '0.8rem !important' }} />} label="Completed" size="small" sx={{ bgcolor: alpha('#10b981', 0.15), color: '#047857', fontWeight: 600 }} />
                              )}
                              {row.workflowStatus === 'FAILED' && (
                                <Chip icon={<ErrorOutline sx={{ fontSize: '0.8rem !important' }} />} label="Failed" size="small" sx={{ bgcolor: alpha('#ef4444', 0.15), color: '#b91c1c', fontWeight: 600 }} />
                              )}
                            </TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                                {row.currentStepLabel || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                              {row.workflowStatus === 'WAITING_IAM' ? (
                                <Tooltip title="Record IAM decision">
                                  <IconButton
                                    size="small"
                                    color="warning"
                                    onClick={() =>
                                      setIamDecisionModal({
                                        open: true,
                                        orphanId: row.id,
                                        accountName: row.accountName,
                                      })
                                    }
                                  >
                                    <Troubleshoot fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              ) : (
                                <Box onClick={(e) => e.stopPropagation()} sx={{ display: 'inline-flex' }}>
                                  <QueueFirstRemediationRowAction
                                    targetId={row.id}
                                    recordLabel={accountLabel(row)}
                                    eventTypeLabel="IAM Orphan Review"
                                    queueAction="IAM_ORPHAN_REVIEW"
                                    pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
                                    queuedInfo={getQueuedInfo(row.id)}
                                    disabled={['IN_PROGRESS', 'WAITING_IAM', 'PENDING'].includes(row.workflowStatus)}
                                    onQueuedRefresh={refreshQueueStatus}
                                    size="small"
                                    variant="outlined"
                                  />
                                </Box>
                              )}
                              <Tooltip title="View task">
                                <IconButton
                                  size="small"
                                  onClick={() => {
                                    const queued = getQueuedInfo(row.id);
                                    navigate(iamOrphanReviewTaskPath(queued?.taskId));
                                  }}
                                >
                                  <TasksIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Correlation engine">
                                <IconButton size="small" aria-label="Correlation engine" onClick={() => navigate('/identities/correlation')}>
                                  <Hub fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Link to identity">
                                <IconButton
                                  color="primary"
                                  size="small"
                                  onClick={() =>
                                    setRemediateModal({
                                      open: true,
                                      orphanId: row.id,
                                      accountName: row.accountName,
                                      action: 'ASSIGN',
                                      identityId: null,
                                    })
                                  }
                                >
                                  <LinkIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="Ignore (false positive)">
                                <IconButton
                                  color="secondary"
                                  size="small"
                                  onClick={() =>
                                    setRemediateModal({
                                      open: true,
                                      orphanId: row.id,
                                      accountName: row.accountName,
                                      action: 'IGNORE',
                                      identityId: null,
                                    })
                                  }
                                >
                                  <VisibilityOff fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell
                              colSpan={12}
                              sx={{ py: 0, borderBottom: open ? undefined : 'none', bgcolor: alpha(palette.bg.elevated, 0.5) }}
                            >
                              <Collapse in={open} timeout="auto" unmountOnExit>
                                <Box sx={{ py: 2, px: 1 }}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                                    Audit detail
                                  </Typography>
                                  <Grid container spacing={2}>
                                    <Grid item xs={12} md={4}>
                                      <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                                        <Typography variant="caption" color="primary" sx={{ fontWeight: 700 }}>
                                          Target account
                                        </Typography>
                                        <Typography variant="body2" sx={{ mt: 1 }}>
                                          <strong>Display:</strong> {accountLabel(row)}
                                        </Typography>
                                        <Box sx={{ mt: 0.5 }}>
                                          <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
                                            Account id:{' '}
                                          </Typography>
                                          <TruncatedCell text={row.accountId} monospace copyable onCopied={() => showToast('Copied', 'success')} />
                                        </Box>
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                          Correlation key: {row.correlationKey || '—'}
                                        </Typography>
                                      </Paper>
                                    </Grid>
                                    <Grid item xs={12} md={4}>
                                      <Paper variant="outlined" sx={{ p: 2, bgcolor: alpha(palette.brand.primary, 0.03), height: '100%' }}>
                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>
                                          Matching context
                                        </Typography>
                                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                                          {row.matchRuleDisplay || 'No manual correlation rule saved for this application yet.'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                                          Trust:{' '}
                                          <Box component="span" sx={{ verticalAlign: 'middle' }}>
                                            <Tooltip
                                              arrow
                                              placement="top"
                                              title={
                                                <TrustChipTooltipTitle
                                                  level={row.trustLevel || row.riskLevel || 'HIGH'}
                                                  lines={row.trustTooltipLines}
                                                  appliedMappingLine={row.appliedTrustMappingLine}
                                                />
                                              }
                                            >
                                              <span>
                                                <RiskBadge level={row.trustLevel || row.riskLevel || 'HIGH'} />
                                              </span>
                                            </Tooltip>
                                          </Box>
                                          {' · '}
                                          Detected: {row.detectedAt ? new Date(row.detectedAt).toLocaleString() : '—'}
                                        </Typography>
                                      </Paper>
                                    </Grid>
                                    <Grid item xs={12} md={4}>
                                      <TrustAnalysisPanel row={row} />
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

      <OrphanIamDecisionDialog
        open={iamDecisionModal.open}
        orphanId={iamDecisionModal.orphanId}
        accountName={iamDecisionModal.accountName}
        onClose={() => setIamDecisionModal({ open: false, orphanId: null, accountName: '' })}
        onSuccess={(decision) => {
          showToast(`IAM decision recorded: ${decision}`, 'success');
          fetchData();
        }}
      />

      <Dialog
        open={remediateModal.open}
        onClose={() => setRemediateModal({ ...remediateModal, open: false })}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {remediateModal.action === 'ASSIGN' ? 'Link account to identity' : 'Ignore uncorrelated account'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ mb: 3 }}>
            Target Account: <strong>{remediateModal.accountName?.trim() ? remediateModal.accountName : '—'}</strong>
          </Typography>

          {remediateModal.action === 'ASSIGN' ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Search for the human user who owns this account to establish a permanent link.
              </Typography>
              {identitiesLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={28} />
                </Box>
              ) : (
                <Autocomplete
                  options={identities}
                  getOptionLabel={(option) => `${option.displayName || '—'} (${option.email || '—'})`}
                  onChange={(event, newValue) => setRemediateModal({ ...remediateModal, identityId: newValue })}
                  renderInput={(params) => <TextField {...params} label="Search Identity" variant="outlined" />}
                  isOptionEqualToValue={(option, value) => option._id === value._id}
                />
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Marking this as a false positive removes it from the uncorrelated list. It will not be linked to anyone. Continue?
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setRemediateModal({ ...remediateModal, open: false })} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={executeRemediation}
            variant="contained"
            color={remediateModal.action === 'ASSIGN' ? 'primary' : 'secondary'}
          >
            Confirm Action
          </Button>
        </DialogActions>
      </Dialog>

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
