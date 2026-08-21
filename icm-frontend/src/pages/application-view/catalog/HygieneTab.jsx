import React, { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Typography, Chip, Button, LinearProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowBackOutlined,
  OpenInNewOutlined,
  ChevronRightOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  DeepLinkButton,
  SeverityChip,
  formatDate,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { palette } from '../../../theme/palette';
import {
  WIDGET_TITLES,
  VALID_WIDGETS,
  parseRecord,
  managerHygieneIssueLabel,
} from '../../datahygine/widgetDetailSupport';
import {
  fetchApplicationViewHygiene,
  applicationViewHygieneQueryKey,
  fetchApplicationViewHygieneWidgetItems,
  applicationViewHygieneWidgetItemsQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

function checkLabel(row) {
  return row.label
    || (row.detailWidgetId && WIDGET_TITLES[row.detailWidgetId])
    || 'Check';
}

/** Map finding intensity to a severity band for presentation. */
function checkSeverity(row) {
  const count = Number(row.count || 0);
  if (count <= 0) return null;
  const pct = row.percent != null ? Number(row.percent) : null;
  if (pct != null) {
    if (pct >= 20) return 'HIGH';
    if (pct >= 10) return 'MEDIUM';
    return 'LOW';
  }
  if (count >= 100) return 'HIGH';
  if (count >= 25) return 'MEDIUM';
  return 'LOW';
}

function CoverageMeter({ percent, severity }) {
  if (percent == null || Number.isNaN(Number(percent))) {
    return <Typography sx={{ color: CATALOG.inkFaint, fontSize: '0.8125rem' }}>—</Typography>;
  }
  const pct = Math.min(Math.max(Number(percent), 0), 100);
  const color =
    severity === 'HIGH' ? palette.status.error
      : severity === 'MEDIUM' ? palette.status.warning
        : severity === 'LOW' ? palette.brand.primary
          : CATALOG.inkFaint;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 140 }}>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          flex: 1,
          height: 6,
          borderRadius: 99,
          bgcolor: alpha(color, 0.12),
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 99 },
        }}
      />
      <Typography
        sx={{
          fontWeight: 700,
          fontSize: '0.78rem',
          fontVariantNumeric: 'tabular-nums',
          color,
          minWidth: 40,
          textAlign: 'right',
        }}
      >
        {pct}%
      </Typography>
    </Box>
  );
}

function detailRowId(rec, fallback, idx) {
  if (!rec) return fallback || `row-${idx}`;
  if (rec.kind === 'orphan') return rec.o?.id || fallback;
  if (rec.kind === 'mm' || rec.kind === 'mma') return rec.i?.id || fallback;
  if (rec.kind === 'mgrx') return rec.m?.id || fallback;
  if (rec.kind === 'stmx') return rec.s?.id || fallback;
  if (rec.kind === 'ent') return rec.e?.id || fallback;
  if (rec.kind === 'ina') return rec.a?.linkId || rec.a?.id || fallback;
  if (rec.kind === 'camp') return rec.c?.id || fallback;
  if (rec.kind === 'sodPol') return rec.p?.id || fallback;
  if (rec.kind === 'dup') return rec.d?.id || fallback;
  return fallback || `row-${idx}`;
}

function mapDetailRows(items, widgetId) {
  return (items || []).map((raw, idx) => {
    const rec = parseRecord(raw, widgetId);
    const id = detailRowId(rec, raw?.id || raw?._id, idx);
    if (!rec) {
      return {
        id,
        name: raw?.displayName || raw?.accountName || raw?.name || '—',
        secondary: raw?.email || raw?.accountId || '—',
        meta: raw?.status || raw?.riskLevel || '—',
        extra: '—',
      };
    }
    if (rec.kind === 'orphan') {
      return {
        id,
        name: rec.o.accountName || rec.o.displayName || rec.o.accountId || '—',
        secondary: rec.o.applicationLabel || rec.o.applicationName || '—',
        meta: rec.o.riskLevel || '—',
        extra: rec.o.status || '—',
      };
    }
    if (rec.kind === 'mm' || rec.kind === 'mma') {
      return {
        id,
        name: rec.i.displayName || '—',
        secondary: rec.i.email || rec.i.employeeId || '—',
        meta: managerHygieneIssueLabel(rec.i.managerIssue || rec.i.managerResolutionStatus, rec.i),
        extra: rec.i.lifecycleState || '—',
      };
    }
    if (rec.kind === 'mgrx') {
      return {
        id,
        name: rec.m.displayName || '—',
        secondary: rec.m.email || '—',
        meta: rec.m.appManager || rec.m.applicationManager || '—',
        extra: rec.m.identityManager || rec.m.hrManager || '—',
      };
    }
    if (rec.kind === 'stmx') {
      return {
        id,
        name: rec.s.displayName || '—',
        secondary: rec.s.email || '—',
        meta: rec.s.appStatus || rec.s.applicationStatus || '—',
        extra: rec.s.identityStatus || rec.s.lifecycleState || '—',
      };
    }
    if (rec.kind === 'ent') {
      return {
        id,
        name: rec.e.entitlementName || rec.e.displayName || '—',
        secondary: rec.e.entitlementId || rec.e.value || '—',
        meta: rec.e.type || rec.e.entitlementType || '—',
        extra: rec.e.owner || rec.e.ownerName || '—',
      };
    }
    if (rec.kind === 'ina') {
      return {
        id,
        name: rec.a.displayName || '—',
        secondary: rec.a.email || '—',
        meta: rec.a.lifecycleState || '—',
        extra: rec.a.lastLogin || rec.a.lastActivityAt || '—',
      };
    }
    if (rec.kind === 'camp') {
      return {
        id,
        name: rec.c.name || rec.c.campaignName || '—',
        secondary: rec.c.status || '—',
        meta: rec.c.totalItems != null ? `${rec.c.totalItems} items` : '—',
        extra: rec.c.pendingItems != null ? `${rec.c.pendingItems} pending` : '—',
      };
    }
    if (rec.kind === 'sodPol') {
      return {
        id,
        name: rec.p.name || rec.p.policyName || '—',
        secondary: rec.p.severity || '—',
        meta: rec.p.openViolations != null ? `${rec.p.openViolations} open` : '—',
        extra: rec.p.totalViolations != null ? `${rec.p.totalViolations} total` : '—',
      };
    }
    if (rec.kind === 'dup') {
      return {
        id,
        name: rec.d.displayName || rec.d.accountName || '—',
        secondary: rec.d.primaryKeyValue || rec.d.primaryKeyNormalized || '—',
        meta: rec.d.duplicateCount != null ? `${rec.d.duplicateCount} dupes` : '—',
        extra: rec.d.source || '—',
      };
    }
    return { id, name: '—', secondary: '—', meta: '—', extra: '—' };
  });
}

function detailColumnLabels(widgetId) {
  if (widgetId === 'orphanedProfiles') {
    return { name: 'Account', secondary: 'Application', meta: 'Risk', extra: 'Status' };
  }
  if (widgetId === 'missingManagers' || widgetId === 'missingManagersByApplication') {
    return { name: 'Identity', secondary: 'Email / ID', meta: 'Manager status', extra: 'Lifecycle' };
  }
  if (widgetId === 'managerMismatches') {
    return { name: 'Identity', secondary: 'Email', meta: 'App manager', extra: 'HR manager' };
  }
  if (widgetId === 'statusMismatches') {
    return { name: 'Identity', secondary: 'Email', meta: 'App status', extra: 'Identity status' };
  }
  if (
    widgetId === 'unassignedEntitlements'
    || widgetId === 'privilegedEntitlements'
    || widgetId === 'entitlementsMissingOwner'
  ) {
    return { name: 'Entitlement', secondary: 'Value / ID', meta: 'Type', extra: 'Owner' };
  }
  if (widgetId === 'inactiveUsersWithAccess') {
    return { name: 'User', secondary: 'Email', meta: 'Lifecycle', extra: 'Last activity' };
  }
  if (widgetId === 'accessCertificationCampaigns') {
    return { name: 'Campaign', secondary: 'Status', meta: 'Items', extra: 'Pending' };
  }
  if (widgetId === 'sodPoliciesViolations') {
    return { name: 'Policy', secondary: 'Severity', meta: 'Open', extra: 'Total' };
  }
  if (widgetId === 'duplicateAccountsByApplication') {
    return { name: 'Account', secondary: 'Primary key', meta: 'Duplicates', extra: 'Source' };
  }
  return { name: 'Name', secondary: 'Detail', meta: 'Meta', extra: 'Extra' };
}

function HygieneCheckDetailView({ applicationId, check, onBack }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const widgetId = check?.detailWidgetId;

  const query = useQuery({
    queryKey: applicationViewHygieneWidgetItemsQueryKey(applicationId, widgetId, {
      page,
      limit: rowsPerPage,
    }),
    queryFn: () => fetchApplicationViewHygieneWidgetItems(applicationId, widgetId, {
      page,
      limit: rowsPerPage,
    }),
    enabled: Boolean(applicationId && widgetId && VALID_WIDGETS.has(widgetId)),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const labels = detailColumnLabels(widgetId);
  const rows = useMemo(
    () => mapDetailRows(query.data?.items || [], widgetId),
    [query.data?.items, widgetId],
  );
  const total = query.data?.total ?? Number(check?.count || 0);
  const title = checkLabel(check);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={<ArrowBackOutlined />}
          onClick={onBack}
          sx={{ textTransform: 'none', fontWeight: 650 }}
        >
          Back to checks
        </Button>
        <Typography sx={{ fontWeight: 700, color: CATALOG.ink }}>{title}</Typography>
        <Chip
          size="small"
          label={`${Number(total).toLocaleString()} items`}
          sx={{ fontWeight: 650 }}
        />
        {query.data?.deepLink ? (
          <Button
            component={RouterLink}
            to={query.data.deepLink}
            size="small"
            endIcon={<OpenInNewOutlined sx={{ fontSize: 14 }} />}
            sx={{ textTransform: 'none', fontWeight: 650, ml: 'auto' }}
          >
            Open full detail
          </Button>
        ) : null}
      </Box>

      <InsightPanel title={`${title} — details`} bodySx={{ p: 0 }}>
        {query.isPending ? (
          <Box sx={{ p: 2 }}><InsightLoading /></Box>
        ) : null}
        {query.isError ? (
          <Box sx={{ p: 2 }}>
            <InsightError
              message={query.error?.response?.data?.message || query.error?.message || 'Failed to load check details.'}
              onRetry={() => query.refetch()}
            />
          </Box>
        ) : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <Box sx={{ p: 2.25 }}>
            <InsightEmpty title="No items" body="No detail rows returned for this hygiene check." />
          </Box>
        ) : null}
        {!query.isPending && !query.isError && rows.length > 0 ? (
          <InsightTable
            columns={[
              { key: 'name', label: labels.name, render: (row) => row.name },
              { key: 'secondary', label: labels.secondary, render: (row) => row.secondary },
              { key: 'meta', label: labels.meta, render: (row) => row.meta },
              { key: 'extra', label: labels.extra, render: (row) => (typeof row.extra === 'string' && row.extra.includes('T') ? formatDate(row.extra) : row.extra) },
            ]}
            rows={rows}
            page={page}
            onPageChange={setPage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0); }}
            totalCount={total}
          />
        ) : null}
      </InsightPanel>
    </Box>
  );
}

function HygieneChecksView({ applicationId }) {
  const [selectedCheck, setSelectedCheck] = useState(null);

  const query = useQuery({
    queryKey: applicationViewHygieneQueryKey(applicationId),
    queryFn: () => fetchApplicationViewHygiene(applicationId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  if (selectedCheck) {
    return (
      <HygieneCheckDetailView
        applicationId={applicationId}
        check={selectedCheck}
        onBack={() => setSelectedCheck(null)}
      />
    );
  }

  if (query.isPending) return <InsightLoading />;
  if (query.isError) {
    return (
      <InsightError
        message={query.error?.message || 'Failed to load hygiene findings.'}
        onRetry={() => query.refetch()}
      />
    );
  }

  const data = query.data;
  const rows = data?.rows || [];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <InsightPanel
        title="Hygiene checks"
        action={data?.deepLink ? <DeepLinkButton to={data.deepLink} label="Open data hygiene" /> : null}
        bodySx={{ p: 0 }}
      >
        {rows.length === 0 ? (
          <Box sx={{ p: 2.25 }}>
            <InsightEmpty title="No results" body="No hygiene tile data for this application yet." />
          </Box>
        ) : (
          <InsightTable
            getRowSx={(row) => {
              const severity = checkSeverity(row);
              if (!severity) return undefined;
              const tone =
                severity === 'HIGH' ? palette.status.error
                  : severity === 'MEDIUM' ? palette.status.warning
                    : palette.brand.primary;
              return { bgcolor: alpha(tone, 0.03) };
            }}
            columns={[
              {
                key: 'label',
                label: 'Check',
                render: (row) => {
                  const clickable = Number(row.count) > 0 && row.detailWidgetId && VALID_WIDGETS.has(row.detailWidgetId);
                  return (
                    <Box
                      onClick={clickable ? () => setSelectedCheck(row) : undefined}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        cursor: clickable ? 'pointer' : 'default',
                        minWidth: 0,
                      }}
                    >
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          sx={{
                            fontWeight: 650,
                            fontSize: '0.84rem',
                            color: clickable ? palette.brand.primary : CATALOG.ink,
                            lineHeight: 1.3,
                          }}
                        >
                          {checkLabel(row)}
                        </Typography>
                        {row.detailWidgetId ? (
                          <Typography sx={{ mt: 0.2, fontSize: '0.68rem', color: CATALOG.inkFaint }}>
                            {Number(row.count) > 0 ? 'Click to review findings' : 'No findings'}
                          </Typography>
                        ) : null}
                      </Box>
                      {clickable ? (
                        <ChevronRightOutlined sx={{ fontSize: 18, color: CATALOG.inkFaint, flexShrink: 0 }} />
                      ) : null}
                    </Box>
                  );
                },
              },
              {
                key: 'severity',
                label: 'Severity',
                width: 108,
                render: (row) => {
                  const severity = checkSeverity(row);
                  if (!severity) {
                    return (
                      <Chip
                        size="small"
                        label="Clean"
                        sx={{
                          height: 22,
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          bgcolor: alpha(palette.status.success, 0.1),
                          color: palette.status.success,
                          border: `1px solid ${alpha(palette.status.success, 0.25)}`,
                        }}
                      />
                    );
                  }
                  return <SeverityChip severity={severity} />;
                },
              },
              {
                key: 'count',
                label: 'Findings',
                width: 96,
                align: 'right',
                render: (row) => {
                  const clickable = Number(row.count) > 0 && row.detailWidgetId && VALID_WIDGETS.has(row.detailWidgetId);
                  const value = Number(row.count || 0).toLocaleString();
                  return (
                    <Typography
                      onClick={clickable ? () => setSelectedCheck(row) : undefined}
                      sx={{
                        fontSize: '0.875rem',
                        fontWeight: 750,
                        fontVariantNumeric: 'tabular-nums',
                        color: clickable ? palette.brand.primary : CATALOG.ink,
                        cursor: clickable ? 'pointer' : 'default',
                      }}
                    >
                      {value}
                    </Typography>
                  );
                },
              },
              {
                key: 'pct',
                label: 'Share',
                width: 168,
                render: (row) => (
                  <CoverageMeter percent={row.percent} severity={checkSeverity(row)} />
                ),
              },
            ]}
            rows={rows.map((r) => ({ ...r, id: r.detailWidgetId || r.label }))}
          />
        )}
      </InsightPanel>
    </Box>
  );
}

export default function HygieneTab({ applicationId }) {
  return (
    <CatalogSection
      eyebrow="Quality"
      title="Data Hygiene"
      subtitle="Hygiene findings for this application. Open data hygiene for duplicates and the orphan queue."
      dense
    >
      <HygieneChecksView applicationId={applicationId} />
    </CatalogSection>
  );
}
