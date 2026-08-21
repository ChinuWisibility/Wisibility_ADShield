import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useSecurityWorkspace } from "../../pages/security/SecurityWorkspaceContext";
import { SCAN_CENTER_INK } from "../../pages/security/securityTheme";

function ContextField({ label, value }) {
  return (
    <Box sx={{ minWidth: 140 }}>
      <Typography
        variant="caption"
        fontWeight={600}
        display="block"
        sx={{ letterSpacing: 0.2, color: SCAN_CENTER_INK.soft }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={700}
        sx={{ wordBreak: "break-word", color: SCAN_CENTER_INK.primary }}
      >
        {value ?? "—"}
      </Typography>
    </Box>
  );
}

/**
 * Assessment context strip — labeled fields (no chips).
 */
export default function AssessmentContextBar({ actions = null }) {
  const navigate = useNavigate();
  const {
    applicationId,
    applications,
    assessment,
    viewVersion,
    isViewingVersion,
    overview,
    buildPath,
  } = useSecurityWorkspace();
  const app = (applications || []).find((a) => String(a._id) === String(applicationId));
  const scan = overview?.scan;
  const totals = overview?.totals || {};

  if (!applicationId) return null;

  const lastScan =
    scan?.completedAt || scan?.startedAt
      ? new Date(scan.completedAt || scan.startedAt).toLocaleString()
      : "—";

  const assessmentName = assessment?.name || "—";
  const configMode = isViewingVersion
    ? viewVersion?.label || `Version ${viewVersion?.versionNumber ?? ""}`
    : "Working Configuration";
  const status = assessment?.status || scan?.status || "—";
  const findings = totals.findings ?? 0;

  return (
    <Paper
      sx={{
        p: 1.5,
        mb: 2,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.default",
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1.5}
        alignItems={{ xs: "stretch", md: "center" }}
        justifyContent="space-between"
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={{ xs: 2, md: 3 }}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 0.25 }}
          >
            <ContextField label="Assessment Name" value={assessmentName} />
            <ContextField label="Configuration" value={configMode} />
            <ContextField label="Application" value={app?.name || "—"} />
            <ContextField label="Status" value={status} />
            <ContextField label="Findings" value={Number(findings).toLocaleString()} />
            <ContextField label="Last Scan" value={lastScan} />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {actions}
          <Button
            size="small"
            variant="outlined"
            onClick={() => navigate(buildPath("/security/dashboard"))}
            sx={{ textTransform: "none" }}
          >
            View dashboard
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => navigate(buildPath("/security/findings"))}
            sx={{ textTransform: "none" }}
          >
            View findings
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
