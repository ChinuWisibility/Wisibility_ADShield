import React from 'react';
import { Box, Grid, Typography, Chip } from '@mui/material';
import {
  HealthAndSafetyOutlined,
  FactCheckOutlined,
  RuleFolderOutlined,
  ReportProblemOutlined,
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from './CatalogSection';
import {
  InsightKpi,
  InsightLoading,
  InsightError,
  InsightPanel,
  InsightTable,
  SeverityChip,
  DeepLinkButton,
  TableLink,
} from './CatalogInsightPrimitives';
import {
  fetchIdentityHygiene,
  identityHygieneQueryKey,
  IDENTITY_INSIGHT_STALE_MS,
} from './identityCatalogQueries';
import { palette } from '../../../theme/palette';
import { CATALOG } from './catalogTheme';

function involvedColor(row) {
  if (row.kind === 'info') return row.involved ? palette.brand.primary : CATALOG.inkFaint;
  return row.involved ? palette.status.error : palette.status.success;
}

function InvolvedChip({ row }) {
  const color = involvedColor(row);
  return (
    <Chip
      size="small"
      label={row.involved ? 'Yes' : 'No'}
      sx={{
        height: 22,
        minWidth: 44,
        fontWeight: 700,
        fontSize: '0.68rem',
        bgcolor: alpha(color, 0.12),
        color,
      }}
    />
  );
}

export default function HygieneTab({ identityId }) {
  const query = useQuery({
    queryKey: identityHygieneQueryKey(identityId),
    queryFn: () => fetchIdentityHygiene(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const summary = data?.summary;
  const checks = data?.attributeChecks || [];
  const catalog = React.useMemo(() => {
    const rows = data?.catalog || [];
    const rank = (row) => {
      if (row.kind === 'info') return 2;
      return row.involved ? 0 : 1;
    };
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }, [data]);

  return (
    <CatalogSection
      eyebrow="Quality"
      title="Data hygiene"
      subtitle="Every data hygiene check, and whether this identity is involved."
      dense
      actions={data?.deepLink ? <DeepLinkButton to={data.deepLink} label="Open data hygiene" /> : null}
    >
      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load hygiene findings.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? (
        <Box sx={{ display: 'grid', gap: 1.75 }}>
          <Grid container spacing={1.25}>
            <Grid item xs={6} md={3}>
              <InsightKpi
                dense
                label="Hygiene score"
                value={summary?.hygieneScore ?? '—'}
                icon={<HealthAndSafetyOutlined />}
                accent={palette.brand.primary}
                subtitle="Attribute completeness"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                dense
                label="Checks involved"
                value={summary?.involvedChecks ?? 0}
                icon={<ReportProblemOutlined />}
                accent={palette.status.error}
                subtitle={`Out of ${summary?.totalChecks ?? 0} checks`}
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                dense
                label="Clean checks"
                value={summary?.cleanChecks ?? 0}
                icon={<RuleFolderOutlined />}
                accent={palette.status.success}
                subtitle="No issue found"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <InsightKpi
                dense
                label="Attribute gaps"
                value={summary?.attributeGaps ?? 0}
                icon={<FactCheckOutlined />}
                accent={palette.status.warning}
                subtitle="Failed checks"
              />
            </Grid>
          </Grid>

          <InsightPanel title="Data hygiene catalog">
            <InsightTable
              getRowSx={(row) =>
                row.involved && row.kind === 'issue'
                  ? { bgcolor: alpha(palette.status.error, 0.03) }
                  : undefined
              }
              columns={[
                {
                  key: 'involved',
                  label: 'Involved',
                  width: 88,
                  render: (row) => <InvolvedChip row={row} />,
                },
                {
                  key: 'title',
                  label: 'Check',
                  render: (row) => (
                    <Box sx={{ minWidth: 0, pr: 1 }}>
                      <TableLink to={row.deepLink || '/datahygine'}>
                        {row.title}
                      </TableLink>
                      {row.detail ? (
                        <Typography
                          sx={{
                            mt: 0.25,
                            fontSize: '0.75rem',
                            fontWeight: row.involved ? 700 : 400,
                            color: row.involved ? CATALOG.ink : CATALOG.inkFaint,
                            lineHeight: 1.35,
                          }}
                        >
                          {row.detail}
                        </Typography>
                      ) : null}
                    </Box>
                  ),
                },
                {
                  key: 'count',
                  label: 'Count',
                  width: 72,
                  render: (row) => (
                    <Typography
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: 700,
                        color: CATALOG.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.count ?? 0}
                    </Typography>
                  ),
                },
                {
                  key: 'severity',
                  label: 'Severity',
                  width: 110,
                  render: (row) =>
                    row.involved && row.kind === 'issue' ? <SeverityChip severity={row.severity} /> : (
                      <Typography sx={{ color: CATALOG.inkFaint, fontSize: '0.8125rem' }}>—</Typography>
                    ),
                },
              ]}
              rows={catalog}
            />
          </InsightPanel>

          <InsightPanel title="Attribute checks">
            {checks.length ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
                  gap: 0,
                }}
              >
                {checks.map((check, idx) => {
                  const ok = Boolean(check.ok);
                  const enabled = check.enabled !== false;
                  const statusLabel = !enabled ? 'Disabled' : ok ? 'Complete' : 'Missing';
                  const statusColor = !enabled
                    ? CATALOG.inkFaint
                    : ok
                      ? palette.status.success
                      : palette.status.error;
                  return (
                    <Box
                      key={check.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        px: 2,
                        py: 1.15,
                        borderBottom: `1px solid ${CATALOG.border}`,
                        borderRight: {
                          xs: 'none',
                          sm: idx % 2 === 0 ? `1px solid ${CATALOG.border}` : 'none',
                          lg: (idx + 1) % 3 !== 0 ? `1px solid ${CATALOG.border}` : 'none',
                        },
                      }}
                    >
                      {ok && enabled ? (
                        <CheckCircle sx={{ fontSize: 18, color: palette.status.success, flexShrink: 0 }} />
                      ) : (
                        <Cancel sx={{ fontSize: 18, color: statusColor, flexShrink: 0 }} />
                      )}
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: CATALOG.inkMuted,
                            lineHeight: 1.3,
                          }}
                        >
                          {check.label || check.id}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: '0.75rem',
                            fontWeight: 400,
                            color: statusColor,
                            lineHeight: 1.3,
                          }}
                        >
                          {statusLabel}
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Box sx={{ p: 2 }}>
                <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
                  No attribute checks configured.
                </Typography>
              </Box>
            )}
          </InsightPanel>
        </Box>
      ) : null}
    </CatalogSection>
  );
}
