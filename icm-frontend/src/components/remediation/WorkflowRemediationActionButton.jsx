import WorkflowRemediationBulkAction from "./WorkflowRemediationBulkAction";

/**
 * Thin wrapper for single-record intake. Prefer WorkflowRemediationBulkAction directly.
 */
export default function WorkflowRemediationActionButton({
  eventType,
  eventTypeLabel,
  targetId,
  targetIds,
  recordLabel,
  queueSlug,
  context,
  disabled = false,
  size = "small",
  variant = "outlined",
  sx,
  enabled = true,
}) {
  if (!enabled) return null;

  const ids = targetIds?.length
    ? targetIds.map(String)
    : targetId
      ? [String(targetId)]
      : [];

  if (!ids.length) return null;

  const selectedItems =
    targetIds?.length > 1
      ? targetIds.map((id, idx) => ({
          id: String(id),
          label: recordLabel && idx === 0 ? recordLabel : String(id),
          context,
        }))
      : [
          {
            id: ids[0],
            label: recordLabel || ids[0],
            context,
          },
        ];

  return (
    <WorkflowRemediationBulkAction
      eventType={eventType}
      eventTypeLabel={eventTypeLabel}
      queueSlug={queueSlug}
      selectedItems={selectedItems}
      sharedContext={context}
      disabled={disabled}
      size={size}
      variant={variant}
      sx={sx}
    />
  );
}
