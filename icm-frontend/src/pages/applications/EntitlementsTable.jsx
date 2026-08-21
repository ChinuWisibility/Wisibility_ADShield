import React, { useState, useEffect, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Box,
  Typography,
  Chip,
  Button,
  Menu,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Toolbar,
  TablePagination,
} from '@mui/material';
import { ViewColumn } from '@mui/icons-material';
import { applicationAPI } from '../../services/api';
import { getStickyTableContainerSx } from '../../components/DataTable';
import { filterEntitlementColumnDefs } from '../../utils/entitlementUi';

const formatHeaderName = (fieldName) => {
  if (!fieldName) return '';
  return fieldName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const DEFAULT_VISIBLE_COUNT = 6;

/** Column keys + labels from saved Entitlement schema (entitlementMappings); order matches the schema tab. */
function columnDefsFromEntitlementMappings(entitlementMappings) {
  if (!Array.isArray(entitlementMappings) || entitlementMappings.length === 0) return null;
  const seen = new Set();
  const defs = [];
  for (const m of entitlementMappings) {
    const key = String(m.standardField || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const label =
      (m.displayName && String(m.displayName).trim()) || formatHeaderName(key);
    defs.push({
      key,
      label,
      dataType: String(m.dataType || 'String').trim() || 'String',
    });
  }
  const visible = filterEntitlementColumnDefs(defs);
  return visible.length ? visible : null;
}

function initialVisibleKeys(keys) {
  return keys.slice(0, Math.min(DEFAULT_VISIBLE_COUNT, keys.length));
}

export default function EntitlementsTable({ applicationId, entitlementMappings = null }) {
  const [entitlements, setEntitlements] = useState([]);
  const [totalEntitlements, setTotalEntitlements] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [loading, setLoading] = useState(true);

  const [visibleColumns, setVisibleColumns] = useState([]);
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  const columnDefs = useMemo(
    () => columnDefsFromEntitlementMappings(entitlementMappings) || [],
    [entitlementMappings],
  );

  useEffect(() => {
    const keys = columnDefs.map((d) => d.key);
    setVisibleColumns(initialVisibleKeys(keys));
  }, [entitlementMappings]);

  useEffect(() => {
    setPage(0);
  }, [applicationId]);

  useEffect(() => {
    const fetchEntitlements = async () => {
      if (!applicationId) return;
      setLoading(true);
      try {
        const entRes = await applicationAPI.getEntitlements(applicationId, {
          page,
          limit: rowsPerPage,
        });
        setEntitlements(entRes.data?.data || []);
        setTotalEntitlements(Number(entRes.data?.total ?? 0));
      } catch (error) {
        console.error('Failed to fetch entitlements', error);
        setEntitlements([]);
        setTotalEntitlements(0);
      } finally {
        setLoading(false);
      }
    };
    fetchEntitlements();
  }, [applicationId, page, rowsPerPage]);

  const handleToggleColumn = (columnKey) => {
    setVisibleColumns((prev) => {
      if (prev.includes(columnKey)) {
        return prev.filter((c) => c !== columnKey);
      }
      return [...prev, columnKey];
    });
  };

  const visibleDefs = useMemo(
    () => columnDefs.filter((d) => visibleColumns.includes(d.key)),
    [columnDefs, visibleColumns],
  );

  if (columnDefs.length === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 600, mb: 1 }}>
          No schema defined
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Go to the <strong>Entitlement schema</strong> tab, define attributes (or use one-step import), select a primary key,
          and save. This table only shows columns that match your saved technical names — nothing is hardcoded.
        </Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ p: 5, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
          Loading entitlements…
        </Typography>
      </Box>
    );
  }

  if (!loading && totalEntitlements === 0) {
    return (
      <Box sx={{ p: 5, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          No entitlements found. Configure the <strong>Entitlement schema</strong> tab and import a CSV, or use Data Importer /
          Mapping Studio.
        </Typography>
      </Box>
    );
  }

  const renderCell = (ent, def) => {
    const raw = ent[def.key];
    const isBool = def.dataType === 'Boolean';
    if (isBool) {
      const s = raw != null ? String(raw) : '';
      const truthy =
        s.toLowerCase() === 'true' || s.toLowerCase() === 'active' || s === 'Yes' || s === '1';
      return (
        <Chip
          label={s || 'false'}
          size="small"
          color={truthy ? 'success' : 'default'}
          sx={{ fontWeight: 500, height: 20, fontSize: '0.7rem' }}
        />
      );
    }
    return (
      <Typography variant="body2">
        {raw != null && raw !== '' ? raw : <span style={{ color: '#cbd5e1' }}>—</span>}
      </Typography>
    );
  };

  return (
    <Box>
      <Toolbar sx={{ px: '0 !important', mb: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          startIcon={<ViewColumn />}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          size="small"
        >
          Columns
        </Button>
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={() => setAnchorEl(null)}
          PaperProps={{ style: { maxHeight: 400, width: 280 } }}
        >
          <Box sx={{ px: 2, py: 1, borderBottom: '1px solid #e2e8f0' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Show/Hide Columns
            </Typography>
          </Box>
          {columnDefs.map(({ key, label }) => (
            <MenuItem key={key} onClick={() => handleToggleColumn(key)} sx={{ py: 0 }}>
              <FormControlLabel
                control={<Checkbox checked={visibleColumns.includes(key)} size="small" />}
                label={<Typography variant="body2">{label}</Typography>}
                sx={{ width: '100%', m: 0 }}
              />
            </MenuItem>
          ))}
        </Menu>
      </Toolbar>

      <TableContainer
        component={Paper}
        elevation={0}
        sx={getStickyTableContainerSx({
          sx: { border: '1px solid #e2e8f0' },
        })}
      >
        <Table size="small" stickyHeader>
          <TableHead sx={{ backgroundColor: '#f8fafc' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, width: '60px' }}>Sl. No.</TableCell>
              {visibleDefs.map((def) => (
                <TableCell key={def.key} sx={{ fontWeight: 600 }}>
                  {def.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {entitlements.map((ent, index) => (
              <TableRow key={ent._id} hover>
                <TableCell sx={{ color: 'text.secondary' }}>{page * rowsPerPage + index + 1}</TableCell>
                {visibleDefs.map((def) => (
                  <TableCell key={def.key}>{renderCell(ent, def)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={totalEntitlements}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(parseInt(e.target.value, 10));
          setPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
        sx={{ borderTop: '1px solid', borderColor: 'divider' }}
      />
    </Box>
  );
}
