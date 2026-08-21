import React, { useState } from 'react';
import { Box, Chip, TextField, InputAdornment } from '@mui/material';
import { AccountTree, Search, AdminPanelSettingsOutlined } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from '../../identities/catalog/CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import {
  fetchApplicationViewEntitlements,
  applicationViewEntitlementsQueryKey,
  APP_VIEW_DETAIL_STALE_MS,
} from './applicationViewQueries';
import ApplicationAccessGraph from './ApplicationAccessGraph';

const GRAPH_CAP = 150;

/** Outlined pill filter chip — same look as the other Application View tabs. */
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

export default function AccessGraphTab({ applicationId, application }) {
  const [search, setSearch] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [privilegedOnly, setPrivilegedOnly] = useState(false);

  const params = {
    page: 0,
    limit: GRAPH_CAP,
    ...(searchApplied ? { search: searchApplied } : {}),
    ...(privilegedOnly ? { isPrivileged: true } : {}),
  };

  const query = useQuery({
    queryKey: applicationViewEntitlementsQueryKey(applicationId, params),
    queryFn: () => fetchApplicationViewEntitlements(applicationId, params),
    enabled: Boolean(applicationId),
    staleTime: APP_VIEW_DETAIL_STALE_MS,
    placeholderData: (previousData) => previousData,
  });

  const ents = query.data?.data || [];
  const total = query.data?.total ?? ents.length;

  return (
    <CatalogSection
      eyebrow="Access Graph"
      title="Application access map"
      subtitle="Application → entitlements. Expand the hub to reveal the entitlement tree."
      dense
      actions={(
        <Chip
          size="small"
          icon={<AccountTree />}
          label={total > GRAPH_CAP ? `Showing ${ents.length} of ${total} — refine search to narrow` : `${total} entitlements`}
          sx={{ fontWeight: 650 }}
        />
      )}
    >
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search entitlements…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearchApplied(search.trim());
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
          clickable
          variant="outlined"
          size="small"
          icon={<AdminPanelSettingsOutlined />}
          label="Privileged only"
          onClick={() => setPrivilegedOnly((prev) => !prev)}
          sx={filterChipSx(privilegedOnly)}
        />
      </Box>

      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load access graph.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {!query.isPending && !query.isError && ents.length === 0 ? (
        <InsightEmpty title="No results" body="No entitlements to graph for this application." />
      ) : null}
      {ents.length > 0 ? (
        <Box>
          <ApplicationAccessGraph application={application} entitlements={ents} />
        </Box>
      ) : null}
    </CatalogSection>
  );
}
