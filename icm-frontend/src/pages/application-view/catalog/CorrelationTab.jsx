import React, { useState } from 'react';
import {
  Box, Grid, Typography, Chip, Button,
} from '@mui/material';
import {
  LinkOutlined, PeopleAltOutlined, VpnKeyOutlined, ArrowBackOutlined,
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightKpi,
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  DeepLinkButton,
  TableLink,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { palette } from '../../../theme/palette';
import { useAuth } from '../../../contexts/AuthContext';
import {
  fetchApplicationViewCorrelation,
  applicationViewCorrelationQueryKey,
  fetchApplicationViewCorrelatedAccounts,
  applicationViewCorrelatedAccountsQueryKey,
  fetchApplicationViewEntitlementUsers,
  applicationViewEntitlementUsersQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

const SUB_VIEWS = [
  { id: 'identity', label: 'Identity Correlation', icon: <LinkOutlined sx={{ fontSize: 16 }} /> },
  { id: 'entitlements', label: 'Entitlements', icon: <VpnKeyOutlined sx={{ fontSize: 16 }} /> },
];

function subNavChipSx(selected) {
  return {
    fontWeight: 650,
    height: 30,
    bgcolor: selected ? CATALOG.accent : CATALOG.surface,
    color: selected ? '#fff' : CATALOG.ink,
    border: `1px solid ${selected ? CATALOG.accent : CATALOG.border}`,
    '& .MuiChip-icon': { color: selected ? '#fff' : CATALOG.inkFaint },
    '&:hover': { bgcolor: selected ? CATALOG.accent : CATALOG.surfaceAlt },
  };
}

function entName(row) {
  const d = row.entitlementData || {};
  return d.entitlement_name || d.entitlementName || d.name || d.entitlement_id || 'Entitlement';
}

function userLabel(userData) {
  if (!userData || typeof userData !== 'object') return '—';
  return (
    userData.displayName
    || userData.display_name
    || userData.user_name
    || userData.username
    || userData.accountName
    || userData.account_name
    || userData.email
    || userData.mail
    || String(userData._id || '—')
  );
}

function identityLabel(row) {
  const idObj = row.identityId && typeof row.identityId === 'object' ? row.identityId : null;
  const nameFromParts = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return (
    row.identityLabel
    || row.identityDisplayName
    || row.identityName
    || idObj?.displayName
    || idObj?.email
    || nameFromParts
    || null
  );
}

function IdentityCorrelationView({ applicationId }) {
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const summaryQuery = useQuery({
    queryKey: applicationViewCorrelationQueryKey(applicationId, tenantId),
    queryFn: () => fetchApplicationViewCorrelation(applicationId, tenantId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const linkedQuery = useQuery({
    queryKey: applicationViewCorrelatedAccountsQueryKey(applicationId, tenantId, {
      page,
      limit: rowsPerPage,
    }),
    queryFn: () => fetchApplicationViewCorrelatedAccounts(applicationId, tenantId, {
      page,
      limit: rowsPerPage,
    }),
    enabled: Boolean(applicationId && tenantId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
    placeholderData: (previousData) => previousData,
  });

  if (!tenantId) {
    return (
      <InsightEmpty
        title="Tenant required"
        body="Sign in with a tenant context to load correlated users for this application."
      />
    );
  }

  if (linkedQuery.isPending && !linkedQuery.data) return <InsightLoading />;
  if (linkedQuery.isError) {
    return (
      <InsightError
        message={linkedQuery.error?.message || 'Failed to load correlated users.'}
        onRetry={() => linkedQuery.refetch()}
      />
    );
  }

  const linked = linkedQuery.data?.data || [];
  const linkedTotal = linkedQuery.data?.total ?? 0;
  const deepLink = linkedQuery.data?.deepLink || summaryQuery.data?.deepLink;
  const entitlementTotal = summaryQuery.data?.entitlementCorrelationTotal ?? 0;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {deepLink ? (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <DeepLinkButton to={deepLink} label="Open correlated accounts" />
        </Box>
      ) : null}
      <Grid container spacing={1.5}>
        <Grid item xs={6} md={4}>
          <InsightKpi
            label="Linked accounts"
            value={Number(linkedTotal).toLocaleString()}
            icon={<LinkOutlined sx={{ fontSize: 18 }} />}
            accent={palette.brand.primary}
            subtitle="Active identity links"
          />
        </Grid>
        <Grid item xs={6} md={4}>
          <InsightKpi
            label="Showing"
            value={`${linked.length.toLocaleString()} / ${Number(linkedTotal).toLocaleString()}`}
            icon={<PeopleAltOutlined sx={{ fontSize: 18 }} />}
            accent={palette.text.secondary}
            subtitle={`Page ${page + 1}`}
          />
        </Grid>
        <Grid item xs={6} md={4}>
          <InsightKpi
            label="Entitlements correlated"
            value={Number(entitlementTotal).toLocaleString()}
            icon={<VpnKeyOutlined sx={{ fontSize: 18 }} />}
            accent={palette.brand.primary}
            subtitle="See Entitlements sub-tab"
          />
        </Grid>
      </Grid>

      <InsightPanel title="Correlated users" bodySx={{ p: 0 }}>
        {linked.length === 0 ? (
          <Box sx={{ p: 2.25 }}>
            <InsightEmpty title="No results" body="No correlated identity-account links for this application." />
          </Box>
        ) : (
          <InsightTable
            columns={[
              {
                key: 'identity',
                label: 'Identity',
                render: (row) => {
                  const id = row.identityId?._id || row.identityId;
                  const name = identityLabel(row) || (id ? String(id) : '—');
                  return id ? (
                    <TableLink to={`/identities/${id}`}>{name}</TableLink>
                  ) : name;
                },
              },
              {
                key: 'account',
                label: 'Account',
                render: (row) => row.accountName || row.accountId || '—',
              },
              {
                key: 'method',
                label: 'Method',
                render: (row) => row.correlationMethod || '—',
              },
              {
                key: 'status',
                label: 'Status',
                render: (row) => row.correlationStatus || (row.isActive ? 'active' : 'inactive'),
              },
              {
                key: 'match',
                label: 'Matched on',
                render: (row) => {
                  const rule = row.matchRuleDisplay || row.correlationKeyLabel || null;
                  const detected = row.lastVerifiedAt || row.updatedAt || row.correlatedAt;
                  return (
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                        {rule || '—'}
                      </Typography>
                      {detected ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                          Detected {new Date(detected).toLocaleString()}
                        </Typography>
                      ) : null}
                    </Box>
                  );
                },
              },
            ]}
            rows={linked.map((r) => ({ ...r, id: r._id || r.linkId || `${r.accountId}-${r.identityId}` }))}
            page={page}
            onPageChange={setPage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0); }}
            totalCount={linkedTotal}
          />
        )}
      </InsightPanel>
    </Box>
  );
}

function EntitlementUsersPanel({ applicationId, entitlement, onBack }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const entitlementId = entitlement?.entitlementId;

  const query = useQuery({
    queryKey: applicationViewEntitlementUsersQueryKey(applicationId, entitlementId, {
      page,
      limit: rowsPerPage,
    }),
    queryFn: () => fetchApplicationViewEntitlementUsers(applicationId, entitlementId, {
      page,
      limit: rowsPerPage,
    }),
    enabled: Boolean(applicationId && entitlementId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const rows = query.data?.data || [];
  const total = query.data?.total ?? 0;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          startIcon={<ArrowBackOutlined />}
          onClick={onBack}
          sx={{ textTransform: 'none', fontWeight: 650 }}
        >
          Back to entitlements
        </Button>
        <Typography sx={{ fontWeight: 700, color: CATALOG.ink }}>
          {entName(entitlement)}
        </Typography>
        <Chip
          size="small"
          label={`${Number(entitlement?.userCount || total || 0).toLocaleString()} users`}
          sx={{ fontWeight: 650 }}
        />
      </Box>

      <InsightPanel title="Assigned users" bodySx={{ p: 0 }}>
        {query.isPending ? (
          <Box sx={{ p: 2 }}><InsightLoading /></Box>
        ) : null}
        {query.isError ? (
          <Box sx={{ p: 2 }}>
            <InsightError
              message={query.error?.message || 'Failed to load entitlement users.'}
              onRetry={() => query.refetch()}
            />
          </Box>
        ) : null}
        {!query.isPending && !query.isError && rows.length === 0 ? (
          <Box sx={{ p: 2.25 }}>
            <InsightEmpty title="No users" body="No correlated users found for this entitlement." />
          </Box>
        ) : null}
        {!query.isPending && !query.isError && rows.length > 0 ? (
          <InsightTable
            columns={[
              {
                key: 'user',
                label: 'User',
                render: (row) => userLabel(row.userData),
              },
              {
                key: 'email',
                label: 'Email',
                render: (row) => row.userData?.email || row.userData?.mail || '—',
              },
              {
                key: 'status',
                label: 'Status',
                render: (row) => row.status || row.userData?.status || '—',
              },
              {
                key: 'method',
                label: 'Match',
                render: (row) => row.matchMethod || '—',
              },
            ]}
            rows={rows.map((r) => ({ ...r, id: r._id || `${r.userId}-${r.entitlementId}` }))}
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

function EntitlementsCorrelationView({ applicationId }) {
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
  const [selected, setSelected] = useState(null);

  const query = useQuery({
    queryKey: applicationViewCorrelationQueryKey(applicationId, tenantId),
    queryFn: () => fetchApplicationViewCorrelation(applicationId, tenantId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  if (selected) {
    return (
      <EntitlementUsersPanel
        applicationId={applicationId}
        entitlement={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (query.isPending) return <InsightLoading />;
  if (query.isError) {
    return (
      <InsightError
        message={query.error?.message || 'Failed to load entitlement correlations.'}
        onRetry={() => query.refetch()}
      />
    );
  }

  const ents = query.data?.entitlementCorrelations || [];

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Grid container spacing={1.5}>
        <Grid item xs={12} md={4}>
          <InsightKpi
            label="Entitlements correlated"
            value={Number(query.data?.entitlementCorrelationTotal || 0).toLocaleString()}
            icon={<VpnKeyOutlined sx={{ fontSize: 18 }} />}
            accent={palette.brand.primary}
            subtitle="Click a row to see users"
          />
        </Grid>
      </Grid>

      <InsightPanel title="Entitlements">
        {ents.length === 0 ? (
          <InsightEmpty
            title="No results"
            body="No entitlement correlation results yet. Run correlation from application settings if needed."
          />
        ) : (
          <InsightTable
            columns={[
              {
                key: 'ent',
                label: 'Entitlement',
                render: (row) => (
                  <Button
                    onClick={() => setSelected(row)}
                    sx={{
                      textTransform: 'none',
                      fontWeight: 650,
                      p: 0,
                      minWidth: 0,
                      justifyContent: 'flex-start',
                      color: palette.brand.primary,
                    }}
                  >
                    {entName(row)}
                  </Button>
                ),
              },
              {
                key: 'users',
                label: 'Users',
                align: 'right',
                render: (row) => (
                  <Button
                    size="small"
                    onClick={() => setSelected(row)}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    {Number(row.userCount ?? 0).toLocaleString()}
                  </Button>
                ),
              },
            ]}
            rows={ents.map((r) => ({ ...r, id: String(r.entitlementId || '') }))}
          />
        )}
      </InsightPanel>
    </Box>
  );
}

export default function CorrelationTab({ applicationId }) {
  const [subView, setSubView] = useState('identity');

  return (
    <CatalogSection
      eyebrow="Correlation"
      title="Correlation"
      subtitle="Identity-account links and entitlement-assigned users for this application."
      dense
      actions={(
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
          {SUB_VIEWS.map((sv) => (
            <Chip
              key={sv.id}
              clickable
              size="small"
              icon={sv.icon}
              label={sv.label}
              onClick={() => setSubView(sv.id)}
              sx={subNavChipSx(subView === sv.id)}
            />
          ))}
        </Box>
      )}
    >
      {subView === 'identity' ? <IdentityCorrelationView applicationId={applicationId} /> : null}
      {subView === 'entitlements' ? <EntitlementsCorrelationView applicationId={applicationId} /> : null}
    </CatalogSection>
  );
}
