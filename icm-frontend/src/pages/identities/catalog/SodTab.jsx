import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Collapse, IconButton, Divider, TablePagination,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircle, Cancel, HourglassEmpty, ExpandMore, ExpandLess,
  ErrorOutline, GavelOutlined, VerifiedUserOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from './CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  DeepLinkButton,
  SeverityChip,
} from './CatalogInsightPrimitives';
import {
  fetchIdentitySod,
  identitySodQueryKey,
  IDENTITY_INSIGHT_STALE_MS,
} from './identityCatalogQueries';
import { CATALOG } from './catalogTheme';

const PASTEL = {
  greenBg: '#e8f2ec',
  greenInk: '#2f4d40',
  redBg: '#f5e9e9',
  redInk: '#6b4242',
  amberBg: '#f8f1e4',
  amberInk: '#6b5340',
  blueBg: '#e9edf5',
  blueInk: '#3d4d6b',
  tealBg: '#e5f0f1',
  tealInk: '#355a5f',
  purpleBg: alpha('#5b4d7a', 0.09),
  purpleInk: '#5b4d7a',
  neutralBg: '#f9fafb',
  ringLow: '#94a3b8',
  cardShadow: '0 1px 3px rgba(15, 23, 42, 0.045)',
  cardBorder: alpha('#0f172a', 0.07),
};

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Badge({ label, color, bg, border }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.9,
        py: 0.2,
        fontSize: '0.63rem',
        fontWeight: 700,
        lineHeight: 1.6,
        borderRadius: '4px',
        border: `1px solid ${border}`,
        bgcolor: bg,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  );
}

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase();
  const map = {
    open: { label: 'Open', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.14) },
    remediated: { label: 'Remediated', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    exception_granted: { label: 'Exception', color: PASTEL.purpleInk, bg: PASTEL.purpleBg, border: alpha(PASTEL.purpleInk, 0.15) },
    false_positive: { label: 'False positive', color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border },
    expired: { label: 'Expired', color: CATALOG.inkFaint, bg: CATALOG.surfaceAlt, border: CATALOG.border },
    mixed: { label: 'Mixed', color: PASTEL.blueInk, bg: PASTEL.blueBg, border: alpha(PASTEL.blueInk, 0.14) },
    clear: { label: 'Clear', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
  };
  const m = map[key] || { label: status || '—', color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border };
  return <Badge {...m} />;
}

function ViolationStatusBadge({ status }) {
  const key = String(status || 'open').toLowerCase();
  const map = {
    open: { icon: <HourglassEmpty sx={{ fontSize: 11 }} />, label: 'Open', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.14) },
    remediated: { icon: <CheckCircle sx={{ fontSize: 11 }} />, label: 'Remediated', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    exception_granted: { icon: <VerifiedUserOutlined sx={{ fontSize: 11 }} />, label: 'Exception', color: PASTEL.purpleInk, bg: PASTEL.purpleBg, border: alpha(PASTEL.purpleInk, 0.15) },
    false_positive: { icon: <Cancel sx={{ fontSize: 11 }} />, label: 'False positive', color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border },
    expired: { icon: <Cancel sx={{ fontSize: 11 }} />, label: 'Expired', color: CATALOG.inkFaint, bg: CATALOG.surfaceAlt, border: CATALOG.border },
  };
  const m = map[key] || map.open;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.8, py: 0.2, borderRadius: '4px', border: `1px solid ${m.border}`, bgcolor: m.bg }}>
      <Box sx={{ color: m.color, display: 'flex' }}>{m.icon}</Box>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: m.color }}>{m.label}</Typography>
    </Box>
  );
}

function ProgressRing({ pct, size = 38 }) {
  const r = (size - 5) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * circ;
  const color = pct >= 90
    ? PASTEL.greenInk
    : pct >= 50
      ? PASTEL.amberInk
      : pct >= 15
        ? PASTEL.blueInk
        : PASTEL.ringLow;
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alpha(CATALOG.ink, 0.07)} strokeWidth={4.5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4.5}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
        />
      </svg>
      <Typography sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 800, color }}>
        {pct}%
      </Typography>
    </Box>
  );
}

function normalizeStatus(status) {
  return String(status || 'open').toLowerCase();
}

function groupPolicies(violations, subject) {
  const byPolicy = new Map();
  for (const row of violations || []) {
    const key = row.policyId || row.policyName || 'unknown';
    if (!byPolicy.has(key)) byPolicy.set(key, []);
    byPolicy.get(key).push(row);
  }

  return [...byPolicy.entries()].map(([policyKey, rows]) => {
    const open = rows.filter((r) => normalizeStatus(r.status) === 'open').length;
    const remediated = rows.filter((r) => normalizeStatus(r.status) === 'remediated').length;
    const exception = rows.filter((r) => normalizeStatus(r.status) === 'exception_granted' || r.hasActiveException).length;
    const criticalHigh = rows.filter((r) => {
      const sev = String(r.severity || '').toUpperCase();
      return normalizeStatus(r.status) === 'open' && (sev === 'CRITICAL' || sev === 'HIGH');
    }).length;
    const total = rows.length;
    const resolved = remediated + exception + rows.filter((r) => ['false_positive', 'expired'].includes(normalizeStatus(r.status))).length;
    const progress = total ? Math.round((resolved / total) * 100) : 0;

    let status = 'open';
    if (open === 0 && total > 0) status = 'clear';
    else if (resolved > 0 && open > 0) status = 'mixed';
    else if (exception > 0 && open === 0) status = 'exception_granted';
    else if (remediated > 0 && open === 0) status = 'remediated';

    return {
      id: policyKey,
      name: rows[0]?.policyName || 'SoD Policy',
      policyId: rows[0]?.policyId || null,
      deepLink: rows[0]?.deepLink || '/governance/sod-violations',
      subjectName: subject?.subjectName || rows[0]?.subjectName || null,
      subjectEmail: subject?.subjectEmail || rows[0]?.subjectEmail || null,
      status,
      totalItems: total,
      openItems: open,
      remediatedItems: remediated,
      exceptionItems: exception,
      criticalHigh,
      completionPercentage: progress,
      records: rows,
    };
  }).sort((a, b) => b.openItems - a.openItems || b.criticalHigh - a.criticalHigh);
}

function PolicyCard({ policy, index }) {
  const [open, setOpen] = useState(index === 0);
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const records = policy.records || [];
  const filtered = statusFilter
    ? records.filter((r) => {
      const st = normalizeStatus(r.status);
      if (statusFilter === 'OPEN') return st === 'open';
      if (statusFilter === 'REMEDIATED') return st === 'remediated';
      if (statusFilter === 'EXCEPTION') return st === 'exception_granted' || r.hasActiveException;
      if (statusFilter === 'CRITICAL') {
        const sev = String(r.severity || '').toUpperCase();
        return st === 'open' && (sev === 'CRITICAL' || sev === 'HIGH');
      }
      return true;
    })
    : records;

  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Box
      sx={{
        border: `1px solid ${open ? alpha(PASTEL.blueInk, 0.22) : PASTEL.cardBorder}`,
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: PASTEL.neutralBg,
        mb: 1.25,
        boxShadow: open ? '0 4px 18px rgba(15,23,42,0.055)' : PASTEL.cardShadow,
      }}
    >
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          px: 2.5,
          py: 1.75,
          cursor: 'pointer',
          userSelect: 'none',
          bgcolor: open ? CATALOG.surfaceAlt : '#fff',
          '&:hover': { bgcolor: CATALOG.surfaceAlt },
        }}
      >
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: CATALOG.inkFaint, minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {String(index + 1).padStart(2, '0')}
        </Typography>
        <Divider orientation="vertical" flexItem sx={{ borderColor: CATALOG.border }} />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.35 }}>
            <Typography sx={{ fontSize: '0.87rem', fontWeight: 700, color: CATALOG.ink, lineHeight: 1.3 }}>
              {policy.name}
            </Typography>
            <StatusBadge status={policy.status} />
            {policy.criticalHigh > 0 ? (
              <Badge label={`${policy.criticalHigh} Critical/High`} color={PASTEL.redInk} bg={PASTEL.redBg} border={alpha(PASTEL.redInk, 0.14)} />
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge label="SoD Policy" color={PASTEL.purpleInk} bg={PASTEL.purpleBg} border={alpha(PASTEL.purpleInk, 0.15)} />
            <Badge
              label={policy.subjectName ? `User: ${policy.subjectName}` : 'This identity only'}
              color={PASTEL.tealInk}
              bg={PASTEL.tealBg}
              border={alpha(PASTEL.tealInk, 0.16)}
            />
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { v: policy.totalItems, label: 'In scope', filterVal: null, ink: PASTEL.blueInk, bg: PASTEL.blueBg, br: alpha(PASTEL.blueInk, 0.14) },
            { v: policy.openItems, label: 'Open', filterVal: 'OPEN', ink: PASTEL.amberInk, bg: PASTEL.amberBg, br: alpha(PASTEL.amberInk, 0.14) },
            { v: policy.remediatedItems, label: 'Remediated', filterVal: 'REMEDIATED', ink: PASTEL.greenInk, bg: PASTEL.greenBg, br: alpha(PASTEL.greenInk, 0.14) },
            { v: policy.exceptionItems, label: 'Exception', filterVal: 'EXCEPTION', ink: PASTEL.purpleInk, bg: PASTEL.purpleBg, br: alpha(PASTEL.purpleInk, 0.15) },
          ].map((s) => {
            const selected = statusFilter === s.filterVal;
            return (
              <Box
                key={s.label}
                onClick={(e) => {
                  e.stopPropagation();
                  setStatusFilter(selected ? null : s.filterVal);
                  setPage(0);
                  if (!open) setOpen(true);
                }}
                sx={{
                  textAlign: 'center',
                  px: 1.25,
                  py: 0.5,
                  borderRadius: '10px',
                  border: `2px solid ${selected ? s.ink : s.br}`,
                  bgcolor: selected ? alpha(s.ink, 0.08) : s.bg,
                  minWidth: 48,
                  cursor: 'pointer',
                  '&:hover': { borderColor: s.ink },
                }}
              >
                <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: s.ink, lineHeight: 1 }}>{s.v ?? 0}</Typography>
                <Typography sx={{ fontSize: '0.55rem', color: s.ink, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em', mt: 0.2 }}>
                  {s.label}
                </Typography>
              </Box>
            );
          })}
          <ProgressRing pct={policy.completionPercentage || 0} />
        </Box>

        <IconButton size="small" sx={{ color: CATALOG.inkFaint, ml: 0.5, flexShrink: 0 }}>
          {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, py: 1, borderTop: `1px solid ${CATALOG.border}`, bgcolor: alpha(PASTEL.tealInk, 0.05), display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 650, color: PASTEL.tealInk }}>
            Showing this identity only
            {policy.subjectName ? ` — ${policy.subjectName}` : ''}
            {policy.subjectEmail ? ` (${policy.subjectEmail})` : ''}
            . Other users on this policy are not listed.
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
            Violations for this user: {policy.totalItems}
          </Typography>
        </Box>

        {statusFilter ? (
          <Box sx={{ px: 2.5, py: 1, borderTop: `1px solid ${CATALOG.border}`, bgcolor: CATALOG.surfaceAlt, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: CATALOG.ink }}>
              Filtered by:{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {statusFilter === 'OPEN' ? 'Open' : statusFilter === 'REMEDIATED' ? 'Remediated' : statusFilter === 'EXCEPTION' ? 'Exception' : statusFilter}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
              {filtered.length} of {records.length} rows
            </Typography>
          </Box>
        ) : null}

        {filtered.length === 0 ? (
          <Box sx={{ px: 2.5, py: 2.5, borderTop: `1px solid ${CATALOG.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <GavelOutlined sx={{ fontSize: 15, color: CATALOG.inkFaint }} />
            <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint, fontStyle: 'italic' }}>
              No SoD violations for this identity in the selected filter.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ borderTop: `1px solid ${CATALOG.border}` }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 1.3fr 1.6fr 90px 110px 110px',
                gap: 1,
                px: 2.5,
                py: 1,
                bgcolor: CATALOG.surfaceAlt,
                borderBottom: `1px solid ${CATALOG.border}`,
              }}
            >
              {['#', 'Identity', 'Conflict', 'Severity', 'Status', 'Detected'].map((h) => (
                <Typography
                  key={h}
                  sx={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: CATALOG.inkFaint,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {h}
                </Typography>
              ))}
            </Box>
            {paged.map((row, idx) => (
              <Box
                key={row.id}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1.3fr 1.6fr 90px 110px 110px',
                  gap: 1,
                  px: 2.5,
                  py: 1.25,
                  alignItems: 'center',
                  borderBottom: `1px solid ${CATALOG.border}`,
                  bgcolor: idx % 2 ? alpha(PASTEL.blueInk, 0.02) : '#fff',
                }}
              >
                <Typography sx={{ fontSize: '0.72rem', color: CATALOG.inkFaint, fontVariantNumeric: 'tabular-nums' }}>
                  {page * rowsPerPage + idx + 1}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }} noWrap>
                    {row.subjectName || policy.subjectName || 'This identity'}
                  </Typography>
                  {(row.subjectEmail || policy.subjectEmail) ? (
                    <Typography sx={{ fontSize: '0.62rem', color: CATALOG.inkFaint }} noWrap>
                      {row.subjectEmail || policy.subjectEmail}
                    </Typography>
                  ) : null}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: CATALOG.ink }} noWrap>
                    {row.conflict || '—'}
                  </Typography>
                  {row.ruleName ? (
                    <Typography sx={{ fontSize: '0.62rem', color: CATALOG.inkFaint }} noWrap>
                      {row.ruleName}
                    </Typography>
                  ) : null}
                </Box>
                <SeverityChip severity={row.severity || 'MEDIUM'} />
                <ViolationStatusBadge status={row.status} />
                <Typography sx={{ fontSize: '0.72rem', color: CATALOG.inkMuted }}>
                  {fmt(row.detectedAt)}
                </Typography>
              </Box>
            ))}
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_e, next) => setPage(next)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 25, 50]}
              sx={{ borderTop: `1px solid ${CATALOG.border}` }}
            />
          </Box>
        )}
      </Collapse>
    </Box>
  );
}

export default function SodTab({ identityId }) {
  const query = useQuery({
    queryKey: identitySodQueryKey(identityId),
    queryFn: () => fetchIdentitySod(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const policies = useMemo(
    () => groupPolicies(data?.violations || [], {
      subjectName: data?.subjectName,
      subjectEmail: data?.subjectEmail || data?.email,
    }),
    [data],
  );
  const recordCount = data?.violations?.length || 0;

  return (
    <CatalogSection
      eyebrow="Governance"
      title="Segregation of Duties"
      subtitle="SoD policies that include this identity — only this user’s violations and status are shown."
      dense
      actions={data?.deepLink ? <DeepLinkButton to={data.deepLink} label="Open SoD violations" /> : null}
    >
      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load SoD insights.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? (
                    <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: CATALOG.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Detailed SoD Records
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
              {recordCount} violations · {policies.length} polic{policies.length !== 1 ? 'ies' : 'y'}
            </Typography>
                    </Box>

          {policies.length === 0 ? (
            <Box sx={{ py: 4, px: 2, textAlign: 'center', border: `1px dashed ${CATALOG.border}`, borderRadius: '10px', bgcolor: CATALOG.surface }}>
              <ErrorOutline sx={{ fontSize: 28, color: CATALOG.inkFaint, mb: 1 }} />
                <InsightEmpty
                  title="No SoD violations"
                  body="This identity has no recorded segregation-of-duties conflicts."
                  to={data.deepLink}
                  linkLabel="Browse SoD violations"
                />
            </Box>
          ) : (
            policies.map((policy, index) => (
              <PolicyCard key={policy.id} policy={policy} index={index} />
            ))
          )}
        </Box>
      ) : null}
    </CatalogSection>
  );
}
