import { useEffect, useMemo, useState } from "react";
import {
  Box,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  Button,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { securityAPI } from "../../../../services/securityApi";
import { useSecurityWorkspace } from "../../SecurityWorkspaceContext";

const PAIR_STORAGE_PREFIX = "icm:securityRemediationPair:v2:";

function storageKey(applicationId, assessmentId, versionId) {
  return `${PAIR_STORAGE_PREFIX}${applicationId}:${assessmentId || "_"}:${versionId || "_"}`;
}

function readStoredPair(applicationId, assessmentId, versionId) {
  if (!applicationId || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(storageKey(applicationId, assessmentId, versionId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredPair(applicationId, assessmentId, versionId, baselineScanId, currentScanId) {
  if (!applicationId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      storageKey(applicationId, assessmentId, versionId),
      JSON.stringify({ baselineScanId, currentScanId, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore quota */
  }
}

/**
 * Baseline ↔ Current execution pair selector.
 * Lists only executions belonging to the selected Assessment Version
 * (viewVersionId, or the Version of the current execution / latest Version).
 */
export default function AssessmentPairSelector({
  baselineScanId,
  currentScanId,
  onBaselineChange,
  onCurrentChange,
}) {
  const {
    applicationId,
    assessmentId,
    assessment,
    viewVersionId,
    setScanId,
    overview,
  } = useSecurityWorkspace();
  const [initialized, setInitialized] = useState(false);

  const scansQuery = useQuery({
    queryKey: [
      "security",
      "scans-remediation-pair",
      applicationId,
      assessmentId,
      viewVersionId,
      assessment?.latestVersionId,
    ],
    queryFn: async () => {
      const res = await securityAPI.listScans(applicationId, {
        limit: 50,
        page: 1,
        assessmentId: assessmentId || undefined,
      });
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
    enabled: Boolean(applicationId),
  });

  const allScans = scansQuery.data || [];

  const selectedVersionId = useMemo(() => {
    if (viewVersionId) return String(viewVersionId);
    if (currentScanId) {
      const current = allScans.find((s) => s.scanId === currentScanId);
      if (current?.assessmentVersionId) return String(current.assessmentVersionId);
    }
    if (overview?.scan?.assessmentVersionId) {
      return String(overview.scan.assessmentVersionId);
    }
    if (assessment?.latestVersionId) return String(assessment.latestVersionId);
    const newestWithVersion = allScans.find((s) => s.assessmentVersionId);
    return newestWithVersion?.assessmentVersionId
      ? String(newestWithVersion.assessmentVersionId)
      : "";
  }, [
    viewVersionId,
    currentScanId,
    allScans,
    overview?.scan?.assessmentVersionId,
    assessment?.latestVersionId,
  ]);

  const scans = useMemo(() => {
    if (!selectedVersionId) {
      // No Version yet — only show executions that also lack a Version (legacy),
      // or empty until a Version exists.
      return allScans.filter((s) => !s.assessmentVersionId);
    }
    return allScans.filter(
      (s) => String(s.assessmentVersionId || "") === selectedVersionId,
    );
  }, [allScans, selectedVersionId]);

  const versionLabel = useMemo(() => {
    if (
      assessment?.latestVersionId &&
      String(assessment.latestVersionId) === selectedVersionId &&
      assessment.latestVersionNumber != null
    ) {
      return `Version ${assessment.latestVersionNumber}`;
    }
    return selectedVersionId ? "selected Version" : "this Assessment";
  }, [assessment?.latestVersionId, assessment?.latestVersionNumber, selectedVersionId]);

  const scanLabel = useMemo(() => {
    const map = new Map(
      scans.map((s) => [
        s.scanId,
        s.completedAt || s.startedAt
          ? new Date(s.completedAt || s.startedAt).toLocaleString()
          : s.scanId?.slice(0, 8),
      ]),
    );
    return (id) => map.get(id) || (id ? `${String(id).slice(0, 8)}…` : "—");
  }, [scans]);

  // Drop baseline/current if they are outside the Version-scoped list.
  useEffect(() => {
    if (!scansQuery.isSuccess || !selectedVersionId) return;
    const ids = new Set(scans.map((s) => s.scanId));
    if (baselineScanId && !ids.has(baselineScanId)) {
      onBaselineChange?.("");
    }
    if (currentScanId && !ids.has(currentScanId) && scans[0]?.scanId) {
      onCurrentChange?.(scans[0].scanId);
      setScanId(scans[0].scanId);
    }
  }, [
    scansQuery.isSuccess,
    selectedVersionId,
    scans,
    baselineScanId,
    currentScanId,
    onBaselineChange,
    onCurrentChange,
    setScanId,
  ]);

  useEffect(() => {
    setInitialized(false);
  }, [applicationId, assessmentId, selectedVersionId]);

  useEffect(() => {
    if (!applicationId || initialized || scansQuery.isLoading) return;
    if (!scans.length && !allScans.length) {
      setInitialized(true);
      return;
    }
    if (!scans.length) {
      setInitialized(true);
      return;
    }

    const stored = readStoredPair(applicationId, assessmentId, selectedVersionId);
    let nextBaseline = baselineScanId;
    let nextCurrent = currentScanId;
    const ids = new Set(scans.map((s) => s.scanId));

    if (!nextCurrent || !ids.has(nextCurrent)) {
      nextCurrent =
        (stored?.currentScanId && ids.has(stored.currentScanId) && stored.currentScanId) ||
        (overview?.scan?.scanId && ids.has(overview.scan.scanId) && overview.scan.scanId) ||
        scans[0]?.scanId ||
        "";
      if (nextCurrent && onCurrentChange) onCurrentChange(nextCurrent);
      if (nextCurrent) setScanId(nextCurrent);
    }

    if (!nextBaseline || !ids.has(nextBaseline) || nextBaseline === nextCurrent) {
      nextBaseline =
        (stored?.baselineScanId &&
          ids.has(stored.baselineScanId) &&
          stored.baselineScanId !== nextCurrent &&
          stored.baselineScanId) ||
        scans.find((s) => s.scanId !== nextCurrent)?.scanId ||
        "";
      if (nextBaseline && onBaselineChange) onBaselineChange(nextBaseline);
    }

    setInitialized(true);
  }, [
    applicationId,
    assessmentId,
    selectedVersionId,
    baselineScanId,
    currentScanId,
    initialized,
    onBaselineChange,
    onCurrentChange,
    overview?.scan?.scanId,
    scans,
    allScans.length,
    scansQuery.isLoading,
    setScanId,
  ]);

  useEffect(() => {
    if (!applicationId || !baselineScanId || !currentScanId || !selectedVersionId) return;
    writeStoredPair(
      applicationId,
      assessmentId,
      selectedVersionId,
      baselineScanId,
      currentScanId,
    );
  }, [applicationId, assessmentId, selectedVersionId, baselineScanId, currentScanId]);

  if (!applicationId) return null;

  return (
    <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", md: "center" }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>
            Assessment pair
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Baseline vs current — only executions of the {versionLabel} (same Version required)
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems="center">
          <TextField
            select
            size="small"
            label="Baseline execution"
            value={baselineScanId && scans.some((s) => s.scanId === baselineScanId) ? baselineScanId : ""}
            onChange={(e) => onBaselineChange?.(e.target.value)}
            sx={{ minWidth: 200 }}
            disabled={!scans.length}
          >
            {scans.map((s) => (
              <MenuItem key={s.scanId} value={s.scanId}>
                {scanLabel(s.scanId)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Current execution"
            value={currentScanId && scans.some((s) => s.scanId === currentScanId) ? currentScanId : ""}
            onChange={(e) => {
              onCurrentChange?.(e.target.value);
              setScanId(e.target.value);
            }}
            sx={{ minWidth: 200 }}
            disabled={!scans.length}
          >
            {scans.map((s) => (
              <MenuItem key={s.scanId} value={s.scanId}>
                {scanLabel(s.scanId)}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant="outlined"
            sx={{ textTransform: "none" }}
            disabled={scans.length < 2}
            onClick={() => {
              const newer = scans[0]?.scanId;
              const older = scans[1]?.scanId;
              if (older) onBaselineChange?.(older);
              if (newer) {
                onCurrentChange?.(newer);
                setScanId(newer);
              }
            }}
          >
            Use latest pair
          </Button>
        </Stack>
      </Stack>
      {selectedVersionId && scans.length === 0 && !scansQuery.isLoading && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          No executions under this Version yet. Execute the Assessment again to build a comparable
          pair.
        </Typography>
      )}
      {scans.length === 1 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
          Need a second execution under the same Version to measure remediation progress.
        </Typography>
      )}
    </Paper>
  );
}
