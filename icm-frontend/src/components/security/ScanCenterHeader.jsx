import {
  Autocomplete,
  TextField,
  Box,
  Button,
  CircularProgress,
  Typography,
  Stack,
  Tooltip,
  Alert,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import { useNavigate } from "react-router-dom";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { SCAN_CENTER_INK } from "../../pages/security/securityTheme";

export default function ScanCenterHeader({
  applicationId,
  setApplicationId,
  applications,
  applicationsLoading,
  tenantId,
  refreshWorkspace,
  scanRunning,
  scanNotice,
  setScanNotice,
  overview,
  selectedFeature,
  onRunFullScan,
  onRunSelectedFeature,
  headerError,
  setHeaderError,
  enabledFeatureCount = null,
  runDisabled = false,
  runDisabledReason = "Select or create an Assessment first",
}) {
  const navigate = useNavigate();
  const { buildPath } = useSecurityWorkspace();
  const selected = applications.find((a) => String(a._id) === applicationId) || null;
  const lastScan = overview?.scan?.completedAt;
  const totalFindings = overview?.totals?.findings ?? 0;
  const cannotRun = !applicationId || scanRunning || runDisabled;
  const executeLabel =
    enabledFeatureCount != null && enabledFeatureCount > 0
      ? `Execute Assessment (${enabledFeatureCount})`
      : "Execute Assessment";

  if (!tenantId) {
    return (
      <Alert severity="info" sx={{ mb: 2 }}>
        Select or sign in with a tenant-scoped account to view applications in Security Center.
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      {scanNotice && (
        <Alert
          severity={scanNotice.type}
          sx={{ mb: 1.5 }}
          onClose={() => setScanNotice(null)}
          action={
            scanNotice.showContinuation && applicationId ? (
              <Stack direction="row" spacing={0.5}>
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => navigate(buildPath("/security/dashboard"))}
                  sx={{ textTransform: "none" }}
                >
                  View dashboard
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => navigate(buildPath("/security/findings"))}
                  sx={{ textTransform: "none" }}
                >
                  View findings
                </Button>
              </Stack>
            ) : null
          }
        >
          {scanNotice.message}
        </Alert>
      )}
      {headerError && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setHeaderError("")}>
          {headerError}
        </Alert>
      )}

      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 1.5,
          alignItems: "center",
          p: 1.5,
          borderRadius: 1,
          border: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Autocomplete
          size="small"
          sx={{ minWidth: 220, flex: "1 1 220px", maxWidth: 360 }}
          loading={applicationsLoading}
          options={applications}
          value={selected}
          onChange={(_, app) => setApplicationId(app ? String(app._id) : "")}
          getOptionLabel={(o) => o?.name || ""}
          isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
          renderInput={(params) => (
            <TextField {...params} label="Application" placeholder="Select application" />
          )}
        />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Tooltip
            title={
              runDisabled
                ? runDisabledReason
                : enabledFeatureCount != null
                  ? `Execute Assessment — ${enabledFeatureCount} enabled feature${
                      enabledFeatureCount === 1 ? "" : "s"
                    }`
                  : "Execute Assessment (auto-versions)"
            }
          >
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={
                  scanRunning ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <PlaylistPlayIcon />
                  )
                }
                disabled={cannotRun}
                onClick={onRunFullScan}
              >
                {executeLabel}
              </Button>
            </span>
          </Tooltip>

          <Tooltip
            title={
              runDisabled
                ? runDisabledReason
                : selectedFeature
                  ? `Execute ${selectedFeature.name}`
                  : "Select a feature in the list"
            }
          >
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowIcon />}
                disabled={
                  cannotRun ||
                  !selectedFeature?.implemented ||
                  !selectedFeature?.enabled
                }
                onClick={onRunSelectedFeature}
              >
                Execute selected feature
              </Button>
            </span>
          </Tooltip>

          <Button
            size="small"
            variant="text"
            startIcon={<RefreshIcon />}
            disabled={!applicationId}
            onClick={() => refreshWorkspace()}
          >
            Refresh
          </Button>
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box>
            <Typography
              variant="caption"
              display="block"
              sx={{ color: SCAN_CENTER_INK.soft }}
            >
              Last scan
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ color: SCAN_CENTER_INK.primary }}>
              {lastScan ? new Date(lastScan).toLocaleString() : "—"}
            </Typography>
          </Box>
          <Box>
            <Typography
              variant="caption"
              display="block"
              sx={{ color: SCAN_CENTER_INK.soft }}
            >
              Total findings
            </Typography>
            <Typography variant="body2" fontWeight={700} sx={{ color: SCAN_CENTER_INK.primary }}>
              {Number(totalFindings).toLocaleString()}
            </Typography>
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
