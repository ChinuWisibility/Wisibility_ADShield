import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import {
  AssignmentTurnedInOutlined, HourglassEmptyOutlined, CheckCircleOutline, RemoveCircleOutline,
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
  StatusChip,
  DeepLinkButton,
  TableLink,
  formatDate,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { palette } from '../../../theme/palette';
import {
  fetchApplicationViewCertifications,
  applicationViewCertificationsQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

export default function CertificationsTab({ applicationId }) {
  const query = useQuery({
    queryKey: applicationViewCertificationsQueryKey(applicationId),
    queryFn: () => fetchApplicationViewCertifications(applicationId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const summary = data?.summary;
  const campaigns = data?.campaigns || [];

  return (
    <CatalogSection
      eyebrow="Governance"
      title="Access certifications"
      subtitle="Certification campaigns and review items that cover this application."
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
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Grid container spacing={1.5}>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="In progress"
                value={summary?.inProgress ?? 0}
                icon={<HourglassEmptyOutlined sx={{ fontSize: 18 }} />}
                accent={palette.status.info}
                subtitle="Active campaigns"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Pending"
                value={summary?.pending ?? 0}
                icon={<AssignmentTurnedInOutlined sx={{ fontSize: 18 }} />}
                accent={palette.status.warning}
                subtitle="Awaiting decision"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Completed"
                value={summary?.completed ?? 0}
                icon={<CheckCircleOutline sx={{ fontSize: 18 }} />}
                accent={palette.status.success}
                subtitle="Approved / exception"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                label="Revoked"
                value={summary?.revoked ?? 0}
                icon={<RemoveCircleOutline sx={{ fontSize: 18 }} />}
                accent={palette.status.error}
                subtitle="Access removed"
              />
            </Grid>
          </Grid>

          <InsightPanel title="Campaigns covering this application">
            {campaigns.length === 0 ? (
              <InsightEmpty
                title="No campaigns"
                body="No certification campaigns have targeted this application yet."
                to={data.deepLink}
                linkLabel="Launch a certification"
              />
            ) : (
              <InsightTable
                columns={[
                  {
                    key: 'name',
                    label: 'Campaign',
                    render: (row) => <TableLink to={row.deepLink}>{row.name || 'Campaign'}</TableLink>,
                  },
                  { key: 'status', label: 'Status', render: (row) => <StatusChip status={row.status} /> },
                  { key: 'category', label: 'Category', render: (row) => row.category || '—' },
                  {
                    key: 'progress',
                    label: 'Progress',
                    render: (row) => (row.completionPercentage != null ? `${Math.round(row.completionPercentage)}%` : '—'),
                  },
                  { key: 'dueDate', label: 'Due', render: (row) => formatDate(row.dueDate) },
                ]}
                rows={campaigns}
              />
            )}
          </InsightPanel>

          <InsightPanel title="Review items">
            <InsightTable
              columns={[
                {
                  key: 'campaign',
                  label: 'Campaign',
                  render: (row) => (
                    <TableLink to={row.deepLink}>{row.campaignName}</TableLink>
                  ),
                },
                {
                  key: 'item',
                  label: 'Item',
                  render: (row) => (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.itemName}</Typography>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (row) => <StatusChip status={row.status} />,
                },
                {
                  key: 'decision',
                  label: 'Decision',
                  render: (row) => row.decision || '—',
                },
                {
                  key: 'dueDate',
                  label: 'Due',
                  render: (row) => formatDate(row.dueDate),
                },
                {
                  key: 'reviewer',
                  label: 'Reviewer',
                  render: (row) => row.reviewer || '—',
                },
              ]}
              rows={data.items || []}
              empty={(
                <InsightEmpty
                  title="No certification items"
                  body="This application is not part of any access certification campaigns yet."
                  to={data.deepLink}
                  linkLabel="Browse certifications"
                />
              )}
            />
          </InsightPanel>
        </Box>
      ) : null}
    </CatalogSection>
  );
}
