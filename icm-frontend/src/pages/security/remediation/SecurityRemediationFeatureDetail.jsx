import { useMemo, useState, useEffect } from "react";
import { useParams, useSearchParams, Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  Paper,
  Stack,
  Button,
  Alert,
  Chip,
  Checkbox,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DataGrid } from "@mui/x-data-grid";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import RiskDrilldownDrawer from "../../../components/security/RiskDrilldownDrawer";
import SecurityExportMenu from "../../../components/security/SecurityExportMenu";
import RiskSeverityChip from "../../../components/security/RiskSeverityChip";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import SecurityFindingRemediateButton from "../../../components/security/SecurityFindingRemediateButton";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import { securityAPI } from "../../../services/securityApi";
import { securityPageHeaderSx } from "../securityTheme";
import useQueueTaskPageStatus from "../../../hooks/useQueueTaskPageStatus";
import {
  featureDisplayName,
  humanFindingType,
  remediationAvailability,
  remediationAvailabilityLabel,
  recommendedActionLabel,
  whatAdShieldWillChange,
  SAFE_BULK_FEATURES,
  findingHasDn,
  normalizeSeverity,
  maxSeverity,
} from "./adShieldRemediationMeta";

function findingTargetId(finding) {
  return (
    finding?.attributes?.orphanId ||
    finding?.attributes?.accountId ||
    finding?.metadata?.orphanId ||
    finding?.metadata?.accountId ||
    finding?.evidence?.orphanId ||
    finding?.evidence?.accountId ||
    null
  );
}

/**
 * Feature-level remediation detail — action-centered, not scan-comparison-first.
 */
export default function SecurityRemediationFeatureDetail() {
  const { featureId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { applicationId: workspaceAppId, buildPath, setApplicationId } = useSecurityWorkspace();

  const applicationId = searchParams.get("applicationId") || workspaceAppId || "";
  const baselineScanId = searchParams.get("baselineScanId") || "";
  const currentScanId = searchParams.get("scanId") || "";

  const [selected, setSelected] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (applicationId && applicationId !== workspaceAppId) {
      setApplicationId(applicationId);
    }
  }, [applicationId, workspaceAppId, setApplicationId]);

  const findingsQuery = useQuery({
    queryKey: [
      "security",
      "remediation-feature-findings",
      applicationId,
      currentScanId,
      featureId,
    ],
    queryFn: async () => {
      const res = await securityAPI.getFindings(applicationId, {
        scanId: currentScanId || undefined,
        feature: featureId,
        page: 1,
        limit: 2000,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
  });

  const compareQuery = useQuery({
    queryKey: [
      "security",
      "remediation-feature-compare",
      applicationId,
      baselineScanId,
      currentScanId,
      featureId,
    ],
    queryFn: async () => {
      const res = await securityAPI.compareScans(applicationId, {
        left: baselineScanId || undefined,
        right: currentScanId || undefined,
      });
      return res.data?.data ?? res.data;
    },
    enabled: Boolean(applicationId),
  });

  const findings = useMemo(() => {
    const data = findingsQuery.data;
    return data?.items || data?.findings || [];
  }, [findingsQuery.data]);

  const featureStats = compareQuery.data?.byFeature?.[featureId] || null;
  const availability = remediationAvailability(featureId);
  const severity = maxSeverity(findings.map((f) => f.severity || f.riskLevel));
  const whyItMatters =
    findings.find((f) => f.recommendation)?.recommendation ||
    findings.find((f) => f.description)?.description ||
    "";

  const targetIds = useMemo(
    () => findings.map(findingTargetId).filter(Boolean).map(String),
    [findings],
  );

  const queueStatus = useQueueTaskPageStatus({
    action: "IAM_ORPHAN_REVIEW",
    targetIds,
    enabled: targetIds.length > 0,
  });

  const gridRows = useMemo(
    () =>
      findings.map((r, idx) => ({
        ...r,
        id: r.id || `${r.dn || r.objectName}-${idx}`,
      })),
    [findings],
  );

  const remediableRows = useMemo(
    () =>
      gridRows.filter(
        (f) =>
          SAFE_BULK_FEATURES.has(String(featureId)) &&
          findingHasDn(f) &&
          remediationAvailability(featureId, f) === "remediable",
      ),
    [gridRows, featureId],
  );

  const selectedFindings = useMemo(
    () => gridRows.filter((f) => selectedIds.includes(f.id)),
    [gridRows, selectedIds],
  );

  const columns = useMemo(
    () => [
      {
        field: "__select",
        headerName: "",
        width: 48,
        sortable: false,
        renderCell: (params) => {
          const id = params.row.id;
          const canSelect =
            SAFE_BULK_FEATURES.has(String(featureId)) && findingHasDn(params.row);
          return (
            <Checkbox
              size="small"
              disabled={!canSelect}
              checked={selectedIds.includes(id)}
              onChange={(e) => {
                e.stopPropagation();
                setSelectedIds((prev) =>
                  e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
                );
              }}
              onClick={(e) => e.stopPropagation()}
            />
          );
        },
      },
      {
        field: "objectName",
        headerName: "Object",
        flex: 1.2,
        minWidth: 140,
      },
      {
        field: "objectType",
        headerName: "Type",
        width: 100,
        valueFormatter: (value) =>
          String(value || "object").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      },
      {
        field: "severity",
        headerName: "Severity",
        width: 120,
        renderCell: (params) => (
          <RiskSeverityChip severity={normalizeSeverity(params.value || params.row.riskLevel)} />
        ),
      },
      {
        field: "findingType",
        headerName: "Current State",
        flex: 1,
        minWidth: 140,
        valueGetter: (_v, row) => humanFindingType(row),
      },
      {
        field: "remediationState",
        headerName: "Remediation State",
        width: 150,
        valueGetter: (_v, row) =>
          remediationAvailabilityLabel(remediationAvailability(featureId, row)),
      },
      {
        field: "action",
        headerName: "Action",
        width: 140,
        sortable: false,
        renderCell: (params) => (
          <SecurityFindingRemediateButton
            finding={params.row}
            queuedInfo={
              findingTargetId(params.row)
                ? queueStatus.getQueuedInfo?.(String(findingTargetId(params.row)))
                : null
            }
            onQueuedRefresh={queueStatus.refresh}
            onRemediated={() => {
              queryClient.invalidateQueries({
                queryKey: ["security", "remediation-feature-findings"],
              });
            }}
          />
        ),
      },
    ],
    [featureId, selectedIds, queueStatus, queryClient],
  );

  const backTo = buildPath("/security/remediation", {
    baselineScanId: baselineScanId || undefined,
    scanId: currentScanId || undefined,
  });

  const selectAllSafe = () => {
    setSelectedIds(remediableRows.map((r) => r.id));
  };

  const runSelectedRemediation = async () => {
    const targets =
      selectedFindings.length > 0
        ? selectedFindings.filter((f) => findingHasDn(f))
        : remediableRows;
    if (!targets.length) return;

    setBusy(true);
    setResult(null);
    let ok = 0;
    const failed = [];
    for (let i = 0; i < targets.length; i += 1) {
      const finding = targets[i];
      setProgress({
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
    setBusy(false);
    setProgress(null);
    setResult({ ok, failed, total: targets.length });
    setConfirmOpen(false);
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-feature-findings"] });
    queryClient.invalidateQueries({ queryKey: ["security", "remediation-action-findings"] });
    queryClient.invalidateQueries({ queryKey: ["security", "overview"] });
  };

  const targetsForConfirm =
    selectedFindings.length > 0
      ? selectedFindings.filter((f) => findingHasDn(f))
      : remediableRows;

  return (
    <Box sx={{ p: 3, maxWidth: 1920, mx: "auto" }}>
      <Button
        component={RouterLink}
        to={backTo}
        startIcon={<ArrowBackIcon />}
        size="small"
        sx={{ textTransform: "none", mb: 1.5 }}
      >
        Back to Remediation
      </Button>

      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", md: "center" }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <RiskSeverityChip severity={severity} />
            <Typography variant="h5" sx={securityPageHeaderSx}>
              {featureDisplayName(featureId)}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {findings.length} affected {findings.length === 1 ? "object" : "objects"}
            {featureStats?.resolved != null ? ` · ${featureStats.resolved} resolved vs earlier scan` : ""}
          </Typography>
        </Box>
        {applicationId && (
          <SecurityExportMenu applicationId={applicationId} scanId={currentScanId} />
        )}
      </Stack>

      {!applicationId ? (
        <EmptyStateSecurity
          title="Select an application"
          description="Open Remediation Center and choose an application first."
        />
      ) : (
        <>
          <AssessmentContextBar />

          {findingsQuery.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {findingsQuery.error?.message || "Failed to load findings"}
            </Alert>
          )}

          {result && (
            <Alert
              severity={result.failed.length ? "warning" : "success"}
              sx={{ mb: 2 }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  sx={{ textTransform: "none" }}
                  onClick={() => navigate(buildPath("/security/scans"))}
                >
                  Verify with Scan
                </Button>
              }
            >
              {result.failed.length
                ? `Remediation partially completed — ${result.ok} of ${result.total} resolved, ${result.failed.length} require attention.`
                : `Remediation successful — ${result.ok} of ${result.total} issues resolved.`}
            </Alert>
          )}

          {busy && progress && (
            <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
              <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
                Remediating…
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {progress.index} of {progress.total} completed
              </Typography>
              <LinearProgress
                variant="determinate"
                value={(progress.index / progress.total) * 100}
                sx={{ mb: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                Current: {progress.current}
              </Typography>
            </Paper>
          )}

          <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              Why this matters
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {whyItMatters ||
                "Review this Active Directory finding and remediate when appropriate."}
            </Typography>
          </Paper>

          <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              Recommended action
            </Typography>
            <Typography variant="body1" fontWeight={700} sx={{ mt: 0.5, mb: 1.5 }}>
              {recommendedActionLabel(featureId)}
            </Typography>
            <Typography variant="overline" color="text.secondary" fontWeight={800}>
              What ADShield will change
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, mb: 2 }}>
              {whatAdShieldWillChange(featureId)}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                label={`Remediation: ${remediationAvailabilityLabel(availability)}`}
                color={availability === "remediable" ? "success" : "default"}
                variant="outlined"
              />
              {SAFE_BULK_FEATURES.has(String(featureId)) && remediableRows.length > 0 && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    sx={{ textTransform: "none" }}
                    onClick={selectAllSafe}
                  >
                    Select All Safe Items
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    sx={{ textTransform: "none" }}
                    disabled={busy || (selectedIds.length === 0 && remediableRows.length === 0)}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {selectedIds.length
                      ? `Remediate Selected (${selectedIds.length})`
                      : `Remediate (${remediableRows.length})`}
                  </Button>
                </>
              )}
            </Stack>
          </Paper>

          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
            Affected objects
          </Typography>
          <Paper sx={{ p: 1, border: 1, borderColor: "divider" }}>
            <Box sx={{ width: "100%", minHeight: 420 }}>
              <DataGrid
                rows={gridRows}
                columns={columns}
                loading={findingsQuery.isLoading}
                pageSizeOptions={[25, 50]}
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                disableRowSelectionOnClick
                onRowClick={(params) => setSelected(params.row)}
                disableColumnMenu
                density="compact"
                sx={{
                  border: "none",
                  "& .MuiDataGrid-row": { cursor: "pointer" },
                }}
              />
            </Box>
          </Paper>
        </>
      )}

      <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remediate {featureDisplayName(featureId)}?</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography variant="body2">
              {targetsForConfirm.length}{" "}
              {targetsForConfirm.length === 1 ? "object" : "objects"} will be updated in Active
              Directory.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              ADShield will:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              <Typography component="li" variant="body2">
                apply the configured remediation ({whatAdShieldWillChange(featureId)})
              </Typography>
              <Typography component="li" variant="body2">
                verify the resulting AD state
              </Typography>
              <Typography component="li" variant="body2">
                update the finding status
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={busy} sx={{ textTransform: "none" }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={runSelectedRemediation}
            disabled={busy || !targetsForConfirm.length}
            sx={{ textTransform: "none" }}
          >
            Remediate
          </Button>
        </DialogActions>
      </Dialog>

      <RiskDrilldownDrawer
        open={Boolean(selected)}
        finding={selected}
        onClose={() => setSelected(null)}
        remediationContext={{
          baselineScanId,
          currentScanId,
          queuedInfo: findingTargetId(selected)
            ? queueStatus.getQueuedInfo?.(String(findingTargetId(selected)))
            : null,
        }}
      />
    </Box>
  );
}
