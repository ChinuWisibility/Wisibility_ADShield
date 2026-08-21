import React, { useMemo, useState } from 'react';
import { Chip } from '@mui/material';
import { HistoryOutlined } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  formatDate,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import {
  fetchApplicationViewActivity,
  applicationViewActivityQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';

export default function ActivityTab({ applicationId }) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const query = useQuery({
    queryKey: applicationViewActivityQueryKey(applicationId),
    queryFn: () => fetchApplicationViewActivity(applicationId),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const allItems = query.data?.items || [];
  const pagedItems = useMemo(
    () => allItems.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [allItems, page, rowsPerPage],
  );

  return (
    <CatalogSection
      eyebrow="Audit"
      title="Activity & Audit Log"
      subtitle="Recorded actions and system events scoped to this application."
      dense
    >
      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load activity history.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError ? (
        <InsightPanel title="Timeline" bodySx={{ p: 0 }}>
          {allItems.length === 0 ? (
            <InsightEmpty
              title="No recorded activity"
              body="No audit or activity events have been logged against this application yet."
            />
          ) : (
            <InsightTable
              columns={[
                {
                  key: 'source',
                  label: 'Source',
                  width: 90,
                  render: (row) => (
                    <Chip
                      size="small"
                      icon={<HistoryOutlined sx={{ fontSize: '13px !important' }} />}
                      label={row.source}
                      sx={{ height: 22, fontWeight: 650, fontSize: '0.68rem', bgcolor: CATALOG.surfaceAlt, color: CATALOG.inkMuted }}
                    />
                  ),
                },
                { key: 'title', label: 'Event', render: (row) => row.title },
                { key: 'actor', label: 'Actor', render: (row) => row.actor },
                { key: 'timestamp', label: 'When', render: (row) => formatDate(row.timestamp) },
              ]}
              rows={pagedItems}
              page={page}
              onPageChange={setPage}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0); }}
              totalCount={allItems.length}
            />
          )}
        </InsightPanel>
      ) : null}
    </CatalogSection>
  );
}
