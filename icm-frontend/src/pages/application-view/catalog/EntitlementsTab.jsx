import React, { useMemo, useState } from 'react';
import {
  Box, Chip, TextField, InputAdornment, Typography, Button,
} from '@mui/material';
import {
  Search, VpnKeyOutlined, AdminPanelSettingsOutlined, FileDownloadOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  SeverityChip,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { normalizePrivilegeBoolean } from '../../../services/accessCertificationService';
import { exportRowsToCsv } from './applicationHealthUtils';
import {
  fetchApplicationViewEntitlements,
  applicationViewEntitlementsQueryKey,
  APP_VIEW_DETAIL_STALE_MS,
} from './applicationViewQueries';

/** Outlined pill filter chip — same look as the original catalog action chip. */
function filterChipSx(selected) {
  return {
    fontWeight: 650,
    height: 28,
    bgcolor: selected ? CATALOG.accentSoft : CATALOG.surface,
    color: selected ? CATALOG.accent : CATALOG.ink,
    border: `1px solid ${selected ? CATALOG.accent : CATALOG.border}`,
    '& .MuiChip-icon': {
      color: selected ? CATALOG.accent : CATALOG.inkFaint,
      fontSize: 16,
      ml: 0.75,
    },
    '&:hover': {
      bgcolor: selected ? CATALOG.accentSoft : CATALOG.surfaceAlt,
    },
  };
}

function entLabel(row) {
  return (
    row.entitlement_name
    || row.entitlementName
    || row.name
    || row.entitlement_id
    || row.entitlementId
    || '—'
  );
}

export default function EntitlementsTab({ applicationId, summary }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [entitlementType, setEntitlementType] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const typeOptions = useMemo(
    () => (Array.isArray(summary?.entitlementsByType) ? summary.entitlementsByType : [])
      .filter((t) => t.type && t.type !== 'Other'),
    [summary],
  );

  const params = {
    page,
    limit: rowsPerPage,
    ...(searchApplied ? { search: searchApplied } : {}),
    ...(privilegedOnly ? { isPrivileged: true } : {}),
    ...(entitlementType ? { entitlementType } : {}),
  };

  const query = useQuery({
    queryKey: applicationViewEntitlementsQueryKey(applicationId, params),
    queryFn: () => fetchApplicationViewEntitlements(applicationId, params),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_DETAIL_STALE_MS,
    placeholderData: (previousData) => previousData,
  });

  const rows = query.data?.data || [];
  const total = query.data?.total ?? 0;
  const tableRows = useMemo(() => rows.map((r) => ({ ...r, id: r._id })), [rows]);

  const columns = useMemo(() => [
    {
      key: 'entitlement',
      label: 'Entitlement',
      minWidth: 200,
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650 }}>{entLabel(row)}</Typography>
          {row.description ? (
            <Typography variant="caption" color="text.secondary" display="block">
              {String(row.description).slice(0, 120)}
            </Typography>
          ) : null}
        </Box>
      ),
      csvValue: (row) => entLabel(row),
    },
    {
      key: 'type',
      label: 'Type',
      render: (row) => row.entitlement_type || '—',
    },
    {
      key: 'owner',
      label: 'Owner',
      render: (row) => row.owner || row.ownerEmail || row.entitlement_owner || '—',
    },
    {
      key: 'assignedUsers',
      label: 'Assigned Users',
      align: 'right',
      render: (row) => (row.assignedUsers == null ? '—' : Number(row.assignedUsers).toLocaleString()),
      csvValue: (row) => (row.assignedUsers == null ? '' : row.assignedUsers),
    },
    {
      key: 'risk',
      label: 'Risk',
      render: (row) => (normalizePrivilegeBoolean(row)
        ? <SeverityChip severity={row.riskLevel || 'HIGH'} />
        : <Typography variant="caption" color="text.secondary">—</Typography>),
      csvValue: (row) => (normalizePrivilegeBoolean(row) ? (row.riskLevel || 'HIGH') : ''),
    },
  ], []);

  const handleExport = () => {
    const exportRows = selectedIds.length
      ? tableRows.filter((r) => selectedIds.includes(String(r.id)))
      : tableRows;
    exportRowsToCsv(`application-entitlements-page-${page + 1}.csv`, columns, exportRows);
  };

  return (
    <CatalogSection
      eyebrow="Access"
      title="Entitlements"
      subtitle="Roles, groups, and permissions for this application."
      dense
      actions={(
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            clickable
            variant="outlined"
            size="small"
            icon={<VpnKeyOutlined />}
            label="All entitlements"
            onClick={() => { setEntitlementType(''); setPage(0); }}
            sx={filterChipSx(!entitlementType)}
          />
          {typeOptions.map((t) => (
            <Chip
              key={t.type}
              clickable
              variant="outlined"
              size="small"
              label={t.type}
              onClick={() => { setEntitlementType(t.type); setPage(0); }}
              sx={filterChipSx(entitlementType === t.type)}
            />
          ))}
          <Chip
            clickable
            variant="outlined"
            size="small"
            icon={<AdminPanelSettingsOutlined />}
            label="Privileged"
            onClick={() => { setPrivilegedOnly((prev) => !prev); setPage(0); }}
            sx={filterChipSx(privilegedOnly)}
          />
        </Box>
      )}
    >
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search entitlements…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setSearchApplied(search.trim());
                setPage(0);
              }
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240, bgcolor: CATALOG.surface }}
          />
          <Chip
            size="small"
            icon={<VpnKeyOutlined />}
            label={`${total.toLocaleString()} total`}
            sx={{ fontWeight: 650 }}
          />
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileDownloadOutlined />}
          onClick={handleExport}
          disabled={rows.length === 0}
          sx={{ textTransform: 'none', fontWeight: 650 }}
        >
          {selectedIds.length ? `Export selected (${selectedIds.length})` : 'Export page'}
        </Button>
      </Box>

      {query.isPending ? <InsightLoading rows={2} /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load entitlements.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError && rows.length === 0 ? (
        <InsightEmpty title="No results" body={privilegedOnly ? 'No privileged entitlements found.' : 'No entitlements found.'} />
      ) : null}

      {rows.length > 0 ? (
        <InsightPanel title="Entitlements" bodySx={{ p: 0 }}>
          <InsightTable
            columns={columns}
            rows={tableRows}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            page={page}
            onPageChange={setPage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0); }}
            totalCount={total}
          />
        </InsightPanel>
      ) : null}
    </CatalogSection>
  );
}
