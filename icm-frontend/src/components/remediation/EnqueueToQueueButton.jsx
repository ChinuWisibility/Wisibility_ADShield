import { useState } from "react";
import { Button, CircularProgress, Snackbar, Alert } from "@mui/material";
import { QueuePlayNext } from "@mui/icons-material";
import { remediationAPI } from "../../services/remediationService";

export default function EnqueueToQueueButton({
  eventType,
  subjects = [],
  sourceMeta = {},
  label = "Send to Remediation Queue",
  size = "small",
  variant = "outlined",
  disabled = false,
  onSuccess,
  sx,
}) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ open: false, message: "", severity: "success" });

  const handleEnqueue = async () => {
    if (!subjects.length) {
      setToast({ open: true, message: "No items to enqueue.", severity: "warning" });
      return;
    }
    setLoading(true);
    try {
      const res = await remediationAPI.enqueueToQueue({
        eventType,
        subjects,
        sourceMeta,
      });
      const created = res.data?.data?.created;
      setToast({
        open: true,
        message: created
          ? `Added ${subjects.length} item(s) to remediation queue.`
          : "Queue record already exists for this detection batch.",
        severity: "success",
      });
      onSuccess?.(res.data?.data);
    } catch (e) {
      setToast({
        open: true,
        message: e.response?.data?.error?.message || "Failed to enqueue items.",
        severity: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled || loading || !subjects.length}
        startIcon={loading ? <CircularProgress size={14} /> : <QueuePlayNext fontSize="small" />}
        onClick={handleEnqueue}
        sx={{ textTransform: "none", ...sx }}
      >
        {label}
      </Button>
      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={toast.severity} onClose={() => setToast((t) => ({ ...t, open: false }))}>
          {toast.message}
        </Alert>
      </Snackbar>
    </>
  );
}
