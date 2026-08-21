import { TextField, Typography, Box } from "@mui/material";
import {
  DEFAULT_INACTIVE_USERS_DAYS,
  INACTIVE_USERS_DAYS_MAX,
  INACTIVE_USERS_DAYS_MIN,
} from "../../utils/securityScanSettings";

export default function InactiveUsersThresholdField({
  value,
  onChange,
  disabled = false,
  helperText = "Accounts with no logon within this period are flagged as inactive (uses lastLogonTimestamp).",
}) {
  return (
    <Box>
      <TextField
        label="Inactive users threshold (days)"
        type="number"
        size="small"
        fullWidth
        disabled={disabled}
        value={value ?? DEFAULT_INACTIVE_USERS_DAYS}
        onChange={(e) => onChange(e.target.value)}
        inputProps={{
          min: INACTIVE_USERS_DAYS_MIN,
          max: INACTIVE_USERS_DAYS_MAX,
          step: 1,
        }}
        helperText={helperText}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
        Default is {DEFAULT_INACTIVE_USERS_DAYS} days. Allowed range: {INACTIVE_USERS_DAYS_MIN}–
        {INACTIVE_USERS_DAYS_MAX}.
      </Typography>
    </Box>
  );
}
