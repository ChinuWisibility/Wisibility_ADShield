import { Stack, Button, Tooltip } from "@mui/material";
import { Visibility } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { iamOrphanReviewTaskPath } from "../../features/remediation-events/paths";
import QueueFirstRemediationAction from "./QueueFirstRemediationAction";

export default function QueueFirstRemediationRowAction({
  targetId,
  recordLabel,
  eventTypeLabel = "IAM Orphan Review",
  queueAction = "IAM_ORPHAN_REVIEW",
  pipelineSteps,
  queuedInfo,
  disabled = false,
  onQueuedRefresh,
  size = "small",
  variant = "outlined",
  sx,
}) {
  const navigate = useNavigate();
  const id = targetId ? String(targetId) : "";

  if (!id) return null;

  if (queuedInfo?.taskId || queuedInfo?.eventId) {
    const taskId = queuedInfo.taskId || queuedInfo.eventId;
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
        <Tooltip title="This account is in the remediation queue.">
          <span>
            <Button size={size} variant="text" disabled sx={{ textTransform: "none", ...sx }}>
              In queue
            </Button>
          </span>
        </Tooltip>
        <Button
          size={size}
          variant="contained"
          startIcon={<Visibility fontSize="small" />}
          onClick={() => navigate(iamOrphanReviewTaskPath(taskId))}
          sx={{ textTransform: "none", ...sx }}
        >
          View task
        </Button>
      </Stack>
    );
  }

  return (
    <QueueFirstRemediationAction
      queueAction={queueAction}
      pipelineSteps={pipelineSteps}
      eventTypeLabel={eventTypeLabel}
      selectedItems={[{ id, label: recordLabel || id }]}
      disabled={disabled}
      size={size}
      variant={variant}
      sx={sx}
      onQueuedRefresh={onQueuedRefresh}
    />
  );
}
