import React from 'react';
import {
  Box, Typography, Chip, Alert, Button, Skeleton, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Link, Checkbox, TablePagination,
} from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { OpenInNew } from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { CATALOG } from './catalogTheme';
import { palette } from '../../../theme/palette';

export function InsightKpi({ icon, label, value, subtitle, accent = CATALOG.accent, dense = false }) {
  return (
    <Box
      sx={{
        height: '100%',
        px: dense ? 1.75 : 2,
        py: dense ? 1.35 : 2,
        borderRadius: `${CATALOG.radius}px`,
        border: `1px solid ${CATALOG.border}`,
        bgcolor: CATALOG.surface,
        boxShadow: CATALOG.cardShadow,
        display: 'flex',
        flexDirection: 'column',
        gap: dense ? 0.65 : 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography
          sx={{
            fontSize: dense ? '0.65rem' : '0.7rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: CATALOG.inkFaint,
          }}
        >
          {label}
        </Typography>
        {icon ? (
          <Box
            sx={{
              color: accent,
              display: 'grid',
              placeItems: 'center',
              width: dense ? 28 : 34,
              height: dense ? 28 : 34,
              borderRadius: '50%',
              bgcolor: alpha(accent, 0.1),
              flexShrink: 0,
              '& svg': { fontSize: dense ? 15 : 18 },
            }}
          >
            {icon}
          </Box>
        ) : null}
      </Box>
      <Typography
        sx={{
          fontWeight: 800,
          fontSize: dense ? '1.35rem' : '1.5rem',
          color: CATALOG.ink,
          lineHeight: 1.1,
        }}
      >
        {value}
      </Typography>
      {subtitle ? (
        <Typography sx={{ fontSize: dense ? '0.7rem' : '0.75rem', color: CATALOG.inkFaint, fontWeight: 500, lineHeight: 1.3 }}>
          {subtitle}
        </Typography>
      ) : null}
    </Box>
  );
}

export function InsightLoading({ rows = 4 }) {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" height={96} sx={{ borderRadius: 2 }} />
        ))}
      </Box>
      <Skeleton variant="rounded" height={40 + rows * 44} sx={{ borderRadius: 2 }} />
    </Box>
  );
}

export function InsightError({ message, onRetry }) {
  return (
    <Alert
      severity="error"
      action={onRetry ? <Button color="inherit" size="small" onClick={onRetry}>Retry</Button> : null}
    >
      {message || 'Failed to load data for this identity.'}
    </Alert>
  );
}

export function InsightEmpty({ title, body, to, linkLabel }) {
  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 5,
        px: 2,
        borderRadius: `${CATALOG.radius}px`,
        border: `1px dashed ${CATALOG.borderStrong}`,
        bgcolor: CATALOG.surfaceAlt,
      }}
    >
      <Typography sx={{ fontWeight: 600, color: CATALOG.ink, mb: 0.5 }}>{title}</Typography>
      <Typography variant="body2" sx={{ color: CATALOG.inkFaint, mb: to ? 2 : 0, maxWidth: 420, mx: 'auto' }}>
        {body}
      </Typography>
      {to ? (
        <Button
          component={RouterLink}
          to={to}
          size="small"
          variant="outlined"
          endIcon={<OpenInNew sx={{ fontSize: 14 }} />}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {linkLabel || 'Open related page'}
        </Button>
      ) : null}
    </Box>
  );
}

export function InsightPanel({ title, action, children, bodySx }) {
  return (
    <Box
      sx={{
        border: `1.5px solid ${CATALOG.borderStrong}`,
        borderRadius: `${CATALOG.radius}px`,
        bgcolor: CATALOG.surface,
        boxShadow: CATALOG.cardShadow,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          px: 2.25,
          py: 1.5,
          borderBottom: `1px solid ${CATALOG.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <Typography sx={{ fontWeight: 700, fontSize: '0.95rem', color: CATALOG.ink }}>{title}</Typography>
        {action || null}
      </Box>
      <Box sx={{ p: 0, ...bodySx }}>{children}</Box>
    </Box>
  );
}

const SEVERITY_COLOR = {
  CRITICAL: palette.status.error,
  HIGH: palette.risk?.high || '#EA580C',
  MEDIUM: palette.status.warning,
  LOW: palette.status.success,
};

export function SeverityChip({ severity }) {
  const sev = String(severity || 'MEDIUM').toUpperCase();
  const color = SEVERITY_COLOR[sev] || palette.text.secondary;
  return (
    <Chip
      size="small"
      label={sev}
      sx={{
        height: 22,
        fontWeight: 700,
        fontSize: '0.68rem',
        bgcolor: alpha(color, 0.12),
        color,
      }}
    />
  );
}

export function StatusChip({ status }) {
  const s = String(status || '').toLowerCase();
  let color = palette.text.secondary;
  if (s === 'open' || s === 'pending' || s === 'in progress' || s === 'in_progress') color = palette.brand.primary;
  if (s === 'not started' || s === 'not_started' || s === 'draft' || s === 'staged') color = palette.text.secondary;
  if (s === 'approved' || s === 'remediated' || s === 'exception_granted' || s === 'completed') {
    color = palette.status.success;
  }
  if (s.includes('revok') || s === 'critical') color = palette.status.error;
  return (
    <Chip
      size="small"
      label={String(status || '—').replace(/_/g, ' ')}
      sx={{
        height: 22,
        fontWeight: 600,
        fontSize: '0.68rem',
        textTransform: 'capitalize',
        bgcolor: alpha(color, 0.12),
        color,
      }}
    />
  );
}

/**
 * @param {object} [opts]
 * @param {number} [opts.page] 0-indexed current page — pass with `onPageChange` to render pagination.
 * @param {(page: number) => void} [opts.onPageChange]
 * @param {number} [opts.rowsPerPage]
 * @param {(rowsPerPage: number) => void} [opts.onRowsPerPageChange]
 * @param {number} [opts.totalCount] Total row count across all pages; defaults to `rows.length`.
 * @param {boolean} [opts.selectable] Renders a checkbox column when true.
 * @param {Array} [opts.selectedIds]
 * @param {(ids: Array) => void} [opts.onSelectionChange]
 * @param {(row: object) => string} [opts.getRowId] Defaults to `row.id || row.key`.
 */
export function InsightTable({
  columns, rows, empty, getRowSx, dense = false,
  page, onPageChange, rowsPerPage, onRowsPerPageChange, totalCount,
  selectable = false, selectedIds, onSelectionChange, getRowId,
}) {
  if (!rows?.length) return empty || null;
  const cellPadY = dense ? 0.95 : 1.15;
  const rowId = (row, idx) => (getRowId ? getRowId(row) : (row.id || row.key || idx));
  const selected = new Set((selectedIds || []).map(String));
  const paginated = Boolean(onPageChange) && page != null && rowsPerPage != null;

  const toggleRow = (id) => {
    if (!onSelectionChange) return;
    const idStr = String(id);
    const next = new Set(selected);
    if (next.has(idStr)) next.delete(idStr); else next.add(idStr);
    onSelectionChange(Array.from(next));
  };
  const toggleAll = () => {
    if (!onSelectionChange) return;
    const allIds = rows.map((row, idx) => String(rowId(row, idx)));
    const allSelected = allIds.every((id) => selected.has(id));
    onSelectionChange(allSelected ? [] : allIds);
  };
  const allOnPageSelected = selectable && rows.length > 0
    && rows.every((row, idx) => selected.has(String(rowId(row, idx))));

  return (
    <TableContainer>
      <Table
        size="small"
        sx={{
          width: '100%',
          tableLayout: 'fixed',
          borderCollapse: 'separate',
        }}
      >
        <TableHead>
          <TableRow>
            {selectable ? (
              <TableCell
                padding="checkbox"
                sx={{ borderBottom: `1px solid ${CATALOG.border}`, bgcolor: CATALOG.surfaceAlt, width: 42 }}
              >
                <Checkbox size="small" checked={allOnPageSelected} onChange={toggleAll} />
              </TableCell>
            ) : null}
            {columns.map((col) => (
              <TableCell
                key={col.key}
                align={col.align || 'left'}
                sx={{
                  fontWeight: 700,
                  color: CATALOG.inkFaint,
                  fontSize: '0.68rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  py: cellPadY,
                  px: dense ? 1.5 : 2,
                  borderBottom: `1px solid ${CATALOG.border}`,
                  bgcolor: CATALOG.surfaceAlt,
                  width: col.width,
                  minWidth: col.minWidth,
                  maxWidth: col.maxWidth,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, idx) => {
            const id = String(rowId(row, idx));
            return (
              <TableRow
                key={id}
                hover
                sx={typeof getRowSx === 'function' ? getRowSx(row) : null}
              >
                {selectable ? (
                  <TableCell padding="checkbox" sx={{ borderBottom: `1px solid ${CATALOG.border}` }}>
                    <Checkbox size="small" checked={selected.has(id)} onChange={() => toggleRow(id)} />
                  </TableCell>
                ) : null}
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    align={col.align || 'left'}
                    sx={{
                      fontSize: '0.8125rem',
                      color: CATALOG.ink,
                      verticalAlign: 'middle',
                      py: dense ? 1 : 1.15,
                      px: dense ? 1.5 : 2,
                      borderBottom: `1px solid ${CATALOG.border}`,
                      width: col.width,
                      minWidth: col.minWidth,
                      maxWidth: col.maxWidth,
                      overflow: 'hidden',
                    }}
                  >
                    {col.render ? col.render(row) : row[col.key] ?? '—'}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {paginated ? (
        <TablePagination
          component="div"
          count={totalCount ?? rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(_e, next) => onPageChange(next)}
          onRowsPerPageChange={onRowsPerPageChange
            ? (e) => onRowsPerPageChange(Number(e.target.value))
            : undefined}
          rowsPerPageOptions={onRowsPerPageChange ? [10, 25, 50, 100] : [rowsPerPage]}
          sx={{ borderTop: `1px solid ${CATALOG.border}` }}
        />
      ) : null}
    </TableContainer>
  );
}

export function DeepLinkButton({ to, label }) {
  const navigate = useNavigate();
  if (!to) return null;
  return (
    <Button
      size="small"
      endIcon={<OpenInNew sx={{ fontSize: 14 }} />}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(to);
      }}
      sx={{ textTransform: 'none', fontWeight: 600, color: palette.text.link }}
    >
      {label || 'View all'}
    </Button>
  );
}

export function TableLink({ to, children }) {
  const navigate = useNavigate();
  if (!to) return children || '—';
  return (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigate(to);
      }}
      sx={{
        fontWeight: 600,
        color: palette.text.link,
        textAlign: 'left',
        cursor: 'pointer',
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
      }}
    >
      {children}
    </Link>
  );
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return '—';
  }
}
