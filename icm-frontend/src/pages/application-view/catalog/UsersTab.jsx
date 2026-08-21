import React, { useMemo, useState } from 'react';
import {
  Box, Chip, TextField, InputAdornment, Typography, Button,
} from '@mui/material';
import {
  Search, AdminPanelSettingsOutlined, PeopleAltOutlined, FileDownloadOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  TableLink,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { normalizePrivilegeBoolean } from '../../../services/accessCertificationService';
import { exportRowsToCsv } from './applicationHealthUtils';
import {
  fetchApplicationViewUsers,
  applicationViewUsersQueryKey,
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

function userLabel(row) {
  return (
    row.display_name
    || row.displayName
    || [row.first_name || row.firstName, row.last_name || row.lastName].filter(Boolean).join(' ')
    || row.username
    || row.user_id
    || row.employee_id
    || row.email
    || '—'
  );
}

const STATUS_FILTERS = [
  { value: '', label: 'All status' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

function AccountStatusChip({ status }) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return <Typography variant="caption" color="text.secondary">—</Typography>;
  const isActive = s === 'active' || s === 'enabled';
  const isInactive = /inactive|disabled|locked/.test(s);
  const color = isActive ? '#059669' : (isInactive ? '#DC2626' : CATALOG.inkMuted);
  return (
    <Chip
      size="small"
      label={status}
      sx={{
        height: 22, fontWeight: 650, fontSize: '0.68rem', textTransform: 'capitalize',
        bgcolor: `${color}1F`, color,
      }}
    />
  );
}

export default function UsersTab({ applicationId }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [accountStatus, setAccountStatus] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  const params = {
    page,
    limit: rowsPerPage,
    ...(searchApplied ? { search: searchApplied } : {}),
    ...(privilegedOnly ? { isPrivileged: true } : {}),
    ...(accountStatus ? { accountStatus } : {}),
  };

  const query = useQuery({
    queryKey: applicationViewUsersQueryKey(applicationId, params),
    queryFn: () => fetchApplicationViewUsers(applicationId, params),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_DETAIL_STALE_MS,
    placeholderData: (previousData) => previousData,
  });

  const rows = query.data?.data || [];
  const total = query.data?.total ?? 0;
  const tableRows = useMemo(() => rows.map((r) => ({ ...r, id: r._id })), [rows]);

  const columns = useMemo(() => [
    {
      key: 'user',
      label: 'User',
      minWidth: 180,
      render: (row) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650 }}>{userLabel(row)}</Typography>
          <Typography variant="caption" color="text.secondary">
            {row.email || row.user_id || row.employee_id || '—'}
          </Typography>
        </Box>
      ),
      csvValue: (row) => userLabel(row),
    },
    { key: 'department', label: 'Department', render: (row) => row.department || '—' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <AccountStatusChip status={row.status || row.accountStatus} />,
      csvValue: (row) => row.status || row.accountStatus || '',
    },
    {
      key: 'privilege',
      label: 'Privilege',
      render: (row) => (normalizePrivilegeBoolean(row) ? (
        <Chip size="small" color="warning" label="Privileged" sx={{ height: 22, fontWeight: 700 }} />
      ) : <Typography variant="caption" color="text.secondary">—</Typography>),
      csvValue: (row) => (normalizePrivilegeBoolean(row) ? 'Privileged' : ''),
    },
    {
      key: 'identity',
      label: 'Identity',
      render: (row) => (row.correlatedIdentityId ? (
        <TableLink to={`/identities/${row.correlatedIdentityId}`}>
          {row.correlatedIdentityName || 'View identity'}
        </TableLink>
      ) : <Typography variant="caption" color="text.secondary">Uncorrelated</Typography>),
      csvValue: (row) => row.correlatedIdentityName || '',
    },
  ], []);

  const handleExport = () => {
    const exportRows = selectedIds.length
      ? tableRows.filter((r) => selectedIds.includes(String(r.id)))
      : tableRows;
    exportRowsToCsv(`application-users-page-${page + 1}.csv`, columns, exportRows);
  };

  return (
    <CatalogSection
      eyebrow="Accounts"
      title="Application users"
      subtitle="Catalog accounts for this application. Filter by status or privilege, then export."
      dense
      actions={(
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            clickable
            variant="outlined"
            size="small"
            icon={<PeopleAltOutlined />}
            label="All users"
            onClick={() => { setPrivilegedOnly(false); setPage(0); }}
            sx={filterChipSx(!privilegedOnly)}
          />
          <Chip
            clickable
            variant="outlined"
            size="small"
            icon={<AdminPanelSettingsOutlined />}
            label="Privileged"
            onClick={() => { setPrivilegedOnly(true); setPage(0); }}
            sx={filterChipSx(privilegedOnly)}
          />
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f.value || 'all-status'}
              clickable
              variant="outlined"
              size="small"
              label={f.label}
              onClick={() => { setAccountStatus(f.value); setPage(0); }}
              sx={filterChipSx(accountStatus === f.value)}
            />
          ))}
        </Box>
      )}
    >
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search users…"
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
            icon={<PeopleAltOutlined />}
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
          message={query.error?.message || 'Failed to load users.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError && rows.length === 0 ? (
        <InsightEmpty title="No results" body={privilegedOnly ? 'No privileged users found.' : 'No users found.'} />
      ) : null}

      {rows.length > 0 ? (
        <InsightPanel title="Accounts" bodySx={{ p: 0 }}>
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
