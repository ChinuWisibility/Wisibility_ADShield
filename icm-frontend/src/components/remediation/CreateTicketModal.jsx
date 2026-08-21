import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { Send } from "@mui/icons-material";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export default function CreateTicketModal({
  open,
  onClose,
  onSubmit,
  selectedCount = 0,
  loading = false,
  titleDefault = "Revoke Access Remediation Ticket",
  selectedLabel = "revoked user(s)",
}) {
  const [form, setForm] = useState({
    itsmEmail: "",
    title: titleDefault,
    description: "",
    priority: "MEDIUM",
    dueDate: "",
    additionalNotes: "",
  });
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => isValidEmail(form.itsmEmail) && selectedCount > 0 && !loading,
    [form.itsmEmail, selectedCount, loading],
  );

  const handleSend = async () => {
    setError("");
    if (!isValidEmail(form.itsmEmail)) {
      setError("A valid ITSM admin email is required.");
      return;
    }
    if (selectedCount === 0) {
      setError("Select at least one revoked user.");
      return;
    }
    try {
      await onSubmit(form);
      setForm({
        itsmEmail: "",
        title: titleDefault,
        description: "",
        priority: "MEDIUM",
        dueDate: "",
        additionalNotes: "",
      });
    } catch (e) {
      setError(e.response?.data?.error?.message || e.message || "Failed to create ticket.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Create Remediation Ticket</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {selectedCount} {selectedLabel} will be included in this ITSM ticket.
          </Typography>
          {error && (
            <Typography variant="body2" color="error.main">
              {error}
            </Typography>
          )}
          <TextField
            label="ITSM Admin Email"
            required
            value={form.itsmEmail}
            onChange={(e) => setForm((f) => ({ ...f, itsmEmail: e.target.value }))}
            size="small"
            fullWidth
            type="email"
          />
          <TextField
            label="Ticket Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            size="small"
            fullWidth
          />
          <TextField
            label="Description"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <TextField
            select
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            size="small"
            fullWidth
          >
            {PRIORITIES.map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Due Date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
            size="small"
            fullWidth
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Additional Notes"
            value={form.additionalNotes}
            onChange={(e) => setForm((f) => ({ ...f, additionalNotes: e.target.value }))}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<Send fontSize="small" />}
          onClick={handleSend}
          disabled={!canSubmit}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
