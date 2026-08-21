import { Button, Tooltip } from "@mui/material";
import QueueFirstRemediationRowAction from "../remediation/QueueFirstRemediationRowAction";
import { IAM_ORPHAN_QUEUE_MODAL_PIPELINE } from "../../features/remediation-events/utils/iamOrphanReviewPipeline";

/**
 * Reuses the Uncorrelated Accounts queue-first Remediate button when a
 * compatible account target id is present. Does not extend the remediation framework.
 */
export default function SecurityFindingRemediateButton({
  finding,
  queuedInfo = null,
  onQueuedRefresh = null,
}) {
  if (!finding) return null;

  const targetId =
    finding.attributes?.orphanId ||
    finding.attributes?.accountId ||
    finding.metadata?.orphanId ||
    finding.metadata?.accountId ||
    finding.evidence?.orphanId ||
    finding.evidence?.accountId ||
    null;

  if (targetId) {
    return (
      <QueueFirstRemediationRowAction
        targetId={String(targetId)}
        recordLabel={finding.objectName || String(targetId)}
        eventTypeLabel="IAM Orphan Review"
        queueAction="IAM_ORPHAN_REVIEW"
        pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
        queuedInfo={queuedInfo}
        onQueuedRefresh={onQueuedRefresh}
        size="small"
        variant="outlined"
      />
    );
  }

  return (
    <Tooltip title="Follow the recommendation above. Queue-first Remediate is available when the finding is linked to an account target (same control as Uncorrelated Accounts).">
      <span>
        <Button size="small" variant="outlined" disabled sx={{ textTransform: "none" }}>
          Remediate
        </Button>
      </span>
    </Tooltip>
  );
}
