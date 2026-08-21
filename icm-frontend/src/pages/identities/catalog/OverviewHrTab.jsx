import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Link as MuiLink,
  Grid,
  Chip,
  LinearProgress,
  Skeleton,
} from '@mui/material';
import {
  Sync,
  PeopleAltOutlined,
  VpnKey,
  Shield,
  PersonOutline,
  GroupsOutlined,
  PlaceOutlined,
  AutoAwesome,
  DonutLargeOutlined,
  VerifiedUserOutlined,
  ShowChartOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import {
  identityCatalogPath,
  CATALOG_TAB_IDS,
} from './identityCatalogTabs';
import {
  fetchIdentityPosture,
  fetchIdentityCertifications,
  identityPostureQueryKey,
  identityCertificationsQueryKey,
  IDENTITY_POSTURE_STALE_MS,
  IDENTITY_INSIGHT_STALE_MS,
} from './identityCatalogQueries';
import { FINAL_POSTURE_SCORE_LABEL } from '../posture/identityPostureLabels';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  buildIdentityHrFieldList,
  countDynamicEntitlements,
  isManagerNameDisplayField,
} from './identityDetailHelpers';
import {
  CATALOG,
  catalogLabelSx,
  classifyHrField,
  HR_SECTION_META,
  lifecycleTone,
} from './catalogTheme';
import { formatDate } from './CatalogInsightPrimitives';
import { palette } from '../../../theme/palette';
import { alpha } from '@mui/material/styles';

function formatHrValue(item) {
  let display = item.value;
  if (display === '' || display === null || display === undefined) return '—';
  if (typeof display === 'object') return JSON.stringify(display);
  display = String(display);
  if (/date|at|time/i.test(item.key)) {
    const d = new Date(display);
    if (!isNaN(d.getTime()) && (display.includes('-') || display.includes('/'))) {
      return d.toLocaleDateString();
    }
  }
  if (display.includes('e+') || display.includes('E+')) {
    const num = Number(display);
    if (!isNaN(num)) return num.toLocaleString('fullwide', { useGrouping: false });
  }
  return display;
}

function formatHrLabel(label) {
  const raw = String(label || '')
    .replace(/\s*\(Required\)\s*$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (!raw) return '';
  return raw
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === 'id' || lower === 'hr' || lower === 'email') {
        return lower === 'email' ? 'Email' : word.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function isStatusField(item) {
  const k = String(item.key || '').toLowerCase();
  const l = String(item.label || '').toLowerCase();
  return k === 'status' || k === 'lifecyclestate' || l === 'status';
}

function daysAgoLabel(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function Panel({ title, icon, action, children, sx, bodySx }) {
  return (
    <Box
      sx={{
        border: `1px solid ${CATALOG.border}`,
        borderRadius: `${CATALOG.radius}px`,
        bgcolor: CATALOG.surface,
        boxShadow: CATALOG.cardShadow,
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
    >
      {title ? (
        <Box
          sx={{
            px: 2.25,
            py: 1.5,
            borderBottom: `1px solid ${CATALOG.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 52,
          }}
        >
          {icon ? (
            <Box sx={{ color: CATALOG.accent, display: 'flex', lineHeight: 0, flexShrink: 0 }}>
              {icon}
            </Box>
          ) : null}
          <Typography
            sx={{
              fontWeight: 700,
              fontSize: '0.95rem',
              color: CATALOG.ink,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </Typography>
          {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
        </Box>
      ) : null}
      <Box sx={{ p: 2.25, flex: 1, ...bodySx }}>{children}</Box>
    </Box>
  );
}

function KpiCard({ icon, label, value, subtitle, accent }) {
  return (
    <Box
      sx={{
        height: '100%',
        px: 1.75,
        py: 1.35,
        borderRadius: `${CATALOG.radius}px`,
        border: `1px solid ${CATALOG.border}`,
        bgcolor: CATALOG.surface,
        boxShadow: CATALOG.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ ...catalogLabelSx, fontSize: '0.65rem', color: CATALOG.inkMuted, pt: 0.15 }}>
          {label}
        </Typography>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            bgcolor: `${accent}18`,
            color: accent,
            flexShrink: 0,
            '& svg': { fontSize: 16 },
          }}
        >
          {icon}
        </Box>
      </Box>
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: '1.35rem',
          letterSpacing: '-0.03em',
          color: CATALOG.ink,
          lineHeight: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: CATALOG.inkFaint, fontWeight: 500, lineHeight: 1.3 }}>
        {subtitle}
      </Typography>
    </Box>
  );
}

function FieldValue({ item, managerProfileId, onManagerNavigate }) {
  const display = formatHrValue(item);
  const empty = display === '—';

  if (managerProfileId && isManagerNameDisplayField(item) && !empty) {
    return (
      <MuiLink
        component={RouterLink}
        to={`/identities/${managerProfileId}`}
        onClick={onManagerNavigate}
        underline="hover"
        sx={{
          fontSize: '0.875rem',
          fontWeight: 700,
          color: CATALOG.accent,
          textAlign: 'right',
        }}
      >
        {display}
      </MuiLink>
    );
  }

  if (isStatusField(item) && !empty) {
    const tone = lifecycleTone(display);
    return (
      <Chip
        label={String(display).toUpperCase()}
        size="small"
        sx={{
          height: 24,
          fontWeight: 600,
          fontSize: '0.68rem',
          letterSpacing: '0.02em',
          bgcolor: tone.bg,
          color: tone.color,
          border: 'none',
        }}
      />
    );
  }

  return (
    <Typography
      component="span"
      sx={{
        fontSize: '0.875rem',
        fontWeight: 400,
        color: empty ? CATALOG.inkFaint : CATALOG.ink,
        wordBreak: 'break-word',
        textAlign: 'right',
        lineHeight: 1.35,
      }}
    >
      {display}
    </Typography>
  );
}

function FieldTable({ title, icon, items, managerProfileId, onManagerNavigate }) {
  return (
    <Panel title={title} icon={icon} bodySx={{ p: 0 }} sx={{ height: '100%' }}>
      {items.map((item, idx) => (
        <Box
          key={item.key}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            px: 2.25,
            py: 1.35,
            borderBottom: idx < items.length - 1 ? `1px solid ${CATALOG.border}` : 'none',
            minHeight: 44,
          }}
        >
          {/* Info label — bold */}
          <Typography
            component="span"
            sx={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: CATALOG.inkMuted,
              flexShrink: 0,
              letterSpacing: '0.01em',
              lineHeight: 1.35,
            }}
          >
            {formatHrLabel(item.label)}
          </Typography>
          {/* Detail value — normal weight */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0, maxWidth: '62%' }}>
            <FieldValue
              item={item}
              managerProfileId={managerProfileId}
              onManagerNavigate={onManagerNavigate}
            />
          </Box>
        </Box>
      ))}
    </Panel>
  );
}

function AccessOverviewDonut({ accountsCount, entitlementsCount, rolesCount }) {
  const rows = [
    { label: 'Accounts', value: accountsCount, color: CATALOG.accent },
    { label: 'Entitlements', value: entitlementsCount, color: '#0891B2' },
    { label: 'Roles', value: rolesCount, color: '#7C3AED' },
  ];
  const data = rows.filter((d) => d.value > 0);
  const total = accountsCount + entitlementsCount + rolesCount;
  const centerTotal = entitlementsCount || total;

  return (
    <Panel title="Access Overview" icon={<DonutLargeOutlined sx={{ fontSize: 18 }} />}>
      {total === 0 ? (
        <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
          No linked access yet.
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: { xs: 2, sm: 3 },
            flexWrap: 'wrap',
            py: 0.5,
          }}
        >
          <Box sx={{ width: 176, height: 176, position: 'relative', flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={54}
                  outerRadius={78}
                  paddingAngle={3}
                  stroke="none"
                >
                  {data.map((entry) => (
                    <Cell key={entry.label} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [value, name]}
                  contentStyle={{
                    borderRadius: 8,
                    border: `1px solid ${CATALOG.border}`,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <Box sx={{ textAlign: 'center' }}>
                <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', color: CATALOG.ink, lineHeight: 1 }}>
                  {centerTotal}
                </Typography>
                <Typography sx={{ fontSize: '0.62rem', color: CATALOG.inkFaint, fontWeight: 500, mt: 0.35 }}>
                  Total
                </Typography>
              </Box>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.35, minWidth: 148, flex: 1 }}>
            {rows.map((row) => {
              const pct = total ? ((row.value / total) * 100).toFixed(1) : '0.0';
              return (
                <Box key={row.label} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: row.color, flexShrink: 0 }} />
                  <Typography
                    sx={{
                      fontSize: '0.72rem',
                      fontWeight: 400,
                      color: CATALOG.inkFaint,
                      flex: 1,
                      lineHeight: 1.2,
                    }}
                  >
                    {row.label}
                  </Typography>
                  <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: CATALOG.ink, lineHeight: 1 }}>
                    {row.value}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: '0.68rem',
                      fontWeight: 400,
                      color: CATALOG.inkFaint,
                      minWidth: 40,
                      textAlign: 'right',
                    }}
                  >
                    {pct}%
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Panel>
  );
}

/** Semicircle arc: 180° (left) → 0° (right), y grows downward in SVG. */
function semiArc(cx, cy, r, startDeg, endDeg) {
  const rad = (d) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy - r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy - r * Math.sin(rad(endDeg));
  const delta = Math.abs(endDeg - startDeg);
  const large = delta > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function postureStatusFromScore(score) {
  if (score >= 80) return { label: 'STRONG', color: '#15803D', subtitle: 'Identity posture is in good standing.' };
  if (score >= 60) return { label: 'GOOD', color: '#4D7C0F', subtitle: 'Posture is acceptable with room to improve.' };
  if (score >= 40) return { label: 'FAIR', color: '#D97706', subtitle: 'Some posture gaps need attention.' };
  return { label: 'WEAK', color: '#DC2626', subtitle: 'Posture risks require prompt review.' };
}

/** Fallback when posture score is not loaded yet — invert risk into a score estimate. */
function scoreFromRiskLevel(riskLevel) {
  const level = String(riskLevel || 'LOW').toUpperCase();
  if (level === 'CRITICAL') return 15;
  if (level === 'HIGH') return 30;
  if (level === 'MEDIUM' || level === 'MODERATE') return 55;
  return 88;
}

function OverallPostureScoreGauge({ riskLevel, identityId }) {
  const postureQuery = useQuery({
    queryKey: identityPostureQueryKey(identityId),
    queryFn: () => fetchIdentityPosture(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_POSTURE_STALE_MS,
  });

  const health = postureQuery.data?.healthAnalysis;
  const score = Number.isFinite(Number(health?.finalPosture))
    ? Math.max(0, Math.min(100, Number(health.finalPosture)))
    : scoreFromRiskLevel(riskLevel);
  const apiLabel = health?.labels?.finalPosture
    ? String(health.labels.finalPosture).toUpperCase()
    : null;
  const derived = postureStatusFromScore(score);
  const statusLabel = apiLabel || derived.label;
  const pivotColor = derived.color;
  // Higher posture score → needle left (green); lower → right (red)
  const needle = -72 + ((100 - score) / 100) * 144;

  // Gauge-only viewBox: leave clearance under the pivot so score never overlaps
  const w = 260;
  const h = 150;
  const cx = 130;
  const cy = 128;
  const r = 92;
  const trackW = 20;
  const gap = 3;
  const segments = [
    { color: '#22C55E', from: 180, to: 135 + gap },
    { color: '#84CC16', from: 135 - gap, to: 90 + gap },
    { color: '#F59E0B', from: 90 - gap, to: 45 + gap },
    { color: '#EF4444', from: 45 - gap, to: 0 },
  ];

  const detailsTo = identityId
    ? identityCatalogPath(identityId, CATALOG_TAB_IDS.POSTURE)
    : null;

  return (
    <Panel
      title={FINAL_POSTURE_SCORE_LABEL}
      icon={<AutoAwesome sx={{ fontSize: 18 }} />}
      action={
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: '1.15rem',
              letterSpacing: '-0.02em',
              color: CATALOG.ink,
              lineHeight: 1,
            }}
          >
            {Math.round(score)}
            <Typography
              component="span"
              sx={{
                ml: 0.35,
                fontWeight: 600,
                fontSize: '0.75rem',
                color: CATALOG.inkFaint,
              }}
            >
              /100
            </Typography>
          </Typography>
          {detailsTo ? (
            <MuiLink
              component={RouterLink}
              to={detailsTo}
              underline="hover"
              sx={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: CATALOG.accent,
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
              }}
            >
              View details
            </MuiLink>
          ) : null}
        </Box>
      }
      bodySx={{ pt: 2, pb: 2.5, px: 2.25 }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: '100%',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 280,
            mx: 'auto',
            lineHeight: 0,
          }}
        >
          <svg
            viewBox={`0 0 ${w} ${h}`}
            width="100%"
            height="100%"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${FINAL_POSTURE_SCORE_LABEL}: ${Math.round(score)}`}
            style={{ display: 'block', overflow: 'visible' }}
          >
            <path
              d={semiArc(cx, cy, r, 180, 0)}
              fill="none"
              stroke={CATALOG.border}
              strokeWidth={trackW + 5}
              strokeLinecap="round"
            />
            {segments.map((s) => (
              <path
                key={`${s.color}-${s.from}`}
                d={semiArc(cx, cy, r, s.from, s.to)}
                fill="none"
                stroke={s.color}
                strokeWidth={trackW}
                strokeLinecap="butt"
              />
            ))}
            <g transform={`rotate(${needle} ${cx} ${cy})`}>
              <line
                x1={cx}
                y1={cy + 2}
                x2={cx}
                y2={cy - r + 20}
                stroke="#14532D"
                strokeWidth="3.25"
                strokeLinecap="round"
              />
            </g>
            <circle cx={cx} cy={cy} r="10" fill={pivotColor} />
            <circle cx={cx} cy={cy} r="10" fill="none" stroke="#fff" strokeWidth="2.5" />
            <circle cx={cx} cy={cy} r="4" fill="#fff" />
          </svg>
        </Box>

        <Typography
          sx={{
            mt: 1,
            fontWeight: 800,
            fontSize: '0.75rem',
            letterSpacing: '0.1em',
            color: CATALOG.inkMuted,
            lineHeight: 1,
            textAlign: 'center',
          }}
        >
          {statusLabel}
        </Typography>

        <Typography
          sx={{
            mt: 1.25,
            fontSize: '0.8rem',
            color: CATALOG.inkMuted,
            textAlign: 'center',
            lineHeight: 1.4,
            maxWidth: 240,
            fontWeight: 500,
          }}
        >
          {derived.subtitle}
        </Typography>
      </Box>
    </Panel>
  );
}

function ActivityTimeline({ identityId }) {
  const query = useQuery({
    queryKey: identityCertificationsQueryKey(identityId),
    queryFn: () => fetchIdentityCertifications(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const data = query.data?.accessTrend || [];
  const hasValues = data.some((d) => Number(d.value) > 0);
  const yMax = Math.max(3, ...data.map((d) => Number(d.value) || 0));

  return (
    <Panel
      title="Access Review Trend"
      icon={<ShowChartOutlined sx={{ fontSize: 18 }} />}
      action={
        <MuiLink
          component={RouterLink}
          to={identityCatalogPath(identityId, CATALOG_TAB_IDS.CERTIFICATIONS)}
          underline="hover"
          sx={{ fontSize: '0.75rem', fontWeight: 600, color: CATALOG.accent, whiteSpace: 'nowrap', flexShrink: 0 }}
        >
          View analytics
        </MuiLink>
      }
      bodySx={{ pt: 1.5, pb: 1.5, px: 1.75, minHeight: 220 }}
    >
      <Typography sx={{ fontSize: '0.72rem', color: CATALOG.inkFaint, fontWeight: 600, mb: 1 }}>
        Last 6 months · this identity
      </Typography>
      {query.isPending ? (
        <Skeleton variant="rounded" height={168} sx={{ borderRadius: 2 }} />
      ) : !hasValues ? (
        <Box sx={{ height: 168, display: 'grid', placeItems: 'center' }}>
          <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint, textAlign: 'center' }}>
            No access review trend for this identity yet.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ width: '100%', height: 168, minWidth: 0, overflow: 'hidden' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id="accessTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.brand.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={palette.brand.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={CATALOG.border} strokeDasharray="0" />
              <XAxis
                dataKey="label"
                tick={{ fill: CATALOG.inkFaint, fontSize: 10, fontWeight: 500 }}
                axisLine={false}
                tickLine={false}
                dy={4}
                interval="preserveStartEnd"
                tickFormatter={(v) => String(v || '').replace(/ (\d{4})$/, '')}
              />
              <YAxis
                allowDecimals={false}
                domain={[0, yMax]}
                tickCount={4}
                tick={{ fill: CATALOG.inkFaint, fontSize: 11 }}
                tickFormatter={(v) => String(Math.round(Number(v) || 0))}
                axisLine={false}
                tickLine={false}
                width={28}
              />
              <Tooltip
                formatter={(value) => [value, 'Review items']}
                labelFormatter={(label) => label}
                contentStyle={{
                  borderRadius: 8,
                  border: `1px solid ${CATALOG.border}`,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={palette.brand.primary}
                strokeWidth={2.25}
                fill="url(#accessTrendFill)"
                dot={{ r: 3.5, fill: palette.brand.primary, strokeWidth: 0 }}
                activeDot={{ r: 4.5 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Panel>
  );
}

function reviewStatusTone(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'completed') {
    return { color: palette.status.success, bg: alpha(palette.status.success, 0.12) };
  }
  if (s === 'in progress') {
    return { color: palette.brand.primary, bg: alpha(palette.brand.primary, 0.12) };
  }
  return { color: CATALOG.inkMuted, bg: alpha(CATALOG.inkMuted, 0.1) };
}

function RecentAccessReviewsPanel({ identityId }) {
  const query = useQuery({
    queryKey: identityCertificationsQueryKey(identityId),
    queryFn: () => fetchIdentityCertifications(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const rows = query.data?.recentCampaigns || [];
  const viewAllTo = query.data?.deepLink || '/governance/certifications/access';

  return (
    <Panel
      title="Recent Access Reviews"
      icon={<VerifiedUserOutlined sx={{ fontSize: 18 }} />}
      action={
        <MuiLink
          component={RouterLink}
          to={viewAllTo}
          underline="hover"
          sx={{ fontSize: '0.8rem', fontWeight: 600, color: CATALOG.accent, whiteSpace: 'nowrap' }}
        >
          View all
        </MuiLink>
      }
      bodySx={{ p: 0, overflowX: 'auto' }}
    >
      {query.isPending ? (
        <Box sx={{ p: 2 }}>
          <Skeleton variant="rounded" height={140} sx={{ borderRadius: 2 }} />
        </Box>
      ) : rows.length === 0 ? (
        <Box sx={{ p: 2.25 }}>
          <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
            No access reviews found for this identity.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ minWidth: 640 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.2fr 1fr 0.9fr 1.2fr',
              gap: 1.5,
              px: 2.25,
              py: 1.15,
              borderBottom: `1px solid ${CATALOG.border}`,
              alignItems: 'center',
            }}
          >
            {['Review Name', 'Type', 'Status', 'Due Date', 'Progress'].map((label) => (
              <Typography
                key={label}
                sx={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: CATALOG.inkFaint,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                {label}
              </Typography>
            ))}
          </Box>
          {rows.map((row, idx) => {
            const tone = reviewStatusTone(row.status);
            const pct = Math.max(0, Math.min(100, Number(row.progress) || 0));
            const barColor = pct >= 100 ? palette.status.success : palette.brand.primary;
            return (
              <Box
                key={row.id || row.campaignId}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.2fr 1fr 0.9fr 1.2fr',
                  gap: 1.5,
                  alignItems: 'center',
                  px: 2.25,
                  py: 1.35,
                  borderBottom: idx < rows.length - 1 ? `1px solid ${CATALOG.border}` : 'none',
                }}
              >
                <MuiLink
                  component={RouterLink}
                  to={row.deepLink}
                  underline="hover"
                  sx={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: CATALOG.ink,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.name}
                </MuiLink>
                <Typography sx={{ fontSize: '0.8125rem', color: CATALOG.inkMuted }}>
                  {row.type}
                </Typography>
                <Chip
                  size="small"
                  label={row.status}
                  sx={{
                    height: 24,
                    width: 'fit-content',
                    fontWeight: 700,
                    fontSize: '0.68rem',
                    bgcolor: tone.bg,
                    color: tone.color,
                  }}
                />
                <Typography sx={{ fontSize: '0.8125rem', color: CATALOG.inkMuted }}>
                  {formatDate(row.dueDate)}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    sx={{
                      flex: 1,
                      height: 6,
                      borderRadius: 999,
                      bgcolor: alpha(barColor, 0.12),
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 999,
                        bgcolor: barColor,
                      },
                    }}
                  />
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: CATALOG.ink, minWidth: 36 }}>
                    {pct}%
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Panel>
  );
}

export default function OverviewHrTab({
  identity,
  accounts,
  mappedProfileFields,
  managerProfileId,
  onManagerNavigate,
}) {
  const allIdentityData = useMemo(
    () => buildIdentityHrFieldList(identity, mappedProfileFields),
    [identity, mappedProfileFields],
  );

  const totalDynamicEntitlements = useMemo(
    () => countDynamicEntitlements(accounts),
    [accounts],
  );

  const grouped = useMemo(() => {
    const buckets = { identity: [], org: [], contact: [] };
    allIdentityData.forEach((item) => {
      const section = classifyHrField(item.key, item.label);
      buckets[section].push(item);
    });
    return buckets;
  }, [allIdentityData]);

  if (!identity) return null;

  const identityId = identity._id || identity.id;
  const lastSyncedRaw = identity.lastSyncedAt;
  const lastSynced = lastSyncedRaw
    ? new Date(lastSyncedRaw).toLocaleDateString()
    : 'Never';
  const ago = daysAgoLabel(lastSyncedRaw);
  const rolesCount = identity.totalRoles || 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Grid container spacing={1.75}>
        <Grid item xs={6} md={3}>
          <KpiCard
            icon={<PeopleAltOutlined sx={{ fontSize: 20 }} />}
            label="Accounts"
            value={accounts.length}
            subtitle="Linked accounts"
            accent={CATALOG.accent}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard
            icon={<VpnKey sx={{ fontSize: 20 }} />}
            label="Entitlements"
            value={totalDynamicEntitlements}
            subtitle="Total entitlements"
            accent="#0891B2"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard
            icon={<Shield sx={{ fontSize: 20 }} />}
            label="Assigned Roles"
            value={rolesCount}
            subtitle="Directly assigned"
            accent="#7C3AED"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <KpiCard
            icon={<Sync sx={{ fontSize: 20 }} />}
            label="Last Synced"
            value={lastSynced}
            subtitle={ago || 'No sync recorded'}
            accent="#EA580C"
          />
        </Grid>
      </Grid>

      <Grid container spacing={1.75} alignItems="stretch">
        <Grid item xs={12} md={6} lg={4} sx={{ display: 'flex' }}>
          {grouped.identity?.length ? (
            <Box sx={{ width: '100%', display: 'flex', '& > *': { flex: 1 } }}>
              <FieldTable
                title="Profile Summary"
                icon={<PersonOutline sx={{ fontSize: 20 }} />}
                items={grouped.identity}
                managerProfileId={managerProfileId}
                onManagerNavigate={onManagerNavigate}
              />
            </Box>
          ) : (
            <Box sx={{ width: '100%' }}>
              <Panel title="Profile Summary" icon={<PersonOutline sx={{ fontSize: 20 }} />}>
                <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
                  No HR data found for this identity.
                </Typography>
              </Panel>
            </Box>
          )}
        </Grid>

        <Grid item xs={12} md={6} lg={4} sx={{ display: 'flex' }}>
          <Box sx={{ width: '100%', display: 'flex', '& > *': { flex: 1, width: '100%' } }}>
            <AccessOverviewDonut
              accountsCount={accounts.length}
              entitlementsCount={totalDynamicEntitlements}
              rolesCount={rolesCount}
            />
          </Box>
        </Grid>

        <Grid item xs={12} lg={4} sx={{ display: 'flex' }}>
          <Box sx={{ width: '100%', display: 'flex', '& > *': { flex: 1, width: '100%' } }}>
            <OverallPostureScoreGauge
              riskLevel={identity.riskLevel}
              identityId={identityId}
            />
          </Box>
        </Grid>
      </Grid>

      <Grid container spacing={1.75} alignItems="stretch">
        <Grid item xs={12} md={6} lg={4} sx={{ display: 'flex' }}>
          <Box sx={{ width: '100%', display: 'flex', '& > *': { flex: 1, width: '100%' } }}>
            {grouped.org?.length ? (
              <FieldTable
                title={HR_SECTION_META.org.title}
                icon={<GroupsOutlined sx={{ fontSize: 20 }} />}
                items={grouped.org}
                managerProfileId={managerProfileId}
                onManagerNavigate={onManagerNavigate}
              />
            ) : (
              <Panel title={HR_SECTION_META.org.title} icon={<GroupsOutlined sx={{ fontSize: 20 }} />}>
                <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
                  No organization data.
                </Typography>
              </Panel>
            )}
          </Box>
        </Grid>

        <Grid item xs={12} md={6} lg={4} sx={{ display: 'flex' }}>
          <Box sx={{ width: '100%', display: 'flex', '& > *': { flex: 1, width: '100%' } }}>
            {grouped.contact?.length ? (
              <FieldTable
                title={HR_SECTION_META.contact.title}
                icon={<PlaceOutlined sx={{ fontSize: 20 }} />}
                items={grouped.contact}
                managerProfileId={managerProfileId}
                onManagerNavigate={onManagerNavigate}
              />
            ) : (
              <Panel title={HR_SECTION_META.contact.title} icon={<PlaceOutlined sx={{ fontSize: 20 }} />}>
                <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
                  No contact data.
                </Typography>
              </Panel>
            )}
          </Box>
        </Grid>

        <Grid item xs={12} lg={4} sx={{ display: 'flex' }}>
          <Box sx={{ width: '100%', minWidth: 0, display: 'flex', '& > *': { flex: 1, width: '100%', minWidth: 0 } }}>
            <ActivityTimeline identityId={identityId} />
          </Box>
        </Grid>
      </Grid>

      <RecentAccessReviewsPanel identityId={identityId} />
    </Box>
  );
}
