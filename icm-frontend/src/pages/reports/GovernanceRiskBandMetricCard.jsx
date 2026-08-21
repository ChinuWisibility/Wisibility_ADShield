import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box, Typography, Paper, Button, Slider, Alert, CircularProgress, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Tune, NorthEast } from '@mui/icons-material';
import {
  applicationAPI,
  correlationAPI,
  orgAdminAPI,
  reportAPI,
} from '../../services/api';

const T = {
  blueMid: '#2563eb',
  red: '#c8252a', redLt: '#fef2f2', redBdr: '#fbc2c2',
  amber: '#b45309', amberLt: '#fffbeb', amberBdr: '#fcd89d',
  green: '#166534', greenLt: '#f0fdf4', greenBdr: '#a7f3cc',
  ink: '#0d1e35', ink2: '#3d5166', ink3: '#7e96ae', ink4: '#b0c0cf',
  surface: '#ffffff', border: '#dde3ed',
};

const RISK_CHIP = {
  low: { bgcolor: alpha(T.blueMid, 0.12), color: '#1d4ed8', border: '1px solid #93c5fd', fontWeight: 700 },
  medium: { bgcolor: T.amberLt, color: T.amber, border: `1px solid ${T.amberBdr}`, fontWeight: 700 },
  high: { bgcolor: '#fff7ed', color: '#c2410c', border: '1px solid #fdba74', fontWeight: 700 },
  critical: { bgcolor: T.redLt, color: '#991b1b', border: `1px solid ${T.redBdr}`, fontWeight: 700 },
};

/** For metrics where higher values are healthier (e.g. active share): left = weaker, right = stronger. */
const COVERAGE_CHIP = {
  low: { bgcolor: T.amberLt, color: T.amber, border: `1px solid ${T.amberBdr}`, fontWeight: 700 },
  medium: { bgcolor: alpha('#0ea5e9', 0.12), color: '#0369a1', border: '1px solid #7dd3fc', fontWeight: 700 },
  high: { bgcolor: T.greenLt, color: T.green, border: `1px solid ${T.greenBdr}`, fontWeight: 700 },
  critical: { bgcolor: '#ecfdf5', color: '#047857', border: '1px solid #6ee7b7', fontWeight: 700 },
};

/** Per-metric chrome (slider, header tint, save button). */
export const GOVERNANCE_RISK_BAND_PALETTES = {
  orphan: { accent: '#7c3aed', accentHover: '#6d28d9' },
  active_users: { accent: '#0d9488', accentHover: '#0f7668' },
  inactive_users: { accent: '#475569', accentHover: '#334155' },
  privileged_users: { accent: '#c2410c', accentHover: '#9a3412' },
};

function buildSliderSx(accent) {
  return {
    color: accent,
    /** Room above the rail so open value labels do not collide with thumbs */
    py: 3.25,
    '& .MuiSlider-thumb': {
      width: 20,
      height: 20,
      backgroundColor: '#fff',
      border: `2px solid ${accent}`,
      boxShadow: '0 1px 4px rgba(13,30,53,0.12)',
      zIndex: 1,
      '&:hover, &.Mui-focusVisible, &.Mui-active': { boxShadow: `0 0 0 6px ${alpha(accent, 0.15)}` },
    },
    '& .MuiSlider-track': { display: 'none' },
    '& .MuiSlider-rail': {
      height: 10,
      opacity: 1,
    },
    /** Popper wrapper — keep transparent so the “pill” is only the inner circle */
    '& .MuiSlider-valueLabel': {
      backgroundColor: 'transparent',
      padding: 0,
      zIndex: 5,
      '&::before': { display: 'none' },
    },
    '& .MuiSlider-valueLabelCircle': {
      backgroundColor: '#1e293b',
      color: '#fff',
      padding: '8px 14px',
      borderRadius: '10px',
      fontSize: '0.8125rem',
      fontWeight: 600,
      lineHeight: 1.45,
      boxShadow: '0 2px 12px rgba(13, 30, 53, 0.28)',
      width: 'auto',
      height: 'auto',
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transform: 'none',
    },
    '& .MuiSlider-valueLabelLabel': {
      fontSize: '0.8125rem',
      fontWeight: 600,
      lineHeight: 1.45,
      color: '#fff',
      padding: 0,
    },
  };
}

function clampBandTriple(raw) {
  let [a, b, c] = raw.map((x) => Math.round(Number(x)));
  a = Math.min(96, Math.max(1, a));
  b = Math.min(98, Math.max(a + 1, b));
  c = Math.min(99, Math.max(b + 1, c));
  return [a, b, c];
}

function buildFourBandRailGradient(coverageSemantics, A, B, C) {
  const [col0, col1, col2, col3] = coverageSemantics
    ? ['#fbbf24', '#38bdf8', '#4ade80', '#047857']
    : ['#2563eb', '#fbbf24', '#fb923c', '#b91c1c'];
  return `linear-gradient(90deg, ${col0} 0%, ${col0} ${A}%, ${col1} ${A}%, ${col1} ${B}%, ${col2} ${B}%, ${col2} ${C}%, ${col3} ${C}%, ${col3} 100%)`;
}

/**
 * @param {number} pct
 * @param {number} A
 * @param {number} B
 * @param {number} [C] — if omitted, uses legacy 3-tier rules (high when pct ≥ B and B < 100).
 */
export function classifyGovernanceRiskBand(pct, A, B, C) {
  const a = Number(A);
  const b = Number(B);
  const c = C == null || !Number.isFinite(Number(C)) ? null : Number(C);
  if (c == null) {
    if (pct < a) return 'low';
    if (b >= 100) return 'medium';
    if (pct < b) return 'medium';
    return 'high';
  }
  if (pct < a) return 'low';
  if (pct < b) return 'medium';
  if (pct < c) return 'high';
  return 'critical';
}

function bandLabel(level, coverageSemantics) {
  if (level === 'low') return coverageSemantics ? 'Lower coverage' : 'Low risk';
  if (level === 'medium') return coverageSemantics ? 'Moderate coverage' : 'Medium risk';
  if (level === 'high') return coverageSemantics ? 'Strong coverage' : 'High risk';
  return coverageSemantics ? 'Peak coverage' : 'Critical risk';
}

function chipSxForVariant(level, coverageSemantics) {
  const map = coverageSemantics ? COVERAGE_CHIP : RISK_CHIP;
  return map[level] ?? map.medium;
}

function badgeTextForLevel(level, tierBadgeLabels, coverageSemantics) {
  if (tierBadgeLabels) {
    return tierBadgeLabels[level] ?? bandLabel(level, coverageSemantics);
  }
  return bandLabel(level, coverageSemantics);
}

function FourTierLegend({ coverageSemantics }) {
  const risk = [
    { key: 'low', label: 'Low', color: '#2563eb' },
    { key: 'medium', label: 'Medium', color: '#fbbf24' },
    { key: 'high', label: 'High', color: '#fb923c' },
    { key: 'critical', label: 'Critical', color: '#b91c1c' },
  ];
  const cov = [
    { key: 'low', label: 'Low', color: '#fbbf24' },
    { key: 'medium', label: 'Medium', color: '#38bdf8' },
    { key: 'high', label: 'High', color: '#4ade80' },
    { key: 'critical', label: 'Critical', color: '#047857' },
  ];
  const items = coverageSemantics ? cov : risk;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, mb: 1.5 }}>
      {items.map((it) => (
        <Box key={it.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: it.color, flexShrink: 0 }} />
          <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 600, color: T.ink2 }}>
            {it.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

async function fetchOrphanShareLive(applicationId, tenantId) {
  const [isoRes, usersRes] = await Promise.all([
    correlationAPI.getOrphansIsoSummary(applicationId, { tenantId }),
    applicationAPI.getUsers(applicationId, { page: 0, limit: 1 }),
  ]);
  const orphanTotal = isoRes.data?.success ? Number(isoRes.data.total) || 0 : 0;
  const rosterTotal = Number(usersRes.data?.total) || 0;
  const pct = rosterTotal > 0 ? (orphanTotal / rosterTotal) * 100 : 0;
  return { pct, detailLine: `${orphanTotal.toLocaleString()} uncorrelated (open) · ${rosterTotal.toLocaleString()} users` };
}

/**
 * @param {{
 *   tenantId: string;
 *   applicationId: string;
 *   metricKey: string;
 *   title: string;
 *   paletteKey: keyof typeof GOVERNANCE_RISK_BAND_PALETTES;
 *   externalLive?: { pct: number; detailLine: string; loading?: boolean; error?: boolean };
 *   coverageSemantics?: boolean — badge/chip treat higher % as healthier (no “risk” wording); use for active share.
 *   tierBadgeLabels?: { low: string; medium: string; high: string; critical?: string }
 *   readOnly?: boolean
 *   scope?: 'application' | 'tenant'
 * }} props
 */
export default function GovernanceRiskBandMetricCard({
  tenantId,
  applicationId,
  metricKey,
  title,
  paletteKey,
  externalLive,
  coverageSemantics = false,
  tierBadgeLabels,
  readOnly = false,
  scope = 'application',
}) {
  const queryClient = useQueryClient();
  const palette = GOVERNANCE_RISK_BAND_PALETTES[paletteKey] || GOVERNANCE_RISK_BAND_PALETTES.orphan;
  const { accent, accentHover } = palette;

  const [range, setRange] = useState([25, 50, 75]);
  const [savedRange, setSavedRange] = useState([25, 50, 75]);
  const [saveFlash, setSaveFlash] = useState(false);

  const isTenantScope = scope === 'tenant';
  const useInternalLive = !externalLive && !isTenantScope;

  const settingsQuery = useQuery({
    queryKey: isTenantScope
      ? ['tenantRiskBand', metricKey]
      : ['governanceRiskBandSetting', tenantId, applicationId, metricKey],
    queryFn: async () => {
      if (isTenantScope) {
        const res = await orgAdminAPI.getTenantRiskBand(metricKey);
        const d = res.data?.data;
        if (!res.data?.success || !d) {
          return { mediumStartsAtPct: 25, highStartsAtPct: 50, criticalStartsAtPct: 75, isDefault: true, source: 'default' };
        }
        return {
          mediumStartsAtPct: Number(d.mediumStartsAtPct) || 25,
          highStartsAtPct: Number(d.highStartsAtPct) || 50,
          criticalStartsAtPct: d.criticalStartsAtPct != null ? Number(d.criticalStartsAtPct) : 75,
          isDefault: !!d.isDefault,
          source: d.source || 'tenant',
        };
      }
      const res = await reportAPI.getGovernanceRiskBandSetting(applicationId, {
        tenantId,
        metricKey,
      });
      const d = res.data?.data;
      if (!res.data?.success || !d) {
        return { mediumStartsAtPct: 25, highStartsAtPct: 50, criticalStartsAtPct: 75, isDefault: true, source: 'default' };
      }
      return {
        mediumStartsAtPct: Number(d.mediumStartsAtPct) || 25,
        highStartsAtPct: Number(d.highStartsAtPct) || 50,
        criticalStartsAtPct: d.criticalStartsAtPct != null ? Number(d.criticalStartsAtPct) : 75,
        isDefault: !!d.isDefault,
        source: d.source || 'application',
        useCustomRuleSet: d.useCustomRuleSet,
      };
    },
    enabled: isTenantScope ? true : Boolean(tenantId && applicationId),
  });

  const [A, B, C] = range;
  const dirty = useMemo(
    () => range[0] !== savedRange[0] || range[1] !== savedRange[1] || range[2] !== savedRange[2],
    [range, savedRange],
  );

  useEffect(() => {
    if (!settingsQuery.data || dirty) return;
    const { mediumStartsAtPct: a0, highStartsAtPct: b0, criticalStartsAtPct: c0 } = settingsQuery.data;
    let b = Math.round(Number(b0)) || 50;
    let c = c0 != null && Number.isFinite(Number(c0)) ? Math.round(Number(c0)) : NaN;
    const a = Math.round(Number(a0)) || 25;
    if (b >= 100) b = Math.min(98, Math.max(a + 2, 50));
    if (!Number.isFinite(c) || c <= b || c > 99) {
      c = Math.min(99, Math.max(b + 1, Math.round((b + 100) / 2)));
    }
    const next = clampBandTriple([a, b, c]);
    setRange(next);
    setSavedRange(next);
  }, [settingsQuery.data, dirty]);

  const internalLiveQuery = useQuery({
    queryKey: ['governanceRiskBandLive', tenantId, applicationId, metricKey],
    queryFn: () => fetchOrphanShareLive(applicationId, tenantId),
    enabled: Boolean(tenantId && applicationId && useInternalLive),
    refetchInterval: useInternalLive ? 60_000 : false,
  });

  const livePct = useInternalLive
    ? (internalLiveQuery.data?.pct ?? 0)
    : (externalLive?.pct ?? 0);
  const liveDetailLine = useInternalLive
    ? (internalLiveQuery.data?.detailLine ?? '')
    : (externalLive?.detailLine ?? '');
  const liveLoading = useInternalLive
    ? internalLiveQuery.isLoading
    : !!externalLive?.loading;
  const liveError = useInternalLive
    ? internalLiveQuery.isError
    : !!externalLive?.error;

  const savedLevel = classifyGovernanceRiskBand(livePct, savedRange[0], savedRange[1], savedRange[2]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        metricKey,
        mediumStartsAtPct: range[0],
        highStartsAtPct: range[1],
        criticalStartsAtPct: range[2],
      };
      if (isTenantScope) {
        await orgAdminAPI.putTenantRiskBand(metricKey, body);
      } else {
        await reportAPI.putGovernanceRiskBandSetting(applicationId, body, { tenantId });
      }
    },
    onSuccess: async () => {
      if (isTenantScope) {
        await queryClient.invalidateQueries({ queryKey: ['tenantRiskBand', metricKey] });
        await queryClient.invalidateQueries({ queryKey: ['reportingRuleSet'] });
      } else {
        await queryClient.invalidateQueries({ queryKey: ['governanceRiskBandSetting', tenantId, applicationId, metricKey] });
        if (useInternalLive) {
          await queryClient.invalidateQueries({ queryKey: ['governanceRiskBandLive', tenantId, applicationId, metricKey] });
        }
      }
      setSavedRange([...range]);
      setSaveFlash(true);
      window.setTimeout(() => setSaveFlash(false), 2500);
    },
  });

  const handleTripleChange = useCallback((_, newValue) => {
    const arr = Array.isArray(newValue) ? newValue : [newValue];
    setRange(clampBandTriple(arr));
  }, []);

  if (!isTenantScope && (!tenantId || !applicationId)) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: { xs: 2.25, sm: 2.75, md: 3 },
          borderRadius: 2,
          border: `1px solid ${T.border}`,
          bgcolor: alpha(T.blueMid, 0.03),
          width: '100%',
        }}
      >
        <Typography sx={{ fontSize: '0.82rem', color: T.ink3 }}>
          Select a tenant and application above to configure risk bands.
        </Typography>
      </Paper>
    );
  }

  const showRiskBadge = !isTenantScope && !liveLoading && !liveError && (useInternalLive ? internalLiveQuery.data : true);
  const railGradient = buildFourBandRailGradient(coverageSemantics, A, B, C);
  const baseSliderSx = useMemo(() => buildSliderSx(accent), [accent]);
  const sliderSx = useMemo(
    () => ({
      ...baseSliderSx,
      '& .MuiSlider-rail': {
        ...(baseSliderSx['& .MuiSlider-rail'] || {}),
        background: railGradient,
      },
    }),
    [baseSliderSx, railGradient],
  );
  const liveMarkerPct = Math.min(100, Math.max(0, livePct));

  return (
    <Box sx={{ width: '100%', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {saveFlash && (
        <Alert severity="success" sx={{ mb: 1.5, fontSize: '0.78rem' }} onClose={() => setSaveFlash(false)}>
          Saved.
        </Alert>
      )}

      {settingsQuery.isError && (
        <Alert severity="error" sx={{ mb: 1.5, fontSize: '0.78rem' }}>
          {settingsQuery.error?.message || 'Could not load band settings.'}
        </Alert>
      )}

      <Paper
        elevation={0}
        sx={{
          borderRadius: 2,
          border: `1px solid ${T.border}`,
          overflow: 'hidden',
          bgcolor: T.surface,
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            px: { xs: 2.25, sm: 2.75, md: 3 },
            py: 2,
            borderBottom: readOnly ? 'none' : `1px solid ${T.border}`,
            bgcolor: alpha(accent, 0.08),
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
            <Box sx={{ minWidth: 0, flex: 1, pr: showRiskBadge ? 1 : 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Tune sx={{ fontSize: 18, color: accent, flexShrink: 0 }} />
                <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.92rem', fontWeight: 700, color: T.ink }}>
                  {title}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.68rem', color: T.ink3, lineHeight: 1.45, mb: readOnly ? 0 : 1.25 }}>
                {readOnly ? 'Showing live classification from the global rule set.' : 'Set band limits, then Save.'}
              </Typography>

              {isTenantScope ? (
                <Typography sx={{ fontSize: '0.75rem', color: T.ink3, py: 0.5 }}>
                  Tenant-wide default bands for all applications.
                </Typography>
              ) : liveLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.5 }}>
                  <CircularProgress size={20} sx={{ color: accent }} />
                  <Typography sx={{ fontSize: '0.75rem', color: T.ink3 }}>Loading live metrics…</Typography>
                </Box>
              ) : liveError ? (
                <Typography sx={{ fontSize: '0.75rem', color: T.red }}>Could not load exposure data.</Typography>
              ) : (
                <Box>
                  <Typography sx={{ fontFamily: 'monospace', fontSize: '1.2rem', fontWeight: 800, color: T.ink, lineHeight: 1.2 }}>
                    {livePct < 10 ? livePct.toFixed(1) : Math.round(livePct)}%
                    <Typography component="span" sx={{ fontSize: '0.72rem', fontWeight: 500, color: T.ink3, ml: 0.75 }}>
                      of users
                    </Typography>
                  </Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: T.ink3, mt: 0.5 }}>
                    {liveDetailLine}
                  </Typography>
                </Box>
              )}
            </Box>

            {showRiskBadge ? (
              <Chip
                label={badgeTextForLevel(savedLevel, tierBadgeLabels, coverageSemantics)}
                size="small"
                sx={{
                  flexShrink: 0,
                  alignSelf: 'flex-start',
                  height: 28,
                  fontSize: '0.72rem',
                  borderRadius: 2,
                  ...chipSxForVariant(savedLevel, coverageSemantics),
                }}
              />
            ) : null}
          </Box>

        </Box>

        {!readOnly && (
        <Box sx={{ p: { xs: 2.25, sm: 2.75, md: 3 }, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {settingsQuery.isLoading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={22} sx={{ color: accent }} />
              <Typography sx={{ fontSize: '0.8rem', color: T.ink3 }}>Loading saved policy…</Typography>
            </Box>
          ) : (
            <>
              <FourTierLegend coverageSemantics={coverageSemantics} />
              <Box sx={{ position: 'relative', px: 0.5, pt: 1.5, pb: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{
                    pointerEvents: 'none',
                    position: 'absolute',
                    left: `${liveMarkerPct}%`,
                    top: 14,
                    width: 2,
                    height: 10,
                    marginLeft: '-1px',
                    borderRadius: 0.5,
                    bgcolor: T.ink,
                    opacity: showRiskBadge ? 0.55 : 0,
                    zIndex: 2,
                    transition: 'opacity 0.15s',
                  }}
                />
                <Slider
                  value={[A, B, C]}
                  onChange={handleTripleChange}
                  min={1}
                  max={99}
                  step={1}
                  disableSwap
                  valueLabelDisplay="on"
                  track={false}
                  sx={sliderSx}
                  valueLabelFormat={(v) => `${v}%`}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: -0.5, px: 0.25 }}>
                  <Typography sx={{ fontSize: '0.68rem', color: T.ink3, fontWeight: 600 }}>0%</Typography>
                  <Typography sx={{ fontSize: '0.68rem', color: T.ink3, fontWeight: 600 }}>100%</Typography>
                </Box>
              </Box>

              <Button
                variant="contained"
                disabled={!dirty || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                endIcon={saveMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <NorthEast sx={{ fontSize: 18 }} />}
                sx={{
                  mt: 1,
                  textTransform: 'none',
                  fontWeight: 600,
                  borderRadius: 2,
                  boxShadow: 'none',
                  bgcolor: accent,
                  '&:hover': { bgcolor: accentHover, boxShadow: 'none' },
                  width: '100%',
                  maxWidth: '100%',
                }}
              >
                Save
              </Button>
              {saveMutation.isError && (
                <Typography sx={{ fontSize: '0.72rem', color: T.red, mt: 1 }}>
                  {saveMutation.error?.response?.data?.message || saveMutation.error?.message || 'Save failed.'}
                </Typography>
              )}
            </>
          )}
        </Box>
        )}
      </Paper>
    </Box>
  );
}
