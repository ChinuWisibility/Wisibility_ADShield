import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  CircularProgress,
} from "@mui/material";
import SyncIcon from "@mui/icons-material/Sync";

const SYNC_SCOPES = [
  {
    value: "total",
    label: "Total Sync",
    description: "Sync all user accounts from Active Directory.",
  },
  {
    value: "active",
    label: "Active Users Only",
    description: "LDAP filter excludes disabled accounts.",
  },
  {
    value: "disabled",
    label: "Disabled Users Only",
    description: "LDAP filter returns disabled accounts only.",
  },
];

export default function ADSyncDialog({
  open,
  onClose,
  application,
  onConfirm,
  confirming = false,
}) {
  const [syncScope, setSyncScope] = useState("total");

  useEffect(() => {
    if (!open) return;
    setSyncScope("total");
  }, [open]);

  const estimatedObjects = application?.totalUsers || 0;

  const handleConfirm = () => {
    onConfirm({ syncScope });
  };

  return (
    <Dialog open={open} onClose={confirming ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontWeight: 800 }}>
        <SyncIcon color="primary" />
        AD Sync Configuration
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          Sync scope
        </Typography>
        <RadioGroup
          value={syncScope}
          onChange={(e) => setSyncScope(e.target.value)}
        >
          {SYNC_SCOPES.map((scope) => (
            <FormControlLabel
              key={scope.value}
              value={scope.value}
              disabled={confirming}
              control={<Radio />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {scope.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {scope.description}
                  </Typography>
                </Box>
              }
              sx={{ alignItems: "flex-start", mb: 1 }}
            />
          ))}
        </RadioGroup>

        {estimatedObjects > 0 && (
          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: "action.hover",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              Estimated objects
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              ~{estimatedObjects.toLocaleString()} users
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={confirming}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={confirming}
          startIcon={confirming ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {confirming ? "Running…" : "Run Sync"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
