import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Stack,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Tabs,
  Tab,
  Divider,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Tooltip,
  Menu,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  ArrowBack,
  PlayCircleOutline,
  SettingsOutlined,
  DashboardOutlined,
  RefreshOutlined,
  FiberNewOutlined,
  HourglassTopOutlined,
  ErrorOutline,
  ScheduleOutlined,
  ArrowForward,
  DeleteOutline,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import schedulerAPI from '../../../services/schedulerService.js';

const ORG_ADMIN_BASE = '/org-admin';
const DASHBOARD_REFRESH_MS = 30_000;

const LOG_FILTER_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'all', label: 'All time' },
];

const CLEAR_LOG_OPTIONS = [
  { mode: 'all', label: 'Clear all logs', confirm: 'Delete all scheduler run logs for this tenant? This cannot be undone.' },
  { mode: 'before_today', label: 'Delete before today', confirm: 'Delete all logs from before today and keep only today\'s entries?' },
  { mode: 'older_than_7_days', label: 'Delete older than 7 days', confirm: 'Delete scheduler logs older than 7 days?' },
];

const tabItems = [
  { id: 'configuration', label: 'Configuration', icon: <SettingsOutlined fontSize="small" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardOutlined fontSize="small" /> },
];

const EMPTY_DASHBOARD = {
  queue: { total: 0, new: 0, inProgress: 0, completed: 0, failed: 0 },
  today: { newCaptured: 0, movedToInProgress: 0, runs: 0, processed: 0, failedRuns: 0, skippedRuns: 0 },
  last24h: { runs: 0, processed: 0, failedRuns: 0, skippedRuns: 0, successRate: 100, avgProcessedPerRun: 0 },
  scheduler: { enabled: false, scheduleType: 'MINUTE', interval: 5, lastRunAt: null, nextRunAt: null, isOverdue: false },
  trend: [],
  alerts: [],
  lastRun: null,
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return '—';
  const diffMs = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return diffMs >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return diffMs >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return diffMs >= 0 ? `in ${days}d` : `${days}d ago`;
}

function statusChip(status) {
  const map = {
    SUCCESS: { label: 'Success', color: 'success' },
    FAILED: { label: 'Failed', color: 'error' },
    SKIPPED: { label: 'Skipped', color: 'warning' },
  };
  const cfg = map[status] || { label: status, color: 'default' };
  return <Chip size="small" label={cfg.label} color={cfg.color} variant="outlined" />;
}

function triggerChip(triggerType) {
  const isScheduled = triggerType === 'SCHEDULED';
  return (
    <Chip
      size="small"
      label={isScheduled ? 'Scheduled' : 'Manual'}
      color={isScheduled ? 'primary' : 'default'}
      variant="outlined"
    />
  );
}

function MetricCard({ title, value, subtitle, icon, accent = '#2563eb' }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight={800} sx={{ lineHeight: 1.1 }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {icon && (
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                bgcolor: `${accent}14`,
                color: accent,
              }}
            >
              {icon}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function QueuePipeline({ queue }) {
  const waiting = queue.new ?? 0;
  const processing = queue.inProgress ?? 0;
  const total = waiting + processing || 1;

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
          Queue status
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Scheduler rule: if <strong>NEW</strong> records exist, move them to <strong>IN_PROGRESS</strong>.
        </Typography>

        <Box sx={{ display: 'flex', height: 14, borderRadius: 99, overflow: 'hidden', bgcolor: '#f1f5f9', mb: 2 }}>
          {waiting > 0 && (
            <Tooltip title={`NEW (waiting): ${waiting}`}>
              <Box sx={{ width: `${(waiting / total) * 100}%`, bgcolor: '#f59e0b', minWidth: 8 }} />
            </Tooltip>
          )}
          {processing > 0 && (
            <Tooltip title={`IN_PROGRESS: ${processing}`}>
              <Box sx={{ width: `${(processing / total) * 100}%`, bgcolor: '#2563eb', minWidth: 8 }} />
            </Tooltip>
          )}
        </Box>

        <Grid container spacing={2} alignItems="center">
          <Grid item xs={5}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#f59e0b' }} />
              <Box>
                <Typography variant="caption" color="text.secondary">NEW — waiting</Typography>
                <Typography variant="h5" fontWeight={800} color="#b45309">{waiting}</Typography>
              </Box>
            </Stack>
          </Grid>
          <Grid item xs={2} sx={{ textAlign: 'center' }}>
            <ArrowForward sx={{ color: 'text.disabled' }} />
          </Grid>
          <Grid item xs={5}>
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end">
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary">IN_PROGRESS — processing</Typography>
                <Typography variant="h5" fontWeight={800} color="#1d4ed8">{processing}</Typography>
              </Box>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: '#2563eb' }} />
            </Stack>
          </Grid>
        </Grid>

        {waiting > 0 && (
          <Alert severity="info" sx={{ mt: 2 }} variant="outlined">
            {waiting} record(s) in NEW status are ready to be picked up on the next scheduler run.
          </Alert>
        )}
        {waiting === 0 && processing === 0 && (
          <Alert severity="info" sx={{ mt: 2 }} variant="outlined">
            No records in the queue. Use &quot;Generate Dummy Records&quot; to create test data.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function TrendChart({ trend }) {
  const maxProcessed = Math.max(...trend.map((d) => d.processed), 1);

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
          7-day activity
        </Typography>
        {trend.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            No scheduler activity in the last 7 days.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 140, px: 0.5 }}>
            {trend.map((day) => (
              <Tooltip
                key={day._id}
                title={`${day._id}: ${day.processed} processed · ${day.captured} captured · ${day.runs} runs`}
              >
                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                  <Box
                    sx={{
                      width: '100%',
                      maxWidth: 48,
                      height: `${Math.max((day.processed / maxProcessed) * 100, day.processed > 0 ? 8 : 2)}%`,
                      minHeight: day.processed > 0 ? 8 : 2,
                      bgcolor: '#2563eb',
                      borderRadius: '6px 6px 2px 2px',
                    }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {day._id.slice(5)}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
          </Box>
        )}
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">Bars = records moved to IN_PROGRESS</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SchedulerDashboard({
  dashboard,
  logs,
  logFilter,
  logCount,
  onLogFilterChange,
  onClearLogs,
  clearingLogs,
  onRefresh,
  refreshing,
}) {
  const { queue, today, last24h, scheduler, trend, alerts, lastRun } = dashboard;
  const [clearMenuAnchor, setClearMenuAnchor] = useState(null);
  const actionableAlerts = alerts.filter((a) => a.severity === 'warning' || a.severity === 'error');

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1}>
        <Typography variant="subtitle1" fontWeight={700}>
          Operations overview
        </Typography>
        <Button
          size="small"
          startIcon={refreshing ? <CircularProgress size={14} /> : <RefreshOutlined fontSize="small" />}
          onClick={onRefresh}
          disabled={refreshing}
          sx={{ textTransform: 'none' }}
        >
          Refresh
        </Button>
      </Stack>

      {actionableAlerts.length > 0 && (
        <Stack spacing={1}>
          {actionableAlerts.map((alert) => (
            <Alert key={alert.code} severity={alert.severity} variant="outlined">
              <Typography variant="subtitle2" fontWeight={700}>{alert.title}</Typography>
              <Typography variant="body2">{alert.detail}</Typography>
            </Alert>
          ))}
        </Stack>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={4}>
          <MetricCard
            title="NEW — waiting"
            value={queue.new}
            subtitle="Records ready to be picked up"
            icon={<FiberNewOutlined />}
            accent="#f59e0b"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <MetricCard
            title="IN_PROGRESS"
            value={queue.inProgress}
            subtitle={`${today.movedToInProgress} moved today`}
            icon={<HourglassTopOutlined />}
            accent="#2563eb"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <MetricCard
            title="Last run processed"
            value={lastRun?.recordsMovedToInProgress ?? lastRun?.recordsUpdated ?? 0}
            subtitle={lastRun?.summary || 'No runs yet'}
            icon={<ScheduleOutlined />}
            accent="#7c3aed"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <QueuePipeline queue={queue} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ borderRadius: 2, height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                Scheduler health
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Status</Typography>
                  <Chip
                    size="small"
                    label={scheduler.enabled ? (scheduler.isOverdue ? 'Overdue' : 'Active') : 'Paused'}
                    color={scheduler.enabled ? (scheduler.isOverdue ? 'error' : 'success') : 'default'}
                  />
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Schedule</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    Every {scheduler.interval} {scheduler.scheduleType?.toLowerCase()}(s)
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Last run</Typography>
                  <Typography variant="body2" fontWeight={600}>{formatRelativeTime(scheduler.lastRunAt)}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">Next run</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {scheduler.enabled ? formatRelativeTime(scheduler.nextRunAt) : '—'}
                  </Typography>
                </Stack>
                <Divider />
                {lastRun ? (
                  <Box>
                    <Typography variant="caption" color="text.secondary">Latest run summary</Typography>
                    <Typography variant="body2" sx={{ mt: 0.5 }}>{lastRun.summary || '—'}</Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">No runs recorded yet.</Typography>
                )}
                <Box sx={{ pt: 0.5 }}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">24h reliability</Typography>
                    <Typography variant="caption" fontWeight={700}>{last24h.successRate}%</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={last24h.successRate} sx={{ height: 6, borderRadius: 99 }} />
                  {(last24h.failedRuns > 0 || last24h.skippedRuns > 0) && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      {last24h.failedRuns > 0 && (
                        <Chip size="small" icon={<ErrorOutline />} label={`${last24h.failedRuns} failed`} color="error" variant="outlined" />
                      )}
                      {last24h.skippedRuns > 0 && (
                        <Chip size="small" label={`${last24h.skippedRuns} skipped`} color="warning" variant="outlined" />
                      )}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <TrendChart trend={trend} />

      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ sm: 'flex-start' }}
            spacing={1.5}
            sx={{ mb: 2 }}
          >
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                Run activity log
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Each run checks for NEW records and moves them to IN_PROGRESS.
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Filter</InputLabel>
                <Select
                  value={logFilter}
                  label="Filter"
                  onChange={(e) => onLogFilterChange(e.target.value)}
                >
                  {LOG_FILTER_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={clearingLogs ? <CircularProgress size={14} /> : <DeleteOutline fontSize="small" />}
                disabled={clearingLogs}
                onClick={(e) => setClearMenuAnchor(e.currentTarget)}
                sx={{ textTransform: 'none' }}
              >
                Clear logs
              </Button>
              <Menu
                anchorEl={clearMenuAnchor}
                open={Boolean(clearMenuAnchor)}
                onClose={() => setClearMenuAnchor(null)}
              >
                {CLEAR_LOG_OPTIONS.map((opt) => (
                  <MenuItem
                    key={opt.mode}
                    onClick={() => {
                      setClearMenuAnchor(null);
                      onClearLogs(opt.mode, opt.confirm);
                    }}
                  >
                    {opt.label}
                  </MenuItem>
                ))}
              </Menu>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            Showing {logs.length} of {logCount} {LOG_FILTER_OPTIONS.find((o) => o.value === logFilter)?.label?.toLowerCase() || 'matching'} entries
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Run time</TableCell>
                <TableCell>Trigger</TableCell>
                <TableCell align="right">NEW found</TableCell>
                <TableCell align="right">→ IN_PROGRESS</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                    No runs for this filter. Try another date range or run the scheduler.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((r) => (
                  <TableRow key={r._id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(r.executionTime)}</TableCell>
                    <TableCell>{triggerChip(r.triggerType)}</TableCell>
                    <TableCell align="right">{r.recordsFound ?? 0}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, color: (r.recordsMovedToInProgress ?? r.recordsUpdated) > 0 ? 'success.main' : 'text.secondary' }}>
                      {r.recordsMovedToInProgress ?? r.recordsUpdated ?? 0}
                    </TableCell>
                    <TableCell>{statusChip(r.status)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Stack>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4 }}>
          <Typography variant="h6" color="error" sx={{ mb: 2 }}>An unexpected error occurred while rendering this page.</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 2 }}>{String(this.state.error)}</Typography>
          <Button variant="contained" onClick={() => window.location.reload()}>Reload</Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

function RemediationQueueSchedulerContent() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [section, setSection] = useState('dashboard');
  const [config, setConfig] = useState({ enabled: false, scheduleType: 'MINUTE', interval: 5 });
  const [dashboard, setDashboard] = useState(EMPTY_DASHBOARD);
  const [logs, setLogs] = useState([]);
  const [logFilter, setLogFilter] = useState('today');
  const [logCount, setLogCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const logFilterInitialized = useRef(false);

  const loadLogs = useCallback(async (range = logFilter) => {
    const logsRes = await schedulerAPI.getExecutionLogs({ limit: 100, range });
    setLogs(logsRes.data?.data || []);
    setLogCount(logsRes.data?.meta?.count ?? logsRes.data?.data?.length ?? 0);
  }, [logFilter]);

  const loadAll = useCallback(async ({ silent = false, range = logFilter } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [cfgRes, dashRes, logsRes] = await Promise.all([
        schedulerAPI.getConfig(),
        schedulerAPI.getDashboard(),
        schedulerAPI.getExecutionLogs({ limit: 100, range }),
      ]);
      setConfig(cfgRes.data?.data || config);
      setDashboard(dashRes.data?.data || EMPTY_DASHBOARD);
      setLogs(logsRes.data?.data || []);
      setLogCount(logsRes.data?.meta?.count ?? logsRes.data?.data?.length ?? 0);
    } catch {
      enqueueSnackbar('Failed to load scheduler data', { variant: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [config, enqueueSnackbar, logFilter]);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!logFilterInitialized.current) {
      logFilterInitialized.current = true;
      return undefined;
    }
    loadLogs(logFilter).catch(() => {
      enqueueSnackbar('Failed to load activity logs', { variant: 'error' });
    });
    return undefined;
  }, [logFilter, loadLogs, enqueueSnackbar]);

  useEffect(() => {
    if (section !== 'dashboard') return undefined;
    const timer = setInterval(() => loadAll({ silent: true }), DASHBOARD_REFRESH_MS);
    return () => clearInterval(timer);
  }, [section, loadAll]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await schedulerAPI.saveConfig(config);
      setConfig(res.data?.data || config);
      enqueueSnackbar('Scheduler configuration saved', { variant: 'success' });
      await loadAll({ silent: true });
    } catch {
      enqueueSnackbar('Failed to save configuration', { variant: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    try {
      const res = await schedulerAPI.generateDummy();
      const created = res.data?.data?.created ?? 0;
      enqueueSnackbar(`${created} dummy records created`, { variant: 'success' });
      await loadAll({ silent: true });
    } catch {
      enqueueSnackbar('Failed to create dummy records', { variant: 'error' });
    }
  }

  async function handleDeleteGeneratedRecords() {
    const confirmed = window.confirm(
      'Delete all generated scheduler test records? This will only remove dummy records created by the scheduler module.'
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      const res = await schedulerAPI.deleteDummyRecords();
      const deleted = res.data?.data?.deleted ?? 0;
      enqueueSnackbar(`${deleted} generated records deleted.`, { variant: 'success' });
      await loadAll({ silent: true });
    } catch {
      enqueueSnackbar('Failed to delete generated records', { variant: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  async function handleClearLogs(mode, confirmMessage) {
    if (!window.confirm(confirmMessage)) return;
    setClearingLogs(true);
    try {
      const res = await schedulerAPI.clearExecutionLogs(mode);
      const deleted = res.data?.data?.deleted ?? 0;
      enqueueSnackbar(`${deleted} log entr${deleted === 1 ? 'y' : 'ies'} deleted`, { variant: 'success' });
      await loadLogs(logFilter);
      await loadAll({ silent: true });
    } catch {
      enqueueSnackbar('Failed to delete logs', { variant: 'error' });
    } finally {
      setClearingLogs(false);
    }
  }

  async function handleRunNow() {
    try {
      const res = await schedulerAPI.runNow();
      const data = res.data?.data || {};
      if (data.skipped) {
        enqueueSnackbar(data.message || 'Run skipped', { variant: 'info' });
      } else {
        enqueueSnackbar(data.message || 'Scheduler run complete', {
          variant: data.recordsUpdated > 0 ? 'success' : 'info',
        });
      }
      await loadAll({ silent: true });
    } catch {
      enqueueSnackbar('Scheduler execution failed', { variant: 'error' });
    }
  }

  const currentSection = section || 'configuration';
  const schedulerInfo = dashboard.scheduler || EMPTY_DASHBOARD.scheduler;
  const statusLabel = config.enabled
    ? (schedulerInfo.isOverdue ? 'Overdue' : 'Running')
    : 'Stopped';

  return (
    <Box sx={{ minHeight: '100%', bgcolor: '#f8fafc' }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, pb: 3, pt: 2, maxWidth: 1280, mx: 'auto' }}>
        <Button
          startIcon={<ArrowBack fontSize="small" />}
          onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
          size="small"
          sx={{ mb: 2, color: 'text.secondary' }}
        >
          Global rule set
        </Button>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h5" fontWeight={700} letterSpacing="-0.02em">
            Remediation queue scheduler
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
            Configure and monitor the proof-of-concept remediation queue scheduler for tenant test records.
          </Typography>
        </Box>

        <Box sx={{ bgcolor: '#fff', borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Tabs
            value={currentSection}
            onChange={(_, value) => setSection(value)}
            sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }}
            variant="standard"
          >
            {tabItems.map((item) => (
              <Tab
                key={item.id}
                value={item.id}
                label={item.label}
                icon={item.icon}
                iconPosition="start"
                sx={{ textTransform: 'none', fontWeight: 600 }}
              />
            ))}
          </Tabs>
          <Divider />

          <Box sx={{ p: { xs: 2, sm: 3 }, minHeight: 520 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>
                <CircularProgress />
              </Box>
            ) : currentSection === 'configuration' ? (
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <Card variant="outlined" sx={{ borderRadius: 2, p: 2, height: '100%' }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                      Scheduler Configuration
                    </Typography>
                    <Stack spacing={2}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!config.enabled}
                            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                          />
                        }
                        label="Enable Scheduler"
                      />
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                          Schedule type
                        </Typography>
                        <Select
                          fullWidth
                          value={config.scheduleType}
                          onChange={(e) => setConfig({ ...config, scheduleType: e.target.value })}
                        >
                          <MenuItem value="MINUTE">Minutes</MenuItem>
                          <MenuItem value="HOUR">Hours</MenuItem>
                          <MenuItem value="DAY">Days</MenuItem>
                        </Select>
                      </Box>
                      <TextField
                        label="Interval"
                        type="number"
                        fullWidth
                        value={config.interval}
                        onChange={(e) => setConfig({ ...config, interval: Number(e.target.value) })}
                        inputProps={{ min: 1 }}
                      />
                      <Button variant="contained" onClick={handleSave} disabled={saving || loading} sx={{ textTransform: 'none', py: 1.25, fontWeight: 700 }}>
                        {saving ? 'Saving…' : 'Save Configuration'}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>
                <Grid item xs={12} md={8}>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={6}>
                      <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                          Scheduler Status
                        </Typography>
                        <Typography variant="h6" fontWeight={700}>
                          {statusLabel}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                          {config.enabled
                            ? `Next run ${formatRelativeTime(schedulerInfo.nextRunAt || config.nextRunAt)}`
                            : 'Scheduler is currently paused.'}
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                          Processed today
                        </Typography>
                        <Typography variant="h6" fontWeight={700}>
                          {dashboard.today?.movedToInProgress ?? 0}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                          {dashboard.today?.runs ?? 0} run(s) today
                        </Typography>
                      </Card>
                    </Grid>
                    <Grid item xs={12}>
                      <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                          Current backlog
                        </Typography>
                        <Stack direction="row" spacing={3}>
                          <Box>
                            <Typography variant="caption" color="text.secondary">NEW</Typography>
                            <Typography variant="h6" fontWeight={700}>{dashboard.queue?.new ?? 0}</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">IN_PROGRESS</Typography>
                            <Typography variant="h6" fontWeight={700}>{dashboard.queue?.inProgress ?? 0}</Typography>
                          </Box>
                          <Box>
                            <Typography variant="caption" color="text.secondary">Captured today</Typography>
                            <Typography variant="h6" fontWeight={700}>{dashboard.today?.newCaptured ?? 0}</Typography>
                          </Box>
                        </Stack>
                      </Card>
                    </Grid>
                  </Grid>
                </Grid>
                <Grid item xs={12}>
                  <Card variant="outlined" sx={{ borderRadius: 2, p: 2 }}>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>
                      Test data & manual run
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                      Generate sample queue records or trigger the scheduler manually for testing.
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        onClick={handleDeleteGeneratedRecords}
                        disabled={loading || deleting}
                        color="error"
                        variant="outlined"
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                      >
                        Delete generated records
                      </Button>
                    </Stack>
                  </Card>
                </Grid>
              </Grid>
            ) : (
              <SchedulerDashboard
                dashboard={dashboard}
                logs={logs}
                logFilter={logFilter}
                logCount={logCount}
                onLogFilterChange={setLogFilter}
                onClearLogs={handleClearLogs}
                clearingLogs={clearingLogs}
                onRefresh={() => loadAll({ silent: true })}
                refreshing={refreshing}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function RemediationQueueScheduler() {
  return (
    <ErrorBoundary>
      <RemediationQueueSchedulerContent />
    </ErrorBoundary>
  );
}
