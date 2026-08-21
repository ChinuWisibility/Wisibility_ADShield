import { useMemo, useState, useEffect } from 'react';
import {
  Box, Typography, Table, TableHead, TableRow, TableCell, TableBody,
  CircularProgress, Alert, TablePagination, Collapse, IconButton, Chip, Button, Tooltip,
} from '@mui/material';
import {
  ExpandMore, ExpandLess, Shield, OpenInNew, GppBad,
} from '@mui/icons-material';
import { Link as RouterLink } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { palette } from '../../theme/palette';
import {
  violationPrimaryLabel,
  violationEmailLine,
} from '../../utils/sodViolationPresentation';

const C = {
  bg: palette.bg.primary,
  surface: palette.bg.secondary,
  surfaceDeep: alpha(palette.bg.elevated, 0.5),
  border: palette.border.default,
  text: palette.text.primary,
  textMid: palette.text.secondary,
  textDim: palette.text.disabled,
  textXDim: alpha(palette.text.disabled, 0.5),
};

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
  cardShadow: '0 1px 3px rgba(15, 23, 42, 0.045)',
  cardBorder: alpha('#0f172a', 0.07),
};

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function entitlementNames(value) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      return String(item.name || item.displayName || item.entitlementName || item.id || item._id || '').trim();
    })
    .filter(Boolean);
}

function conflictAccessItemsLabel(row) {
  const left = entitlementNames(row?.leftEntitlements || row?.conflictLeftEntitlements || row?.leftAccessItems);
  const right = entitlementNames(row?.rightEntitlements || row?.conflictRightEntitlements || row?.rightAccessItems);

  if (!left.length && !right.length) {
    return '—';
  }

  const leftLabel = left.length > 0 ? left.join(', ') : '—';
  const rightLabel = right.length > 0 ? right.join(', ') : '—';
  return `${leftLabel} × ${rightLabel}`;
}

function policyIdStr(p) {
  if (!p) return '';
  return String(p._id ?? p);
}

function violationPolicyKey(v) {
  const pol = v?.policy;
  if (pol && typeof pol === 'object' && pol._id != null) return String(pol._id);
  return String(pol ?? '');
}

function isOpenStatus(s) {
  return String(s || '').toLowerCase() === 'open';
}

function StatusChip({ value }) {
  const v = String(value || '').toLowerCase();
  const cfg =
    v === 'open'
      ? { color: palette.status.error, bg: palette.status.errorBg, label: 'Open' }
      : v === 'remediated'
        ? { color: palette.status.success, bg: palette.status.successBg, label: 'Remediated' }
        : v === 'exception_granted'
          ? { color: palette.status.info, bg: palette.status.infoBg, label: 'Exception' }
          : v === 'false_positive'
            ? { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: 'False positive' }
            : v
              ? { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: value }
              : { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: '—' };
  return <Chip size="small" label={cfg.label} sx={{ fontWeight: 700, bgcolor: cfg.bg, color: cfg.color }} />;
}

function PolicyViolationsTable({ rows }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    setPage(0);
  }, [rows.length]);

  const slice = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const base = page * rowsPerPage;

  return (
    <Box sx={{ borderTop: `1px solid ${C.border}`, overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 820 }}>
        <TableHead>
          <TableRow sx={{ bgcolor: C.surfaceDeep }}>
            {['#', 'Identity', 'Conflict access items', 'Status', 'Severity', 'Detected'].map((h) => (
              <TableCell
                key={h}
                sx={{
                  py: 1,
                  px: 1.5,
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: C.textDim,
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  borderBottom: `1px solid ${C.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {slice.map((r, i) => (
            <TableRow key={`${base + i}-${r._id || ''}`} sx={{ '&:last-child td': { borderBottom: 0 }, '&:hover': { bgcolor: C.surface } }}>
              <TableCell sx={{ py: 1, px: 1.5, color: C.textXDim, fontSize: '0.68rem', width: 36 }}>{base + i + 1}</TableCell>
              <TableCell sx={{ py: 1, px: 1.5, minWidth: 160 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, lineHeight: 1.3 }}>
                  {violationPrimaryLabel(r)}
                </Typography>
                <Typography sx={{ fontSize: '0.63rem', color: C.textDim }}>{violationEmailLine(r)}</Typography>
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5, minWidth: 240 }}>
                <Tooltip title={conflictAccessItemsLabel(r)} placement="top" arrow>
                  <Typography
                    sx={{
                      fontSize: '0.72rem',
                      color: C.textMid,
                      fontWeight: 600,
                      lineHeight: 1.35,
                    }}
                    noWrap
                  >
                    {conflictAccessItemsLabel(r)}
                  </Typography>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5 }}><StatusChip value={r.status} /></TableCell>
              <TableCell sx={{ py: 1, px: 1.5, fontSize: '0.72rem', fontWeight: 600, color: C.textMid }}>
                {r.severity || '—'}
              </TableCell>
              <TableCell sx={{ py: 1, px: 1.5, whiteSpace: 'nowrap', fontSize: '0.71rem', color: C.textMid }}>
                {fmt(r.detectedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 0 && (
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25, 50]}
          sx={{ borderTop: `1px solid ${alpha(C.text, 0.08)}`, '& .MuiTablePagination-toolbar': { minHeight: 44, px: 1 } }}
        />
      )}
    </Box>
  );
}

function PolicyCard({ policy, violations, index }) {
  const [open, setOpen] = useState(false);
  const pid = policyIdStr(policy);
  const mine = violations.filter((v) => violationPolicyKey(v) === pid);
  const openCount = mine.filter((v) => isOpenStatus(v.status)).length;

  return (
    <Box
      sx={{
        border: `1px solid ${open ? alpha(PASTEL.blueInk, 0.22) : PASTEL.cardBorder}`,
        borderRadius: '14px',
        overflow: 'hidden',
        bgcolor: PASTEL.neutralBg,
        mb: 1.25,
        transition: 'border-color 0.15s, box-shadow 0.15s',
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
          bgcolor: open ? C.surface : C.bg,
          transition: 'background 0.15s',
          '&:hover': { bgcolor: C.surface },
        }}
      >
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: C.textXDim, minWidth: 22, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {String(index + 1).padStart(2, '0')}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.35 }}>
            <Typography sx={{ fontSize: '0.87rem', fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{policy.name || '—'}</Typography>
            <Chip
              size="small"
              label={policy.status || '—'}
              sx={{ fontSize: '0.62rem', height: 22, fontWeight: 700, textTransform: 'capitalize' }}
            />
            {policy.severity && (
              <Chip size="small" label={policy.severity} variant="outlined" sx={{ fontSize: '0.6rem', height: 22 }} />
            )}
          </Box>
          <Typography sx={{ fontSize: '0.63rem', color: C.textDim, lineHeight: 1.4 }} noWrap title={policy.description}>
            {policy.description ? `${String(policy.description).slice(0, 120)}${String(policy.description).length > 120 ? '…' : ''}` : ' '}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <Box sx={{ textAlign: 'center', px: 1.25, py: 0.5, borderRadius: '10px', border: `1px solid ${alpha(PASTEL.redInk, 0.14)}`, bgcolor: PASTEL.redBg, minWidth: 52 }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: PASTEL.redInk, lineHeight: 1 }}>{openCount}</Typography>
            <Typography sx={{ fontSize: '0.55rem', color: PASTEL.redInk, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.05em', mt: 0.2 }}>Open</Typography>
          </Box>
          <Box sx={{ textAlign: 'center', px: 1.25, py: 0.5, borderRadius: '10px', border: `1px solid ${alpha(PASTEL.blueInk, 0.14)}`, bgcolor: PASTEL.blueBg, minWidth: 52 }}>
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: PASTEL.blueInk, lineHeight: 1 }}>{mine.length}</Typography>
            <Typography sx={{ fontSize: '0.55rem', color: PASTEL.blueInk, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.05em', mt: 0.2 }}>Total</Typography>
          </Box>
        </Box>
        <Button
          component={RouterLink}
          to={`/governance/sod-policies/${policy._id}`}
          size="small"
          variant="outlined"
          onClick={(e) => e.stopPropagation()}
          sx={{ textTransform: 'none', fontWeight: 600, flexShrink: 0, display: { xs: 'none', sm: 'inline-flex' } }}
        >
          Policy
        </Button>
        <IconButton size="small" sx={{ color: C.textDim, ml: 0.5, flexShrink: 0 }}>
          {open ? <ExpandLess sx={{ fontSize: 18 }} /> : <ExpandMore sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${C.border}`, bgcolor: C.surface }}>
          {mine.length === 0 ? (
            <Typography sx={{ fontSize: '0.78rem', color: C.textDim, fontStyle: 'italic' }}>No violations loaded for this policy.</Typography>
          ) : (
            <PolicyViolationsTable rows={mine} />
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function PolicySummaryTable({ rows }) {
  return (
    <Box sx={{ border: `1px solid ${C.border}`, borderRadius: '8px', overflow: 'hidden', mb: 3 }}>
      <Box sx={{ px: 2.5, py: 1.5, bgcolor: C.surface, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Shield sx={{ fontSize: 14, color: PASTEL.blueInk }} />
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Policy summary — {rows.length} polic{rows.length !== 1 ? 'ies' : 'y'}
        </Typography>
      </Box>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ bgcolor: C.surfaceDeep }}>
            {['Policy', 'Status', 'Severity', 'Open', 'Total violations'].map((h) => (
              <TableCell key={h} sx={{ py: 1, px: 1.5, fontSize: '0.62rem', fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} sx={{ '&:last-child td': { borderBottom: 0 }, '&:hover': { bgcolor: C.surface } }}>
              <TableCell sx={{ py: 1.25, px: 1.5, minWidth: 200 }}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.text }}>{r.name}</Typography>
              </TableCell>
              <TableCell sx={{ py: 1.25, px: 1.5 }}>
                <Chip size="small" label={r.status || '—'} sx={{ fontSize: '0.62rem', height: 22, textTransform: 'capitalize' }} />
              </TableCell>
              <TableCell sx={{ py: 1.25, px: 1.5, fontSize: '0.74rem' }}>{r.severity || '—'}</TableCell>
              <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.redInk }}>{r.open}</Typography>
              </TableCell>
              <TableCell align="center" sx={{ py: 1.25, px: 1.5 }}>
                <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: PASTEL.blueInk }}>{r.total}</Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

/**
 * ISO 2007 report — SOD tab: policies scoped to the selected application and their violations.
 * Data is loaded by the parent (single query shared with key findings).
 */
export default function IsoReportSodSection({
  applicationId: _applicationId,
  applicationName,
  policies = [],
  violations = [],
  loading = false,
  error = null,
}) {
  const summaryRows = useMemo(() => {
    const byPolicy = new Map();
    for (const p of policies) {
      const id = policyIdStr(p);
      if (id) byPolicy.set(id, { id, name: p.name || '—', status: p.status, severity: p.severity, open: 0, total: 0 });
    }
    for (const v of violations) {
      const k = violationPolicyKey(v);
      if (!k || !byPolicy.has(k)) continue;
      const row = byPolicy.get(k);
      row.total += 1;
      if (isOpenStatus(v.status)) row.open += 1;
    }
    return [...byPolicy.values()];
  }, [policies, violations]);

  const kpis = useMemo(() => {
    const activePolicies = policies.filter((p) => String(p.status || '').toLowerCase() === 'active').length;
    const openV = violations.filter((v) => isOpenStatus(v.status)).length;
    const remediated = violations.filter((v) => String(v.status || '').toLowerCase() === 'remediated').length;
    const exceptions = violations.filter((v) => String(v.status || '').toLowerCase() === 'exception_granted').length;
    return {
      policyCount: policies.length,
      activePolicies,
      totalViolations: violations.length,
      openViolations: openV,
      remediated,
      exceptions,
    };
  }, [policies, violations]);

  return (
    <Box component="section" sx={{ mb: 4, width: '100%' }}>
      <Box sx={{ mb: 3, pb: 2, borderBottom: `2px solid ${C.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
          <Box sx={{ width: 4, height: 20, bgcolor: PASTEL.redInk, borderRadius: 2, flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.12em', color: PASTEL.redInk }}>
            ISO 27001 · Segregation of duties
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: C.text, mb: 0.4, pl: 2.5 }}>
          SoD policies &amp; violations
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: C.textDim, pl: 2.5 }}>
          Active SoD policies linked to this application and violation outcomes from evaluation.
          {applicationName ? ` Scope: ${applicationName}.` : ''}
        </Typography>
      </Box>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
          <CircularProgress size={18} thickness={5} sx={{ color: PASTEL.blueInk }} />
          <Typography sx={{ fontSize: '0.8rem', color: C.textDim }}>Loading SoD data…</Typography>
        </Box>
      )}

      {!loading && error && (
        <Alert severity="warning" sx={{ mb: 2.5, fontSize: '0.78rem' }}>{error}</Alert>
      )}

      {!loading && !error && (
        <>
          {policies.length > 0 ? (
            <>
              <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', mb: 3 }}>
                {[
                  { label: 'Policies in scope', value: kpis.policyCount, ink: PASTEL.blueInk, bg: PASTEL.blueBg, br: alpha(PASTEL.blueInk, 0.14) },
                  { label: 'Active policies', value: kpis.activePolicies, ink: PASTEL.tealInk, bg: PASTEL.tealBg, br: alpha(PASTEL.tealInk, 0.14) },
                  { label: 'Open violations', value: kpis.openViolations, ink: PASTEL.redInk, bg: PASTEL.redBg, br: alpha(PASTEL.redInk, 0.14) },
                  { label: 'Total violations', value: kpis.totalViolations, ink: PASTEL.amberInk, bg: PASTEL.amberBg, br: alpha(PASTEL.amberInk, 0.14) },
                  { label: 'Remediated', value: kpis.remediated, ink: PASTEL.greenInk, bg: PASTEL.greenBg, br: alpha(PASTEL.greenInk, 0.14) },
                  { label: 'Exceptions', value: kpis.exceptions, ink: PASTEL.blueInk, bg: PASTEL.blueBg, br: alpha(PASTEL.blueInk, 0.12) },
                ].map((k) => (
                  <Box
                    key={k.label}
                    sx={{
                      flex: '1 1 120px',
                      minWidth: 108,
                      p: '12px 14px',
                      border: `1px solid ${k.br}`,
                      borderRadius: '14px',
                      bgcolor: k.bg,
                      boxShadow: PASTEL.cardShadow,
                    }}
                  >
                    <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1, color: k.ink }}>{k.value}</Typography>
                    <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, color: k.ink, opacity: 0.85, textTransform: 'uppercase', letterSpacing: '0.07em', mt: 0.5 }}>{k.label}</Typography>
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 2 }}>
                <Button
                  component={RouterLink}
                  to="/governance/sod-violations"
                  variant="outlined"
                  size="small"
                  endIcon={<OpenInNew sx={{ fontSize: 16 }} />}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  Open SoD violations workspace
                </Button>
                <Button
                  component={RouterLink}
                  to="/governance/sod-policies"
                  variant="text"
                  size="small"
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  SoD policies
                </Button>
              </Box>

              <PolicySummaryTable rows={summaryRows} />

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: C.textMid, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Violations by policy
                </Typography>
                <Typography sx={{ fontSize: '0.65rem', color: C.textDim }}>
                  {violations.length} violation{violations.length !== 1 ? 's' : ''} · expand a row for detail
                </Typography>
              </Box>
              {policies.map((p, i) => (
                <PolicyCard key={policyIdStr(p) || i} policy={p} violations={violations} index={i} />
              ))}
            </>
          ) : (
            <Box sx={{ py: 6, textAlign: 'center', border: `1px dashed ${C.border}`, borderRadius: '10px', bgcolor: C.surface }}>
              <GppBad sx={{ fontSize: 36, color: C.textXDim, mb: 1.5 }} />
              <Typography sx={{ fontSize: '0.88rem', fontWeight: 600, color: C.textMid, mb: 0.5 }}>
                No SoD policies scoped to this application
              </Typography>
              <Typography sx={{ fontSize: '0.74rem', color: C.textDim, maxWidth: 420, mx: 'auto' }}>
                Link policies to this application in SoD policy settings, or select another application to view SoD coverage.
              </Typography>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
