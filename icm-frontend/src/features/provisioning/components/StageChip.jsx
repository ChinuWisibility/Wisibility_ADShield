import { Chip } from "@mui/material";

const STAGE_META = {
  AWAITING_APPROVAL: { label: "Awaiting approval", color: "warning" },
  COMPILING: { label: "Compiling plan", color: "info" },
  READY_TO_PROVISION: { label: "Ready to provision", color: "info" },
  PROVISIONING: { label: "Provisioning", color: "info" },
  COMPLETED: { label: "Provisioned", color: "success" },
  ALREADY_SATISFIED: { label: "Already had account", color: "default" },
  FAILED: { label: "Failed", color: "error" },
  REJECTED: { label: "Rejected", color: "default" },
};

const TASK_STATUS_COLOR = {
  PENDING: "default",
  RUNNING: "info",
  RETRYING: "warning",
  COMPLETED: "success",
  FAILED: "error",
  SKIPPED: "default",
};

export default function StageChip({ stage, size = "small" }) {
  const meta = STAGE_META[stage] || { label: stage || "Unknown", color: "default" };
  return <Chip size={size} label={meta.label} color={meta.color} variant="filled" />;
}

export function TaskStatusChip({ status, size = "small" }) {
  return (
    <Chip
      size={size}
      label={status}
      color={TASK_STATUS_COLOR[status] || "default"}
      variant="outlined"
    />
  );
}
