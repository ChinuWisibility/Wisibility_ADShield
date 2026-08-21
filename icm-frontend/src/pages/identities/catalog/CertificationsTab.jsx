import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Collapse, IconButton, Divider, TablePagination, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CheckCircle, Cancel, HourglassEmpty, ExpandMore, ExpandLess,
  CalendarMonth, ErrorOutline, PersonOff,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from './CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  DeepLinkButton,
} from './CatalogInsightPrimitives';
import {
  fetchIdentityCertifications,
  identityCertificationsQueryKey,
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
  const raw = String(status || '');
  const key = raw.toLowerCase();
  const map = {
    completed: { label: 'Completed', color: PASTEL.blueInk, bg: PASTEL.blueBg, border: alpha(PASTEL.blueInk, 0.14) },
    'in progress': { label: 'In Progress', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    active: { label: 'Active', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    draft: { label: 'Draft', color: CATALOG.inkFaint, bg: CATALOG.surfaceAlt, border: CATALOG.border },
    overdue: { label: 'Overdue', color: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.14) },
    'not started': { label: 'Not Started', color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border },
  };
  const m = map[key] || { label: raw || '—', color: CATALOG.inkMuted, bg: CATALOG.surfaceAlt, border: CATALOG.border };
  return <Badge {...m} />;
}

function DecisionBadge({ status, decision }) {
  const key = String(decision || status || 'PENDING').toUpperCase();
  const map = {
    APPROVED: { icon: <CheckCircle sx={{ fontSize: 11 }} />, label: 'Approved', color: PASTEL.greenInk, bg: PASTEL.greenBg, border: alpha(PASTEL.greenInk, 0.14) },
    EXCEPTION: { icon: <CheckCircle sx={{ fontSize: 11 }} />, label: 'Exception', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.18) },
    REVOKED: { icon: <Cancel sx={{ fontSize: 11 }} />, label: 'Revoked', color: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.14) },
    REVOKE_IN_PROGRESS: { icon: <Cancel sx={{ fontSize: 11 }} />, label: 'Revoke in progress', color: PASTEL.redInk, bg: PASTEL.redBg, border: alpha(PASTEL.redInk, 0.14) },
    PENDING: { icon: <HourglassEmpty sx={{ fontSize: 11 }} />, label: 'Pending', color: PASTEL.amberInk, bg: PASTEL.amberBg, border: alpha(PASTEL.amberInk, 0.14) },
    DELEGATED: { icon: <HourglassEmpty sx={{ fontSize: 11 }} />, label: 'Delegated', color: '#5b4d7a', bg: alpha('#5b4d7a', 0.09), border: alpha('#5b4d7a', 0.15) },
  };
  const m = map[key] || map.PENDING;
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

function ReviewerCell({ reviewer }) {
  const value = String(reviewer || '').trim();
  if (!value) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: CATALOG.surfaceAlt, border: `1px dashed ${CATALOG.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <PersonOff sx={{ fontSize: 12, color: CATALOG.inkFaint }} />
        </Box>
        <Typography sx={{ fontSize: '0.72rem', fontStyle: 'italic', color: CATALOG.inkFaint }}>Unassigned</Typography>
      </Box>
    );
  }
  const isEmail = value.includes('@');
  const initials = value.split(/[\s@]/)[0]?.[0]?.toUpperCase() || '?';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: PASTEL.tealBg, border: `1px solid ${alpha(PASTEL.tealInk, 0.2)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: PASTEL.tealInk, flexShrink: 0 }}>
        {initials}
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: isEmail ? 500 : 600, color: CATALOG.ink, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {value}
      </Typography>
    </Box>
  );
}

function statusBucket(status) {
  const st = String(status || '').toUpperCase();
  if (['APPROVED', 'EXCEPTION'].includes(st)) return 'approved';
  if (['REVOKED', 'REVOKE_IN_PROGRESS'].includes(st)) return 'revoked';
  if (['PENDING', 'DELEGATED'].includes(st)) return 'pending';
  return 'other';
}

function groupCampaigns(items) {
  const byCampaign = new Map();
  for (const item of items || []) {
    const key = item.campaignId || 'unknown';
    if (!byCampaign.has(key)) byCampaign.set(key, []);
    byCampaign.get(key).push(item);
  }

  return [...byCampaign.entries()].map(([campaignId, rows]) => {
    // One ReviewItem = one user in the campaign. Entitlement expansions must not inflate "In scope".
    const byReviewItem = new Map();
    for (const row of rows) {
      const rid = row.reviewItemId || row.id;
      if (!byReviewItem.has(rid)) byReviewItem.set(rid, []);
      byReviewItem.get(rid).push(row);
    }

    let approved = 0;
    let revoked = 0;
    let pending = 0;
    for (const itemRows of byReviewItem.values()) {
      const buckets = itemRows.map((r) => statusBucket(r.status));
      if (buckets.every((b) => b === 'approved')) approved += 1;
      else if (buckets.every((b) => b === 'revoked')) revoked += 1;
      else if (buckets.some((b) => b === 'pending' || b === 'other')) pending += 1;
      else if (buckets.some((b) => b === 'revoked')) revoked += 1;
      else approved += 1;
    }

    const inScope = byReviewItem.size; // this identity only (usually 1)
    const done = approved + revoked;
    const progress = inScope ? Math.round((done / inScope) * 100) : 0;
    const dueDate = rows[0]?.dueDate || null;
    const isOverdue = dueDate
      && pending > 0
      && new Date(dueDate).getTime() < Date.now();

    let status = rows[0]?.campaignStatus || 'Draft';
    if (pending === 0 && inScope > 0) status = 'Completed';
    else if (done > 0) status = 'In Progress';
    else if (isOverdue) status = 'Overdue';

    const apps = [...new Set(rows.map((r) => r.applicationName).filter(Boolean))];
    const subjectName = rows[0]?.subjectName || rows[0]?.itemName || null;
    const subjectEmail = rows[0]?.subjectEmail || null;

    return {
      id: campaignId,
      name: rows[0]?.campaignName || 'Campaign',
      status,
      isOverdue,
      startDate: rows[0]?.createdAt || null,
      dueDate,
      applicationName: apps.length === 1 ? apps[0] : (apps.length > 1 ? `${apps.length} apps` : null),
      type: 'Identity',
      subjectName,
      subjectEmail,
      totalItems: inScope,
      approvedItems: approved,
      revokedItems: revoked,
      pendingItems: pending,
      completionPercentage: progress,
      deepLink: rows[0]?.deepLink || '/governance/certifications/access',
      records: rows,
    };
  }).sort((a, b) => {
    const ad = a.dueDate ? new Date(a.dueDate).getTime() : 0;
    const bd = b.dueDate ? new Date(b.dueDate).getTime() : 0;
    return bd - ad;
  });
}

function CampaignCard({ campaign, index }) {
  const [open, setOpen] = useState(index === 0);
  const [statusFilter, setStatusFilter] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const records = campaign.records || [];
  const filtered = statusFilter
    ? records.filter((r) => {
      const st = String(r.status || '').toUpperCase();
      if (statusFilter === 'APPROVED') return ['APPROVED', 'EXCEPTION'].includes(st);
      if (statusFilter === 'REVOKED') return ['REVOKED', 'REVOKE_IN_PROGRESS'].includes(st);
      if (statusFilter === 'PENDING') return ['PENDING', 'DELEGATED'].includes(st);
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
              {campaign.name}
            </Typography>
            <StatusBadge status={campaign.status} />
            {campaign.isOverdue ? (
              <Badge label="Overdue" color={PASTEL.redInk} bg={PASTEL.redBg} border={alpha(PASTEL.redInk, 0.14)} />
            ) : null}
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge label={campaign.type} color={PASTEL.blueInk} bg={PASTEL.blueBg} border={alpha(PASTEL.blueInk, 0.16)} />
            <Badge
              label={campaign.subjectName ? `User: ${campaign.subjectName}` : 'This identity only'}
              color={PASTEL.tealInk}
              bg={PASTEL.tealBg}
              border={alpha(PASTEL.tealInk, 0.16)}
            />
            {campaign.applicationName ? (
              <Chip size="small" label={campaign.applicationName} sx={{ height: 20, fontSize: '0.63rem', fontWeight: 650 }} />
            ) : null}
            {campaign.startDate ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                <CalendarMonth sx={{ fontSize: 10, color: CATALOG.inkFaint }} />
                <Typography sx={{ fontSize: '0.63rem', color: CATALOG.inkFaint }}>
                  Start Date : {fmt(campaign.startDate)}
                </Typography>
              </Box>
            ) : null}
            {campaign.dueDate ? (
              <Typography sx={{ fontSize: '0.63rem', color: campaign.isOverdue ? PASTEL.redInk : CATALOG.inkFaint, fontWeight: campaign.isOverdue ? 700 : 400 }}>
                Due Date : {fmt(campaign.dueDate)}
              </Typography>
            ) : null}
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {[
            { v: campaign.totalItems, label: 'In scope', filterVal: null, ink: PASTEL.blueInk, bg: PASTEL.blueBg, br: alpha(PASTEL.blueInk, 0.14) },
            { v: campaign.approvedItems, label: 'Certified', filterVal: 'APPROVED', ink: PASTEL.greenInk, bg: PASTEL.greenBg, br: alpha(PASTEL.greenInk, 0.14) },
            { v: campaign.revokedItems, label: 'Revoked', filterVal: 'REVOKED', ink: PASTEL.redInk, bg: PASTEL.redBg, br: alpha(PASTEL.redInk, 0.14) },
            { v: campaign.pendingItems, label: 'Pending', filterVal: 'PENDING', ink: PASTEL.amberInk, bg: PASTEL.amberBg, br: alpha(PASTEL.amberInk, 0.14) },
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
          <ProgressRing pct={campaign.completionPercentage || 0} />
        </Box>

        <IconButton size="small" sx={{ color: CATALOG.inkFaint, ml: 0.5, flexShrink: 0 }}>
          {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, py: 1, borderTop: `1px solid ${CATALOG.border}`, bgcolor: alpha(PASTEL.tealInk, 0.05), display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 650, color: PASTEL.tealInk }}>
            Showing this identity only
            {campaign.subjectName ? ` — ${campaign.subjectName}` : ''}
            {campaign.subjectEmail ? ` (${campaign.subjectEmail})` : ''}
            . Other campaign members are not listed.
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
            In scope for this user: {campaign.totalItems}
          </Typography>
        </Box>
        {statusFilter ? (
          <Box sx={{ px: 2.5, py: 1, borderTop: `1px solid ${CATALOG.border}`, bgcolor: CATALOG.surfaceAlt, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: CATALOG.ink }}>
              Filtered by:{' '}
              <Box component="span" sx={{ fontWeight: 700 }}>
                {statusFilter === 'APPROVED' ? 'Certified' : statusFilter === 'REVOKED' ? 'Revoked' : 'Pending'}
              </Box>
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
              {filtered.length} of {records.length} access rows
            </Typography>
          </Box>
        ) : null}

        {filtered.length === 0 ? (
          <Box sx={{ px: 2.5, py: 2.5, borderTop: `1px solid ${CATALOG.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <HourglassEmpty sx={{ fontSize: 15, color: CATALOG.inkFaint }} />
            <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkFaint, fontStyle: 'italic' }}>
              No review records for this identity in the selected filter.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ borderTop: `1px solid ${CATALOG.border}` }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 1.3fr 1.2fr 1.4fr 1.1fr 110px 110px',
                gap: 1,
                px: 2.5,
                py: 1,
                bgcolor: CATALOG.surfaceAlt,
                borderBottom: `1px solid ${CATALOG.border}`,
              }}
            >
              {['#', 'Identity', 'Application', 'Entitlement', 'Reviewer', 'Status', 'Reviewed on'].map((h) => (
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
                  gridTemplateColumns: '40px 1.3fr 1.2fr 1.4fr 1.1fr 110px 110px',
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
                    {row.subjectName || campaign.subjectName || 'This identity'}
                  </Typography>
                  {(row.subjectEmail || campaign.subjectEmail) ? (
                    <Typography sx={{ fontSize: '0.62rem', color: CATALOG.inkFaint }} noWrap>
                      {row.subjectEmail || campaign.subjectEmail}
                    </Typography>
                  ) : null}
                </Box>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 650, color: CATALOG.ink }}>
                  {row.applicationName || '—'}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: CATALOG.ink }} noWrap>
                    {row.entitlementName || row.itemName || '—'}
                  </Typography>
                  {row.entitlementType ? (
                    <Typography sx={{ fontSize: '0.62rem', color: CATALOG.inkFaint }}>
                      {row.entitlementType}
                    </Typography>
                  ) : null}
                </Box>
                <ReviewerCell reviewer={row.reviewer} />
                <DecisionBadge status={row.status} decision={row.decision} />
                <Typography sx={{ fontSize: '0.72rem', color: CATALOG.inkMuted }}>
                  {fmt(row.reviewedAt)}
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

export default function CertificationsTab({ identityId }) {
  const query = useQuery({
    queryKey: identityCertificationsQueryKey(identityId),
    queryFn: () => fetchIdentityCertifications(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const campaigns = useMemo(() => groupCampaigns(data?.items || []), [data?.items]);
  const recordCount = useMemo(() => {
    const ids = new Set((data?.items || []).map((r) => r.reviewItemId || r.id).filter(Boolean));
    return ids.size;
  }, [data?.items]);

  return (
    <CatalogSection
      eyebrow="Governance"
      title="Access certifications"
      subtitle="Campaigns that include this identity — only this user’s status is shown (not other campaign members)."
      dense
      actions={data?.deepLink ? <DeepLinkButton to={data.deepLink} label="Open certifications" /> : null}
    >
      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load certification history.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? (
                    <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: CATALOG.inkMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Detailed Review Records
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: CATALOG.inkFaint }}>
              {recordCount} records · {campaigns.length} campaign{campaigns.length !== 1 ? 's' : ''}
            </Typography>
                    </Box>

          {campaigns.length === 0 ? (
            <Box sx={{ py: 4, px: 2, textAlign: 'center', border: `1px dashed ${CATALOG.border}`, borderRadius: '10px', bgcolor: CATALOG.surface }}>
              <ErrorOutline sx={{ fontSize: 28, color: CATALOG.inkFaint, mb: 1 }} />
                <InsightEmpty
                title="No certification campaigns"
                  body="This identity is not part of any access certification campaigns yet."
                  to={data.deepLink}
                  linkLabel="Browse certifications"
                />
            </Box>
          ) : (
            campaigns.map((campaign, index) => (
              <CampaignCard key={campaign.id} campaign={campaign} index={index} />
            ))
          )}
        </Box>
      ) : null}
    </CatalogSection>
  );
}
