import Chip from "@mui/material/Chip";
import { SEVERITY_COLORS } from "../../pages/security/securityTheme";

function formatSeverityLabel(severity) {
  const key = String(severity || "unknown").trim().toLowerCase();
  if (key === "not defined") return "Not defined";
  return key.toUpperCase();
}

export default function RiskSeverityChip({ severity, size = "small" }) {
  const key = String(severity || "unknown").trim().toLowerCase();
  const colors = SEVERITY_COLORS[key] || SEVERITY_COLORS.unknown;
  return (
    <Chip
      size={size}
      label={formatSeverityLabel(severity)}
      sx={{
        fontWeight: 700,
        letterSpacing: key === "not defined" ? 0.2 : 0.4,
        bgcolor: colors.bg,
        color: colors.main,
        border: `1px solid ${colors.main}33`,
      }}
    />
  );
}
