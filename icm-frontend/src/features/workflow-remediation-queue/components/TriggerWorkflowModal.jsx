import { useEffect, useMemo, useState } from "react";
import { workflowApi } from "../../workflows/services/api";

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

export default function TriggerWorkflowModal({
  open,
  onClose,
  onSubmit,
  triggerType,
  loading,
  presetWorkflowId,
  presetWorkflowName,
}) {
  const [workflows, setWorkflows] = useState([]);
  const [workflowId, setWorkflowId] = useState("");
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (presetWorkflowId) {
      setWorkflowId(presetWorkflowId);
      setWorkflows(presetWorkflowName ? [{ id: presetWorkflowId, name: presetWorkflowName }] : []);
      setError("");
      setLoadError("");
      setLoadingWorkflows(false);
      return;
    }
    setWorkflowId("");
    setError("");
    setLoadError("");
    setLoadingWorkflows(true);
    workflowApi
      .enabled(triggerType || undefined)
      .then((r) => {
        const list = dedupeWorkflows(r.data?.data || []);
        setWorkflows(list);
        if (list.length === 1) setWorkflowId(list[0].id);
      })
      .catch(() => setLoadError("Could not load workflows."))
      .finally(() => setLoadingWorkflows(false));
  }, [open, triggerType, presetWorkflowId, presetWorkflowName]);

  const selected = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId],
  );

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!workflowId) {
      setError("Select a workflow to continue.");
      return;
    }
    try {
      await onSubmit({ workflowId });
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to trigger workflow.");
    }
  };

  return (
    <div className="isc-modal-overlay open" role="presentation" onClick={onClose}>
      <div
        className="isc-modal wrq-trigger-modal"
        role="dialog"
        aria-labelledby="wrq-trigger-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="isc-modal-header">
          <div>
            <div className="isc-modal-title" id="wrq-trigger-title">Trigger Workflow</div>
            <p className="wrq-modal-subtitle">
              {presetWorkflowId
                ? "Confirm workflow execution using the workflow selected during intake."
                : "Choose an enabled workflow to run for this queue event."}
            </p>
          </div>
          <button type="button" className="isc-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form className="wrq-trigger-form" onSubmit={handleSubmit}>
          <div className="wrq-modal-body">
            {triggerType && (
              <div className="wrq-trigger-hint">
                <span className="wrq-trigger-hint-label">Required trigger</span>
                <code>{triggerType}</code>
              </div>
            )}

            {loadingWorkflows && (
              <div className="wrq-workflow-loading">Loading workflows…</div>
            )}

            {loadError && <p className="wrq-modal-error">{loadError}</p>}

            {!presetWorkflowId && !loadingWorkflows && !loadError && workflows.length === 0 && (
              <div className="wrq-workflow-empty">
                <strong>No enabled workflows found</strong>
                <p>
                  Create and enable a workflow with the{" "}
                  <code>{triggerType || "matching"}</code> trigger in the Workflow Builder.
                </p>
              </div>
            )}

            {!presetWorkflowId && !loadingWorkflows && workflows.length > 0 && (
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
            )}

            {selected && (
              <div className="wrq-workflow-selected-summary">
                <span className="wrq-workflow-selected-label">Selected</span>
                <strong>{workflowDisplayLabel(workflows, selected)}</strong>
              </div>
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
              disabled={loading || loadingWorkflows || !workflowId}
            >
              {loading ? "Triggering…" : "Trigger Workflow"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
