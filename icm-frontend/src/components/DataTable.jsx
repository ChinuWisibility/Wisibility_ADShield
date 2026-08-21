import { useState, useMemo } from 'react';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TablePagination, TableSortLabel, Paper, Box, TextField, InputAdornment,
  IconButton, Toolbar, Typography, Tooltip, Checkbox, alpha, Chip,
  CircularProgress, Pagination, LinearProgress,
} from '@mui/material';
import { Search as SearchIcon, FilterList, Download, Refresh } from '@mui/icons-material';
import { keyframes } from '@mui/system';
import { palette } from '../theme/palette';

const listPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

/** Numbered page buttons for the table footer (MUI's default actions are prev/next only). */
function NumberedPaginationActions({ count, page, rowsPerPage, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil(count / Math.max(1, rowsPerPage)));

  return (
    <Pagination
      count={pageCount}
      page={page + 1}
      onChange={(event, value) => onPageChange(event, value - 1)}
      siblingCount={1}
      boundaryCount={1}
      size="small"
      shape="rounded"
      color="primary"
      sx={{
        ml: 2,
        '& .MuiPaginationItem-root': {
          fontSize: '0.8125rem',
          minWidth: 30,
          height: 30,
          borderRadius: 1.5,
        },
      }}
    />
  );
}

/** Default scroll viewport for sticky headers — caps height without forcing a min-height. */
export const DATA_TABLE_STICKY_MAX_HEIGHT = 'min(70vh, 720px)';

/**
 * Shared TableContainer `sx` for MUI `stickyHeader` tables.
 * Scroll is confined to the table container (pagination/toolbars stay outside).
 * Use with `<Table stickyHeader>` — no page-specific CSS or scroll listeners.
 *
 * @param {object} [options]
 * @param {string} [options.maxHeight]
 * @param {string} [options.headerBackground] Solid color or CSS gradient for sticky header cells
 * @param {object} [options.sx] Extra TableContainer sx merged on top
 */
export function getStickyTableContainerSx({
  maxHeight = DATA_TABLE_STICKY_MAX_HEIGHT,
  headerBackground = palette.bg.primary,
  sx = {},
} = {}) {
  const stickyCellSx = {
    background: headerBackground,
    backgroundColor: typeof headerBackground === 'string' && headerBackground.includes('gradient')
      ? palette.bg.primary
      : headerBackground,
    zIndex: 3,
    boxShadow: `0 2px 4px ${alpha(palette.text.primary, 0.06)}`,
  };
  return {
    ...sx,
    // Sticky scroll viewport must win over any consumer overflow/height overrides.
    maxHeight,
    overflow: 'auto',
    '& .MuiTableCell-stickyHeader': {
      ...stickyCellSx,
      ...(sx['& .MuiTableCell-stickyHeader'] || {}),
    },
  };
}

export default function DataTable({
  title, columns, rows, loading, onRefresh, onExport,
  selectable, onSelectionChange, actions, emptyMessage = 'No data found',
  defaultSort, defaultSortDir = 'asc', searchable = true,
  onRowClick,
  toolbarLeft,
  /** Extra controls in the table toolbar (e.g. column picker) — rendered after title, before refresh. */
  toolbarRight,
  /** Controlled selection ids. When provided, parent owns selection (clearing parent clears checkboxes). */
  selectedIds,
  /** Show the built-in “N selected” chip in the table toolbar. Default true; set false when parent renders its own bar. */
  showSelectionChip = true,
  /** When set, rows are one server page; pagination uses totalCount and callbacks. */
  serverPagination = false,
  totalCount = 0,
  page: serverPage = 0,
  rowsPerPage: serverRowsPerPage = 10,
  onPageChange: onServerPageChange,
  onRowsPerPageChange: onServerRowsPerPageChange,
  /** With `serverPagination`, pass these + `onSortChange` so sorting applies to the full dataset (not only the current page). */
  sortField: serverSortField,
  sortDir: serverSortDir,
  onSortChange,
  /**
   * Pin column headers while the table body scrolls vertically.
   * Uses CSS `position: sticky` via MUI `Table` stickyHeader — no scroll listeners.
   * Toolbar and pagination stay outside the scroll area.
   */
  stickyHeader = true,
  /** Max height of the table body scroll area when `stickyHeader` is on. */
  maxHeight = DATA_TABLE_STICKY_MAX_HEIGHT,
}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortField, setSortField] = useState(defaultSort || '');
  const [sortDir, setSortDir] = useState(defaultSortDir);
  const isServerSort = typeof onSortChange === 'function';
  const effectiveSortField = isServerSort ? (serverSortField ?? defaultSort ?? '') : sortField;
  const effectiveSortDir = isServerSort ? (serverSortDir === 'desc' ? 'desc' : 'asc') : sortDir;
  const [search, setSearch] = useState('');
  const [internalSelected, setInternalSelected] = useState([]);
  const selectionControlled = Array.isArray(selectedIds);
  const selected = selectionControlled ? selectedIds : internalSelected;

  const setSelection = (next) => {
    if (!selectionControlled) setInternalSelected(next);
    onSelectionChange?.(next);
  };

  const effectivePage = serverPagination ? serverPage : page;
  const effectiveRowsPerPage = serverPagination ? serverRowsPerPage : rowsPerPage;

  const filteredRows = useMemo(() => {
    let data = [...(rows || [])];
    if (!serverPagination && search) {
      const lower = search.toLowerCase();
      data = data.filter((row) =>
        columns.some((col) => {
          const val = row[col.field];
          return val && String(val).toLowerCase().includes(lower);
        })
      );
    }
    if (!isServerSort && sortField) {
      data.sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return data;
  }, [rows, search, sortField, sortDir, columns, serverPagination, isServerSort]);

  const paginatedRows = serverPagination
    ? filteredRows
    : filteredRows.slice(effectivePage * effectiveRowsPerPage, effectivePage * effectiveRowsPerPage + effectiveRowsPerPage);

  const paginationCount = serverPagination ? totalCount : filteredRows.length;

  const handleSort = (field) => {
    if (isServerSort) {
      if (effectiveSortField === field) {
        onSortChange(field, effectiveSortDir === 'asc' ? 'desc' : 'asc');
      } else {
        onSortChange(field, 'asc');
      }
      return;
    }
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleSelectAll = (e) => {
    const newSelected = e.target.checked ? filteredRows.map((r) => r._id || r.id) : [];
    setSelection(newSelected);
  };

  const handleSelect = (id) => {
    const newSelected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    setSelection(newSelected);
  };

  return (
    <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
      {/* Toolbar */}
      <Toolbar
        sx={{
          px: 2,
          gap: 2,
          borderBottom: `1px solid ${palette.border.default}`,
          minHeight: '52px !important',
          flexWrap: 'wrap',
          alignItems: 'center',
          rowGap: 1,
        }}
      >
        {title && (
          <Typography
            variant="subtitle1"
            component="div"
            sx={{
              fontWeight: 600,
              flex: '0 1 auto',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pr: 1,
            }}
          >
            {title}
          </Typography>
        )}
        {showSelectionChip && selected.length > 0 && (
          <Chip label={`${selected.length} selected`} size="small" color="primary" onDelete={() => setSelection([])} />
        )}
        <Box sx={{ flex: 1 }} />
        {toolbarLeft}
        {toolbarRight}
        {searchable && (
          <TextField
            size="small" placeholder="Search..." value={search}
            onChange={(e) => { setSearch(e.target.value); if (!serverPagination) setPage(0); }}
            sx={{ width: 240 }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: palette.text.secondary }} /></InputAdornment>,
            }}
          />
        )}
        {onRefresh && (
          <Tooltip title="Refresh"><IconButton size="small" onClick={onRefresh}><Refresh fontSize="small" /></IconButton></Tooltip>
        )}
        {onExport && (
          <Tooltip title="Export"><IconButton size="small" onClick={onExport}><Download fontSize="small" /></IconButton></Tooltip>
        )}
        {actions}
      </Toolbar>

     {/* Table - sticky headers scroll inside TableContainer only (toolbar/pagination stay fixed). */}
<Box sx={{ position: 'relative' }}>
  {loading ? (
    <LinearProgress
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 3,
        height: 3,
        borderRadius: 0,
      }}
    />
  ) : null}
  <TableContainer
    sx={{
      ...(stickyHeader ? getStickyTableContainerSx({ maxHeight }) : {}),
      ...(loading && paginatedRows.length > 0
        ? { animation: `${listPulse} 1.1s ease-in-out infinite` }
        : {}),
      transition: 'opacity 0.2s ease',
      opacity: loading && paginatedRows.length > 0 ? 0.72 : 1,
    }}
  >
    <Table size="small" stickyHeader={stickyHeader}>
          <TableHead>
            <TableRow>
              {selectable && (
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    indeterminate={selected.length > 0 && selected.length < filteredRows.length}
                    checked={filteredRows.length > 0 && selected.length === filteredRows.length}
                    onChange={handleSelectAll}
                  />
                </TableCell>
              )}
              {columns.map((col) => (
                <TableCell
                  key={col.field}
                  sx={{
                    width: col.width,
                    minWidth: col.minWidth ?? col.width,
                    maxWidth: col.maxWidth,
                  }}
                >
                  {col.sortable !== false ? (
                    <TableSortLabel
                      active={effectiveSortField === col.field}
                      direction={effectiveSortField === col.field ? effectiveSortDir : 'asc'}
                      onClick={() => handleSort(col.field)}
                    >
                      {col.headerName}
                    </TableSortLabel>
                  ) : col.headerName}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (selectable ? 1 : 0)} sx={{ textAlign: 'center', py: 5, color: palette.text.secondary }}>
                  {loading ? (
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                      <CircularProgress size={28} thickness={4} />
                      <Typography variant="body2" color="text.secondary">
                        Loading data…
                      </Typography>
                    </Box>
                  ) : (
                    emptyMessage
                  )}
                </TableCell>
              </TableRow>
            ) : (
              paginatedRows.map((row, ri) => (
                <TableRow
                  key={row._id || row.id || ri}
                  hover
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {selectable && (
                    <TableCell padding="checkbox">
                      <Checkbox size="small" checked={selected.includes(row._id || row.id)} onChange={() => handleSelect(row._id || row.id)} />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell
                      key={col.field}
                      sx={{
                        width: col.width,
                        minWidth: col.minWidth ?? col.width,
                        maxWidth: col.maxWidth,
                        verticalAlign: 'middle',
                        ...(col.cellSx || {}),
                      }}
                    >
                      {col.renderCell ? col.renderCell(row) : row[col.field] ?? '—'}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        </TableContainer>
        {loading && paginatedRows.length > 0 ? (
          <Box
            aria-live="polite"
            aria-busy="true"
            sx={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha(palette.bg?.secondary || '#fff', 0.35),
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 2,
                py: 1,
                borderRadius: 2,
                bgcolor: alpha('#fff', 0.92),
                boxShadow: '0 4px 20px rgba(15, 23, 42, 0.12)',
                border: `1px solid ${palette.border.default}`,
              }}
            >
              <CircularProgress size={22} thickness={4} />
              <Typography variant="body2" sx={{ fontWeight: 600, color: palette.text.primary }}>
                Refreshing…
              </Typography>
            </Box>
          </Box>
        ) : null}
      </Box>

      <TablePagination
        component="div"
        count={paginationCount}
        page={effectivePage}
        onPageChange={(_, p) => {
          if (serverPagination) onServerPageChange?.(p);
          else setPage(p);
        }}
        rowsPerPage={effectiveRowsPerPage}
        onRowsPerPageChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (serverPagination) {
            onServerRowsPerPageChange?.(n);
          } else {
            setRowsPerPage(n);
            setPage(0);
          }
        }}
        rowsPerPageOptions={serverPagination ? [10, 25, 50, 100] : [5, 10, 25, 50]}
        ActionsComponent={NumberedPaginationActions}
        sx={{
          borderTop: `1px solid ${palette.border.default}`,
          '& .MuiTablePagination-toolbar': { flexWrap: 'wrap', rowGap: 1 },
          '& .MuiTablePagination-spacer': { flex: '1 1 auto' },
        }}
      />
    </Paper>
  );
}
