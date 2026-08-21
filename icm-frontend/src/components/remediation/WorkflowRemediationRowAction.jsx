import { Stack, Button, Tooltip } from "@mui/material";
import { Visibility } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { workflowRemediationQueuePath } from "../../features/workflow-remediation-queue/paths";
import WorkflowRemediationBulkAction from "./WorkflowRemediationBulkAction";

/**
 * Per-row WRQ action: Already In Queue + View, or Remediate (single-item batch).
 */
export default function WorkflowRemediationRowAction({
  targetId,
  recordLabel,
  eventType,
  eventTypeLabel,
  queueSlug,
  queuedInfo,
  context,
  sharedContext,
  disabled = false,
  onQueuedRefresh,
  onSuccess,
  onClearSelection,
  size = "small",
  variant = "outlined",
  sx,
}) {
  const navigate = useNavigate();
  const id = targetId ? String(targetId) : "";

  if (!id) return null;

  if (queuedInfo?.eventId) {
    const slug = queuedInfo.queueSlug || queueSlug;
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
        <Tooltip title="This record is in an open Workflow Remediation Queue event.">
          <span>
            <Button size={size} variant="text" disabled sx={{ textTransform: "none", ...sx }}>
              Already In Queue
            </Button>
          </span>
        </Tooltip>
        <Button
          size={size}
          variant="contained"
          startIcon={<Visibility fontSize="small" />}
          onClick={() =>
            navigate(workflowRemediationQueuePath(slug, { eventId: queuedInfo.eventId }))
          }
          sx={{ textTransform: "none", ...sx }}
        >
          View Queue Item
        </Button>
      </Stack>
    );
  }

  return (
    <WorkflowRemediationBulkAction
      eventType={eventType}
      eventTypeLabel={eventTypeLabel}
      queueSlug={queueSlug}
      selectedItems={[{ id, label: recordLabel || id, context }]}
      sharedContext={sharedContext}
      disabled={disabled}
      size={size}
      variant={variant}
      sx={sx}
      onQueuedRefresh={onQueuedRefresh}
      onSuccess={onSuccess}
      onClearSelection={onClearSelection}
    />
  );
}
