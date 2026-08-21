import Chip from "@mui/material/Chip";

const STATUS_MAP = {
  completed: { label: "Completed", color: "success" },
  failed: { label: "Failed", color: "error" },
  running: { label: "Running", color: "info" },
  queued: { label: "Queued", color: "default" },
  fetching: { label: "Fetching", color: "info" },
  analyzing: { label: "Analyzing", color: "warning" },
  stale: { label: "Stale", color: "warning" },
};

export default function ScanStatusBadge({ status }) {
  const key = String(status || "unknown").toLowerCase();
  const cfg = STATUS_MAP[key] || { label: key, color: "default" };
  return <Chip size="small" label={cfg.label} color={cfg.color} variant="outlined" />;
}
