import React from 'react';
import { Box, Typography, Chip, Stack } from '@mui/material';
import {
  VpnKeyOutlined,
  AppsOutlined,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import CatalogSection from './CatalogSection';
import {
  InsightLoading,
  InsightError,
  InsightEmpty,
  InsightPanel,
  InsightTable,
  SeverityChip,
  DeepLinkButton,
} from './CatalogInsightPrimitives';
import {
  fetchIdentityPrivileges,
  identityPrivilegesQueryKey,
  IDENTITY_INSIGHT_STALE_MS,
} from './identityCatalogQueries';
import { palette } from '../../../theme/palette';
import { CATALOG } from './catalogTheme';

const SLATE = '#4A6984';

function KindChip({ kind }) {
  const isAccount = String(kind || '').toLowerCase() === 'account';
  const color = isAccount ? palette.status.error : SLATE;
  return (
    <Chip
      size="small"
      label={isAccount ? 'Account' : 'Entitlement'}
      sx={{
        height: 22,
        fontWeight: 700,
        fontSize: '0.68rem',
        letterSpacing: '0.02em',
        bgcolor: alpha(color, 0.1),
        color,
        border: `1px solid ${alpha(color, 0.18)}`,
      }}
    />
  );
}

function AppMark({ name }) {
  const initial = String(name || '?').charAt(0).toUpperCase();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.1, minWidth: 0 }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: 1,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: '0.72rem',
          fontWeight: 800,
          color: SLATE,
          bgcolor: alpha(SLATE, 0.1),
          border: `1px solid ${alpha(SLATE, 0.16)}`,
        }}
      >
        {initial}
      </Box>
      <Typography
        sx={{
          fontSize: '0.8125rem',
          fontWeight: 700,
          color: CATALOG.ink,
          letterSpacing: '0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name || '—'}
      </Typography>
    </Box>
  );
}

function SummaryStat({ icon, label, value, subtitle, accent }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 2,
        py: 1.5,
        borderRadius: `${CATALOG.radius}px`,
        border: `1px solid ${CATALOG.border}`,
        bgcolor: CATALOG.surface,
        boxShadow: CATALOG.cardShadow,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1.5,
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color: accent,
          bgcolor: alpha(accent, 0.1),
          border: `1px solid ${alpha(accent, 0.14)}`,
          '& svg': { fontSize: 20 },
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: '0.65rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: CATALOG.inkFaint,
            lineHeight: 1.2,
            mb: 0.35,
          }}
        >
          {label}
        </Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.45rem', color: CATALOG.ink, lineHeight: 1.05 }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: CATALOG.inkFaint, fontWeight: 500, mt: 0.25 }}>
          {subtitle}
        </Typography>
      </Box>
    </Box>
  );
}

export default function PrivilegesTab({ identityId }) {
  const query = useQuery({
    queryKey: identityPrivilegesQueryKey(identityId),
    queryFn: () => fetchIdentityPrivileges(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const data = query.data;
  const summary = data?.summary;
  const items = data?.items || [];
  const byApplication = data?.byApplication || [];

  return (
    <CatalogSection
      eyebrow="Access"
      title="Privileged entitlements"
      subtitle="High-risk access this identity holds across applications."
      dense
      actions={
        data?.deepLink ? (
          <DeepLinkButton to={data.deepLink} label="Open privileged entitlements" />
        ) : null
      }
    >
      {query.isPending ? <InsightLoading /> : null}
      {query.isError ? (
        <InsightError
          message={query.error?.message || 'Failed to load privilege details.'}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {data ? (
        <Box sx={{ display: 'grid', gap: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
            <SummaryStat
              icon={<VpnKeyOutlined />}
              label="Privileged entitlements"
              value={summary?.privilegedEntitlements ?? 0}
              subtitle="Unique privileged access"
              accent={SLATE}
            />
            <SummaryStat
              icon={<AppsOutlined />}
              label="Applications"
              value={summary?.applicationsWithPrivilege ?? 0}
              subtitle="With privileged access"
              accent={CATALOG.accent}
            />
          </Stack>

          {!items.length && !byApplication.length ? (
            <InsightEmpty
              title="No privileged entitlements"
              body="This identity does not hold privileged accounts or entitlements."
              to={data.deepLink}
              linkLabel="Open data hygiene"
            />
          ) : (
            <>
              <InsightPanel
                title="Privilege access details"
                action={
                  items.length ? (
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: CATALOG.inkFaint }}>
                      {items.length} {items.length === 1 ? 'item' : 'items'}
                    </Typography>
                  ) : null
                }
              >
                {items.length ? (
                  <InsightTable
                    dense
                    columns={[
                      {
                        key: 'applicationName',
                        label: 'Application',
                        width: '28%',
                        render: (row) => <AppMark name={row.applicationName} />,
                      },
                      {
                        key: 'entitlementName',
                        label: 'Entitlement',
                        width: '42%',
                        render: (row) => (
                          <Typography
                            sx={{
                              fontSize: '0.8125rem',
                              fontWeight: 600,
                              color: CATALOG.ink,
                              fontFamily: CATALOG.mono,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={row.entitlementName || ''}
                          >
                            {row.entitlementName || '—'}
                          </Typography>
                        ),
                      },
                      {
                        key: 'kind',
                        label: 'Type',
                        width: '15%',
                        render: (row) => <KindChip kind={row.kind} />,
                      },
                      {
                        key: 'severity',
                        label: 'Severity',
                        width: '15%',
                        render: (row) => <SeverityChip severity={row.severity} />,
                      },
                    ]}
                    rows={items}
                  />
                ) : (
                  <Box sx={{ p: 2.25 }}>
                    <Typography sx={{ fontSize: '0.85rem', color: CATALOG.inkFaint }}>
                      No privilege line-items available.
                    </Typography>
                  </Box>
                )}
              </InsightPanel>

              {byApplication.length ? (
                <InsightPanel
                  title="By application"
                  action={
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: CATALOG.inkFaint }}>
                      {byApplication.length} {byApplication.length === 1 ? 'app' : 'apps'}
                    </Typography>
                  }
                >
                  <InsightTable
                    dense
                    columns={[
                      {
                        key: 'applicationName',
                        label: 'Application',
                        width: '28%',
                        render: (row) => <AppMark name={row.applicationName} />,
                      },
                      {
                        key: 'accounts',
                        label: 'Accounts',
                        width: '12%',
                        align: 'center',
                        render: (row) => (
                          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: CATALOG.ink }}>
                            {row.accounts ?? 0}
                          </Typography>
                        ),
                      },
                      {
                        key: 'privilegedEntitlements',
                        label: 'Privileged',
                        width: '12%',
                        align: 'center',
                        render: (row) => (
                          <Typography sx={{ fontWeight: 800, fontSize: '0.8125rem', color: SLATE }}>
                            {row.privilegedEntitlements ?? 0}
                          </Typography>
                        ),
                      },
                      {
                        key: 'privilegedNames',
                        label: 'Entitlements',
                        width: '48%',
                        render: (row) => {
                          const names = row.privilegedNames || [];
                          if (!names.length) {
                            return (
                              <Typography sx={{ fontSize: '0.75rem', color: CATALOG.inkFaint }}>—</Typography>
                            );
                          }
                          return (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, py: 0.15 }}>
                              {names.slice(0, 4).map((name) => (
                                <Chip
                                  key={name}
                                  size="small"
                                  label={name}
                                  sx={{
                                    height: 22,
                                    fontSize: '0.68rem',
                                    fontWeight: 600,
                                    fontFamily: CATALOG.mono,
                                    bgcolor: CATALOG.surfaceAlt,
                                    color: CATALOG.inkMuted,
                                    border: `1px solid ${CATALOG.border}`,
                                    maxWidth: 220,
                                    '& .MuiChip-label': {
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    },
                                  }}
                                />
                              ))}
                              {names.length > 4 ? (
                                <Chip
                                  size="small"
                                  label={`+${names.length - 4}`}
                                  sx={{
                                    height: 22,
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    bgcolor: alpha(SLATE, 0.1),
                                    color: SLATE,
                                  }}
                                />
                              ) : null}
                            </Box>
                          );
                        },
                      },
                    ]}
                    rows={byApplication}
                  />
                </InsightPanel>
              ) : null}
            </>
          )}
        </Box>
      ) : null}
    </CatalogSection>
  );
}
