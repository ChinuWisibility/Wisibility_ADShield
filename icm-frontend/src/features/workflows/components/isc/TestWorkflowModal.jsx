import TestWorkflowPanel from "./TestWorkflowPanel";

export default function TestWorkflowModal({
  open,
  workflowId,
  workflowName,
  onClose,
  getDefinition,
}) {
  if (!open) return null;

  return (
    <div
      className={`isc-test-overlay ${open ? "open" : ""}`}
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="isc-test-panel" role="dialog" onClick={(e) => e.stopPropagation()}>
        <TestWorkflowPanel
          workflowId={workflowId}
          workflowName={workflowName}
          onClose={onClose}
          getDefinition={getDefinition}
        />
      </div>
    </div>
  );
}
