import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  Chip,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import GppBadOutlinedIcon from "@mui/icons-material/GppBadOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import PersonOffOutlinedIcon from "@mui/icons-material/PersonOffOutlined";
import RestartAltOutlinedIcon from "@mui/icons-material/RestartAltOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import { REMEDIATION_ACTION_ACCENTS } from "../../../../features/remediation-events/constants";
import { remediationEventsPath } from "../../../../features/remediation-events/paths";

const ICONS = {
  "access-revoke": GppBadOutlinedIcon,
  "iam-orphan-review": PersonOffOutlinedIcon,
};

export default function RemediationWorkflowRuleCard({
  action,
  workflows,
  draftWorkflowId,
  savedWorkflowId,
  savedWorkflowName,
  isDirty,
  isSaving,
  onDraftChange,
  onSave,
  onReset,
}) {
  const Icon = ICONS[action.slug] || GppBadOutlinedIcon;
  const accent = REMEDIATION_ACTION_ACCENTS[action.accent] || REMEDIATION_ACTION_ACCENTS.green;
  const isConfigured = Boolean(savedWorkflowId);
  const selectedWorkflow = workflows.find((w) => w.id === draftWorkflowId);

  let statusChip;
  if (isDirty) {
    statusChip = (
      <Chip
        size="small"
        icon={<ErrorOutlineIcon />}
        label="Unsaved changes"
        color="warning"
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    );
  } else if (isConfigured) {
    statusChip = (
      <Chip
        size="small"
        icon={<CheckCircleOutlineIcon />}
        label="Configured"
        color="success"
        variant="outlined"
        sx={{ fontWeight: 600 }}
      />
    );
  } else {
    statusChip = (
      <Chip
        size="small"
        label="Not configured"
        variant="outlined"
        sx={{ fontWeight: 600, color: "text.secondary", borderColor: "divider" }}
      />
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 2,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderColor: isDirty ? accent.main : "divider",
        boxShadow: isDirty ? `0 0 0 1px ${accent.main}22` : "none",
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      <Box
        sx={{
          px: 2.5,
          py: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: accent.soft,
        }}
      >
        <Stack direction="row" spacing={1.5} alignItems="flex-start" justifyContent="space-between">
          <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: accent.icon,
                color: accent.main,
                flexShrink: 0,
              }}
            >
              <Icon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" fontWeight={700} letterSpacing="-0.01em">
                {action.label}
              </Typography>
              <Chip
                label={action.badge}
                size="small"
                sx={{
                  mt: 0.75,
                  height: 22,
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  bgcolor: "#fff",
                  border: `1px solid ${accent.border}`,
                  color: accent.main,
                }}
              />
            </Box>
          </Stack>
          {statusChip}
        </Stack>
      </Box>

      <Box sx={{ p: 2.5, flex: 1, display: "flex", flexDirection: "column" }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.6 }}>
          {action.description}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2.5 }}>
          {action.runtimeNote}
        </Typography>

        <Box
          sx={{
            mb: 2.5,
            p: 1.5,
            borderRadius: 1.5,
            bgcolor: "#f8fafc",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: "block", mb: 0.5 }}>
            Active mapping
          </Typography>
          {isConfigured ? (
            <Typography variant="body2" fontWeight={600} noWrap title={savedWorkflowName}>
              {savedWorkflowName}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" fontStyle="italic">
              No workflow assigned — remediation for this event will fail until configured.
            </Typography>
          )}
        </Box>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel id={`wf-${action.value}`}>Default workflow</InputLabel>
          <Select
            labelId={`wf-${action.value}`}
            label="Default workflow"
            value={draftWorkflowId || ""}
            onChange={(e) => onDraftChange(action.value, e.target.value)}
          >
            <MenuItem value="">
              <em>Clear mapping</em>
            </MenuItem>
            {workflows.map((w) => (
              <MenuItem key={w.id} value={w.id}>
                {w.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedWorkflow && draftWorkflowId !== savedWorkflowId && (
          <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
            Pending: <strong>{selectedWorkflow.name}</strong>
          </Typography>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
          sx={{ mt: "auto", pt: 1 }}
        >
          <Link
            component={RouterLink}
            to={remediationEventsPath(action.slug)}
            underline="hover"
            variant="body2"
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              fontWeight: 600,
              color: "primary.main",
            }}
          >
            View operational queue
            <OpenInNewOutlinedIcon sx={{ fontSize: 16 }} />
          </Link>

          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<RestartAltOutlinedIcon />}
              onClick={() => onReset(action.value)}
              disabled={!isDirty || isSaving}
              sx={{ textTransform: "none", fontWeight: 600, borderColor: "divider" }}
            >
              Reset
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveOutlinedIcon />}
              onClick={() => onSave(action.value)}
              disabled={!isDirty || isSaving}
              sx={{ textTransform: "none", fontWeight: 600, minWidth: 120 }}
            >
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Card>
  );
}
