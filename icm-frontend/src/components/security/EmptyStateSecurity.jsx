import { Box, Typography, Button } from "@mui/material";
import SecurityIcon from "@mui/icons-material/Security";

export default function EmptyStateSecurity({
  title = "No data yet",
  description,
  actionLabel,
  onAction,
}) {
  return (
    <Box
      sx={{
        py: 8,
        px: 3,
        textAlign: "center",
        border: "1px dashed",
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "action.hover",
      }}
    >
      <SecurityIcon sx={{ fontSize: 48, color: "text.disabled", mb: 1 }} />
      <Typography variant="h6" fontWeight={700}>
        {title}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 480, mx: "auto" }}>
          {description}
        </Typography>
      )}
      {actionLabel && onAction && (
        <Button variant="contained" sx={{ mt: 2 }} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}
