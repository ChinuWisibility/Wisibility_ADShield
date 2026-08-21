import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Alert,
  Button,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Chip,
  alpha,
} from '@mui/material';
import { keyframes } from '@mui/system';
import {
  BugReport as HygieneIcon,
  Refresh as RefreshIcon,
  Widgets as MetricsViewIcon,
  Apartment as ApplicationViewIcon,
  CheckCircleOutline as FreshIcon,
  Sync as SyncIcon,
  WarningAmber as StaleIcon,
  ErrorOutline as FailedIcon,
} from '@mui/icons-material';
import { dataHygieneAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import DataHygieneWidgetCard from './components/DataHygieneWidgetCard';
import {
  readDataHygieneSummaryCache,
  writeDataHygieneSummaryCache,
} from './dataHygieneSummaryCache';
import DataHygieneApplicationDashboard from './DataHygieneApplicationDashboard';
import { resolveTenantId, sanitizeApplicationTile } from './widgetDetailSupport';

const POLL_INTERVAL_MS = 900;
const POLL_TIMEOUT_MS = 3 * 60 * 1000;

const progressSlide = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
`;

const iconSpin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const contentSettle = keyframes`
  0% { opacity: 0.72; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
`;

function computedAtMs(summary) {
  if (!summary?.computedAt) return 0;
  const t = Date.parse(summary.computedAt);
  return Number.isFinite(t) ? t : 0;
}

function freshnessChipProps(freshness, softRefreshing) {
  const status = softRefreshing
    ? 'processing'
    : String(freshness?.status || 'fresh').toLowerCase();
  if (status === 'failed') {
    return {
      label: 'Update failed',
      color: 'error',
      icon: <FailedIcon sx={{ fontSize: 16 }} />,
    };
  }
  if (status === 'processing' || softRefreshing) {
    return {
      label: 'Refreshing…',
      color: 'default',
      icon: <SyncIcon sx={{ fontSize: 16 }} />,
    };
  }
  if (status === 'dirty' || status === 'neverbuilt') {
    return {
      label: 'Updating in background',
      color: 'warning',
      icon: <StaleIcon sx={{ fontSize: 16 }} />,
    };
  }
  return {
    label: 'Up to date',
    color: 'success',
    variant: 'outlined',
    icon: <FreshIcon sx={{ fontSize: 16 }} />,
  };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'CanceledError', code: 'ERR_CANCELED' }));
      return;
    }
    const id = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(Object.assign(new Error('Aborted'), { name: 'CanceledError', code: 'ERR_CANCELED' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export default function DataHygieneDashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantFromUser = resolveTenantId(user);
  const tenantFromQuery = searchParams.get('tenantId');
  const effectiveTenantId = tenantFromUser || tenantFromQuery || null;
  const dashboardView = searchParams.get('view') === 'application' ? 'application' : 'metric';

  const [loading, setLoading] = useState(() => readDataHygieneSummaryCache(effectiveTenantId) == null);
  const [refreshing, setRefreshing] = useState(false);
  /** Background SWR poll after Refresh — does not block the UI. */
  const [softRefreshing, setSoftRefreshing] = useState(false);
  /** Bumps when a fresh snapshot lands so tiles can play a settle animation. */
  const [contentTick, setContentTick] = useState(0);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(() => readDataHygieneSummaryCache(effectiveTenantId));
  const summaryAbortRef = useRef(null);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  const load = useCallback(
    async (opts = {}) => {
      summaryAbortRef.current?.abort();

      const bypassCache = opts.bypassCache === true;
      if (!bypassCache) {
        const cached = readDataHygieneSummaryCache(effectiveTenantId);
        if (cached) {
          setSummary(cached);
          setLoading(false);
          setRefreshing(false);
          setSoftRefreshing(false);
          setError(null);
          return;
        }
      }

      const controller = new AbortController();
      summaryAbortRef.current = controller;

      const currentSummary = summaryRef.current;
      const keepVisible = bypassCache && currentSummary != null;
      if (keepVisible) {
        // Brief button feedback only — do not wait for full recompute.
        setRefreshing(true);
        setError(null);
      } else {
        setLoading(true);
        setRefreshing(false);
        setSoftRefreshing(false);
        setError(null);
        setSummary(null);
      }

      try {
        const params = {};
        if (effectiveTenantId) params.tenantId = effectiveTenantId;
        const res = await dataHygieneAPI.getSummary(params, {
          signal: controller.signal,
          refresh: bypassCache,
        });
        if (summaryAbortRef.current !== controller) return;

        const payload = res.data?.data ?? res.data;
        const meta = res.data?.meta ?? null;
        const previousComputedAt =
          meta?.previousComputedAt ??
          payload?.computedAt ??
          currentSummary?.computedAt ??
          null;
        const previousMs = computedAtMs({ computedAt: previousComputedAt });

        if (bypassCache && meta?.staleWhileRevalidate) {
          if (payload) {
            setSummary(payload);
            writeDataHygieneSummaryCache(effectiveTenantId, payload);
          }
          setLoading(false);
          setRefreshing(false);
          setSoftRefreshing(true);

          // Poll for the new snapshot without blocking Refresh / tiles.
          void (async () => {
            const deadline = Date.now() + POLL_TIMEOUT_MS;
            try {
              while (Date.now() < deadline) {
                if (summaryAbortRef.current !== controller) return;
                await sleep(POLL_INTERVAL_MS, controller.signal);
                if (summaryAbortRef.current !== controller) return;

                const pollRes = await dataHygieneAPI.getSummary(params, {
                  signal: controller.signal,
                  refresh: false,
                });
                if (summaryAbortRef.current !== controller) return;
                const next = pollRes.data?.data ?? pollRes.data;
                if (next && computedAtMs(next) > previousMs) {
                  setSummary(next);
                  writeDataHygieneSummaryCache(effectiveTenantId, next);
                  setContentTick((n) => n + 1);
                  setError(null);
                  return;
                }
              }
            } catch (e) {
              if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
            } finally {
              if (summaryAbortRef.current === controller) {
                setSoftRefreshing(false);
              }
            }
          })();
          return;
        }

        setSummary(payload);
        if (payload) {
          writeDataHygieneSummaryCache(effectiveTenantId, payload);
        }
      } catch (e) {
        if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
        if (summaryAbortRef.current !== controller) return;
        setError(e?.response?.data?.message || e.message || 'Failed to load data hygiene summary');
        if (!keepVisible) {
          setSummary(null);
        }
      } finally {
        if (summaryAbortRef.current === controller) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [effectiveTenantId],
  );

  useEffect(() => {
    void load();
    return () => {
      summaryAbortRef.current?.abort();
    };
  }, [load]);

  const needsTenantHint = !effectiveTenantId && user?.role === 'superAdmin';
  const widgets = Array.isArray(summary?.widgets) ? summary.widgets : [];
  const applicationTiles = Array.isArray(summary?.applicationTiles)
    ? summary.applicationTiles.map(sanitizeApplicationTile)
    : [];
  const tenantIdForLinks = !tenantFromUser && effectiveTenantId ? effectiveTenantId : null;
  const busy = loading || refreshing;
  const freshnessProps = freshnessChipProps(summary?.freshness, softRefreshing);

  const handleViewChange = (_, nextView) => {
    if (!nextView || nextView === dashboardView) return;
    const next = new URLSearchParams(searchParams);
    if (nextView === 'application') next.set('view', 'application');
    else next.delete('view');
    setSearchParams(next, { replace: true });
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1920, mx: 'auto', position: 'relative', minWidth: 0 }}>
      {/* Slim indeterminate bar while background refresh runs */}
      <Box
        aria-hidden={!softRefreshing}
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          overflow: 'hidden',
          borderRadius: '0 0 2px 2px',
          opacity: softRefreshing ? 1 : 0,
          transition: 'opacity 0.25s ease',
          pointerEvents: 'none',
          zIndex: 5,
          bgcolor: alpha('#64748b', 0.12),
        }}
      >
        <Box
          sx={{
            width: '32%',
            height: '100%',
            borderRadius: 1,
            background: 'linear-gradient(90deg, transparent, #475569 35%, #94a3b8 55%, transparent)',
            animation: softRefreshing ? `${progressSlide} 1.15s ease-in-out infinite` : 'none',
          }}
        />
      </Box>

      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: alpha('#fff', 0.55),
            backdropFilter: 'blur(1px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <CircularProgress size={28} thickness={4} sx={{ color: '#64748b' }} />
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <HygieneIcon color="primary" sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={800}>Data hygiene</Typography>
            <Typography variant="body2" color="text.secondary">
              {dashboardView === 'application'
                ? 'Application-wise tiles with all hygiene metrics inside each card.'
                : 'Metric-wise tiles grouped by application.'}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {summary && (
            <Chip
              size="small"
              {...freshnessProps}
              sx={{
                height: 28,
                fontWeight: 600,
                '& .MuiChip-icon': { ml: 0.5 },
              }}
            />
          )}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={dashboardView}
            onChange={handleViewChange}
            aria-label="Data hygiene dashboard view"
          >
            <ToggleButton value="metric" aria-label="Metric-wise view">
              <MetricsViewIcon sx={{ fontSize: 18, mr: 0.75 }} />
              Metrics
            </ToggleButton>
            <ToggleButton value="application" aria-label="Application-wise view">
              <ApplicationViewIcon sx={{ fontSize: 18, mr: 0.75 }} />
              Applications
            </ToggleButton>
          </ToggleButtonGroup>
          <Button
            startIcon={
              <RefreshIcon
                sx={{
                  fontSize: 18,
                  animation:
                    softRefreshing || refreshing
                      ? `${iconSpin} 0.85s linear infinite`
                      : 'none',
                }}
              />
            }
            variant="outlined"
            size="small"
            onClick={() => void load({ bypassCache: true })}
            disabled={busy}
            sx={{
              minWidth: 108,
              borderColor: softRefreshing ? alpha('#64748b', 0.45) : undefined,
              color: softRefreshing ? 'text.secondary' : undefined,
              transition: 'border-color 0.2s, color 0.2s',
            }}
          >
            {softRefreshing ? 'Refreshing' : refreshing ? 'Updating…' : 'Refresh'}
          </Button>
        </Box>
      </Box>

      {needsTenantHint && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Add <strong>?tenantId=…</strong> to the URL or use a tenant-scoped account to load metrics.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box
        key={contentTick}
        sx={{
          animation: contentTick > 0 ? `${contentSettle} 0.35s ease-out` : 'none',
        }}
      >
        {dashboardView === 'application' ? (
          <DataHygieneApplicationDashboard
            applicationTiles={applicationTiles}
            loading={loading}
            tenantIdForLinks={tenantIdForLinks}
          />
        ) : (
          <Grid container spacing={2}>
            {widgets.map((w) => (
              <Grid item xs={12} sm={6} lg={3} key={w.id}>
                <DataHygieneWidgetCard
                  widget={w}
                  loading={loading}
                  tenantIdForLinks={tenantIdForLinks}
                  dashboardView={dashboardView}
                />
              </Grid>
            ))}
            {!loading && widgets.length === 0 && (
              <Grid item xs={12}>
                <Alert severity="warning">No widget data returned. Check tenant scope and API response.</Alert>
              </Grid>
            )}
          </Grid>
        )}
      </Box>
    </Box>
  );
}
