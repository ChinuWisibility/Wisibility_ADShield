import { useCallback, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Grid,
  Alert,
  Button,
  CircularProgress,
  ToggleButton,
  ToggleButtonGroup,
  Stack,
} from "@mui/material";
import {
  VerifiedUserOutlined as RemediationIcon,
  Refresh as RefreshIcon,
  Widgets as MetricsViewIcon,
  Apartment as ApplicationViewIcon,
} from "@mui/icons-material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import SecurityApplicationBar from "../SecurityApplicationBar";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import DataHygieneWidgetCard from "../../datahygine/components/DataHygieneWidgetCard";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import { securityAPI } from "../../../services/securityApi";
import { securityPageHeaderSx } from "../securityTheme";
import AssessmentPairSelector from "./components/AssessmentPairSelector";
import SecurityRemediationProgressWidget from "./components/SecurityRemediationProgressWidget";
import SecurityRemediationQueueActivity from "./components/SecurityRemediationQueueActivity";
import {
  buildSecurityRemediationThemeRegistry,
  SECURITY_REMEDIATION_THEME,
} from "./securityRemediationTheme";
import { categoryIdForFeatureKey } from "../../../utils/scanCenterCategories";

/**
 * AD Security Remediation Center — Assessment progress dashboard.
 * Layout mirrors Data Hygiene; data from Compare / remediation-summary APIs.
 */
export default function SecurityRemediationDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    applicationId,
    scanId,
    overview,
    tenantId,
    buildPath,
  } = useSecurityWorkspace();

  const dashboardView = searchParams.get("view") === "application" ? "application" : "metric";
  const baselineScanId = searchParams.get("baselineScanId") || "";
  const currentScanId = searchParams.get("scanId") || scanId || "";

  const setBaselineScanId = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("baselineScanId", id);
      else next.delete("baselineScanId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setCurrentScanIdParam = useCallback(
    (id) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set("scanId", id);
      else next.delete("scanId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleViewChange = (_, nextView) => {
    if (!nextView || nextView === dashboardView) return;
    const next = new URLSearchParams(searchParams);
    if (nextView === "application") next.set("view", "application");
    else next.delete("view");
    setSearchParams(next, { replace: true });
  };

  const summaryQuery = useQuery({
    queryKey: [
      "security",
      "remediation-summary",
      applicationId,
      baselineScanId,
      currentScanId,
    ],
    queryFn: async () => {
      const res = await securityAPI.getRemediationSummary(applicationId, {
        baseline: baselineScanId || undefined,
        current: currentScanId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && dashboardView === "metric",
    staleTime: 20_000,
  });

  const appsSummaryQuery = useQuery({
    queryKey: ["security", "remediation-applications-summary", tenantId],
    queryFn: async () => {
      const res = await securityAPI.getRemediationApplicationsSummary({
        tenantId: tenantId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(tenantId) && dashboardView === "application",
    staleTime: 30_000,
  });

  const summary = summaryQuery.data;
  const progress = summary?.progress;
  const pair = summary?.pair;
  const featureWidgets = Array.isArray(summary?.widgets) ? summary.widgets : [];
  const categoryWidgets = Array.isArray(summary?.categoryWidgets)
    ? summary.categoryWidgets
    : [];
  const metricCards = featureWidgets.length ? featureWidgets : categoryWidgets;

  const applicationTiles = useMemo(() => {
    if (dashboardView === "application") {
      return Array.isArray(appsSummaryQuery.data?.applicationTiles)
        ? appsSummaryQuery.data.applicationTiles
        : [];
    }
    return Array.isArray(summary?.applicationTiles) ? summary.applicationTiles : [];
  }, [appsSummaryQuery.data, dashboardView, summary?.applicationTiles]);

  const themeRegistry = useMemo(() => {
    const keys = metricCards.map((w) => w.id);
    const registry = buildSecurityRemediationThemeRegistry(keys);
    for (const w of metricCards) {
      const cat = categoryIdForFeatureKey(w.id);
      if (cat && SECURITY_REMEDIATION_THEME[cat] && !SECURITY_REMEDIATION_THEME[w.id]) {
        registry[w.id] = { ...SECURITY_REMEDIATION_THEME[cat], icon: "🔎" };
      }
    }
    return registry;
  }, [metricCards]);

  const linkQueryParams = useMemo(
    () => ({
      baselineScanId: baselineScanId || undefined,
      scanId: currentScanId || undefined,
    }),
    [baselineScanId, currentScanId],
  );

  const loading =
    dashboardView === "metric" ? summaryQuery.isLoading : appsSummaryQuery.isLoading;
  const error =
    dashboardView === "metric" ? summaryQuery.error : appsSummaryQuery.error;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-summary"] });
    queryClient.invalidateQueries({
      queryKey: ["security", "remediation-applications-summary"],
    });
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-queue-activity"] });
  };

  if (!applicationId && dashboardView === "metric") {
    return (
      <Box sx={{ p: 3, maxWidth: 1920, mx: "auto" }}>
        <SecurityApplicationBar />
        <EmptyStateSecurity
          title="Select an application"
          description="Choose an Active Directory application to measure remediation progress between assessments."
        />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 1920, mx: "auto", position: "relative", minWidth: 0 }}>
      {loading && (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            bgcolor: "rgba(255,255,255,0.75)",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CircularProgress />
        </Box>
      )}

      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "flex-start" }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <RemediationIcon color="primary" />
            <Typography variant="h5" sx={securityPageHeaderSx}>
              AD Security Remediation
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Measure, track, and verify security remediation progress between Active Directory
            assessments.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={dashboardView}
            onChange={handleViewChange}
          >
            <ToggleButton value="metric" aria-label="Metrics view">
              <MetricsViewIcon sx={{ mr: 0.75, fontSize: 18 }} />
              Metrics
            </ToggleButton>
            <ToggleButton value="application" aria-label="Applications view">
              <ApplicationViewIcon sx={{ mr: 0.75, fontSize: 18 }} />
              Applications
            </ToggleButton>
          </ToggleButtonGroup>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={refresh}
            sx={{ textTransform: "none" }}
          >
            Refresh
          </Button>
          {applicationId && (
            <SecurityExportMenu
              applicationId={applicationId}
              scanId={currentScanId || overview?.scan?.scanId}
            />
          )}
        </Stack>
      </Stack>

      {dashboardView === "metric" && <SecurityApplicationBar />}

      {dashboardView === "metric" && (
        <>
          <AssessmentContextBar
            actions={
              <Button
                size="small"
                variant="outlined"
                sx={{ textTransform: "none" }}
                onClick={() => navigate(buildPath("/security/scans"))}
              >
                Scan Center
              </Button>
            }
          />

          <AssessmentPairSelector
            baselineScanId={baselineScanId}
            currentScanId={currentScanId}
            onBaselineChange={setBaselineScanId}
            onCurrentChange={setCurrentScanIdParam}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error?.response?.data?.message || error?.message || "Failed to load remediation summary"}
            </Alert>
          )}

          {summary?.message && (
            <Alert severity="info" sx={{ mb: 2 }}>
              {summary.message}
            </Alert>
          )}

          <SecurityRemediationProgressWidget progress={progress} pair={pair} />

          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.5 }}>
            Feature progress
          </Typography>
          {!loading && !metricCards.length && !summary?.message && (
            <EmptyStateSecurity
              title="No feature deltas yet"
              description="Run at least two assessments, then select a baseline and current pair."
            />
          )}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {metricCards.map((widget) => (
              <Grid item xs={12} sm={6} lg={4} key={widget.id}>
                <DataHygieneWidgetCard
                  widget={widget}
                  loading={loading}
                  dashboardView="metric"
                  detailBasePath="/security/remediation"
                  applicationAnalyticsBasePath="/security/remediation"
                  themeRegistry={themeRegistry}
                  linkQueryParams={linkQueryParams}
                />
              </Grid>
            ))}
          </Grid>
        </>
      )}

      {dashboardView === "application" && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error?.response?.data?.message || error?.message || "Failed to load applications"}
            </Alert>
          )}
          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1.5 }}>
            Applications
          </Typography>
          {!loading && !applicationTiles.length && (
            <EmptyStateSecurity
              title="No applications with assessments"
              description="Applications appear here after AD Security scans are available."
            />
          )}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {applicationTiles.map((widget, index) => (
              <Grid item xs={12} sm={6} lg={4} key={widget.id || widget.applicationId}>
                <DataHygieneWidgetCard
                  widget={widget}
                  loading={loading}
                  dashboardView="application"
                  themeIndex={index}
                  detailBasePath="/security/remediation"
                  applicationAnalyticsBasePath={null}
                  themeRegistry={SECURITY_REMEDIATION_THEME}
                  linkQueryParams={{
                    applicationId: widget.applicationId || undefined,
                  }}
                />
              </Grid>
            ))}
          </Grid>
        </>
      )}

      <SecurityRemediationQueueActivity />
    </Box>
  );
}
