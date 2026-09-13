import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import {
  Typography,
  Box,
  Paper,
  Button,
  Alert,
  LinearProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  TablePagination,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Tooltip,
  Stack,
  CircularProgress,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import ScanStatusBadge from "../../../components/security/ScanStatusBadge";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import { securityPageHeaderSx, scanCenterRootSx, SCAN_CENTER_INK } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
import { applicationAPI } from "../../../services/api";
import ScanCenterHeader from "../../../components/security/ScanCenterHeader";
import ScanCenterFeatureWorkspace from "../../../components/security/ScanCenterFeatureWorkspace";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import AssessmentSelectionPanel from "../../../components/security/AssessmentSelectionPanel";
import AssessmentVersionHistoryPanel from "../../../components/security/AssessmentVersionHistoryPanel";
import { useSecurityFeatureActions } from "../../../hooks/useSecurityFeatureActions";
import { readInactiveUsersDays } from "../../../utils/securityScanSettings";
import { useNavigate } from "react-router-dom";

function formatDuration(started, completed) {
  const a = started ? Date.parse(started) : NaN;
  const b = completed ? Date.parse(completed) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  return `${Math.round((b - a) / 1000)}s`;
}

export default function ScanCenter() {
  const navigate = useNavigate();
  const {
    applicationId,
    setApplicationId,
    assessmentId,
    setAssessmentId,
    viewVersionId,
    setViewVersionId,
    viewVersion,
    isViewingVersion,
    applications,
    applicationsLoading,
    tenantId,
    scanRunning,
    runScan,
    refreshWorkspace,
    setScanId,
    scanId,
    overview,
    scanNotice,
    setScanNotice,
    buildPath,
  } = useSecurityWorkspace();

  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [selectedFeatureKey, setSelectedFeatureKey] = useState(null);
  const [activeScanFeatureKey, setActiveScanFeatureKey] = useState(null);
  const [headerError, setHeaderError] = useState("");
  const [historyPage, setHistoryPage] = useState(0);
  const [historyRowsPerPage, setHistoryRowsPerPage] = useState(10);
  const [resetting, setResetting] = useState(false);
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false);
  const [disablingAll, setDisablingAll] = useState(false);

  const featureActionsRef = useRef(null);
  const showWorkspace = Boolean(applicationId && assessmentId);
  const readOnly = isViewingVersion;

  const appQuery = useQuery({
    queryKey: ["application", applicationId],
    queryFn: async () => {
      const res = await applicationAPI.getById(applicationId);
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
    staleTime: 30_000,
  });

  const workingConfigQuery = useQuery({
    queryKey: ["security", "working-config", applicationId, assessmentId],
    queryFn: async () => {
      const res = await securityAPI.getWorkingConfiguration(applicationId, assessmentId);
      return res.data?.data ?? res.data;
    },
    enabled: showWorkspace && !readOnly,
    staleTime: 15_000,
  });

  const versionConfigQuery = useQuery({
    queryKey: ["security", "version-config", applicationId, assessmentId, viewVersionId],
    queryFn: async () => {
      const res = await securityAPI.getAssessmentVersionConfig(
        applicationId,
        assessmentId,
        viewVersionId,
      );
      return res.data?.data ?? res.data;
    },
    enabled: showWorkspace && readOnly,
    staleTime: 30_000,
  });

  const configQuery = readOnly ? versionConfigQuery : workingConfigQuery;

  useEffect(() => {
    setHistoryPage(0);
  }, [applicationId, assessmentId]);

  const scansQuery = useQuery({
    queryKey: [
      "security",
      "scans",
      applicationId,
      assessmentId,
      historyPage,
      historyRowsPerPage,
    ],
    queryFn: async () => {
      const res = await securityAPI.listScans(applicationId, {
        page: historyPage + 1,
        limit: historyRowsPerPage,
        assessmentId: assessmentId || undefined,
      });
      const payload = res.data ?? {};
      return {
        scans: Array.isArray(payload.data) ? payload.data : [],
        total: Number(payload.total) || 0,
      };
    },
    enabled: showWorkspace,
  });

  const features = useMemo(
    () => configQuery.data?.features || [],
    [configQuery.data],
  );

  const scans = useMemo(
    () => scansQuery.data?.scans || [],
    [scansQuery.data],
  );

  const scansTotal = scansQuery.data?.total ?? 0;

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(scansTotal / historyRowsPerPage) - 1);
    if (historyPage > maxPage) setHistoryPage(maxPage);
  }, [scansTotal, historyRowsPerPage, historyPage]);

  const selectedFeature = useMemo(
    () => features.find((f) => f.featureKey === selectedFeatureKey) || null,
    [features, selectedFeatureKey],
  );

  const workingConfigQueryKey = useMemo(
    () => ["security", "working-config", applicationId, assessmentId],
    [applicationId, assessmentId],
  );

  const invalidateFeatureConfig = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: workingConfigQueryKey });
    queryClient.invalidateQueries({
      queryKey: ["security", "version-config", applicationId, assessmentId],
    });
    queryClient.invalidateQueries({ queryKey: ["application", applicationId] });
    refreshWorkspace();
  }, [queryClient, workingConfigQueryKey, applicationId, assessmentId, refreshWorkspace]);

  const featureActions = useSecurityFeatureActions({
    applicationId,
    assessmentId,
    application: appQuery.data,
    onSaved: invalidateFeatureConfig,
    runScan: async (options) => {
      const featureKey = options?.body?.features?.[0];
      if (featureKey) setActiveScanFeatureKey(featureKey);
      try {
        return await runScan(options);
      } finally {
        setActiveScanFeatureKey(null);
      }
    },
  });
  featureActionsRef.current = featureActions;

  const handleToggleFeatureEnabled = useCallback(
    async (feature, enabled) => {
      if (!applicationId || !assessmentId || readOnly) return;

      const previous = queryClient.getQueryData(workingConfigQueryKey);
      queryClient.setQueryData(workingConfigQueryKey, (old) => {
        if (!old?.features) return old;
        return {
          ...old,
          features: old.features.map((f) =>
            f.featureKey === feature.featureKey ? { ...f, enabled } : f,
          ),
        };
      });

      try {
        await featureActions.toggleFeatureEnabled(feature, enabled);
      } catch (err) {
        queryClient.setQueryData(workingConfigQueryKey, previous);
        setHeaderError(
          err?.response?.data?.message || err.message || "Failed to update feature.",
        );
      }
    },
    [
      applicationId,
      assessmentId,
      readOnly,
      queryClient,
      workingConfigQueryKey,
      featureActions,
    ],
  );

  const handleResetWorking = async () => {
    if (!applicationId || !assessmentId) return;
    setResetting(true);
    setHeaderError("");
    try {
      await securityAPI.resetWorkingConfiguration(applicationId, assessmentId);
      setViewVersionId("");
      invalidateFeatureConfig();
    } catch (err) {
      setHeaderError(
        err?.response?.data?.message || err.message || "Failed to reset Working Configuration.",
      );
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || !applicationId) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await securityAPI.deleteScan(applicationId, deleteTarget.scanId);
      if (scanId === deleteTarget.scanId) setScanId("");
      setDeleteTarget(null);
      refreshWorkspace();
      await queryClient.invalidateQueries({
        queryKey: ["security", "scans", applicationId, assessmentId],
      });
      await queryClient.invalidateQueries({
        queryKey: ["security", "assessment-versions", applicationId, assessmentId],
      });
    } catch (err) {
      setDeleteError(
        err?.response?.data?.message || err?.message || "Failed to delete scan",
      );
    } finally {
      setDeleting(false);
    }
  };

  const enabledFeatureCount = useMemo(
    () => features.filter((f) => f.enabled && f.implemented !== false).length,
    [features],
  );

  const enabledFeatureNames = useMemo(
    () =>
      features
        .filter((f) => f.enabled && f.implemented !== false)
        .map((f) => f.name || f.featureKey),
    [features],
  );

  const handleRunFullScan = async () => {
    setExecuteConfirmOpen(false);
    setHeaderError("");
    setActiveScanFeatureKey(null);
    try {
      await featureActions.runFullScan(features, {
        ...appQuery.data,
        securityScanSettings:
          configQuery.data?.securityScanSettings || appQuery.data?.securityScanSettings,
      });
      await scansQuery.refetch();
      await queryClient.invalidateQueries({
        queryKey: ["security", "assessment-versions", applicationId, assessmentId],
      });
    } catch (err) {
      setHeaderError(err?.response?.data?.message || err.message || "Full scan failed.");
    }
  };

  const handleDisableAllFeatures = async () => {
    if (!applicationId || !assessmentId || readOnly || !features.length) return;
    setHeaderError("");
    setDisablingAll(true);
    try {
      await securityAPI.putWorkingConfiguration(applicationId, assessmentId, {
        features: features.map((f) => ({ ...f, enabled: false })),
        securityScanSettings: configQuery.data?.securityScanSettings || {},
        source: "disable_all_features",
      });
      await queryClient.invalidateQueries({
        queryKey: ["security", "working-config", applicationId, assessmentId],
      });
    } catch (err) {
      setHeaderError(
        err?.response?.data?.message || err.message || "Failed to disable features.",
      );
    } finally {
      setDisablingAll(false);
    }
  };

  const handleRunSelectedFeature = async () => {
    if (!selectedFeature) return;
    setHeaderError("");
    setActiveScanFeatureKey(selectedFeature.featureKey);
    try {
      await featureActions.runFeatureScan(selectedFeature, {
        ldapFilter: selectedFeature.ldapFilter,
        searchBase: selectedFeature.searchBase,
        searchScope: selectedFeature.searchScope,
        enabled: selectedFeature.enabled,
        inactiveUsersDays: readInactiveUsersDays({
          securityScanSettings: configQuery.data?.securityScanSettings,
        }),
      });
      await scansQuery.refetch();
      await queryClient.invalidateQueries({
        queryKey: ["security", "assessment-versions", applicationId, assessmentId],
      });
    } catch (err) {
      setHeaderError(
        err?.response?.data?.message || err.message || "Feature scan failed.",
      );
    } finally {
      setActiveScanFeatureKey(null);
    }
  };

  const configLoading = configQuery.isLoading && showWorkspace;
  const versionLabel =
    viewVersion?.label ||
    (viewVersion?.versionNumber != null
      ? `Version ${viewVersion.versionNumber}`
      : versionConfigQuery.data?.label) ||
    "Version";

  return (
    <Box sx={scanCenterRootSx}>
      <Box sx={securityPageHeaderSx}>
        <Box>
          <Typography variant="h5" fontWeight={800} sx={{ color: SCAN_CENTER_INK.primary }}>
            Scan Center
          </Typography>
          <Typography variant="body2" sx={{ color: SCAN_CENTER_INK.muted }}>
            Assessment Workspace — edit Working Configuration, Execute freezes a Version
          </Typography>
        </Box>
      </Box>

      <ScanCenterHeader
        applicationId={applicationId}
        setApplicationId={setApplicationId}
        applications={applications}
        applicationsLoading={applicationsLoading}
        tenantId={tenantId}
        refreshWorkspace={refreshWorkspace}
        scanRunning={scanRunning}
        scanNotice={scanNotice}
        setScanNotice={setScanNotice}
        overview={overview}
        selectedFeature={selectedFeature}
        onRunFullScan={() => setExecuteConfirmOpen(true)}
        onRunSelectedFeature={handleRunSelectedFeature}
        headerError={headerError}
        setHeaderError={setHeaderError}
        enabledFeatureCount={enabledFeatureCount}
        runDisabled={!assessmentId || readOnly || enabledFeatureCount === 0}
        runDisabledReason={
          !assessmentId
            ? "Select or create an Assessment first"
            : readOnly
              ? "Return to Working Configuration to execute (or clone this Version first)"
              : enabledFeatureCount === 0
                ? "Enable at least one feature before executing"
                : "Cannot execute"
        }
      />

      {applicationId && !assessmentId && <AssessmentSelectionPanel />}

      {applicationId && assessmentId && (
        <AssessmentContextBar
          actions={
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {readOnly && (
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ textTransform: "none" }}
                  onClick={() => setViewVersionId("")}
                >
                  Edit Working Configuration
                </Button>
              )}
              {!readOnly && (
                <Button
                  size="small"
                  variant="outlined"
                  disabled={
                    disablingAll || scanRunning || enabledFeatureCount === 0
                  }
                  onClick={handleDisableAllFeatures}
                  sx={{ textTransform: "none" }}
                >
                  {disablingAll ? "Disabling…" : "Disable all features"}
                </Button>
              )}
              {!readOnly && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={resetting ? <CircularProgress size={14} /> : <RestartAltIcon />}
                  disabled={resetting || scanRunning}
                  onClick={handleResetWorking}
                  sx={{ textTransform: "none" }}
                >
                  Reset Working Config
                </Button>
              )}
              <Button
                size="small"
                variant="outlined"
                sx={{ textTransform: "none" }}
                onClick={() => setAssessmentId("")}
              >
                Change Assessment
              </Button>
            </Stack>
          }
        />
      )}

      {showWorkspace && !readOnly && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {enabledFeatureCount} feature{enabledFeatureCount === 1 ? "" : "s"} enabled — Execute
          only runs those toggles. New assessments start with all features off (opt-in).
        </Alert>
      )}

      {showWorkspace && readOnly && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Viewing {versionLabel} (read-only). Clone to Working Configuration to edit, or return to
          Working Configuration to execute.
        </Alert>
      )}

      {scanRunning && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="info" sx={{ mb: 1 }}>
            Assessment execution in progress — analyzing findings…
          </Alert>
          <LinearProgress />
        </Box>
      )}

      {deleteError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setDeleteError("")}>
          {deleteError}
        </Alert>
      )}

      {!applicationId && (
        <EmptyStateSecurity
          title="Select an application"
          description="Choose an application to create or open an Assessment."
          actionLabel="Go to Applications"
          onAction={() => window.location.assign("/applications")}
        />
      )}

      {showWorkspace && configQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {configQuery.error?.message || "Failed to load configuration."}
        </Alert>
      )}

      {showWorkspace && configLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {showWorkspace && !configLoading && !configQuery.isError && (
        <ScanCenterFeatureWorkspace
          applicationId={applicationId}
          application={appQuery.data}
          features={features}
          scans={scans}
          selectedFeatureKey={selectedFeatureKey}
          onSelectFeature={setSelectedFeatureKey}
          onSaved={invalidateFeatureConfig}
          runScan={runScan}
          scanRunning={scanRunning}
          activeScanFeatureKey={activeScanFeatureKey}
          featureActionsRef={featureActionsRef}
          onToggleEnabled={handleToggleFeatureEnabled}
          readOnly={readOnly}
        />
      )}

      {showWorkspace && <AssessmentVersionHistoryPanel />}

      {showWorkspace && (
        <Paper sx={{ border: 1, borderColor: "divider", overflow: "hidden" }}>
          <Box
            sx={{
              p: 1.5,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="subtitle2" fontWeight={700}>
              Recent Assessment executions
            </Typography>
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              onClick={() => {
                refreshWorkspace();
                scansQuery.refetch();
              }}
            >
              Refresh
            </Button>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Started</TableCell>
                <TableCell>Duration</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Findings</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {scans.length === 0 && !scansQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" sx={{ py: 1.5, color: SCAN_CENTER_INK.muted }}>
                      No executions recorded yet for this Assessment.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {scans.map((s) => {
                const count =
                  s.summary?.totalFindings ??
                  (Array.isArray(s.findings) ? s.findings.length : 0);
                const stale =
                  s.completedAt &&
                  (Date.now() - Date.parse(s.completedAt)) / 86400000 > 7;
                const isActive = s.scanId === scanId;
                return (
                  <TableRow key={s.scanId} selected={isActive} hover>
                    <TableCell sx={{ py: 0.75 }}>
                      {s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell sx={{ py: 0.75 }}>
                      {formatDuration(s.startedAt, s.completedAt)}
                    </TableCell>
                    <TableCell sx={{ py: 0.75 }}>
                      <ScanStatusBadge status={stale ? "stale" : s.status || "completed"} />
                    </TableCell>
                    <TableCell align="right" sx={{ py: 0.75 }}>
                      {count}
                    </TableCell>
                    <TableCell align="right" sx={{ py: 0.75 }}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Load this execution">
                          <Button
                            size="small"
                            variant={isActive ? "contained" : "text"}
                            disabled={isActive}
                            onClick={() => {
                              setScanId(s.scanId);
                              setScanNotice({
                                type: "info",
                                message: `Using execution from ${
                                  s.startedAt
                                    ? new Date(s.startedAt).toLocaleString()
                                    : "history"
                                }.`,
                                showContinuation: true,
                              });
                            }}
                          >
                            {isActive ? "In use" : "Use execution"}
                          </Button>
                        </Tooltip>
                        <Tooltip title="Compare (same Version only)">
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => {
                              navigate(
                                buildPath("/security/dashboard", {
                                  compareLeft: s.scanId,
                                  compareRight: scanId || s.scanId,
                                  assessmentId,
                                }),
                              );
                            }}
                            sx={{ textTransform: "none" }}
                          >
                            Compare
                          </Button>
                        </Tooltip>
                        <Tooltip title="Delete execution">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label="Delete execution"
                            onClick={() =>
                              setDeleteTarget({
                                scanId: s.scanId,
                                startedAt: s.startedAt,
                                findings: count,
                              })
                            }
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={scansTotal}
            page={historyPage}
            onPageChange={(_, nextPage) => setHistoryPage(nextPage)}
            rowsPerPage={historyRowsPerPage}
            onRowsPerPageChange={(e) => {
              setHistoryRowsPerPage(parseInt(e.target.value, 10));
              setHistoryPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      )}

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Delete execution snapshot?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently removes the execution snapshot and all{" "}
            {deleteTarget?.findings ?? 0} findings recorded for it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={executeConfirmOpen}
        onClose={() => !scanRunning && setExecuteConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Execute Assessment?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1.5 }}>
            This run will analyze {enabledFeatureCount} enabled feature
            {enabledFeatureCount === 1 ? "" : "s"} and freeze a Version if the
            Working Configuration changed.
          </DialogContentText>
          {enabledFeatureCount > 8 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Many features are enabled. Disable ones you do not want before
              continuing, or use Disable all features then re-enable a subset.
            </Alert>
          )}
          {enabledFeatureNames.length > 0 && (
            <Box
              component="ul"
              sx={{
                m: 0,
                pl: 2.5,
                maxHeight: 220,
                overflow: "auto",
                color: "text.secondary",
                typography: "body2",
              }}
            >
              {enabledFeatureNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setExecuteConfirmOpen(false)} disabled={scanRunning}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleRunFullScan}
            disabled={scanRunning || enabledFeatureCount === 0}
          >
            {scanRunning ? "Running…" : "Execute"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
