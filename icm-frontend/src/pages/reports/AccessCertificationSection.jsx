import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Table, TableHead, TableRow, TableCell, TableBody,
  LinearProgress, Tooltip, Collapse, IconButton, Divider,
  CircularProgress, Alert, TablePagination,
} from '@mui/material';
import {
  CheckCircle, Cancel, HourglassEmpty, ExpandMore, ExpandLess,
  VerifiedUser, CalendarMonth, ErrorOutline, PersonOff, OpenInNew,
} from '@mui/icons-material';
import api from '../../services/api';

import { alpha } from '@mui/material/styles';
import { palette } from '../../theme/palette';

/* ── Design tokens ─────────────────────────────────────────────────── */
const C = {
  bg: palette.bg.primary,
  surface: palette.bg.secondary,
  surfaceDeep: alpha(palette.bg.elevated, 0.5),
  border: palette.border.default,
  borderStrong: alpha(palette.brand.primary, 0.4),
  text: palette.text.primary,
  textMid: palette.text.secondary,
  textDim: palette.text.disabled,
  textXDim: alpha(palette.text.disabled, 0.5),
  accent: palette.brand.primary,
  accentMid: palette.brand.primaryHover,
  accentSoft: palette.brand.primaryLight,
  accentBorder: alpha(palette.brand.primary, 0.3),
  green: palette.status.success,
  greenBg: palette.status.successBg,
  greenBorder: alpha(palette.status.success, 0.3),
  red: palette.status.error,
  redBg: palette.status.errorBg,
  redBorder: alpha(palette.status.error, 0.3),
  amber: palette.status.warning,
  amberBg: palette.status.warningBg,
  amberBorder: alpha(palette.status.warning, 0.3),
  slate: palette.text.secondary,
  slateBg: palette.bg.elevated,
  teal: palette.status.info,
  tealBg: palette.status.infoBg,
  tealBorder: alpha(palette.status.info, 0.3),
  purple: palette.brand.secondary,
  purpleBg: alpha(palette.brand.secondary, 0.1),
};

/**
 * Dusty pastel surfaces — low-chroma backgrounds with slate-tinted inks
 * so cards read as one family (less “traffic light” than raw status hex).
 */
const PASTEL = {
  greenBg: '#e8f2ec',
  greenInk: '#2f4d40',
  greenIconBg: alpha('#2f4d40', 0.12),

  redBg: '#f5e9e9',
  redInk: '#6b4242',
  redIconBg: alpha('#6b4242', 0.12),

  amberBg: '#f8f1e4',
  amberInk: '#6b5340',
  amberIconBg: alpha('#6b5340', 0.12),

  blueBg: '#e9edf5',
  blueInk: '#3d4d6b',
  blueIconBg: alpha('#3d4d6b', 0.12),

  tealBg: '#e5f0f1',
  tealInk: '#355a5f',
  tealIconBg: alpha('#355a5f', 0.1),

  neutralBg: '#f9fafb',
  mutedInk: '#64748b',
  ringLow: '#94a3b8',
  cardShadow: '0 1px 3px rgba(15, 23, 42, 0.045)',
  cardBorder: alpha('#0f172a', 0.07),
};

/* ── Helpers ───────────────────────────────────────────────────────── */
function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function truncate(s, n = 30) {
  if (!s || s === '—') return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function initials(name) {
  if (!name || name === '—') return '?';
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function isEmailStr(s) { return Boolean(s && s.includes('@')); }

const CATEGORY_LABEL = {
  IDENTITY: 'Identity',
  ACCESS_ITEMS: 'Application Access',
  MANAGER: 'Manager Review',
  SOD: 'Segregation of Duties',
  UNCORRELATED_ACCOUNTS: 'Uncorrelated Accounts',
  ROLE_COMPOSITION: 'Role Composition',
};
const CATEGORY_COLOR = {
  IDENTITY: { text: PASTEL.blueInk, bg: PASTEL.blueBg, border: alpha(PASTEL.blueInk, 0.16) },
  ACCESS_ITEMS: { text: PASTEL.tealInk, bg: PASTEL.tealBg, border: alpha(PASTEL.tealInk, 0.16) },
  MANAGER: { text: '#5b4d7a', bg: alpha('#5b4d7a', 0.09), border: alpha('#5b4d7a', 0.15) },
  SOD: { text: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.14) },
};

/* ── Sub-components ────────────────────────────────────────────────── */
function Badge({ label, color = C.slate, bg = C.slateBg, border = C.border }) {
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 0.9, py: 0.2,
      fontSize: '0.63rem', fontWeight: 700, lineHeight: 1.6,
      borderRadius: '4px', border: `1px solid ${border}`,
      bgcolor: bg, color, whiteSpace: 'nowrap',
    }}>
      {label}
    </Box>
  );
}

function StatusBadge({ status }) {
  const map = {
    Active: { label: 'Active', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    Completed: { label: 'Completed', color: PASTEL.blueInk, bg: PASTEL.blueBg, border: alpha(PASTEL.blueInk, 0.14) },
    DecisionPending: { label: 'Decision Pending', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.14) },
    Closed: { label: 'Closed', color: C.slate, bg: C.slateBg, border: C.border },
    Draft: { label: 'Draft', color: C.textDim, bg: C.surfaceDeep, border: C.border },
    Scheduled: { label: 'Scheduled', color: '#5b4d7a', bg: alpha('#5b4d7a', 0.09), border: alpha('#5b4d7a', 0.15) },
  };
  const m = map[status] || map.Draft;
  return <Badge {...m} />;
}

function DecisionBadge({ status }) {
  const map = {
    APPROVED: { icon: <CheckCircle sx={{ fontSize: 11 }} />, label: 'Approved', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    REVOKED: { icon: <Cancel sx={{ fontSize: 11 }} />, label: 'Revoked', color: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.14) },
    PENDING: { icon: <HourglassEmpty sx={{ fontSize: 11 }} />, label: 'Pending', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.14) },
    DELEGATED: { icon: <OpenInNew sx={{ fontSize: 11 }} />, label: 'Delegated', color: '#5b4d7a', bg: alpha('#5b4d7a', 0.09), border: alpha('#5b4d7a', 0.15) },
    EXCEPTION: { icon: <ErrorOutline sx={{ fontSize: 11 }} />, label: 'Exception', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.18) },
  };
  const key = String(status || '').toUpperCase();
  const m = map[key] || map.PENDING;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.8, py: 0.2, borderRadius: '4px', border: `1px solid ${m.border}`, bgcolor: m.bg }}>
      <Box sx={{ color: m.color, display: 'flex' }}>{m.icon}</Box>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: m.color }}>{m.label}</Typography>
    </Box>
  );
}

function ReviewerCell({ name, email }) {
  const cleanEmail = email && email !== '—' ? email : '';
  const cleanName = name && name !== '—' && name !== cleanEmail ? name : '';
  const unassigned = !cleanEmail && !cleanName;

  if (unassigned) return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: C.surfaceDeep, border: `1px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <PersonOff sx={{ fontSize: 12, color: C.textXDim }} />
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontStyle: 'italic', color: C.textXDim }}>Unassigned</Typography>
    </Box>
  );

  const displayName = cleanName || cleanEmail;
  const initials = displayName.split(/[\s@]/)[0]?.[0]?.toUpperCase() || '?';

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: C.tealBg, border: `1px solid ${C.tealBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: C.teal, flexShrink: 0 }}>
        {initials}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {cleanName && <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{cleanName}</Typography>}
        {cleanEmail && <Typography sx={{ fontSize: '0.63rem', color: C.textDim }}>{cleanEmail}</Typography>}
      </Box>
    </Box>
  );
}

/* ── Progress ring (mini) ─────────────────────────────────────────── */
function ProgressRing({ pct, size = 38 }) {
  const r = (size - 5) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  const color = pct >= 90
    ? PASTEL.greenInk
    : pct >= 50
      ? PASTEL.amberInk
      : pct >= 15
        ? PASTEL.blueInk
        : PASTEL.ringLow;
  const track = alpha(C.text, 0.07);
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={4.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4.5}
          strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={circ / 4} strokeLinecap="round" />
      </svg>
      <Typography sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 800, color }}>
        {pct}%
      </Typography>
    </Box>
  );
}

/* ── KPI Cards ────────────────────────────────────────────────────── */
function KpiCards({ summary }) {
  const cards = [
    { icon: <CheckCircle sx={{ fontSize: 22 }} />, label: 'Certified', value: summary.totalCertified, ink: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.12), iconBg: PASTEL.greenIconBg },
    { icon: <Cancel sx={{ fontSize: 22 }} />, label: 'Revoked', value: summary.totalRevoked, ink: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.12), iconBg: PASTEL.redIconBg },
    { icon: <HourglassEmpty sx={{ fontSize: 22 }} />, label: 'Pending', value: summary.totalPending, ink: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.12), iconBg: PASTEL.amberIconBg },
    { icon: <VerifiedUser sx={{ fontSize: 22 }} />, label: 'Campaigns', value: summary.totalCampaigns, ink: PASTEL.blueInk, bg: PASTEL.blueBg, border: alpha(PASTEL.blueInk, 0.12), iconBg: PASTEL.blueIconBg },
  ];
  const completionPct = summary.totalCertified + summary.totalRevoked + summary.totalPending > 0
    ? Math.round(((summary.totalCertified + summary.totalRevoked) / (summary.totalCertified + summary.totalRevoked + summary.totalPending)) * 100)
    : 0;

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
      {cards.map((k) => (
        <Box key={k.label} sx={{
          flex: '1 1 130px', minWidth: 110, p: 2,
          border: `1px solid ${k.border}`, borderRadius: '14px', bgcolor: k.bg,
          boxShadow: PASTEL.cardShadow,
          display: 'flex', alignItems: 'center', gap: 1.5,
        }}>
          <Box sx={{
            width: 44, height: 44, borderRadius: '50%', bgcolor: k.iconBg, color: k.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {k.icon}
          </Box>
          <Box>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1, color: k.ink }}>
              {k.value ?? 0}
            </Typography>
            <Typography sx={{ fontSize: '0.63rem', fontWeight: 600, color: k.ink, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 0.25 }}>
              {k.label}
            </Typography>
          </Box>
        </Box>
      ))}
      <Box sx={{
        flex: '1 1 130px', minWidth: 110, p: 2,
        border: `1px solid ${PASTEL.cardBorder}`, borderRadius: '14px', bgcolor: PASTEL.neutralBg,
        boxShadow: PASTEL.cardShadow,
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}>
        <ProgressRing pct={completionPct} size={46} />
        <Box>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.textMid }}>
            Overall Progress
          </Typography>
          <Typography sx={{ fontSize: '0.63rem', color: C.textDim, mt: 0.2 }}>
            {summary.totalCertified + summary.totalRevoked} of {summary.totalCertified + summary.totalRevoked + summary.totalPending} reviewed
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

/* ── Scope quality KPIs ────────────────────────────────────────────── */
function ScopeQualityKpis({ campaigns, records }) {
  const cards = [
    {
      label: 'Total in Scope',
      value: campaigns.reduce((s, c) => s + (c.totalItems || 0), 0),
      sub: 'All campaigns combined',
      ink: PASTEL.tealInk,
      bg: PASTEL.tealBg,
      border: alpha(PASTEL.tealInk, 0.14),
    },
  ];

  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textDim, mb: 1.25 }}>
        Scope quality
      </Typography>
      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
        {cards.map((k) => (
          <Box key={k.label} sx={{
            flex: '1 1 220px', minWidth: 180, p: '12px 14px',
            border: `1px solid ${k.border}`, borderRadius: '14px', bgcolor: k.bg,
            boxShadow: PASTEL.cardShadow,
          }}>
            <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1, color: k.ink }}>{k.value}</Typography>
            <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, color: k.ink, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 0.5 }}>{k.label}</Typography>
            <Typography sx={{ fontSize: '0.6rem', color: C.textDim, mt: 0.25 }}>{k.sub}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ── Campaign overview table ──────────────────────────────────────── */
function CampaignTable({ campaigns }) {
  return (
    <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', mb: 3 }}>
      <Box sx={{ px: 2.5, py: 1.5, bgcolor: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <VerifiedUser sx={{ fontSize: 14, color: PASTEL.blueInk }} />
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Campaign Summary — {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: C.surfaceDeep }}>
            {['Campaign', 'Category', 'Status', 'Progress', 'In Scope', 'Certified', 'Revoked', 'Pending', 'Due Date'].map(h => (
              <TableCell key={h} sx={{ py: 1, px: 1.5, fontSize: '0.62rem', fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {campaigns.map((c) => {
            const cat = CATEGORY_COLOR[c.category] || {};
            const overdueStyle = c.isOverdue ? { bgcolor: alpha(PASTEL.redInk, 0.06) } : {};
            return (
              <TableRow key={c.id} sx={{ '&:last-child td': { borderBottom: 0 }, '&:hover': { bgcolor: C.surface }, ...overdueStyle }}>
                <TableCell sx={{ py: 1.25, px: 1.5, minWidth: 170 }}>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{c.name}</Typography>
                  {c.applicationName && c.applicationName !== '—' && (
                    <Typography sx={{ fontSize: '0.62rem', color: C.textDim }}>{c.applicationName}</Typography>
                  )}
                </TableCell>
                <TableCell sx={{ py: 1.25, px: 1.5 }}>
                  <Badge label={CATEGORY_LABEL[c.category] || c.category} color={cat.text || C.slate} bg={cat.bg || C.slateBg} border={cat.border || C.border} />
                </TableCell>
                <TableCell sx={{ py: 1.25, px: 1.5 }}>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell sx={{ py: 1.25, px: 1.5, minWidth: 110 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress variant="determinate" value={Math.min(c.completionPercentage, 100)} sx={{
                      flex: 1, height: 5, borderRadius: 3, bgcolor: alpha(C.text, 0.06),
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 3,
                        bgcolor: c.completionPercentage >= 90 ? PASTEL.greenInk : c.completionPercentage >= 50 ? PASTEL.amberInk : c.completionPercentage >= 15 ? PASTEL.blueInk : PASTEL.ringLow,
                      },
                    }} />
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.textMid, minWidth: 28 }}>{c.completionPercentage}%</Typography>
                  </Box>
                </TableCell>
                <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.blueInk }}>{c.totalItems ?? 0}</Typography>
                </TableCell>
                <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.greenInk }}>{c.approvedItems}</Typography>
                </TableCell>
                <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.redInk }}>{c.revokedItems}</Typography>
                </TableCell>
                <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                  <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.amberInk }}>{c.pendingItems}</Typography>
                </TableCell>
                <TableCell sx={{ py: 1.25, px: 1.5, whiteSpace: 'nowrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {c.isOverdue && <ErrorOutline sx={{ fontSize: 13, color: PASTEL.redInk }} />}
                    <Typography sx={{ fontSize: '0.72rem', color: c.isOverdue ? PASTEL.redInk : C.textMid, fontWeight: c.isOverdue ? 700 : 400 }}>
                      {fmt(c.dueDate)}
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

/* ── Review records table (paginated per campaign) ─────────────────── */
function ReviewRecordsTable({ records, category, campaignId }) {
  const isAccess = ['ACCESS_ITEMS', 'ROLE_COMPOSITION'].includes(category);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  useEffect(() => {
    setPage(0);
  }, [campaignId, records.length]);

  const paginated = records.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const rowBase = page * rowsPerPage;

  return (
    <Box sx={{ borderTop: `1px solid ${C.border}`, overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 680 }}>
        <TableHead>
          <TableRow sx={{ bgcolor: C.surfaceDeep }}>
            {['#', 'Identity / User', 'Application', 'Entitlement', 'Reviewer', 'Decision', 'Reviewed On'].map(h => (
              <TableCell key={h} sx={{ py: 1, px: 1.5, fontSize: '0.62rem', fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {paginated.map((r, i) => (
            <TableRow key={`${rowBase + i}-${r.userId || ''}-${r.itemId || ''}`} sx={{ '&:last-child td': { borderBottom: 0 }, '&:hover': { bgcolor: C.surface } }}>
              <TableCell sx={{ py: 1, px: 1.5, color: C.textXDim, fontSize: '0.68rem', width: 30 }}>{rowBase + i + 1}</TableCell>
              <TableCell sx={{ py: 1, px: 1.5, minWidth: 140 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>
                  {r.itemName && r.itemName !== '—' ? r.itemName : '—'}
                </Typography>
                {r.itemEmail && (
                  <Typography sx={{ fontSize: '0.63rem', color: C.textDim }}>{r.itemEmail}</Typography>
                )}
                {r.itemDepartment && (
                  <Typography sx={{ fontSize: '0.62rem', color: C.textXDim }}>{r.itemDepartment}</Typography>
                )}
              </TableCell>
              {/* Application column */}
              <TableCell sx={{ py: 1, px: 1.5, minWidth: 120 }}>
                <Typography sx={{ fontSize: '0.72rem', color: C.textMid }}>
                  {r.applicationName && r.applicationName !== '—' ? r.applicationName : CATEGORY_LABEL[category] || '—'}
                </Typography>
              </TableCell>
              {/* Entitlement column */}
              <TableCell sx={{ py: 1, px: 1.5, maxWidth: 180 }}>
                {Array.isArray(r.accessScope) && r.accessScope.length > 0 ? (
                  <Tooltip title={r.accessScope.length > 1 ? r.accessScope.join(' · ') : ''} placement="top">
                    <Box>
                      <Typography sx={{ fontSize: '0.73rem', fontWeight: 600, color: C.teal }}>{truncate(r.accessScope[0], 26)}</Typography>
                      {r.accessScope.length > 1 && <Typography sx={{ fontSize: '0.6rem', color: C.textDim }}>+{r.accessScope.length - 1} more</Typography>}
                    </Box>
                  </Tooltip>
                ) : (
                  <Typography sx={{ fontSize: '0.72rem', color: C.textXDim }}>—</Typography>
                )}
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5, minWidth: 150 }}>
                <ReviewerCell name={r.reviewerName} email={r.reviewerEmail} />
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5, whiteSpace: 'nowrap' }}>
                <DecisionBadge status={r.status} />
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5, whiteSpace: 'nowrap' }}>
                <Typography sx={{ fontSize: '0.71rem', color: r.reviewedAt ? C.textMid : C.textXDim }}>
                  {r.reviewedAt ? fmt(r.reviewedAt) : '—'}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {records.length > 0 && (
        <TablePagination
          component="div"
          count={records.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[10, 25, 50, 100]}
          sx={{ borderTop: `1px solid ${alpha(C.text, 0.08)}`, '& .MuiTablePagination-toolbar': { minHeight: 44, px: 1 } }}
        />
      )}
    </Box>
  );
}

/* ── Campaign detail card ─────────────────────────────────────────── */
function CampaignCard({ campaign, records, index }) {
  const [open, setOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const campRecords = records.filter(r => r.campaignId === campaign.id);
  const visibleRecords = statusFilter
    ? campRecords.filter(r => String(r.status || '').toUpperCase() === statusFilter)
    : campRecords;
  const pct = campaign.completionPercentage || 0;
  const hasUnassigned = campRecords.length > 0 && campRecords.every(r => !r.reviewerEmail);
  const cat = CATEGORY_COLOR[campaign.category] || {};

  return (
    <Box sx={{ border: `1px solid ${open ? alpha(PASTEL.blueInk, 0.22) : PASTEL.cardBorder}`, borderRadius: '14px', overflow: 'hidden', bgcolor: PASTEL.neutralBg, mb: 1.25, transition: 'border-color 0.15s, box-shadow 0.15s', boxShadow: open ? '0 4px 18px rgba(15,23,42,0.055)' : PASTEL.cardShadow }}>
      {/* Header */}
      <Box onClick={() => setOpen(v => !v)} sx={{
        display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.75,
        cursor: 'pointer', userSelect: 'none', bgcolor: open ? C.surface : C.bg,
        transition: 'background 0.15s', '&:hover': { bgcolor: C.surface },
      }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: C.textXDim, minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {String(index + 1).padStart(2, '0')}
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ borderColor: C.border }} />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.35 }}>
            <Typography sx={{ fontSize: '0.87rem', fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{campaign.name}</Typography>
            <StatusBadge status={campaign.status} />
            {campaign.isOverdue && <Badge label="Overdue" color={PASTEL.redInk} bg={PASTEL.redBg} border={alpha(PASTEL.redInk, 0.14)} />}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge label={CATEGORY_LABEL[campaign.category] || campaign.category} color={cat.text || C.slate} bg={cat.bg || C.slateBg} border={cat.border || C.border} />
            {campaign.applicationName && campaign.applicationName !== '—' && (
              <Typography sx={{ fontSize: '0.63rem', color: C.textDim }}>{campaign.applicationName}</Typography>
            )}
            {campaign.startDate && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                <CalendarMonth sx={{ fontSize: 10, color: C.textDim }} />
                <Typography sx={{ fontSize: '0.63rem', color: C.textDim }}>Start Date : {fmt(campaign.startDate)}</Typography>
              </Box>
            )}
            {campaign.dueDate && (
              <Typography sx={{ fontSize: '0.63rem', color: campaign.isOverdue ? PASTEL.redInk : C.textDim, fontWeight: campaign.isOverdue ? 700 : 400 }}>
                Due Date : {fmt(campaign.dueDate)}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Mini stats */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { v: campaign.totalItems ?? 0, label: 'In scope', filterVal: null, ink: PASTEL.blueInk, bg: PASTEL.blueBg, br: alpha(PASTEL.blueInk, 0.14) },
            { v: campaign.approvedItems, label: 'Certified', filterVal: 'APPROVED', ink: PASTEL.greenInk, bg: PASTEL.greenBg, br: alpha(PASTEL.greenInk, 0.14) },
            { v: campaign.revokedItems, label: 'Revoked', filterVal: 'REVOKED', ink: PASTEL.redInk, bg: PASTEL.redBg, br: alpha(PASTEL.redInk, 0.14) },
            { v: campaign.pendingItems, label: 'Pending', filterVal: 'PENDING', ink: PASTEL.amberInk, bg: PASTEL.amberBg, br: alpha(PASTEL.amberInk, 0.14) },
          ].map(s => {
            const isSelected = statusFilter === s.filterVal;
            return (
              <Box
                key={s.label}
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusFilter(isSelected ? null : s.filterVal);
                }}
                sx={{
                  textAlign: 'center', px: 1.25, py: 0.5, borderRadius: '10px',
                  border: `2px solid ${isSelected ? s.ink : s.br}`,
                  bgcolor: isSelected ? alpha(s.ink, 0.08) : s.bg,
                  minWidth: 48,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  '&:hover': { borderColor: s.ink, bgcolor: alpha(s.ink, 0.12) },
                }}
              >
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: s.ink, lineHeight: 1 }}>{s.v ?? 0}</Typography>
                <Typography sx={{ fontSize: '0.55rem', color: s.ink, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', mt: 0.2 }}>{s.label}</Typography>
              </Box>
            );
          })}
          <ProgressRing pct={pct} size={38} />
        </Box>

        <IconButton size="small" sx={{ color: C.textDim, ml: 0.5, flexShrink: 0 }}>
          {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      {/* Expandable body */}
      <Collapse in={open} unmountOnExit>
        {statusFilter && (
          <Box sx={{ px: 2.5, py: 1, borderTop: `1px solid ${C.border}`, bgcolor: C.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: C.text }}>
              Filtered by: <Typography component="span" sx={{ fontWeight: 700, color: C.text }}>
                {statusFilter === 'APPROVED' ? 'Certified' : statusFilter === 'REVOKED' ? 'Revoked' : statusFilter === 'PENDING' ? 'Pending' : statusFilter}
              </Typography>
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: C.textDim }}>
              {visibleRecords.length} of {campRecords.length} records
            </Typography>
          </Box>
        )}
        {/* Unassigned warning */}
        {hasUnassigned && (
          <Box sx={{ mx: 2.5, mt: 1.25, mb: 0, px: 1.5, py: 0.9, bgcolor: PASTEL.amberBg, border: `1px solid ${alpha(PASTEL.amberInk, 0.14)}`, borderRadius: '8px', display: 'flex', alignItems: 'center', gap: 1 }}>
            <ErrorOutline sx={{ fontSize: 14, color: PASTEL.amberInk }} />
            <Typography sx={{ fontSize: '0.72rem', color: PASTEL.amberInk, fontWeight: 600 }}>
              No reviewer assigned — {campRecords.length} item{campRecords.length !== 1 ? 's' : ''} pending reviewer assignment
            </Typography>
          </Box>
        )}

        {/* Records table or empty */}
        {visibleRecords.length > 0
          ? <ReviewRecordsTable records={visibleRecords} category={campaign.category} campaignId={campaign.id} />
          : (
            <Box sx={{ px: 2.5, py: 2.5, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
              <HourglassEmpty sx={{ fontSize: 15, color: C.textXDim }} />
              <Typography sx={{ fontSize: '0.78rem', color: C.textDim, fontStyle: 'italic' }}>
                No review records loaded for this campaign.
              </Typography>
            </Box>
          )}
      </Collapse>
    </Box>
  );
}

/* ── Main export ──────────────────────────────────────────────────── */
export default function AccessCertificationSection({ applicationId, applicationName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchData = useCallback(async () => {
    if (!applicationId && !applicationName) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (applicationId) params.applicationId = applicationId;
      if (applicationName) params.applicationName = applicationName;
      const res = await api.get('/certifications/campaigns/iso-report', { params });
      setData(res.data?.data ?? null);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Failed to load certification data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [applicationId, applicationName]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summary = data?.summary;
  const campaigns = data?.campaigns ?? [];
  const records = data?.decisionRecords ?? [];

  return (
    <Box component="section" sx={{ mb: 4, width: '100%' }}>

      {/* ── Section header ── */}
      <Box sx={{ mb: 3, pb: 2, borderBottom: `2px solid ${C.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
          <Box sx={{ width: 4, height: 20, bgcolor: PASTEL.blueInk, borderRadius: 2, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: PASTEL.blueInk }}>
            ISO 27001 · Control A.5.20
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: C.text, mb: 0.4, pl: 2.5 }}>
          User Access Review
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: C.textDim, pl: 2.5 }}>
          Periodic review of user access rights — entitlement certifications, revocations, and pending decisions.
          {applicationName ? ` Scope: ${applicationName}.` : ''}
        </Typography>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
          <CircularProgress size={18} thickness={5} sx={{ color: PASTEL.blueInk }} />
          <Typography sx={{ fontSize: '0.8rem', color: C.textDim }}>Loading certification data…</Typography>
        </Box>
      )}

      {/* Error */}
      {!loading && error && <Alert severity="warning" sx={{ mb: 2.5, fontSize: '0.78rem' }}>{error}</Alert>}

      {/* Content */}
      {!loading && !error && (
        <>
          {campaigns.length > 0 ? (
            <>
              {/* Scope quality first — data hygiene before volume KPIs */}
              <ScopeQualityKpis campaigns={campaigns} records={records} />

              {summary && <KpiCards summary={summary} />}

              {/* Campaign overview table */}
              <CampaignTable campaigns={campaigns} />

              {/* Detailed records — all campaigns listed; pagination is inside each expanded table */}
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Detailed Review Records
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: C.textDim }}>
                    {records.length} records · {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
                  </Typography>
                </Box>
                {campaigns.map((c, i) => (
                  <CampaignCard key={c.id} campaign={c} records={records} index={i} />
                ))}
              </Box>
            </>
          ) : (
            <Box sx={{ py: 6, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: '10px', bgcolor: C.surface }}>
              <VerifiedUser sx={{ fontSize: 36, color: C.textXDim, mb: 1.5 }} />
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 600, color: C.textMid, mb: 0.5 }}>
                No certification campaigns found
              </Typography>
              <Typography sx={{ fontSize: '0.74rem', color: C.textDim, maxWidth: 380, mx: 'auto' }}>
                No access certification campaigns are linked to this application.
                Create a campaign in the Access Certification module to generate A.5.20 compliance data.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
