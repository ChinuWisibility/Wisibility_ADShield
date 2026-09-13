import { Paper, Stack, Typography, Box } from "@mui/material";
import RemediationKpiStrip from "../../../../features/remediation-events/components/RemediationKpiStrip";
import "../../../../features/remediation-events/styles/remediation-events.css";

/**
 * Progress summary strip — reuses RemediationKpiStrip with Compare-derived metrics.
 */
export default function SecurityRemediationProgressWidget({ progress, pair }) {
  const p = progress || {};
  const items = [
    { label: "Earlier scan", value: p.baselineFindings ?? 0, hint: "Findings then" },
    { label: "Fixed", value: p.resolved ?? 0, tone: "ok", hint: "No longer present" },
    { label: "Still open", value: p.remaining ?? 0, tone: "active", hint: "Still present" },
    { label: "New", value: p.new ?? 0, tone: "fail", hint: "Found only in the later scan" },
    { label: "Came back", value: p.reopened ?? 0, hint: "Fixed once, then returned" },
    {
      label: "Overall progress",
      value: `${p.progressPercent ?? 0}%`,
      tone: p.tone || (p.progressPercent >= 70 ? "ok" : p.progressPercent >= 30 ? "active" : "fail"),
      hint: "Share of earlier findings fixed",
    },
  ];

  return (
    <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>
            Progress summary
          </Typography>
          <Typography variant="caption" color="text.secondary">
            What changed between your earlier and later scans
          </Typography>
        </Box>
        {pair?.lastComparedAt && (
          <Typography variant="caption" color="text.secondary">
            Last compared {new Date(pair.lastComparedAt).toLocaleString()}
          </Typography>
        )}
      </Stack>
      <RemediationKpiStrip items={items} />
    </Paper>
  );
}
