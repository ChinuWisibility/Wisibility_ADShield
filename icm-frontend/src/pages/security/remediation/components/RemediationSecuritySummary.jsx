import { Paper, Stack, Typography, Box, Grid } from "@mui/material";
import { SEVERITY_COLORS } from "../../securityTheme";

/**
 * Compact severity summary for issues needing attention.
 */
export default function RemediationSecuritySummary({
  needingAttention = 0,
  bySeverity = {},
  resolved = 0,
}) {
  const cells = [
    { key: "critical", label: "Critical", value: bySeverity.critical || 0 },
    { key: "high", label: "High", value: bySeverity.high || 0 },
    { key: "medium", label: "Medium", value: bySeverity.medium || 0 },
    { key: "low", label: "Low", value: bySeverity.low || 0 },
  ];

  return (
    <Paper sx={{ p: 2.5, mb: 2, border: 1, borderColor: "divider" }}>
      <Typography variant="h6" fontWeight={800} sx={{ mb: 0.5 }}>
        {needingAttention} {needingAttention === 1 ? "issue needs" : "issues need"} attention
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Issues currently present in Active Directory that still require review or remediation.
      </Typography>
      <Grid container spacing={1.5}>
        {cells.map((cell) => {
          const colors = SEVERITY_COLORS[cell.key] || SEVERITY_COLORS.unknown;
          return (
            <Grid item xs={6} sm={3} md={2} key={cell.key}>
              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 1,
                  bgcolor: colors.bg,
                  border: `1px solid ${colors.main}33`,
                }}
              >
                <Typography variant="caption" fontWeight={700} sx={{ color: colors.main }}>
                  {cell.label}
                </Typography>
                <Typography variant="h5" fontWeight={800} sx={{ color: colors.main }}>
                  {cell.value}
                </Typography>
              </Box>
            </Grid>
          );
        })}
        <Grid item xs={6} sm={3} md={2}>
          <Box
            sx={{
              p: 1.25,
              borderRadius: 1,
              bgcolor: "action.hover",
              border: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="caption" fontWeight={700} color="text.secondary">
              Resolved
            </Typography>
            <Typography variant="h5" fontWeight={800}>
              {resolved}
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Paper>
  );
}
