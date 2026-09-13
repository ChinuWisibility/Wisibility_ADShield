import { useCallback, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Alert,
  Button,
  CircularProgress,
  Stack,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
} from "@mui/material";
import {
  VerifiedUserOutlined as RemediationIcon,
  Refresh as RefreshIcon,
  AutoFixHigh as BulkRemediateIcon,
} from "@mui/icons-material";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import SecurityApplicationBar from "../SecurityApplicationBar";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import { securityAPI } from "../../../services/securityApi";
import { securityPageHeaderSx } from "../securityTheme";
import SecurityRemediationQueueActivity from "./components/SecurityRemediationQueueActivity";
import RemediationSecuritySummary from "./components/RemediationSecuritySummary";
import RemediationFindingFilters from "./components/RemediationFindingFilters";
import RemediationFindingList from "./components/RemediationFindingList";
import RemediationScanHistoryPanel from "./components/RemediationScanHistoryPanel";
import {
  buildSecurityRemediationThemeRegistry,
  SECURITY_REMEDIATION_THEME,
} from "./securityRemediationTheme";
import { categoryIdForFeatureKey } from "../../../utils/scanCenterCategories";
import {
  SAFE_BULK_FEATURES,
  ADSHIELD_REMEDIABLE_FEATURES,
  buildFeatureIssueRows,
  findingHasDn,
  normalizeSeverity,
} from "./adShieldRemediationMeta";

/**
 * AD Security Remediation — action-centered remediation experience.
 * Scan comparison lives under the Scan History tab.
 */
export default function SecurityRemediationDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { applicationId, scanId, overview, buildPath } = useSecurityWorkspace();

  const pageTab = searchParams.get("tab") === "history" ? "history" : "remediation";
  const baselineScanId = searchParams.get("baselineScanId") || "";
  const currentScanId = searchParams.get("scanId") || scanId || "";

  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkResult, setBulkResult] = useState(null);

  const setPageTab = useCallback(
    (_, next) => {
      if (!next) return;
      const nextParams = new URLSearchParams(searchParams);
      if (next === "history") nextParams.set("tab", "history");
      else nextParams.delete("tab");
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams],
  );

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

  const findingsQuery = useQuery({
    queryKey: ["security", "remediation-action-findings", applicationId, currentScanId],
    queryFn: async () => {
      const res = await securityAPI.getFindings(applicationId, {
        scanId: currentScanId || undefined,
        page: 1,
        limit: 2000,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId) && pageTab === "remediation",
    staleTime: 20_000,
  });

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
    enabled: Boolean(applicationId),
    staleTime: 20_000,
  });

  const findings = useMemo(() => {
    const data = findingsQuery.data;
    return data?.items || data?.findings || [];
  }, [findingsQuery.data]);

  const featureRows = useMemo(() => buildFeatureIssueRows(findings), [findings]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return featureRows.filter((row) => {
      if (severityFilter !== "all" && row.severity !== severityFilter) return false;
      if (categoryFilter !== "all" && row.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        row.title.toLowerCase().includes(q) ||
        row.feature.toLowerCase().includes(q) ||
        String(row.whyItMatters || "").toLowerCase().includes(q)
      );
    });
  }, [featureRows, severityFilter, categoryFilter, search]);

  const bySeverity = useMemo(() => {
    const totals = overview?.totals;
    if (totals && (totals.findings || 0) > 0) {
      return {
        critical: totals.critical || 0,
        high: totals.high || 0,
        medium: totals.medium || 0,
        low: totals.low || 0,
      };
    }
    const agg = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const s = normalizeSeverity(f.severity || f.riskLevel);
      if (agg[s] != null) agg[s] += 1;
    }
    return agg;
  }, [overview?.totals, findings]);

  const needingAttention = useMemo(() => {
    if (overview?.totals?.findings != null && !findingsQuery.isLoading) {
      // Prefer live findings length when loaded so filters stay consistent.
      return findings.length || overview.totals.findings || 0;
    }
    return findings.length;
  }, [overview?.totals, findings, findingsQuery.isLoading]);

  const resolvedCount = summaryQuery.data?.progress?.resolved || 0;

  const safeBulkFindings = useMemo(
    () =>
      findings.filter(
        (f) => SAFE_BULK_FEATURES.has(String(f.feature || "")) && findingHasDn(f),
      ),
    [findings],
  );

  // Only offer bulk when every remediable open finding is a safe (no-extra-input) action.
  const canBulkRemediate = useMemo(() => {
    if (!safeBulkFindings.length) return false;
    const remediableOpen = findings.filter(
      (f) => ADSHIELD_REMEDIABLE_FEATURES.has(String(f.feature || "")) && findingHasDn(f),
    );
    return (
      remediableOpen.length > 0 &&
      remediableOpen.every((f) => SAFE_BULK_FEATURES.has(String(f.feature || "")))
    );
  }, [findings, safeBulkFindings.length]);

  const summary = summaryQuery.data;
  const progress = summary?.progress;
  const pair = summary?.pair;
  const featureWidgets = Array.isArray(summary?.widgets) ? summary.widgets : [];
  const categoryWidgets = Array.isArray(summary?.categoryWidgets)
    ? summary.categoryWidgets
    : [];
  const metricCards = featureWidgets.length ? featureWidgets : categoryWidgets;

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
    pageTab === "remediation" ? findingsQuery.isLoading : summaryQuery.isLoading;
  const error =
    pageTab === "remediation" ? findingsQuery.error : summaryQuery.error;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-action-findings"] });
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-summary"] });
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-queue-activity"] });
    queryClient.invalidateQueries({ queryKey: ["security", "overview"] });
  };

  const openFeature = (row) => {
    navigate(
      buildPath(`/security/remediation/${row.feature}`, {
        baselineScanId: baselineScanId || undefined,
        scanId: currentScanId || undefined,
      }),
    );
  };

  const runBulkRemediate = async () => {
    setBulkBusy(true);
    setBulkResult(null);
    const targets = safeBulkFindings;
    let ok = 0;
    let failed = [];
    for (let i = 0; i < targets.length; i += 1) {
      const finding = targets[i];
      setBulkProgress({
        index: i + 1,
        total: targets.length,
        current: finding.objectName || finding.dn,
      });
      try {
        const res = await securityAPI.remediateFinding(applicationId, {
          finding,
          dryRun: false,
        });
        const data = res.data?.data || res.data;
        if (data?.success) ok += 1;
        else {
          failed.push({
            objectName: finding.objectName,
            reason: data?.errors?.[0] || "Remediation failed",
          });
        }
      } catch (e) {
        failed.push({
          objectName: finding.objectName,
          reason: e?.response?.data?.message || e?.message || "Remediation failed",
        });
      }
    }
    setBulkProgress(null);
    setBulkBusy(false);
    setBulkResult({ ok, failed, total: targets.length });
    refresh();
  };

  if (!applicationId) {
    return (
      <Box sx={{ p: 3, maxWidth: 1920, mx: "auto" }}>
        <SecurityApplicationBar />
        <EmptyStateSecurity
          title="Select an application"
          description="Choose an Active Directory application to review and remediate security issues."
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
            Review and fix security issues detected in Active Directory.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={refresh}
            sx={{ textTransform: "none" }}
          >
            Refresh
          </Button>
          <SecurityExportMenu
            applicationId={applicationId}
            scanId={currentScanId || overview?.scan?.scanId}
          />
        </Stack>
      </Stack>

      <SecurityApplicationBar />

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

      <Tabs value={pageTab} onChange={setPageTab} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="remediation" label="Remediation" sx={{ textTransform: "none", fontWeight: 700 }} />
        <Tab value="history" label="Scan History" sx={{ textTransform: "none", fontWeight: 700 }} />
      </Tabs>

      {pageTab === "remediation" && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error?.response?.data?.message || error?.message || "Failed to load findings"}
            </Alert>
          )}

          {!loading && needingAttention === 0 ? (
            <EmptyStateSecurity
              title="✓ Active Directory security posture is clean"
              description="No remediable security issues currently require attention."
              actionLabel="Run Security Scan"
              onAction={() => navigate(buildPath("/security/scans"))}
            />
          ) : (
            <>
              <RemediationSecuritySummary
                needingAttention={needingAttention}
                bySeverity={bySeverity}
                resolved={resolvedCount}
              />

              {canBulkRemediate && (
                <Stack direction="row" sx={{ mb: 2 }}>
                  <Button
                    variant="contained"
                    startIcon={<BulkRemediateIcon />}
                    sx={{ textTransform: "none", fontWeight: 700 }}
                    onClick={() => {
                      setBulkResult(null);
                      setBulkOpen(true);
                    }}
                  >
                    Remediate All Safe Issues ({safeBulkFindings.length})
                  </Button>
                </Stack>
              )}

              <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                Issues needing attention
              </Typography>

              <RemediationFindingFilters
                severity={severityFilter}
                category={categoryFilter}
                search={search}
                onSeverityChange={setSeverityFilter}
                onCategoryChange={setCategoryFilter}
                onSearchChange={setSearch}
              />

              {!loading && !filteredRows.length && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  No findings match the current filters.
                </Alert>
              )}

              <RemediationFindingList
                rows={filteredRows}
                onView={openFeature}
                onRemediateFeature={openFeature}
              />
            </>
          )}

          <Box sx={{ mt: 3 }}>
            <SecurityRemediationQueueActivity />
          </Box>
        </>
      )}

      {pageTab === "history" && (
        <RemediationScanHistoryPanel
          baselineScanId={baselineScanId}
          currentScanId={currentScanId}
          onBaselineChange={setBaselineScanId}
          onCurrentChange={setCurrentScanIdParam}
          progress={progress}
          pair={pair}
          metricCards={metricCards}
          themeRegistry={themeRegistry}
          linkQueryParams={linkQueryParams}
          loading={summaryQuery.isLoading}
          error={summaryQuery.error}
          message={summary?.message}
          onGoScanCenter={() => navigate(buildPath("/security/scans"))}
        />
      )}

      <Dialog open={bulkOpen} onClose={() => !bulkBusy && setBulkOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {bulkResult
            ? bulkResult.failed.length
              ? "Remediation partially completed"
              : "Remediation successful"
            : bulkBusy
              ? "Remediating…"
              : "Remediate all safe issues?"}
        </DialogTitle>
        <DialogContent>
          {!bulkBusy && !bulkResult && (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2">
                {safeBulkFindings.length} objects will be updated in Active Directory.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                ADShield will apply the configured remediation for each safe finding, verify the
                resulting AD state, and update finding status.
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Findings that require review (owners, ACE trustees, nested memberships, OU moves)
                are not included.
              </Typography>
            </Stack>
          )}
          {bulkBusy && bulkProgress && (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {bulkProgress.index} of {bulkProgress.total} completed
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(bulkProgress.index / bulkProgress.total) * 100}
              />
              <Typography variant="caption" color="text.secondary">
                Current: {bulkProgress.current}
              </Typography>
            </Stack>
          )}
          {bulkResult && (
            <Stack spacing={1.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2">
                {bulkResult.ok} of {bulkResult.total} issues resolved
                {bulkResult.failed.length
                  ? ` · ${bulkResult.failed.length} require attention`
                  : ""}
              </Typography>
              {bulkResult.failed.map((f) => (
                <Alert key={`${f.objectName}-${f.reason}`} severity="warning" sx={{ py: 0.5 }}>
                  {f.objectName}: {f.reason}
                </Alert>
              ))}
              {!bulkResult.failed.length && (
                <Alert severity="success">
                  Active Directory was updated and remediations were verified.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {!bulkBusy && !bulkResult && (
            <>
              <Button onClick={() => setBulkOpen(false)} sx={{ textTransform: "none" }}>
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={runBulkRemediate}
                sx={{ textTransform: "none" }}
              >
                Remediate
              </Button>
            </>
          )}
          {bulkResult && (
            <>
              {bulkResult.failed.length > 0 && (
                <Button
                  onClick={() => {
                    setBulkResult(null);
                    runBulkRemediate();
                  }}
                  sx={{ textTransform: "none" }}
                >
                  Retry Failed
                </Button>
              )}
              <Button
                variant="contained"
                onClick={() => navigate(buildPath("/security/scans"))}
                sx={{ textTransform: "none" }}
              >
                Verify with Scan
              </Button>
              <Button onClick={() => setBulkOpen(false)} sx={{ textTransform: "none" }}>
                Back to Remediation
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
