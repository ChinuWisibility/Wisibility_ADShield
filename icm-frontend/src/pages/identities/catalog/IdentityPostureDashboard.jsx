/**
 * Identity posture dashboard for a known identityId (no picker).
 * Used by catalog Posture tab and by the standalone posture page after selection.
 */

import React, { useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Grid,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IdentityProfilePostureCard from '../posture/components/IdentityProfilePostureCard';
import OverallPostureScoreCard from '../posture/components/OverallPostureScoreCard';
import { PostureMetricsRow } from '../posture/components/PostureMetricKpiCard';
import PeerComparisonPostureCard from '../posture/components/PeerComparisonPostureCard';
import AccessDetailsPostureCard from '../posture/components/AccessDetailsPostureCard';
import { POSTURE_COLORS } from '../posture/components/identityPostureTheme';
import { IDENTITY_POSTURE_PAGE_TITLE } from '../posture/identityPostureLabels';
import {
  fetchIdentityPosture,
  identityPostureQueryKey,
  IDENTITY_POSTURE_STALE_MS,
} from './identityCatalogQueries';

function formatLastUpdated(ts) {
  if (!ts) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return null;
  }
}

export default function IdentityPostureDashboard({
  identityId,
  identityName,
  showRefresh = true,
  fillPageBg = false,
  showPageHeader = false,
  onChangeIdentity,
}) {
  const queryClient = useQueryClient();

  const postureQuery = useQuery({
    queryKey: identityPostureQueryKey(identityId),
    queryFn: () => fetchIdentityPosture(identityId),
    enabled: Boolean(identityId),
    staleTime: IDENTITY_POSTURE_STALE_MS,
    gcTime: 15 * 60_000,
  });

  const posture = postureQuery.data ?? null;
  const loading = postureQuery.isLoading || (postureQuery.isFetching && !posture);
  const refreshing = postureQuery.isFetching && Boolean(posture);
  const error = postureQuery.error
    ? (postureQuery.error.response?.data?.message || postureQuery.error.message || 'Failed to load identity posture')
    : '';
  const lastUpdatedLabel = formatLastUpdated(postureQuery.dataUpdatedAt);
  const displayName =
    identityName ||
    posture?.profile?.displayName ||
    posture?.profile?.name ||
    '';

  const handleRefresh = useCallback(() => {
    if (!identityId) return;
    queryClient.invalidateQueries({ queryKey: identityPostureQueryKey(identityId) });
  }, [identityId, queryClient]);

  return (
    <Box
      sx={{
        width: '100%',
        position: 'relative',
        ...(fillPageBg
          ? { minHeight: '100%', bgcolor: POSTURE_COLORS.pageBg }
          : {}),
      }}
    >
      {showPageHeader ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            mb: 2.5,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
            {onChangeIdentity && (
              <Button
                startIcon={<ArrowBack />}
                onClick={onChangeIdentity}
                sx={{
                  textTransform: 'none',
                  color: 'text.secondary',
                  fontWeight: 600,
                  mt: 0.35,
                  flexShrink: 0,
                }}
              >
                Back
              </Button>
            )}
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  color: POSTURE_COLORS.blueDark,
                  fontSize: { xs: '1.25rem', md: '1.45rem' },
                  lineHeight: 1.2,
                }}
              >
                {IDENTITY_POSTURE_PAGE_TITLE}
              </Typography>
              {displayName && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, fontWeight: 500 }}>
                  {displayName}
                </Typography>
              )}
            </Box>
          </Box>

          {showRefresh && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
              {lastUpdatedLabel && (
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                  Last updated: {lastUpdatedLabel}
                </Typography>
              )}
              <Tooltip title="Refresh posture data">
                <span>
                  <IconButton
                    onClick={handleRefresh}
                    disabled={loading || refreshing || !identityId}
                    size="small"
                    sx={{
                      bgcolor: '#fff',
                      border: '1px solid #e8ecf1',
                      animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
                      '@keyframes spin': {
                        from: { transform: 'rotate(0deg)' },
                        to: { transform: 'rotate(360deg)' },
                      },
                    }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          )}
        </Box>
      ) : (
        showRefresh && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1, mb: 1.5 }}>
            {lastUpdatedLabel && (
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
                Last updated: {lastUpdatedLabel}
              </Typography>
            )}
            <Tooltip title="Refresh posture data">
              <span>
                <IconButton
                  onClick={handleRefresh}
                  disabled={loading || refreshing || !identityId}
                  size="small"
                  sx={{
                    bgcolor: '#fff',
                    border: '1px solid #e8ecf1',
                    animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
                    '@keyframes spin': {
                      from: { transform: 'rotate(0deg)' },
                      to: { transform: 'rotate(360deg)' },
                    },
                  }}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        )
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && posture?.meta?.ruleSetSource === 'default' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          System default posture rules are in use for this tenant. Save custom rules under Org admin → Global rule set →
          Identity posture rules, then refresh this page.
        </Alert>
      )}

      {!loading && posture && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Grid container spacing={2.5}>
            <Grid item xs={12} lg={5}>
              <IdentityProfilePostureCard
                profile={posture.profile}
                animateIndex={0}
                onPhotoUpdated={() => {
                  if (identityId) {
                    queryClient.invalidateQueries({ queryKey: identityPostureQueryKey(identityId) });
                  }
                }}
              />
            </Grid>
            <Grid item xs={12} lg={7}>
              <OverallPostureScoreCard
                healthAnalysis={posture.healthAnalysis}
                peerComparison={posture.peerComparison}
                overallRanking={posture.overallRanking}
                animateIndex={1}
              />
            </Grid>
          </Grid>

          <PostureMetricsRow
            healthAnalysis={posture.healthAnalysis}
            attributeChecks={posture.profile?.attributeChecks}
            sodAnalysis={posture.sodAnalysis}
            startIndex={2}
          />

          <Grid container spacing={2} alignItems="stretch">
            <Grid item xs={12} lg={8} sx={{ display: 'flex' }}>
              <AccessDetailsPostureCard accessDetails={posture.accessDetails} animateIndex={6} />
            </Grid>
            <Grid item xs={12} lg={4} sx={{ display: 'flex' }}>
              <PeerComparisonPostureCard peerComparison={posture.peerComparison} animateIndex={7} />
            </Grid>
          </Grid>
        </Box>
      )}
    </Box>
  );
}
