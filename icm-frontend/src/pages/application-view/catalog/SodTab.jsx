import React, { useMemo, useState } from 'react';
import {
  Box, Grid, Typography, Chip, IconButton, Menu, MenuItem, Snackbar, Alert,
} from '@mui/material';
import {
  GavelOutlined, ErrorOutline, VerifiedUserOutlined, PolicyOutlined, MoreVert,
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightKpi,
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  SeverityChip,
  StatusChip,
  DeepLinkButton,
  TableLink,
  formatDate,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { palette } from '../../../theme/palette';
import { sodAPI } from '../../../services/sodService';
import {
  fetchApplicationViewSod,
  applicationViewSodQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

/** Outlined pill filter chip — same look as the other Application View tabs. */
function filterChipSx(selected) {
  return {
    fontWeight: 650,
    height: 26,
    bgcolor: selected ? CATALOG.accentSoft : CATALOG.surface,
    color: selected ? CATALOG.accent : CATALOG.ink,
    border: `1px solid ${selected ? CATALOG.accent : CATALOG.border}`,
    '&:hover': { bgcolor: selected ? CATALOG.accentSoft : CATALOG.surfaceAlt },
  };
}

const SEVERITY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const STATUS_FILTERS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'remediated', label: 'Remediated' },
  { value: 'exception_granted', label: 'Exception granted' },
  { value: 'false_positive', label: 'False positive' },
  { value: 'expired', label: 'Expired' },
];

const REMEDIATION_ACTIONS = [
  { status: 'remediated', label: 'Mark remediated' },
  { status: 'exception_granted', label: 'Grant exception' },
  { status: 'false_positive', label: 'Mark false positive' },
];

function RemediationMenu({ violation, onDone }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ status }) => sodAPI.updateViolationStatus(violation._id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['application-view', 'sod'] });
      onDone({ ok: true, text: `Violation marked ${variables.status.replace(/_/g, ' ')}.` });
    },
    onError: (err) => {
      onDone({ ok: false, text: err?.response?.data?.message || err?.message || 'Update failed.' });
    },
  });

  if (String(violation.status).toLowerCase() !== 'open') return null;

  return (
    <>
      <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget); }}>
        <MoreVert fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {REMEDIATION_ACTIONS.map((a) => (
          <MenuItem
            key={a.status}
            disabled={mutation.isPending}
            onClick={() => {
              setAnchorEl(null);
              mutation.mutate({ status: a.status });
            }}
          >
            {a.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export default function SodTab({ applicationId }) {
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [toast, setToast] = useState(null);

  const query = useQuery({
    queryKey: applicationViewSodQueryKey(applicationId),
    queryFn: () => fetchApplicationViewSod(applicationId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const summary = data?.summary;
  const policies = data?.policies || [];
  const allViolations = data?.violations || [];

  const filteredViolations = useMemo(() => allViolations.filter((v) => {
    if (severityFilter !== 'ALL' && String(v.severity || '').toUpperCase() !== severityFilter) return false;
    if (statusFilter !== 'ALL' && String(v.status || '').toLowerCase() !== statusFilter) return false;
    return true;
  }), [allViolations, severityFilter, statusFilter]);

  const pagedViolations = useMemo(
    () => filteredViolations.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredViolations, page, rowsPerPage],
  );

  const handleRemediationDone = (result) => {
    setToast(result);
    query.refetch();
  };

  return (
    <CatalogSection
      eyebrow="Governance"
      title="Segregation of Duties"
      subtitle="Policies that include this application, and related violations."
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
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Grid container spacing={1.5}>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Policies"
                value={summary?.policyCount ?? policies.length}
                icon={<PolicyOutlined sx={{ fontSize: 18 }} />}
                accent={palette.brand.primary}
                subtitle="Touching this app"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Open conflicts"
                value={summary?.openCount ?? 0}
                icon={<GavelOutlined sx={{ fontSize: 18 }} />}
                accent={palette.status.warning}
                subtitle="Currently open"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Critical / High"
                value={summary?.criticalHigh ?? 0}
                icon={<ErrorOutline sx={{ fontSize: 18 }} />}
                accent={palette.status.error}
                subtitle="Open severity"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Exceptions"
                value={summary?.exceptionCount ?? 0}
                icon={<VerifiedUserOutlined sx={{ fontSize: 18 }} />}
                accent={palette.brand.primary}
                subtitle="Active exceptions"
              />
            </Grid>
          </Grid>

          <InsightPanel title="Policies">
            {policies.length === 0 ? (
              <InsightEmpty title="No results" body="No SoD policies reference this application." />
            ) : (
              <InsightTable
                columns={[
                  {
                    key: 'name',
                    label: 'Policy',
                    render: (row) => (
                      <TableLink to={row.deepLink || `/governance/sod-policies/${row._id}`}>
                        {row.name || 'Policy'}
                      </TableLink>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (row) => <StatusChip status={row.status} />,
                  },
                  {
                    key: 'severity',
                    label: 'Severity',
                    render: (row) => <SeverityChip severity={row.severity} />,
                  },
                  {
                    key: 'open',
                    label: 'Open',
                    render: (row) => row.openViolations ?? 0,
                  },
                ]}
                rows={policies.map((p) => ({ ...p, id: p._id || p.policyId }))}
              />
            )}
          </InsightPanel>

          <InsightPanel
            title="Violations"
            action={(
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {SEVERITY_FILTERS.map((s) => (
                  <Chip
                    key={s}
                    size="small"
                    clickable
                    label={s === 'ALL' ? 'All severities' : s}
                    onClick={() => { setSeverityFilter(s); setPage(0); }}
                    sx={filterChipSx(severityFilter === s)}
                  />
                ))}
              </Box>
            )}
            bodySx={{ p: 0 }}
          >
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', px: 2.25, pt: 1.5 }}>
              {STATUS_FILTERS.map((s) => (
                <Chip
                  key={s.value}
                  size="small"
                  clickable
                  label={s.label}
                  onClick={() => { setStatusFilter(s.value); setPage(0); }}
                  sx={filterChipSx(statusFilter === s.value)}
                />
              ))}
            </Box>
            {filteredViolations.length === 0 ? (
              <Box sx={{ p: 2.25 }}>
                <InsightEmpty title="No results" body="No violations match the current filters." />
              </Box>
            ) : (
              <Box sx={{ mt: 1.5 }}>
                <InsightTable
                  columns={[
                    {
                      key: 'policy',
                      label: 'Policy',
                      render: (row) => (
                        <TableLink to={row.deepLink || `/governance/sod-policies/${row.policy}`}>
                          {row.policyName || 'Policy'}
                        </TableLink>
                      ),
                    },
                    {
                      key: 'identity',
                      label: 'Identity',
                      render: (row) => (
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {row.identityName || row.userName || '—'}
                          </Typography>
                          {row.identityEmail ? (
                            <Typography variant="caption" color="text.secondary">{row.identityEmail}</Typography>
                          ) : null}
                        </Box>
                      ),
                    },
                    {
                      key: 'severity',
                      label: 'Severity',
                      render: (row) => <SeverityChip severity={row.severity} />,
                    },
                    {
                      key: 'status',
                      label: 'Status',
                      render: (row) => <StatusChip status={row.status} />,
                    },
                    {
                      key: 'detected',
                      label: 'Detected',
                      render: (row) => formatDate(row.detectedAt),
                    },
                    {
                      key: 'actions',
                      label: '',
                      align: 'right',
                      width: 48,
                      render: (row) => <RemediationMenu violation={row} onDone={handleRemediationDone} />,
                    },
                  ]}
                  rows={pagedViolations.map((v) => ({ ...v, id: v._id }))}
                  page={page}
                  onPageChange={setPage}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0); }}
                  totalCount={filteredViolations.length}
                />
              </Box>
            )}
          </InsightPanel>
        </Box>
      ) : null}

      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast(null)}>
        {toast ? (
          <Alert severity={toast.ok ? 'success' : 'error'} onClose={() => setToast(null)} variant="filled">
            {toast.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </CatalogSection>
  );
}
