import {
  Paper,
  Stack,
  Typography,
  Button,
  Chip,
  Box,
} from "@mui/material";
import RiskSeverityChip from "../../../../components/security/RiskSeverityChip";
import { remediationAvailabilityLabel } from "../adShieldRemediationMeta";

export default function RemediationFindingList({ rows = [], onView, onRemediateFeature }) {
  if (!rows.length) return null;

  return (
    <Stack spacing={1.5}>
      {rows.map((row) => {
        const canRemediate =
          row.availability === "remediable" || row.remediableCount > 0;
        return (
          <Paper
            key={row.feature}
            variant="outlined"
            sx={{
              p: 2,
              borderColor: "divider",
              "&:hover": { borderColor: "primary.light", bgcolor: "action.hover" },
            }}
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "flex-start" }}
              spacing={2}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                  <RiskSeverityChip severity={row.severity} />
                  <Typography variant="subtitle1" fontWeight={800}>
                    {row.title}
                  </Typography>
                  <Chip
                    size="small"
                    label={`${row.count} affected`}
                    variant="outlined"
                    sx={{ fontWeight: 700 }}
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {row.whyItMatters ||
                    row.recommendation ||
                    "Security finding detected in Active Directory."}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Typography variant="caption" color="text.secondary">
                    Remediation:{" "}
                    <Box component="span" fontWeight={700} color="text.primary">
                      {row.availabilityLabel || remediationAvailabilityLabel(row.availability)}
                    </Box>
                  </Typography>
                  {row.availability === "requires_review" && (
                    <Chip size="small" label="Requires review" color="warning" variant="outlined" />
                  )}
                  {row.availability === "not_remediable" && (
                    <Chip size="small" label="Not remediable" variant="outlined" />
                  )}
                </Stack>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
                <Button
                  size="small"
                  variant="outlined"
                  sx={{ textTransform: "none" }}
                  onClick={() => onView?.(row)}
                >
                  View affected objects
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  sx={{ textTransform: "none" }}
                  disabled={!canRemediate}
                  onClick={() => onRemediateFeature?.(row)}
                >
                  Remediate
                </Button>
              </Stack>
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
