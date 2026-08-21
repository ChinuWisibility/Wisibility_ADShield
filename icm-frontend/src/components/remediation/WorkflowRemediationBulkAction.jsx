import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Tooltip } from "@mui/material";
import { PlaylistAdd } from "@mui/icons-material";
import useWorkflowRemediationQueue from "../../hooks/useWorkflowRemediationQueue";
import WorkflowSelectionModal from "./WorkflowSelectionModal";
import "../../features/workflow-remediation-queue/styles/workflow-remediation-queue.css";

function buildTargetIdsKey(selectedItems = []) {
  return selectedItems
    .filter((item) => item?.id)
    .map((item) => String(item.id))
    .sort()
    .join(",");
}

/**
 * Reusable WRQ intake for single or multi-select batches.
 * selectedItems: [{ id, label, context? }]
 */
export default function WorkflowRemediationBulkAction({
  eventType,
  eventTypeLabel,
  queueSlug,
  selectedItems = [],
  disabled = false,
  size = "small",
  variant = "outlined",
  sx,
  sharedContext,
  onSuccess,
  onClearSelection,
  onQueuedRefresh,
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [queueCheck, setQueueCheck] = useState(null);
  const [checkingQueue, setCheckingQueue] = useState(false);
  const [queueCheckCompleted, setQueueCheckCompleted] = useState(false);
  const [queueCheckError, setQueueCheckError] = useState("");
  const checkRequestIdRef = useRef(0);

  const targetIdsKey = buildTargetIdsKey(selectedItems);
  const targetIds = targetIdsKey ? targetIdsKey.split(",") : [];
  const items = selectedItems.filter((item) => item?.id);

  const { manualEnqueue, loadWorkflows, checkQueuedTargets } = useWorkflowRemediationQueue({
    eventType,
    queueSlug,
  });

  const runQueueCheck = useCallback(() => {
    if (!targetIdsKey) {
      setQueueCheck(null);
      setQueueCheckError("");
      setCheckingQueue(false);
      setQueueCheckCompleted(true);
      return;
    }

    const requestId = ++checkRequestIdRef.current;
    setQueueCheckCompleted(false);
    setQueueCheckError("");
    setCheckingQueue(true);

    checkQueuedTargets({ eventType, targetIds: targetIdsKey.split(",") })
      .then((data) => {
        if (requestId !== checkRequestIdRef.current) return;
        setQueueCheck(data);
        setQueueCheckError("");
      })
      .catch((err) => {
        if (requestId !== checkRequestIdRef.current) return;
        setQueueCheck(null);
        setQueueCheckError(
          err.response?.data?.message
            || err.response?.data?.error?.message
            || "Unable to validate queue status.",
        );
      })
      .finally(() => {
        if (requestId === checkRequestIdRef.current) {
          setCheckingQueue(false);
          setQueueCheckCompleted(true);
        }
      });
  }, [checkQueuedTargets, eventType, targetIdsKey]);

  useEffect(() => {
    if (!modalOpen) {
      setQueueCheck(null);
      setCheckingQueue(false);
      setQueueCheckCompleted(false);
      setQueueCheckError("");
      return undefined;
    }

    runQueueCheck();

    return () => {
      checkRequestIdRef.current += 1;
    };
  }, [modalOpen, targetIdsKey, runQueueCheck]);

  const handleOpen = () => {
    if (!items.length || disabled) return;
    setModalOpen(true);
  };

  const handleSubmit = async ({ workflowId, proceedWithAvailable = true }) => {
    if (!queueCheckCompleted || checkingQueue || queueCheckError) {
      throw new Error("Queue validation must complete before adding to the queue.");
    }

    setSubmitting(true);
    try {
      const contexts = items.map((item) => ({
        targetId: String(item.id),
        ...(item.context || {}),
      }));

      const data = await manualEnqueue({
        eventType,
        targetIds,
        workflowId,
        context: sharedContext || {},
        contexts,
        proceedWithAvailable,
      });

      if (data?.created) {
        onSuccess?.(data);
        onClearSelection?.();
        await onQueuedRefresh?.();
        setModalOpen(false);
      } else if (data?.partialConflict) {
        setQueueCheck({
          alreadyQueued: data.alreadyQueued || [],
          availableIds: data.availableIds || [],
          targetIds,
        });
        throw new Error(data.message || "Some records are already in the queue.");
      } else if (data?.duplicate) {
        setQueueCheck({
          alreadyQueued: data.alreadyQueued || [],
          availableIds: [],
          targetIds,
        });
        throw new Error(data.message || "All selected records are already in the queue.");
      }
      return data;
    } finally {
      setSubmitting(false);
    }
  };

  if (!items.length) return null;

  const label = items.length === 1 ? "Remediate" : `Remediate Selected (${items.length})`;
  const recordLabel =
    items.length === 1
      ? items[0].label || items[0].id
      : `${items.length} record${items.length === 1 ? "" : "s"}`;

  return (
    <>
      <Tooltip
        title={
          disabled
            ? "Remediation is not available for this selection"
            : "Add selected records to Workflow Remediation Queue"
        }
      >
        <span>
          <Button
            size={size}
            variant={variant}
            disabled={disabled || submitting}
            startIcon={<PlaylistAdd fontSize="small" />}
            onClick={handleOpen}
            sx={{ textTransform: "none", ...sx }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>

      <WorkflowSelectionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        onRetryQueueCheck={runQueueCheck}
        eventTypeLabel={eventTypeLabel || eventType?.replace(/_/g, " ")}
        recordCount={items.length}
        recordLabel={recordLabel}
        queueCheck={queueCheck}
        checkingQueue={checkingQueue}
        queueCheckCompleted={queueCheckCompleted}
        queueCheckError={queueCheckError}
        loadWorkflows={loadWorkflows}
        loading={submitting}
      />
    </>
  );
}
