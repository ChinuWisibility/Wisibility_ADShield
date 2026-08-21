import { Typography, Box, Paper } from "@mui/material";
import HubIcon from "@mui/icons-material/Hub";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { securityPageHeaderSx } from "../securityTheme";

export default function GraphExplorerPlaceholder() {
  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Typography variant="h5" fontWeight={800}>
          Graph Explorer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Interactive attack-path and blast-radius visualization (coming soon)
        </Typography>
      </Box>

      <SecurityApplicationBar />

      <Paper
        sx={{
          p: 6,
          textAlign: "center",
          border: "1px dashed",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        <HubIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
        <Typography variant="h6" fontWeight={700}>
          Graph canvas reserved
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 520, mx: "auto", mt: 1 }}>
          The identity graph engine is materialized in the backend. This view will host
          BloodHound-style exploration, blast-radius analysis, and remediation overlays in a
          future phase.
        </Typography>
      </Paper>
    </Box>
  );
}
