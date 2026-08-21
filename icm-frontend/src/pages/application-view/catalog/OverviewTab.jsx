import React, { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box, Grid, Typography, LinearProgress, Chip, Button,
} from '@mui/material';
import {
  PeopleAltOutlined,
  VpnKeyOutlined,
  AdminPanelSettingsOutlined,
  GavelOutlined,
  HealthAndSafetyOutlined,
  SyncOutlined,
  HubOutlined,
  PlayArrowOutlined,
  FactCheckOutlined,
  FileDownloadOutlined,
  VerifiedOutlined,
  CheckCircleOutline,
  ErrorOutline,
  InfoOutlined,
  ShieldOutlined,
  MonitorHeartOutlined,
  DonutLargeOutlined,
  ReportProblemOutlined,
  TimelineOutlined,
  HistoryOutlined,
  BoltOutlined,
} from '@mui/icons-material';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import {
  InsightLoading,
  InsightError,
  SeverityChip,
} from '../../identities/catalog/CatalogInsightPrimitives';
import { CATALOG } from '../../identities/catalog/catalogTheme';
import { applicationViewPath, APP_VIEW_TAB_IDS } from './applicationViewTabs';
import {
  deriveHealth,
  healthLabel,
  relativeTime,
  formatConnector,
  formatSharePct,
  buildTrendSeries,
  DASH,
} from './applicationHealthUtils';
import {
  fetchApplicationViewCertifications,
  applicationViewCertificationsQueryKey,
  APP_VIEW_INSIGHT_STALE_MS,
} from './applicationViewQueries';
import {
  SectionHeading,
  Card,
  StatColumn,
  ActionCard,
  HealthGauge,
  TrendAreaChart,
} from './ApplicationViewPrimitives';

const PIE_ACCESS = ['#2563EB', '#F59E0B', '#8B5CF6', '#94A3B8'];
const PIE_RISK = ['#DC2626', '#EA580C', '#F59E0B', '#22C55E'];

function DimensionBar({ label, value, color }) {
  return (
    <Box sx={{ mb: 1.15 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 650, color: CATALOG.ink }}>{label}</Typography>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: CATALOG.inkMuted }}>{value}%</Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{
          height: 7,
          borderRadius: 99,
          bgcolor: '#F1F5F9',
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 99 },
        }}
      />
    </Box>
  );
}

export default function OverviewTab({
  application,
  summary,
  summaryLoading,
  summaryError,
  onRetrySummary,
}) {
  const appId = application?._id || application?.id;
  const scores = useMemo(
    () => deriveHealth(summary) || {
      health: 0,
      risk: 0,
      security: 0,
      correlation: 0,
      hygiene: 0,
      compliance: 0,
      correlationRate: 0,
    },
    [summary],
  );
  const healthTone = healthLabel(summary ? scores.health : null);

  const certQuery = useQuery({
    queryKey: applicationViewCertificationsQueryKey(appId),
    queryFn: () => fetchApplicationViewCertifications(appId),
    enabled: Boolean(appId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
  const certSummary = certQuery.data?.summary || {};
  const certTotal = Number(certSummary.total) || 0;
  const certApproved = Number(certSummary.approved ?? certSummary.completed) || 0;
  const certPending = Number(certSummary.pending) || 0;
  const certRevoked = Number(certSummary.revoked) || 0;
  const certInProgress = Number(certSummary.inProgress) || 0;
  const certApprovalRate = certTotal ? Math.round((certApproved / certTotal) * 100) : 0;
  const certDeepLink = certQuery.data?.deepLink || '/governance/certifications/access';

  const corrTrend = useMemo(
    () => buildTrendSeries(scores.correlationRate, { rising: true, variance: 0.06 }),
    [scores.correlationRate],
  );
  const sodTrend = useMemo(
    () => buildTrendSeries(Number(summary?.openSodViolations) || 0, {
      rising: false,
      variance: 0.2,
      integer: true,
    }),
    [summary?.openSodViolations],
  );
  const sodYMax = useMemo(() => {
    const peak = Math.max(0, ...sodTrend.map((d) => Number(d.value) || 0));
    return Math.max(20, Math.ceil(peak / 10) * 10 + 10);
  }, [sodTrend]);

  if (summaryLoading && !summary) return <InsightLoading rows={8} />;
  if (summaryError && !summary) {
    return (
      <InsightError
        message={summaryError?.message || 'Failed to load application health overview.'}
        onRetry={onRetrySummary}
      />
    );
  }

  const users = Number(summary?.users ?? application?.totalUsers) || 0;
  const privUsers = Number(summary?.privilegedUsers) || 0;
  const inactiveUsers = Number(summary?.inactiveUsers ?? summary?.disabledUsers) || 0;
  const serviceAccountsTracked = Boolean(summary?.serviceAccountsTracked);
  const serviceAccounts = serviceAccountsTracked ? Number(summary?.serviceAccounts) || 0 : 0;
  const normalUsers = Math.max(0, users - privUsers - serviceAccounts - inactiveUsers);
  const ents = Number(summary?.entitlements) || 0;
  const privEnts = Number(summary?.privilegedEntitlements) || 0;
  const entitlementsByType = Array.isArray(summary?.entitlementsByType) ? summary.entitlementsByType : [];
  const sodOpen = Number(summary?.openSodViolations) || 0;
  const orphans = Number(summary?.openOrphans ?? summary?.hygieneOpen) || 0;
  const correlated = Number(summary?.correlatedLinks) || 0;
  const duplicates = Number(summary?.duplicateAccounts) || 0;
  const stale = Number(summary?.staleAccounts) || 0;
  const staleDays = Number(summary?.staleDays) || 90;
  const exceptions = Number(summary?.policyExceptions) || 0;
  const sodBySeverity = summary?.sodBySeverity || {};
  const critical = sodBySeverity.CRITICAL || 0;
  const high = sodBySeverity.HIGH || 0;
  const medium = sodBySeverity.MEDIUM || 0;
  const low = sodBySeverity.LOW || 0;
  const totalRisks = critical + high + medium + low || sodOpen;
  const highRiskAccounts = Number(
    summary?.highRiskAccounts != null
      ? summary.highRiskAccounts
      : (summary?.privilegedEntitlementHolders ?? privUsers),
  ) || 0;
  const criticalPerms = Number(summary?.criticalPermissions ?? privEnts) || 0;
  const topPolicies = summary?.topSodPolicies || [];
  const topPrivEnts = summary?.topPrivilegedEntitlements || [];
  const lastSync = summary?.lastSyncedAt || application?.lastSyncedAt || application?.updatedAt;
  const connectorHealthy = String(application?.status || summary?.status || '').toLowerCase() === 'active';

  const accessPie = [
    { name: 'Normal Users', value: normalUsers, color: PIE_ACCESS[0] },
    { name: 'Privileged Users', value: privUsers, color: PIE_ACCESS[1] },
    { name: 'Service Accounts', value: serviceAccounts, color: PIE_ACCESS[2] },
    { name: 'Inactive Accounts', value: inactiveUsers, color: PIE_ACCESS[3] },
  ].filter((d) => d.value > 0);

  const riskPie = [
    { name: 'Critical', value: critical, color: PIE_RISK[0] },
    { name: 'High', value: high, color: PIE_RISK[1] },
    { name: 'Medium', value: medium, color: PIE_RISK[2] },
    { name: 'Low', value: low || (totalRisks === 0 ? 1 : 0), color: PIE_RISK[3] },
  ].filter((d) => d.value > 0);

  const activity = [
    {
      icon: <CheckCircleOutline sx={{ fontSize: 18, color: '#059669' }} />,
      title: 'Application correlation completed successfully',
      time: relativeTime(lastSync),
    },
    {
      icon: <SyncOutlined sx={{ fontSize: 18, color: '#2563EB' }} />,
      title: 'Connector sync finished',
      time: relativeTime(lastSync),
    },
    {
      icon: <GavelOutlined sx={{ fontSize: 18, color: '#EA580C' }} />,
      title: sodOpen
        ? `${sodOpen.toLocaleString()} open SoD violations require review`
        : 'No open SoD violations',
      time: 'Today',
    },
    {
      icon: orphans
        ? <ErrorOutline sx={{ fontSize: 18, color: '#DC2626' }} />
        : <InfoOutlined sx={{ fontSize: 18, color: '#64748B' }} />,
      title: orphans
        ? `${orphans.toLocaleString()} orphan accounts detected`
        : 'No orphan accounts open',
      time: 'Today',
    },
  ];

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {/* Category metrics — Identity (accounts) then Access (entitlements) */}
      <Box>
        <SectionHeading eyebrow="Overview" title="Identity & Access Summary" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} sm={6} lg={3}>
            <StatColumn
              title="Identity"
              icon={<PeopleAltOutlined sx={{ fontSize: 17 }} />}
              accent="#2563EB"
              rows={[
                { label: 'Total Users', value: users },
                { label: 'Privileged Users', value: privUsers, tone: '#D97706' },
                ...(serviceAccountsTracked ? [{ label: 'Service Accounts', value: serviceAccounts }] : []),
                { label: 'Inactive Accounts', value: inactiveUsers, tone: inactiveUsers ? '#64748B' : undefined },
              ]}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <StatColumn
              title="Access"
              icon={<VpnKeyOutlined sx={{ fontSize: 17 }} />}
              accent="#7C3AED"
              rows={[
                { label: 'Entitlements', value: ents },
                ...(entitlementsByType.length
                  ? entitlementsByType.slice(0, 2).map((t) => ({ label: t.type, value: t.count }))
                  : [{ label: 'Entitlement Types', value: 'Not tracked' }]),
                { label: 'Privileged Entitlements', value: privEnts, tone: '#DC2626' },
              ]}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <StatColumn
              title="Security"
              icon={<ShieldOutlined sx={{ fontSize: 17 }} />}
              accent="#DC2626"
              rows={[
                { label: 'SoD Violations', value: sodOpen, tone: sodOpen ? '#DC2626' : undefined },
                { label: 'High Risk Accounts', value: highRiskAccounts, tone: highRiskAccounts ? '#EA580C' : undefined },
                { label: 'Critical Permissions', value: criticalPerms, tone: criticalPerms ? '#DC2626' : undefined },
                { label: 'Policy Exceptions', value: exceptions },
              ]}
            />
          </Grid>
          <Grid item xs={12} sm={6} lg={3}>
            <StatColumn
              title="Data Quality"
              icon={<HealthAndSafetyOutlined sx={{ fontSize: 17 }} />}
              accent="#059669"
              rows={[
                { label: 'Correlated Users', value: correlated, tone: '#059669' },
                { label: 'Orphan Accounts', value: orphans, tone: orphans ? '#DC2626' : undefined },
                { label: 'Duplicate Accounts', value: duplicates, tone: duplicates ? '#D97706' : undefined },
                {
                  label: `Stale Accounts (${staleDays}d)`,
                  value: stale,
                  tone: stale ? '#64748B' : undefined,
                },
              ]}
            />
          </Grid>
        </Grid>
      </Box>

      {/* Health, distribution & correlation triad */}
      <Box>
        <SectionHeading eyebrow="Signals" title="Health, Access Distribution & Correlation" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} md={4}>
            <Card title="Application Health" icon={<MonitorHeartOutlined sx={{ fontSize: 16 }} />} iconColor={healthTone.color}>
              <HealthGauge score={scores.health} label={healthTone.label} color={healthTone.color} />
              <Box sx={{ mt: 2 }}>
                <DimensionBar label="Security" value={scores.security} color="#2563EB" />
                <DimensionBar label="Correlation" value={scores.correlation} color="#0EA5E9" />
                <DimensionBar label="Data Quality" value={scores.hygiene} color="#10B981" />
                <DimensionBar label="Compliance" value={scores.compliance} color="#8B5CF6" />
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card title="Access Distribution" icon={<DonutLargeOutlined sx={{ fontSize: 16 }} />} iconColor="#7C3AED">
              {accessPie.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No access data yet.</Typography>
              ) : (
                <>
                  <Box sx={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={accessPie}
                          dataKey="value"
                          innerRadius={44}
                          outerRadius={64}
                          paddingAngle={2}
                          minAngle={3}
                        >
                          {accessPie.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v, n) => [
                            `${Number(v).toLocaleString()} (${formatSharePct(v, users)})`,
                            n,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                  <Box sx={{ display: 'grid', gap: 0.75, mt: 0.75 }}>
                    {accessPie.map((d) => (
                      <Box key={d.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.color, flexShrink: 0 }} />
                          <Typography sx={{ fontSize: '0.75rem', color: CATALOG.inkMuted }} noWrap>{d.name}</Typography>
                        </Box>
                        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: CATALOG.ink, whiteSpace: 'nowrap' }}>
                          {Number(d.value).toLocaleString()}
                          <Box component="span" sx={{ color: CATALOG.inkFaint, fontWeight: 600, ml: 0.75 }}>
                            ({formatSharePct(d.value, users)})
                          </Box>
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </Card>
          </Grid>

          <Grid item xs={12} md={4}>
            <Card
              title="Certification Status"
              icon={<VerifiedOutlined sx={{ fontSize: 16 }} />}
              iconColor="#16A34A"
              action={(
                <Button
                  component={RouterLink}
                  to={certDeepLink}
                  size="small"
                  sx={{ textTransform: 'none', fontWeight: 650, fontSize: '0.72rem' }}
                >
                  View all
                </Button>
              )}
            >
              {certQuery.isLoading ? (
                <Typography variant="body2" color="text.secondary">Loading certification status…</Typography>
              ) : certTotal === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No certification campaigns cover this application yet.
                </Typography>
              ) : (
                <>
                  <Typography sx={{ fontWeight: 800, fontSize: '2rem', color: '#16A34A', lineHeight: 1.1 }}>
                    {certTotal.toLocaleString()}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 650, color: CATALOG.inkMuted, mb: 1.5 }}>
                    Total certification items · enterprise-wide review
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 650, color: CATALOG.ink }}>
                      Approval Rate
                    </Typography>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: CATALOG.inkMuted }}>
                      {certApprovalRate}%
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={certApprovalRate}
                    sx={{
                      height: 8,
                      borderRadius: 99,
                      mb: 1.75,
                      bgcolor: '#F1F5F9',
                      '& .MuiLinearProgress-bar': { borderRadius: 99, bgcolor: '#16A34A' },
                    }}
                  />
                  <Grid container spacing={1}>
                    {[
                      { label: 'Approved', value: certApproved, color: '#059669' },
                      { label: 'Pending', value: certPending, color: '#2563EB' },
                      { label: 'Revoked', value: certRevoked, color: '#DC2626' },
                      { label: 'In Progress', value: certInProgress, color: '#D97706' },
                    ].map((c) => (
                      <Grid item xs={6} key={c.label}>
                        <Box
                          sx={{
                            p: 1,
                            borderRadius: 1.5,
                            bgcolor: `${c.color}12`,
                            border: `1px solid ${c.color}22`,
                          }}
                        >
                          <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: c.color, textTransform: 'uppercase' }}>
                            {c.label}
                          </Typography>
                          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: CATALOG.ink }}>
                            {Number(c.value).toLocaleString()}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                </>
              )}
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Top risk items — full-width tables get room to breathe */}
      <Box>
        <SectionHeading eyebrow="Risk" title="Top Risk Items" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} lg={6}>
            <Card
              title="Top Privileged Entitlements"
              icon={<AdminPanelSettingsOutlined sx={{ fontSize: 16 }} />}
              iconColor="#D97706"
              action={(
                <Button
                  component={RouterLink}
                  to={applicationViewPath(appId, APP_VIEW_TAB_IDS.ENTITLEMENTS)}
                  size="small"
                  sx={{ textTransform: 'none', fontWeight: 650, fontSize: '0.72rem' }}
                >
                  View all
                </Button>
              )}
            >
              {topPrivEnts.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No privileged entitlements flagged.</Typography>
              ) : (
                <Box sx={{ display: 'grid', gap: 0.85 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1.4fr 0.7fr 0.6fr', gap: 0.5, px: 0.25 }}>
                    {['Entitlement', 'Users', 'Risk'].map((h) => (
                      <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: CATALOG.inkFaint, textTransform: 'uppercase' }}>
                        {h}
                      </Typography>
                    ))}
                  </Box>
                  {topPrivEnts.slice(0, 5).map((e) => (
                    <Box
                      key={String(e._id || e.name)}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 0.7fr 0.6fr',
                        gap: 0.5,
                        alignItems: 'center',
                        px: 1,
                        py: 0.85,
                        borderRadius: 1.25,
                        bgcolor: '#FAFBFC',
                        border: `1px solid ${CATALOG.border}`,
                        transition: 'border-color 0.15s ease',
                        '&:hover': { borderColor: CATALOG.borderStrong },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }} noWrap>
                        {e.name}
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 650, color: CATALOG.inkMuted }}>
                        {Number(e.assignedUsers || 0).toLocaleString()}
                      </Typography>
                      <SeverityChip severity={e.risk || 'HIGH'} />
                    </Box>
                  ))}
                </Box>
              )}
            </Card>
          </Grid>

          <Grid item xs={12} lg={6}>
            <Card
              title="Top SoD Violations"
              icon={<GavelOutlined sx={{ fontSize: 16 }} />}
              iconColor="#DC2626"
              action={(
                <Button
                  component={RouterLink}
                  to={applicationViewPath(appId, APP_VIEW_TAB_IDS.SOD)}
                  size="small"
                  sx={{ textTransform: 'none', fontWeight: 650, fontSize: '0.72rem' }}
                >
                  Review
                </Button>
              )}
            >
              {topPolicies.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No open SoD violations.</Typography>
              ) : (
                <Box sx={{ display: 'grid', gap: 0.85 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr', gap: 0.5, px: 0.25 }}>
                    {['Policy', 'Users', 'Severity'].map((h) => (
                      <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: CATALOG.inkFaint, textTransform: 'uppercase' }}>
                        {h}
                      </Typography>
                    ))}
                  </Box>
                  {topPolicies.slice(0, 5).map((p) => (
                    <Box
                      key={String(p._id)}
                      component={RouterLink}
                      to={p.deepLink || applicationViewPath(appId, APP_VIEW_TAB_IDS.SOD)}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: '1.5fr 0.6fr 0.6fr',
                        gap: 0.5,
                        alignItems: 'center',
                        px: 1,
                        py: 0.85,
                        borderRadius: 1.25,
                        bgcolor: '#FAFBFC',
                        border: `1px solid ${CATALOG.border}`,
                        textDecoration: 'none',
                        color: 'inherit',
                        '&:hover': { borderColor: CATALOG.accent },
                      }}
                    >
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: CATALOG.ink }} noWrap>
                        {p.name}
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 650, color: CATALOG.inkMuted }}>
                        {Number(p.openViolations || 0).toLocaleString()}
                      </Typography>
                      <SeverityChip severity={p.severity || 'MEDIUM'} />
                    </Box>
                  ))}
                </Box>
              )}
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Lower ops row */}
      <Box>
        <SectionHeading eyebrow="Operations" title="Risk & Connector Health" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} md={6}>
            <Card title="Risk Summary" icon={<ReportProblemOutlined sx={{ fontSize: 16 }} />} iconColor="#EA580C">
              <Box sx={{ position: 'relative', height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={riskPie} dataKey="value" innerRadius={46} outerRadius={64} paddingAngle={2}>
                      {riskPie.map((d) => (
                        <Cell key={d.name} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <Box
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  <Typography sx={{ fontWeight: 800, fontSize: '1.35rem', color: CATALOG.ink, lineHeight: 1 }}>
                    {totalRisks}
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 650, color: CATALOG.inkFaint }}>
                    Total Risks
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center', mt: 0.75 }}>
                {riskPie.map((d) => (
                  <Chip
                    key={d.name}
                    size="small"
                    label={`${d.name} ${d.value}`}
                    sx={{
                      height: 22,
                      fontWeight: 700,
                      fontSize: '0.65rem',
                      bgcolor: `${d.color}14`,
                      color: d.color,
                    }}
                  />
                ))}
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card title="Connector Status" icon={<HubOutlined sx={{ fontSize: 16 }} />} iconColor="#2563EB">
              <Box sx={{ display: 'grid', gap: 1.25 }}>
                {[
                  { label: 'Status', value: connectorHealthy ? 'Healthy' : toDisplayStatus(application?.status), tone: connectorHealthy ? '#059669' : undefined },
                  { label: 'Last Sync', value: relativeTime(lastSync) },
                  { label: 'Connector', value: formatConnector(summary?.connectorType || application?.connectorType) },
                  { label: 'Accounts', value: users.toLocaleString() },
                  { label: 'Entitlements', value: ents.toLocaleString() },
                  { label: 'Sync Success', value: connectorHealthy ? '100%' : '—' },
                ].map((row, idx, arr) => (
                  <Box
                    key={row.label}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                      pb: idx < arr.length - 1 ? 1.15 : 0,
                      borderBottom: idx < arr.length - 1 ? `1px solid ${CATALOG.border}` : 'none',
                    }}
                  >
                    <Typography sx={{ fontSize: '0.78rem', color: CATALOG.inkMuted }}>{row.label}</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 750, color: row.tone || CATALOG.ink, textAlign: 'right' }}>
                      {row.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Trend charts */}
      <Box>
        <SectionHeading eyebrow="Trends" title="30-Day Trend Analysis" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} md={6}>
            <Card
              title="Correlation Trend"
              icon={<TimelineOutlined sx={{ fontSize: 16 }} />}
              iconColor="#3B82F6"
              action={(
                <Chip
                  size="small"
                  label={`${scores.correlationRate}% current`}
                  sx={{ height: 22, fontWeight: 700, fontSize: '0.65rem', bgcolor: 'rgba(59,130,246,0.1)', color: '#3B82F6' }}
                />
              )}
            >
              <TrendAreaChart
                data={corrTrend}
                color="#3B82F6"
                yDomain={[0, 100]}
                yTickFormatter={(v) => `${v}%`}
                tooltipFormatter={(v) => [`${v}%`, 'Correlation']}
              />
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card
              title="SoD Violations Trend"
              icon={<TimelineOutlined sx={{ fontSize: 16 }} />}
              iconColor="#EF4444"
              action={(
                <Chip
                  size="small"
                  label={`${sodOpen.toLocaleString()} open`}
                  sx={{ height: 22, fontWeight: 700, fontSize: '0.65rem', bgcolor: 'rgba(239,68,68,0.1)', color: '#EF4444' }}
                />
              )}
            >
              <TrendAreaChart
                data={sodTrend}
                color="#EF4444"
                yDomain={[0, sodYMax]}
                yTickFormatter={(v) => `${Math.round(Number(v) || 0)}`}
                tooltipFormatter={(v) => [Math.round(Number(v) || 0).toLocaleString(), 'Open violations']}
              />
            </Card>
          </Grid>
        </Grid>
      </Box>

      {/* Activity + Actions */}
      <Box>
        <SectionHeading eyebrow="Next Steps" title="Recent Activity & Recommended Actions" />
        <Grid container spacing={1.75}>
          <Grid item xs={12} md={5}>
            <Card title="Recent Activity" icon={<HistoryOutlined sx={{ fontSize: 16 }} />} iconColor="#64748B">
              <Box sx={{ display: 'grid', gap: 0 }}>
                {activity.map((a, idx) => (
                  <Box
                    key={a.title}
                    sx={{
                      display: 'flex',
                      gap: 1.25,
                      py: 1.25,
                      borderBottom: idx < activity.length - 1 ? `1px solid ${CATALOG.border}` : 'none',
                    }}
                  >
                    <Box sx={{ mt: 0.15 }}>{a.icon}</Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.82rem', fontWeight: 650, color: CATALOG.ink }}>
                        {a.title}
                      </Typography>
                      <Typography sx={{ fontSize: '0.7rem', color: CATALOG.inkFaint, mt: 0.2 }}>
                        {a.time}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Card>
          </Grid>

          <Grid item xs={12} md={7}>
            <Box sx={{ mb: 1.1, display: 'flex', alignItems: 'center', gap: 0.75, px: 0.25 }}>
              <BoltOutlined sx={{ fontSize: 17, color: CATALOG.accent }} />
              <Typography sx={{ fontWeight: 750, fontSize: '0.9rem', color: CATALOG.ink }}>
                Recommended Actions
              </Typography>
            </Box>
            <Grid container spacing={1.25}>
              <Grid item xs={12} sm={6} lg={4}>
                <ActionCard
                  to={applicationViewPath(appId, APP_VIEW_TAB_IDS.CORRELATION)}
                  icon={<PlayArrowOutlined />}
                  color="#2563EB"
                  title="Run Correlation"
                  body="Re-run correlation to update linked accounts"
                  cta="Run Now"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={4}>
                <ActionCard
                  to={applicationViewPath(appId, APP_VIEW_TAB_IDS.HYGIENE)}
                  icon={<HealthAndSafetyOutlined />}
                  color="#059669"
                  title="Data Hygiene"
                  body="Review orphans, duplicates, and correlation quality"
                  cta="Review"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={4}>
                <ActionCard
                  to={applicationViewPath(appId, APP_VIEW_TAB_IDS.SOD)}
                  icon={<FactCheckOutlined />}
                  color="#DC2626"
                  title="Review SoD Violations"
                  body={`${sodOpen.toLocaleString()} active violations need attention`}
                  cta="Review"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={4}>
                <ActionCard
                  to="/governance/certifications/access"
                  icon={<VerifiedOutlined />}
                  color="#16A34A"
                  title="Launch Certification"
                  body="Start access certification campaign"
                  cta="Launch"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={4}>
                <ActionCard
                  to={`/applications/${appId}`}
                  icon={<FileDownloadOutlined />}
                  color="#EA580C"
                  title="Export Report"
                  body="Download application access report"
                  cta="Export"
                />
              </Grid>
            </Grid>
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
}

function toDisplayStatus(status) {
  if (!status) return 'Unknown';
  return String(status).charAt(0).toUpperCase() + String(status).slice(1).toLowerCase();
}
