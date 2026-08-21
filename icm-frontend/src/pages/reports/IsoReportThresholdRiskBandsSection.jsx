import { Box } from '@mui/material';
import GovernanceRiskBandMetricCard, {
  classifyGovernanceRiskBand,
} from './GovernanceRiskBandMetricCard';
import {
  REPORT_METRIC_KEY_ACTIVE_USERS_SHARE,
  REPORT_METRIC_KEY_INACTIVE_USERS_SHARE,
  REPORT_METRIC_KEY_ORPHAN_UNCORRELATED_SHARE,
  REPORT_METRIC_KEY_PRIVILEGED_USERS_SHARE,
} from '../../services/api';

export { classifyGovernanceRiskBand };

/**
 * @param {{
 *   tenantId: string;
 *   applicationId: string;
 *   stats: { total: number; active: number; inactive: number };
 *   privilegedDisplay: { value: number; source: string };
 *   liveReportLoading: boolean;
 *   readOnly?: boolean;
 *   scope?: 'application' | 'tenant';
 * }} props
 */
export default function IsoReportThresholdRiskBandsSection({
  tenantId,
  applicationId,
  stats,
  privilegedDisplay,
  liveReportLoading,
  readOnly = false,
  scope = 'application',
}) {
  const total = Math.max(0, stats?.total ?? 0);
  const activePct = total > 0 ? (stats.active / total) * 100 : 0;
  const inactivePct = total > 0 ? (stats.inactive / total) * 100 : 0;
  const privValue = privilegedDisplay?.value ?? 0;
  const privPct = total > 0 ? Math.min(100, (privValue / total) * 100) : 0;
  const src = privilegedDisplay?.source ?? '—';

  return (
    <Box
      sx={{
        mt: 1,
        width: '100%',
        maxWidth: '100%',
        display: 'grid',
        /* Two wide cards per row (≈50% each minus gap); single column on phones */
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
        gap: { xs: 2.5, sm: 3, md: 3.5 },
        alignItems: 'stretch',
      }}
    >
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GovernanceRiskBandMetricCard
          tenantId={tenantId}
          applicationId={applicationId}
          metricKey={REPORT_METRIC_KEY_ORPHAN_UNCORRELATED_SHARE}
          title="Orphan uncorrelated — risk bands"
          paletteKey="orphan"
          readOnly={readOnly}
          scope={scope}
        />
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GovernanceRiskBandMetricCard
          tenantId={tenantId}
          applicationId={applicationId}
          metricKey={REPORT_METRIC_KEY_ACTIVE_USERS_SHARE}
          title="Active users — coverage bands"
          paletteKey="active_users"
          coverageSemantics
          tierBadgeLabels={{
            low: 'Lower coverage',
            medium: 'Moderate coverage',
            high: 'Strong coverage',
            critical: 'Peak coverage',
          }}
          externalLive={{
            pct: activePct,
            detailLine: `${(stats?.active ?? 0).toLocaleString()} active · ${total.toLocaleString()} users`,
            loading: liveReportLoading,
          }}
          readOnly={readOnly}
          scope={scope}
        />
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GovernanceRiskBandMetricCard
          tenantId={tenantId}
          applicationId={applicationId}
          metricKey={REPORT_METRIC_KEY_INACTIVE_USERS_SHARE}
          title="Inactive users — risk bands"
          paletteKey="inactive_users"
          externalLive={{
            pct: inactivePct,
            detailLine: `${(stats?.inactive ?? 0).toLocaleString()} inactive · ${total.toLocaleString()} users`,
            loading: liveReportLoading,
          }}
          readOnly={readOnly}
          scope={scope}
        />
      </Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <GovernanceRiskBandMetricCard
          tenantId={tenantId}
          applicationId={applicationId}
          metricKey={REPORT_METRIC_KEY_PRIVILEGED_USERS_SHARE}
          title="Privileged users — risk bands"
          paletteKey="privileged_users"
          externalLive={{
            pct: privPct,
            detailLine: `${privValue.toLocaleString()} privileged (${src}) · ${total.toLocaleString()} users`,
            loading: liveReportLoading,
          }}
          readOnly={readOnly}
          scope={scope}
        />
      </Box>
    </Box>
  );
}
