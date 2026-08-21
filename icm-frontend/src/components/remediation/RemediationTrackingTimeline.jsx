import { Box, Chip, Step, StepLabel, Stepper, Tooltip, Typography } from "@mui/material";
import { palette } from "../../theme/palette";

const STAGES = [
  { key: "emailStatus", label: "Email" },
  {
    key: "managerStatus",
    label: "Certification Review",
    tooltip:
      "Manager or external certification reviewer completed approve/revoke decisions before remediation.",
  },
  { key: "itsmStatus", label: "ITSM" },
  { key: "validationStatus", label: "Validation" },
  { key: "reportingStatus", label: "Reporting" },
];

const STATUS_COLORS = {
  PENDING: palette.text.disabled,
  SENT: palette.status.info,
  GRANTED: palette.brand.primary,
  VALIDATED: palette.status.success,
  FAILED: palette.status.error,
  EXPIRED: palette.status.error,
};

function labelize(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function stageIndex(status) {
  const order = ["PENDING", "SENT", "GRANTED", "VALIDATED"];
  if (["FAILED", "EXPIRED"].includes(status)) return -1;
  return order.indexOf(status);
}

export default function RemediationTrackingTimeline({ tracking, compact = false }) {
  if (!tracking) {
    return (
      <Typography variant="body2" color="text.secondary">
        No tracking data available.
      </Typography>
    );
  }

  const activeStep = STAGES.reduce((max, stage, idx) => {
    const st = tracking[stage.key]?.status || "PENDING";
    const si = stageIndex(st);
    return si >= 0 ? Math.max(max, idx) : max;
  }, 0);

  return (
    <Box sx={{ width: "100%", py: compact ? 1 : 2 }}>
      <Stepper activeStep={activeStep} alternativeLabel={!compact}>
        {STAGES.map((stage) => {
          const stageData = tracking[stage.key] || { status: "PENDING" };
          const status = stageData.status || "PENDING";
          const at = stageData.at;
          const tooltipTitle =
            stage.tooltip ||
            (at ? new Date(at).toLocaleString() : "Not started");

          return (
            <Step key={stage.key} completed={["VALIDATED", "SENT", "GRANTED"].includes(status)}>
              <StepLabel
                optional={
                  <Tooltip
                    title={tooltipTitle}
                    arrow
                  >
                    <Box sx={{ mt: 0.5 }}>
                      <Chip
                        label={labelize(status)}
                        size="small"
                        sx={{
                          bgcolor: `${STATUS_COLORS[status] || palette.text.disabled}1A`,
                          color: STATUS_COLORS[status] || palette.text.disabled,
                          fontWeight: 700,
                          fontSize: 11,
                          height: 22,
                        }}
                      />
                    </Box>
                  </Tooltip>
                }
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {stage.label}
                </Typography>
              </StepLabel>
            </Step>
          );
        })}
      </Stepper>
    </Box>
  );
}
