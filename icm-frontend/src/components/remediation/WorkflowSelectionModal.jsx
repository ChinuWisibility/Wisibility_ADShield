import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import "../../features/workflows/styles/isc-theme.css";
import "../../features/workflow-remediation-queue/styles/workflow-remediation-queue.css";

function dedupeWorkflows(list = []) {
  const seen = new Set();
  return list.filter((wf) => {
    if (!wf?.id || seen.has(wf.id)) return false;
    seen.add(wf.id);
    return true;
  });
}

function workflowDisplayLabel(workflows, wf) {
  const sameName = workflows.filter((w) => w.name === wf.name);
  if (sameName.length <= 1) return wf.name;
  const version = wf.version ? `v${wf.version}` : null;
  const shortId = wf.id ? wf.id.slice(-6) : null;
  return [wf.name, version || (shortId ? `#${shortId}` : null)].filter(Boolean).join(" · ");
}

export default function WorkflowSelectionModal({
  open,
  onClose,
  onSubmit,
  onRetryQueueCheck,
  eventTypeLabel,
  recordLabel,
  recordCount,
  queueCheck,
  checkingQueue = false,
  queueCheckCompleted = false,
  queueCheckError = "",
  loadWorkflows,
  loading = false,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [workflowId, setWorkflowId] = useState("");
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setWorkflowId("");
    setError("");
    setLoadError("");
    setLoadingWorkflows(true);
    loadWorkflows()
      .then((list) => {
        const deduped = dedupeWorkflows(list);
        setWorkflows(deduped);
        if (deduped.length === 1) setWorkflowId(deduped[0].id);
      })
      .catch((err) => {
        setLoadError(
          err.response?.data?.message
            || err.response?.data?.error?.message
            || "Could not load workflows.",
        );
      })
      .finally(() => setLoadingWorkflows(false));
  }, [open, loadWorkflows]);

  const selected = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId],
  );

  const alreadyQueued = queueCheck?.alreadyQueued || [];
  const availableCount =
    queueCheck?.availableIds?.length ??
    (recordCount != null ? Math.max(0, recordCount - alreadyQueued.length) : null);
  const allQueued = alreadyQueued.length > 0 && availableCount === 0;
  const queueValidationPassed = queueCheckCompleted && !checkingQueue && !queueCheckError;
  const submitDisabled =
    loading
    || loadingWorkflows
    || !workflowId
    || allQueued
    || !queueValidationPassed;

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!workflowId) {
      setError("Select a workflow to continue.");
      return;
    }
    if (!queueCheckCompleted || checkingQueue) {
      setError("Queue validation is still in progress. Please wait.");
      return;
    }
    if (queueCheckError) {
      setError("Unable to validate queue status. Retry validation before continuing.");
      return;
    }
    if (allQueued) {
      setError("All selected records are already in Workflow Remediation Queue.");
      return;
    }
    try {
      await onSubmit({ workflowId, workflowName: selected?.name || "", proceedWithAvailable: true });
      onClose();
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.response?.data?.error?.message ||
          err.message ||
          "Failed to add to queue.",
      );
    }
  };

  return createPortal(
    <div className="isc-modal-overlay open wrq-intake-overlay" role="presentation" onClick={onClose}>
      <div
        className="isc-modal wrq-trigger-modal wrq-intake-modal"
        role="dialog"
        aria-labelledby="wrq-intake-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="isc-modal-header">
          <div>
            <div className="isc-modal-title" id="wrq-intake-title">
              Add To Workflow Remediation Queue
            </div>
            <p className="wrq-modal-subtitle">
              Select a workflow to associate with this queue event. The workflow will not run until
              you trigger it from the queue.
            </p>
          </div>
          <button type="button" className="isc-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="wrq-trigger-form" onSubmit={handleSubmit}>
          <div className="wrq-modal-body">
            <div className="wrq-intake-summary">
              <div className="wrq-intake-summary-row">
                <span className="wrq-intake-summary-label">Event Type</span>
                <strong>{eventTypeLabel}</strong>
              </div>
              <div className="wrq-intake-summary-row">
                <span className="wrq-intake-summary-label">
                  {recordCount != null && recordCount > 1 ? "Selected Records" : "Selected Record"}
                </span>
                <strong>
                  {recordCount != null && recordCount > 1
                    ? recordCount
                    : recordLabel || "—"}
                </strong>
              </div>
            </div>

            {checkingQueue && (
              <div className="wrq-workflow-loading">Checking queue status…</div>
            )}

            {queueCheckError && !checkingQueue && (
              <div className="wrq-intake-check-error">
                <p>{queueCheckError}</p>
                {onRetryQueueCheck && (
                  <button
                    type="button"
                    className="isc-btn isc-btn-outline"
                    onClick={onRetryQueueCheck}
                    disabled={checkingQueue}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {!checkingQueue && !queueCheckError && alreadyQueued.length > 0 && (
              <div className="wrq-intake-conflict">
                <strong>Already in Workflow Remediation Queue</strong>
                <ul>
                  {alreadyQueued.slice(0, 8).map((row) => (
                    <li key={row.targetId}>
                      {row.identityName || row.targetId}
                    </li>
                  ))}
                  {alreadyQueued.length > 8 && (
                    <li>…and {alreadyQueued.length - 8} more</li>
                  )}
                </ul>
                {availableCount > 0 ? (
                  <p>
                    {availableCount} record{availableCount === 1 ? "" : "s"} will be added.
                    Records already queued will be skipped.
                  </p>
                ) : (
                  <p>All selected records are already queued. Cancel or adjust your selection.</p>
                )}
              </div>
            )}

            {loadingWorkflows && <div className="wrq-workflow-loading">Loading workflows…</div>}
            {loadError && <p className="wrq-modal-error">{loadError}</p>}

            {!loadingWorkflows && !loadError && workflows.length === 0 && (
              <div className="wrq-workflow-empty">
                <strong>No enabled workflows found</strong>
                <p>Create and enable a matching workflow in the Workflow Builder.</p>
              </div>
            )}

            {!loadingWorkflows && workflows.length > 0 && (
              <>
                <div className="wrq-intake-field-label">Workflow</div>
                <div className="wrq-workflow-picker" role="radiogroup" aria-label="Workflow">
                  {workflows.map((wf) => {
                    const isSelected = workflowId === wf.id;
                    return (
                      <label
                        key={wf.id}
                        className={`wrq-workflow-option ${isSelected ? "selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="workflowId"
                          value={wf.id}
                          checked={isSelected}
                          onChange={() => setWorkflowId(wf.id)}
                        />
                        <span className="wrq-workflow-option-radio" aria-hidden />
                        <span className="wrq-workflow-option-content">
                          <span className="wrq-workflow-option-name">
                            {workflowDisplayLabel(workflows, wf)}
                          </span>
                          {wf.description && (
                            <span className="wrq-workflow-option-desc">{wf.description}</span>
                          )}
                          <span className="wrq-workflow-option-meta">
                            {wf.trigger?.type || "Unknown trigger"}
                            {wf.version ? ` · Version ${wf.version}` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {error && <p className="wrq-modal-error">{error}</p>}
          </div>

          <div className="wrq-modal-footer">
            <button type="button" className="isc-btn isc-btn-outline" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="isc-btn isc-btn-primary"
              disabled={submitDisabled}
            >
              {loading ? "Adding…" : "Add To Queue"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
