import {
  Autocomplete,
  TextField,
  Box,
  Button,
  CircularProgress,
  Tooltip,
  Alert,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useSecurityWorkspace } from "./SecurityWorkspaceContext";

export default function SecurityApplicationBar({ showRunScan = false }) {
  const {
    applicationId,
    setApplicationId,
    applications,
    applicationsLoading,
    tenantId,
    refreshWorkspace,
    runScan,
    scanRunning,
    scanNotice,
    setScanNotice,
    overview,
  } = useSecurityWorkspace();

  const selected = applications.find((a) => String(a._id) === applicationId) || null;

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
        >
          {scanNotice.message}
        </Alert>
      )}
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
      <Autocomplete
        size="small"
        sx={{ minWidth: 280, flex: "1 1 280px" }}
        loading={applicationsLoading}
        options={applications}
        value={selected}
        onChange={(_, app) => setApplicationId(app ? String(app._id) : "")}
        getOptionLabel={(o) => o?.name || ""}
        isOptionEqualToValue={(a, b) => String(a?._id) === String(b?._id)}
        renderInput={(params) => (
          <TextField {...params} label="Application scope" placeholder="Select application" />
        )}
      />
      <Tooltip title="Refresh posture data">
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshIcon />}
            disabled={!applicationId}
            onClick={() => refreshWorkspace()}
          >
            Refresh
          </Button>
        </span>
      </Tooltip>
      {showRunScan && (
        <Tooltip title="Run identity graph security scan">
          <span>
            <Button
              size="small"
              variant="contained"
              startIcon={scanRunning ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
              disabled={!applicationId || scanRunning}
              onClick={() => runScan()}
            >
              Run scan
            </Button>
          </span>
        </Tooltip>
      )}
      {overview?.scan?.completedAt && (
        <Box component="span" sx={{ typography: "caption", color: "text.secondary" }}>
          Last scan: {new Date(overview.scan.completedAt).toLocaleString()}
        </Box>
      )}
      </Box>
    </Box>
  );
}
