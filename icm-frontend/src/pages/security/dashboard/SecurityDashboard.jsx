import { useMemo, useState } from "react";
import { Grid, Typography, Paper, Box, Alert, Skeleton, Button, Stack, Chip } from "@mui/material";
import TuneIcon from "@mui/icons-material/Tune";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import GppBadIcon from "@mui/icons-material/GppBad";
import GroupsIcon from "@mui/icons-material/Groups";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import SecurityIcon from "@mui/icons-material/Security";
import ComputerIcon from "@mui/icons-material/Computer";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import PersonOffIcon from "@mui/icons-material/PersonOff";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import SecurityMetricCard from "../../../components/security/SecurityMetricCard";
import ScanStatusBadge from "../../../components/security/ScanStatusBadge";
import FindingsTable from "../../../components/security/FindingsTable";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import AssessmentComparePanel from "../../../components/security/AssessmentComparePanel";
import PrivilegeExposurePanel from "../../../components/security/PrivilegeExposurePanel";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import SecurityReportPanel from "../../../components/security/SecurityReportPanel";
import AdaptDashboardTilesDialog from "../../../components/security/AdaptDashboardTilesDialog";
import { securityPageHeaderSx, SEVERITY_COLORS } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
import { preferenceAPI } from "../../../services/api";
import { featureLabel } from "../securityFeatureMeta";
import {
  isSecurityTileVisible,
  normalizeSecurityDashboardPrefs,
} from "../../../utils/securityDashboardTiles";

const PIE_COLORS = ["#b71c1c", "#e65100", "#f9a825", "#2e7d32", "#757575"];

export default function SecurityDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [adaptOpen, setAdaptOpen] = useState(false);
  const {
    applicationId,
    overview,
    overviewLoading,
    overviewError,
    scanId,
    refreshWorkspace,
    buildPath,
  } = useSecurityWorkspace();

  const go = (path, extras = {}) => navigate(buildPath(path, extras));

  const prefsQuery = useQuery({
    queryKey: ["preferences"],
    queryFn: async () => {
      const res = await preferenceAPI.get();
      return res.data?.data ?? res.data;
    },
    staleTime: 60_000,
  });

  const tilePrefs = useMemo(
    () => normalizeSecurityDashboardPrefs(prefsQuery.data?.securityDashboard || {}),
    [prefsQuery.data?.securityDashboard],
  );

  const savePrefsMutation = useMutation({
    mutationFn: (securityDashboard) => preferenceAPI.update({ securityDashboard }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
      setAdaptOpen(false);
    },
  });

  const topFindingsQuery = useQuery({
    queryKey: ["security", "top-findings", applicationId, scanId],
    queryFn: async () => {
      const res = await securityAPI.getFindings(applicationId, {
        page: 1,
        limit: 8,
        scanId: scanId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const totals = overview?.totals || {};
  const group = overview?.groupSummary || {};
  const priv = overview?.privilegedSummary || {};
  const acl = overview?.aclSummary || {};
  const computer = overview?.computerSummary || {};
  const kerberos = overview?.kerberosSummary || {};
  const delegation = overview?.delegationSummary || {};
  const user = overview?.userSummary || {};
  const scan = overview?.scan;

  const disabledUsersTrendLabel = useMemo(() => {
    const trend = user.disabledUsersTrend;
    if (trend == null || trend === 0) return "No change since last scan";
    if (trend > 0) return `+${trend} since last scan`;
    return `${trend} since last scan`;
  }, [user.disabledUsersTrend]);

  const disabledUsersDiagnostic = useMemo(
    () => (scan?.diagnostics || []).find((d) => d.featureKey === "disabled_users"),
    [scan?.diagnostics],
  );

  const pieData = useMemo(
    () =>
      [
        { name: "Critical", value: totals.critical || 0 },
        { name: "High", value: totals.high || 0 },
        { name: "Medium", value: totals.medium || 0 },
        { name: "Low", value: totals.low || 0 },
        { name: "Not defined", value: totals.notDefined || 0 },
      ].filter((d) => d.value > 0),
    [totals],
  );

  const topExposures = useMemo(() => {
    const byFeature = overview?.byFeature || {};
    return Object.entries(byFeature)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [overview?.byFeature]);

  const trends = overview?.trends || {};
  const comparison = overview?.comparison;

  const scanFreshness = scan?.completedAt
    ? (Date.now() - Date.parse(scan.completedAt)) / 86400000
    : null;
  const isStale = scanFreshness != null && scanFreshness > 7;

  const show = (id, value = 1) => isSecurityTileVisible(tilePrefs, id, value);

  const metricTiles = useMemo(
    () => [
      {
        id: "total_risks",
        title: "Total risks",
        value: totals.findings,
        icon: <WarningAmberIcon />,
        onClick: () => go("/security/findings"),
      },
      {
        id: "disabled_users",
        title: "Disabled users",
        value: user.disabledUsers,
        subtitle: disabledUsersTrendLabel,
        icon: <PersonOffIcon />,
        onClick: () => go("/security/findings", { feature: "disabled_users" }),
      },
      {
        id: "critical",
        title: "Critical",
        value: totals.critical,
        accentColor: SEVERITY_COLORS.critical.main,
        icon: <GppBadIcon />,
        onClick: () => go("/security/findings"),
      },
      {
        id: "toxic_combinations",
        title: "Toxic combinations",
        value: priv.toxicCombinations,
        onClick: () => go("/security/groups", { feature: "toxic_privilege_combinations" }),
      },
      {
        id: "dormant_privileged",
        title: "Dormant privileged",
        value: priv.dormantPrivileged,
        onClick: () => go("/security/privileged", { feature: "dormant_privileged_users" }),
      },
      {
        id: "empty_groups",
        title: "Empty groups",
        value: group.emptyGroups,
        icon: <GroupsIcon />,
        onClick: () => go("/security/groups", { feature: "empty_groups" }),
      },
      {
        id: "orphan_groups",
        title: "Orphan groups",
        value: group.orphanGroups,
        onClick: () => go("/security/groups", { feature: "orphan_groups" }),
      },
      {
        id: "escalation_paths",
        title: "Escalation paths",
        value: priv.escalationPaths,
        icon: <AdminPanelSettingsIcon />,
        onClick: () => go("/security/privileged", { feature: "privilege_escalation_paths" }),
      },
      {
        id: "shadow_admins",
        title: "Shadow admins",
        value: acl.shadowAdmins,
        icon: <SecurityIcon />,
        onClick: () => go("/security/acl", { feature: "shadow_admins" }),
      },
      {
        id: "unknown_sid_bindings",
        title: "Unknown SID bindings",
        value: acl.unknownSidBindings,
        onClick: () => go("/security/acl", { feature: "unknown_sid_bindings" }),
      },
      {
        id: "broken_acls",
        title: "Broken ACLs",
        value: acl.brokenAcls,
        onClick: () => go("/security/acl", { feature: "broken_acls" }),
      },
      {
        id: "sid_history_risks",
        title: "SID history risks",
        value: acl.sidHistoryAnalysis,
        onClick: () => go("/security/acl", { feature: "sid_history_analysis" }),
      },
      {
        id: "foreign_principals",
        title: "Foreign principals",
        value: acl.foreignSecurityPrincipals,
        onClick: () => go("/security/acl", { feature: "foreign_security_principals" }),
      },
      {
        id: "inactive_computers",
        title: "Inactive computers",
        value: computer.inactiveComputers,
        icon: <ComputerIcon />,
        onClick: () => go("/security/computer", { feature: "inactive_computers" }),
      },
      {
        id: "unsupported_os",
        title: "Unsupported OS",
        value: computer.unsupportedOsVersions,
        onClick: () => go("/security/computer", { feature: "unsupported_os_versions" }),
      },
      {
        id: "duplicate_spns",
        title: "Duplicate SPNs",
        value: computer.duplicateSpns,
        onClick: () => go("/security/computer", { feature: "duplicate_spns" }),
      },
      {
        id: "kerberoastable",
        title: "Kerberoastable",
        value: kerberos.kerberoastableAccounts,
        icon: <VpnKeyIcon />,
        onClick: () => go("/security/kerberos", { feature: "kerberoastable_accounts" }),
      },
      {
        id: "asrep_roastable",
        title: "AS-REP roastable",
        value: kerberos.asrepRoastableUsers,
        onClick: () => go("/security/kerberos", { feature: "asrep_roastable_users" }),
      },
      {
        id: "unconstrained_delegation",
        title: "Unconstrained deleg.",
        value: delegation.unconstrainedDelegation,
        icon: <SwapHorizIcon />,
        onClick: () => go("/security/delegation", { feature: "unconstrained_delegation" }),
      },
      {
        id: "rbcd_exposure",
        title: "RBCD exposure",
        value: delegation.rbcd,
        onClick: () => go("/security/delegation", { feature: "rbcd" }),
      },
    ],
    // tile values refresh with overview; navigate helpers intentionally omitted from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totals, user, priv, group, acl, computer, kerberos, delegation, disabledUsersTrendLabel],
  );

  const visibleMetrics = metricTiles.filter((t) => show(t.id, t.value ?? 0));

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Box>
          <Typography variant="h5" fontWeight={800}>
            Security Posture Dashboard
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Assessment summary, privilege exposure, and trends from evidence
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            size="small"
            variant="outlined"
            startIcon={<TuneIcon />}
            onClick={() => setAdaptOpen(true)}
            sx={{ textTransform: "none" }}
          >
            Adapt tiles
          </Button>
          <SecurityExportMenu applicationId={applicationId} scanId={scanId} />
          {scan && <ScanStatusBadge status={isStale ? "stale" : scan.status} />}
        </Stack>
      </Box>

      <SecurityApplicationBar />

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description="Choose an application to view security posture metrics and findings. Run an assessment from Scan Center when ready."
          actionLabel="Open Scan Center"
          onAction={() => navigate("/security/scans")}
        />
      )}

      {overviewError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => refreshWorkspace()}>
              Retry
            </Button>
          }
        >
          {overviewError?.response?.data?.message ||
            overviewError.message ||
            "Failed to load security overview."}
        </Alert>
      )}

      {applicationId && (
        <>
          <AssessmentContextBar
            actions={
              <Button
                size="small"
                variant="outlined"
                onClick={() => go("/security/scans")}
                sx={{ textTransform: "none" }}
              >
                Run assessment
              </Button>
            }
          />

          <PrivilegeExposurePanel loading={overviewLoading} tilePrefs={tilePrefs} />

          {!scan && !overviewLoading && (
            <Alert
              severity="info"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => go("/security/scans")}>
                  Scan Center
                </Button>
              }
            >
              No assessments yet. Run an assessment from Scan Center to generate findings.
            </Alert>
          )}

          {comparison && show("comparison") && (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={4}>
                <SecurityMetricCard
                  title="Resolved since prior"
                  value={comparison.resolved}
                  subtitle="Absent in current assessment"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <SecurityMetricCard
                  title="New findings"
                  value={comparison.new}
                  subtitle="Appeared in current assessment"
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <SecurityMetricCard
                  title="Unchanged"
                  value={comparison.unchanged}
                  subtitle="Present in both assessments"
                />
              </Grid>
            </Grid>
          )}

          {visibleMetrics.length > 0 && (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {visibleMetrics.map((tile) => (
                <Grid item xs={6} sm={4} md={3} lg={2} key={tile.id}>
                  <SecurityMetricCard
                    title={tile.title}
                    value={tile.value}
                    subtitle={tile.subtitle}
                    loading={overviewLoading}
                    icon={tile.icon}
                    accentColor={tile.accentColor}
                    onClick={tile.onClick}
                  />
                </Grid>
              ))}
            </Grid>
          )}

          {visibleMetrics.length === 0 && !overviewLoading && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => setAdaptOpen(true)}>
                  Adapt tiles
                </Button>
              }
            >
              All metric tiles are hidden by your preferences or the zero-filter. Adjust Adapt tiles to
              show metrics again.
            </Alert>
          )}

          <Grid container spacing={2}>
            {show("severity_pie") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 280, border: 1, borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Risk severity distribution
                  </Typography>
                  {overviewLoading ? (
                    <Skeleton variant="circular" width={160} height={160} sx={{ mx: "auto" }} />
                  ) : pieData.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 4, textAlign: "center" }}>
                      No findings in latest scan
                    </Typography>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72}>
                          {pieData.map((_, i) => (
                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Paper>
              </Grid>
            )}

            {show("scan_status") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 280, border: 1, borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Scan status
                  </Typography>
                  {overviewLoading ? (
                    <Skeleton height={120} />
                  ) : scan ? (
                    <Box sx={{ typography: "body2", "& > div": { mb: 1 } }}>
                      <div>
                        <strong>Assessment:</strong>{" "}
                        {scan.completedAt ? new Date(scan.completedAt).toLocaleString() : "—"}
                      </div>
                      <div>
                        <strong>Duration:</strong>{" "}
                        {scan.durationMs != null ? `${Math.round(scan.durationMs / 1000)}s` : "—"}
                      </div>
                      <div>
                        <strong>Findings:</strong> {totals.findings ?? 0}
                      </div>
                      {disabledUsersDiagnostic && (
                        <Box sx={{ mt: 1.5, typography: "caption", color: "text.secondary" }}>
                          <Typography variant="caption" fontWeight={700} display="block">
                            Disabled Users diagnostic
                          </Typography>
                          <div>LDAP returned: {disabledUsersDiagnostic.ldapObjectsReturned ?? 0}</div>
                          <div>Findings generated: {disabledUsersDiagnostic.findingsGenerated ?? 0}</div>
                          <div>Findings saved: {disabledUsersDiagnostic.findingsPersisted ?? 0}</div>
                          <div>Displayed in UI: {disabledUsersDiagnostic.findingsDisplayed ?? 0}</div>
                        </Box>
                      )}
                      {isStale && (
                        <Alert severity="warning" sx={{ mt: 1 }}>
                          Scan data is older than 7 days — consider re-running.
                        </Alert>
                      )}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No scans yet. Run a scan from Scan Center.
                    </Typography>
                  )}
                </Paper>
              </Grid>
            )}

            {show("top_exposures") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 280, border: 1, borderColor: "divider", overflow: "auto" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Top exposures (by detector)
                  </Typography>
                  {overviewLoading ? (
                    <Skeleton height={120} />
                  ) : topExposures.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No findings in this assessment.
                    </Typography>
                  ) : (
                    <Stack spacing={0.75}>
                      {topExposures.map(([feature, count]) => (
                        <Box
                          key={feature}
                          sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            "&:hover": { bgcolor: "action.hover" },
                            px: 0.5,
                            borderRadius: 0.5,
                          }}
                          onClick={() => go("/security/findings", { feature })}
                        >
                          <Typography variant="body2">{featureLabel(feature)}</Typography>
                          <Chip size="small" label={count} />
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Paper>
              </Grid>
            )}

            {show("trends") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 280, border: 1, borderColor: "divider", overflow: "auto" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Recently improved / degraded
                  </Typography>
                  {overviewLoading ? (
                    <Skeleton height={120} />
                  ) : !trends.improved?.length && !trends.degraded?.length ? (
                    <Typography variant="body2" color="text.secondary">
                      Run another assessment to see trends vs the previous snapshot.
                    </Typography>
                  ) : (
                    <Box sx={{ typography: "body2" }}>
                      <Typography variant="caption" fontWeight={700} color="success.main">
                        Improved (fewer findings)
                      </Typography>
                      {(trends.improved || []).slice(0, 4).map((row) => (
                        <div key={`i-${row.feature}`}>
                          {featureLabel(row.feature)} · {row.delta}
                        </div>
                      ))}
                      <Typography
                        variant="caption"
                        fontWeight={700}
                        color="error.main"
                        sx={{ mt: 1, display: "block" }}
                      >
                        Degraded (more findings)
                      </Typography>
                      {(trends.degraded || []).slice(0, 4).map((row) => (
                        <div key={`d-${row.feature}`}>
                          {featureLabel(row.feature)} · +{row.delta}
                        </div>
                      ))}
                    </Box>
                  )}
                </Paper>
              </Grid>
            )}

            {show("domain_evidence") && (
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 280, border: 1, borderColor: "divider", overflow: "auto" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Domain evidence
                  </Typography>
                  {overviewLoading ? (
                    <Skeleton height={120} />
                  ) : (
                    <Box sx={{ typography: "body2", "& > div": { mb: 0.5 } }}>
                      <div>Inactive users: {user.inactiveUsers ?? 0}</div>
                      <div>Locked accounts: {user.lockedAccounts ?? 0}</div>
                      <div>Circular groups: {group.circularMemberships ?? 0}</div>
                      <div>Nested groups: {group.nestedGroups ?? 0}</div>
                      <div>Servers in wrong OU: {computer.serversInWrongOu ?? 0}</div>
                      <div>Computers w/o owners: {computer.computersWithoutOwners ?? 0}</div>
                      <div>Pre-auth disabled: {kerberos.preauthDisabled ?? 0}</div>
                      <div>Constrained delegation: {delegation.constrainedDelegation ?? 0}</div>
                      {scan?.policySnapshot && (
                        <div>Policies evaluated: {scan.policySnapshot.policyCount ?? "—"}</div>
                      )}
                    </Box>
                  )}
                </Paper>
              </Grid>
            )}

            {show("assessment_compare_panel") && (
              <Grid item xs={12}>
                <AssessmentComparePanel
                  leftScanId={overview?.previousScanId}
                  rightScanId={scanId}
                  compact
                />
              </Grid>
            )}

            {show("top_findings") && (
              <Grid item xs={12}>
                <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
                  <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                    Top risk findings
                  </Typography>
                  <FindingsTable
                    rows={topFindingsQuery.data?.items || []}
                    rowCount={topFindingsQuery.data?.total || 0}
                    paginationModel={{ page: 0, pageSize: 8 }}
                    onPaginationModelChange={() => {}}
                    loading={topFindingsQuery.isLoading}
                    onRowClick={(row) => go("/security/findings", { highlight: row.id })}
                  />
                </Paper>
              </Grid>
            )}

            {show("reports") && (
              <Grid item xs={12}>
                <SecurityReportPanel />
              </Grid>
            )}
          </Grid>
        </>
      )}

      <AdaptDashboardTilesDialog
        open={adaptOpen}
        onClose={() => setAdaptOpen(false)}
        initialPrefs={tilePrefs}
        saving={savePrefsMutation.isPending}
        onSave={(securityDashboard) => savePrefsMutation.mutate(securityDashboard)}
      />
    </Box>
  );
}
