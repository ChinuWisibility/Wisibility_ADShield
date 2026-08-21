import { useCallback, useMemo, useState } from "react";
import { Button, Tooltip } from "@mui/material";
import { PlaylistAdd } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import { workflowTaskQueueApi } from "../../features/remediation-events/services/api";
import QueueFirstRemediationModal from "./QueueFirstRemediationModal";
import { ACCESS_REVOKE_QUEUE_MODAL_PIPELINE } from "../../features/remediation-events/utils/accessRevokePipeline";
import { IAM_ORPHAN_QUEUE_MODAL_PIPELINE } from "../../features/remediation-events/utils/iamOrphanReviewPipeline";

const QUEUE_ACTION_META = {
  IAM_ORPHAN_REVIEW: {
    tooltip: "Queue selected accounts for IAM orphan review",
    defaultLabel: "Remediate",
    modalTitle: "Queue IAM review",
    eventTypeLabel: "IAM Orphan Review",
    pipelineSteps: IAM_ORPHAN_QUEUE_MODAL_PIPELINE,
    grsHint: "Map IAM_ORPHAN_REVIEW to a workflow in Global Rule Set → Remediation workflow rules.",
  },
  ACCESS_REVOKE: {
    tooltip: "Queue selected certification revokes for remediation",
    defaultLabel: "Queue revoke",
    modalTitle: "Queue access revoke",
    eventTypeLabel: "Access Revoke",
    pipelineSteps: ACCESS_REVOKE_QUEUE_MODAL_PIPELINE,
    grsHint: "Map ACCESS_REVOKE to a workflow in Global Rule Set → Remediation workflow rules.",
  },
};

/**
 * Queue-first remediation with enterprise workflow picker (Global Rule Set default pre-selected).
 * selectedItems: [{ id, label, reviewItemId?, entitlementName?, context? }]
 */
export default function QueueFirstRemediationAction({
  queueAction = "IAM_ORPHAN_REVIEW",
  eventTypeLabel,
  modalTitle,
  pipelineSteps,
  selectedItems = [],
  disabled = false,
  size = "small",
  variant = "outlined",
  sx,
  onSuccess,
  onClearSelection,
  onQueuedRefresh,
  successPath = null,
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const meta = QUEUE_ACTION_META[queueAction] || QUEUE_ACTION_META.IAM_ORPHAN_REVIEW;
  const items = selectedItems.filter((item) => item?.id || item?.reviewItemId);

  const revokeItems = useMemo(
    () =>
      items.map((item) => ({
        reviewItemId: String(item.reviewItemId || item.id),
        entitlementName: item.entitlementName || item.context?.entitlementName || null,
        campaignName: item.campaignName || item.context?.campaignName || null,
      })),
    [items],
  );

  const orphanIds = useMemo(
    () => items.map((item) => String(item.id)),
    [items],
  );

  const handleConfirm = useCallback(
    async ({ workflowId } = {}) => {
      setSubmitting(true);
      setError("");
      try {
        if (!workflowId) {
          throw new Error("Select a workflow to continue.");
        }
        let res;
        if (queueAction === "IAM_ORPHAN_REVIEW") {
          res = await workflowTaskQueueApi.enqueueIamOrphanReview(orphanIds, { workflowId });
        } else if (queueAction === "ACCESS_REVOKE") {
          res = await workflowTaskQueueApi.enqueueAccessRevoke(revokeItems, { workflowId });
        } else {
          throw new Error("Unsupported queue action");
        }
        const data = res.data?.data || {};
        if (data.duplicate && !data.createdCount) {
          throw new Error(data.message || "All selected records are already in the queue.");
        }
        if (!data.createdCount && !data.duplicateCount) {
          throw new Error(res.data?.message || meta.grsHint);
        }
        onSuccess?.(data);
        onClearSelection?.();
        await onQueuedRefresh?.();
        if (successPath) navigate(successPath);
        return data;
      } catch (err) {
        const msg =
          err.response?.data?.message || err.message || "Failed to add to remediation queue.";
        setError(msg);
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [
      queueAction,
      orphanIds,
      revokeItems,
      onSuccess,
      onClearSelection,
      onQueuedRefresh,
      navigate,
      successPath,
      meta.grsHint,
    ],
  );

  if (!items.length) return null;

  const label =
    items.length === 1 ? meta.defaultLabel : `${meta.defaultLabel} Selected (${items.length})`;
  const recordLabel =
    items.length === 1 ? items[0].label || items[0].id : `${items.length} records`;

  return (
    <>
      <Tooltip title={meta.tooltip}>
        <span>
          <Button
            size={size}
            variant={variant}
            disabled={disabled || submitting}
            startIcon={<PlaylistAdd fontSize="small" />}
            onClick={() => setOpen(true)}
            sx={{ textTransform: "none", ...sx }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>

      <QueueFirstRemediationModal
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={handleConfirm}
        queueAction={queueAction}
        title={modalTitle || meta.modalTitle}
        eventTypeLabel={eventTypeLabel || meta.eventTypeLabel}
        recordCount={items.length}
        recordLabel={recordLabel}
        pipelineSteps={pipelineSteps || meta.pipelineSteps}
        loading={submitting}
        error={error}
      />
    </>
  );
}
