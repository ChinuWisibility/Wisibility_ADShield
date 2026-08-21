import { Chip } from "@mui/material";

const TONE = {
  resolved: { label: "Resolved", color: "success" },
  remaining: { label: "Remaining", color: "warning" },
  unchanged: { label: "Remaining", color: "warning" },
  new: { label: "New", color: "error" },
  reopened: { label: "Reopened", color: "secondary" },
  queued: { label: "In queue", color: "info" },
  in_progress: { label: "In progress", color: "info" },
  waiting: { label: "Waiting", color: "default" },
  completed: { label: "Completed", color: "success" },
  failed: { label: "Failed", color: "error" },
  open: { label: "Open", color: "default" },
};

/**
 * Compact status chip for remediation / compare / queue states.
 */
export default function SecurityRemediationStatusChip({ status, label, size = "small" }) {
  const key = String(status || "").toLowerCase();
  const meta = TONE[key] || { label: label || status || "—", color: "default" };
  return (
    <Chip
      size={size}
      color={meta.color}
      variant="outlined"
      label={label || meta.label}
      sx={{ fontWeight: 600 }}
    />
  );
}
