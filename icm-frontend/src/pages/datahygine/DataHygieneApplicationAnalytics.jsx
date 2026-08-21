import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Link,
  Button,
  Alert,
  alpha,
  Stack,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  ArrowBack,
  Analytics as AnalyticsIcon,
  OpenInNew,
} from '@mui/icons-material';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';
import { dataHygieneAPI } from '../../services/api';
import { getApplicationTileTheme } from './components/widgetTheme';
import {
  readDataHygieneSummaryCache,
  writeDataHygieneSummaryCache,
} from './dataHygieneSummaryCache';
import {
  buildBackTo,
  findApplicationTile,
  resolveTenantId,
  sanitizeApplicationTile,
  WIDGET_TITLES,
} from './widgetDetailSupport';

function shortMetricLabel(label, max = 22) {
  const s = String(label || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Client-facing label for what the share percentage is measured against. */
function comparedAgainstLabel(percentBasis) {
  const raw = String(percentBasis || '').trim().toLowerCase();
  if (!raw) return '—';
  if (raw.includes('app account')) return 'App accounts';
  if (raw.includes('app entitlement')) return 'App entitlements';
  if (raw.includes('uncorrelated')) return 'Uncorrelated accounts';
  if (raw.includes('campaign')) return 'All campaigns';
  if (raw.includes('polic')) return 'All policies';
  if (raw.includes('duplicate')) return 'Duplicate groups';
  if (raw.includes('finding')) return 'All findings';
  return String(percentBasis).replace(/^%\s*of\s+/i, '').replace(/^\w/, (c) => c.toUpperCase());
}

function severityColor(percent) {
  if (percent >= 40) return '#d45c5c';
  if (percent >= 15) return '#d4883a';
  if (percent >= 5) return '#c9a820';
  return '#4a9a68';
}

function KpiCard({ label, value, sub, accent, muted }) {
  return (
    <Paper
      elevation={0}
      component={motion.div}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      sx={{
        p: 2,
        height: '100%',
        borderRadius: 2,
        border: `1px solid ${alpha(accent, 0.22)}`,
        bgcolor: muted,
      }}
    >
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Typography>
      <Typography variant="h4" fontWeight={800} sx={{ color: accent, mt: 0.5, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

export default function DataHygieneApplicationAnalytics() {
  const { applicationId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isPlatformAdmin } = useAuth();

  const tenantFromUser = resolveTenantId(user);
  const tenantFromQuery = searchParams.get('tenantId');
  const effectiveTenantId = tenantFromUser || tenantFromQuery || null;
  const appThemeIndex = Number(searchParams.get('appThemeIndex') ?? 0);

  const [tile, setTile] = useState(() => {
    const raw =
      location.state?.tile ??
      findApplicationTile(readDataHygieneSummaryCache(effectiveTenantId), applicationId);
    return sanitizeApplicationTile(raw);
  });
  const [loadingTile, setLoadingTile] = useState(!tile);
  const [tileError, setTileError] = useState(null);

  useEffect(() => {
    const fromState = location.state?.tile
      ? sanitizeApplicationTile(location.state.tile)
      : null;
    if (fromState) {
      setTile(fromState);
      setLoadingTile(false);
      setTileError(null);
      return undefined;
    }

    const fromCache = findApplicationTile(
      readDataHygieneSummaryCache(effectiveTenantId),
      applicationId,
    );
    if (fromCache) {
      setTile(fromCache);
      setLoadingTile(false);
      setTileError(null);
      return undefined;
    }

    let cancelled = false;
    setLoadingTile(true);
    setTileError(null);

    (async () => {
      try {
        const params = {};
        if (effectiveTenantId) params.tenantId = effectiveTenantId;
        const res = await dataHygieneAPI.getSummary(params);
        const summary = res?.data?.data ?? res?.data ?? null;
        if (summary) writeDataHygieneSummaryCache(effectiveTenantId, summary);
        const found = findApplicationTile(summary, applicationId);
        if (cancelled) return;
        if (found) {
          setTile(found);
          setTileError(null);
        } else {
          setTile(null);
          setTileError('Application summary not found for this id.');
        }
      } catch (err) {
        if (cancelled) return;
        setTile(null);
        setTileError(err?.response?.data?.message || err?.message || 'Failed to load application hygiene.');
      } finally {
        if (!cancelled) setLoadingTile(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applicationId, effectiveTenantId, location.state?.tile]);

  const theme = getApplicationTileTheme(appThemeIndex);
  const accent = theme.main;

  const metricRows = useMemo(() => {
    const rows = Array.isArray(tile?.rows) ? tile.rows : [];
    return rows
      .map((row) => {
        const label =
          (row.detailWidgetId && WIDGET_TITLES[row.detailWidgetId])
          || row.label
          || 'Metric';
        return {
          fullName: label,
          shortName: shortMetricLabel(label),
          count: row.count || 0,
          denominator: Number(row.denominator) > 0 ? Number(row.denominator) : 0,
          percent: row.percent ?? 0,
          comparedAgainst: comparedAgainstLabel(row.percentBasis),
          detailWidgetId: row.detailWidgetId,
          applicationId: row.applicationId ?? tile?.applicationId,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [tile]);

  const totalFindings = metricRows.reduce((s, r) => s + r.count, 0);
  const metricsWithFindings = metricRows.filter((r) => r.count > 0).length;
  const topMetric = metricRows.find((r) => r.count > 0)?.fullName ?? '—';
  const maxCount = Math.max(...metricRows.map((r) => r.count), 1);

  const backHref = buildBackTo('/datahygine', tenantFromUser ? null : effectiveTenantId, 'application');
  const needsTenantHint = isPlatformAdmin && !effectiveTenantId;

  const openMetricDetail = (row) => {
    if (!row?.detailWidgetId || !(row.count > 0)) return;
    const q = new URLSearchParams();
    q.set('applicationId', String(row.applicationId ?? applicationId ?? ''));
    if (effectiveTenantId && !tenantFromUser) q.set('tenantId', String(effectiveTenantId));
    q.set('dashboardView', 'application');
    q.set('appThemeIndex', String(appThemeIndex));
    navigate(`/datahygine/${encodeURIComponent(row.detailWidgetId)}?${q}`);
  };

  if (loadingTile) {
    return (
      <Box sx={{ bgcolor: palette.bg.primary, minHeight: '100%', p: 3, display: 'flex', justifyContent: 'center', pt: 8 }}>
        <Stack alignItems="center" spacing={1.5}>
          <CircularProgress size={36} sx={{ color: accent }} />
          <Typography color="text.secondary">Loading application hygiene…</Typography>
        </Stack>
      </Box>
    );
  }

  if (!tile) {
    return (
      <Box sx={{ bgcolor: palette.bg.primary, minHeight: '100%', p: 3 }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {tileError ||
              'Application summary not found. Open Data hygiene → Applications, then click an application name on a tile.'}
          </Alert>
          <Button component={RouterLink} to={backHref} startIcon={<ArrowBack />} variant="outlined">
            Back to applications
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ bgcolor: palette.bg.primary, minHeight: '100%', py: 3, px: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 1100, mx: 'auto' }}>
        <Link
          component={RouterLink}
          to={backHref}
          underline="none"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 2.5,
            color: accent,
            fontWeight: 700,
            fontSize: 14,
            '&:hover': { opacity: 0.75 },
          }}
        >
          <ArrowBack sx={{ fontSize: 17 }} />
          Applications
        </Link>

        <Paper
          elevation={0}
          sx={{
            mb: 3,
            borderRadius: 3,
            overflow: 'hidden',
            border: `1px solid ${alpha(accent, 0.3)}`,
          }}
        >
          <Box sx={{ height: 5, bgcolor: accent }} />
          <Box sx={{ px: 3, py: 2.5, bgcolor: 'background.paper' }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  border: `2px solid ${accent}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: accent,
                }}
              >
                <AnalyticsIcon />
              </Box>
              <Box>
                <Typography variant="h5" fontWeight={800} sx={{ color: theme.dark }}>
                  {tile.title || 'Application'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Data hygiene overview for this application
                </Typography>
              </Box>
            </Stack>
          </Box>
        </Paper>

        {needsTenantHint && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Add <strong>?tenantId=…</strong> to load data for the correct tenant.
          </Alert>
        )}

        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={4}>
            <KpiCard label="Total findings" value={totalFindings.toLocaleString()} accent={accent} muted={theme.muted} />
          </Grid>
          <Grid item xs={12} sm={4}>
            <KpiCard
              label="Metrics with issues"
              value={metricsWithFindings}
              sub={`of ${metricRows.length} tracked`}
              accent={accent}
              muted={theme.muted}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <KpiCard
              label="Highest volume"
              value={shortMetricLabel(topMetric, 28)}
              sub={topMetric !== '—' ? topMetric : undefined}
              accent={accent}
              muted={theme.muted}
            />
          </Grid>
        </Grid>

        <Paper
          elevation={0}
          component={motion.div}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          sx={{
            borderRadius: 3,
            border: `1px solid ${alpha(accent, 0.2)}`,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ px: 2.5, py: 1.5, borderBottom: `2px solid ${accent}`, bgcolor: theme.muted }}>
            <Typography variant="subtitle2" fontWeight={800} sx={{ color: theme.dark }}>
              All metrics — click a row to open records
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Share is count ÷ base for that metric (not a slice of total findings)
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 800, color: theme.dark }}>Metric</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: theme.dark, width: 100 }}>
                    Count
                  </TableCell>
                  <TableCell sx={{ fontWeight: 800, color: theme.dark, minWidth: 140, width: 160 }}>
                    Volume
                  </TableCell>
                  <TableCell sx={{ fontWeight: 800, color: theme.dark, minWidth: 140 }}>
                    Compared against
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: theme.dark, width: 110 }}>
                    Base total
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, color: theme.dark, width: 88 }}>
                    Share
                  </TableCell>
                  <TableCell align="right" sx={{ width: 48 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {metricRows.map((row, index) => {
                  const clickable = row.count > 0 && row.detailWidgetId;
                  const barPct = row.count > 0 ? Math.max(6, Math.round((100 * row.count) / maxCount)) : 0;
                  const color = severityColor(row.percent);
                  return (
                    <TableRow
                      key={row.detailWidgetId || row.fullName}
                      component={motion.tr}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: 0.03 * index }}
                      hover={clickable}
                      onClick={clickable ? () => openMetricDetail(row) : undefined}
                      sx={{
                        cursor: clickable ? 'pointer' : 'default',
                        '&:hover': clickable ? { bgcolor: alpha(accent, 0.06) } : undefined,
                      }}
                    >
                      <TableCell sx={{ fontWeight: 600, color: theme.dark }}>{row.fullName}</TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={700} sx={{ color, fontSize: 14 }}>
                          {row.count.toLocaleString()}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box
                          sx={{
                            height: 8,
                            borderRadius: 99,
                            bgcolor: alpha(color, 0.14),
                            overflow: 'hidden',
                            minWidth: 72,
                          }}
                        >
                          <Box
                            component={motion.div}
                            initial={{ width: 0 }}
                            animate={{ width: `${barPct}%` }}
                            transition={{ duration: 0.55, delay: 0.04 * index, ease: [0.22, 1, 0.36, 1] }}
                            sx={{
                              height: '100%',
                              borderRadius: 99,
                              bgcolor: color,
                            }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ color: 'text.secondary', fontSize: 13, fontWeight: 500 }}>
                          {row.comparedAgainst}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography fontWeight={600} sx={{ color: 'text.secondary', fontSize: 13 }}>
                          {row.denominator > 0 ? row.denominator.toLocaleString() : '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        {row.denominator > 0 || row.count > 0 ? (
                          <Chip
                            label={`${row.percent}%`}
                            size="small"
                            sx={{
                              fontWeight: 700,
                              fontSize: 11,
                              height: 22,
                              bgcolor: alpha(color, 0.12),
                              color,
                            }}
                          />
                        ) : (
                          <Typography sx={{ color: 'text.disabled', fontSize: 12, fontWeight: 600 }}>
                            —
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        {clickable && <OpenInNew sx={{ fontSize: 16, color: accent, opacity: 0.7 }} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>
    </Box>
  );
}
