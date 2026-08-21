import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import "../../features/workflows/styles/isc-theme.css";
import "../../features/workflow-remediation-queue/styles/workflow-remediation-queue.css";
import {
  loadRemediationWorkflowOptions,
  workflowDisplayLabel,
} from "./remediationWorkflowPicker";

const DEFAULT_PIPELINE = [
  { label: "Queued", hint: "Status New" },
  { label: "Scheduler", hint: "Tenant interval" },
  { label: "Workflow", hint: "Runs on pickup" },
];

export default function QueueFirstRemediationModal({
  open,
  onClose,
  onConfirm,
  queueAction = "IAM_ORPHAN_REVIEW",
  title = "Queue IAM review",
  eventTypeLabel,
  recordLabel,
  recordCount,
  pipelineSteps = DEFAULT_PIPELINE,
  loading = false,
  error = "",
}) {
  const [localError, setLocalError] = useState("");
  const [workflows, setWorkflows] = useState([]);
  const [workflowId, setWorkflowId] = useState("");
  const [defaultWorkflowId, setDefaultWorkflowId] = useState("");
  const [triggerLabel, setTriggerLabel] = useState("");
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [loadError, setLoadError] = useState("");
  const isBulk = recordCount != null && recordCount > 1;

  useEffect(() => {
    if (!open) return;
    setLocalError("");
    setLoadError("");
    setLoadingWorkflows(true);
    loadRemediationWorkflowOptions(queueAction)
      .then(({ workflows: list, defaultWorkflowId: grsId, initialWorkflowId, triggerLabel: tl }) => {
        setWorkflows(list);
        setDefaultWorkflowId(grsId || "");
        setWorkflowId(initialWorkflowId || "");
        setTriggerLabel(tl || "");
      })
      .catch(() => setLoadError("Could not load workflows for this trigger."))
      .finally(() => setLoadingWorkflows(false));
  }, [open, queueAction]);

  const selected = useMemo(
    () => workflows.find((w) => w.id === workflowId) || null,
    [workflows, workflowId],
  );

  const pipelineWithWorkflow = useMemo(() => {
    const wfName = selected?.name;
    return pipelineSteps.map((step) => {
      if (step.label !== "Workflow" && step.label !== "Workflow execution") return step;
      return {
        ...step,
        hint: wfName ? wfName : step.hint || "Runs on scheduler pickup",
      };
    });
  }, [pipelineSteps, selected?.name]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    if (!workflowId) {
      setLocalError("Select a workflow to continue.");
      return;
    }
    try {
      await onConfirm({
        workflowId,
        workflowName: selected?.name || "",
      });
      onClose();
    } catch (err) {
      setLocalError(
        err.response?.data?.message || err.message || "Failed to queue remediation.",
      );
    }
  };

  const displayError = localError || error;
  const confirmLabel = isBulk ? `Queue ${recordCount} accounts` : "Queue for review";
  const submitDisabled = loading || loadingWorkflows || !workflowId;

  return createPortal(
    <div className="isc-modal-overlay open wrq-intake-overlay" role="presentation" onClick={onClose}>
      <div
        className="isc-modal wrq-trigger-modal wrq-intake-modal wrq-queue-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wrq-queue-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="isc-modal-header">
          <div>
            <div className="isc-modal-title" id="wrq-queue-confirm-title">
              {title}
            </div>
            <p className="wrq-modal-subtitle wrq-queue-confirm__lede">
              Choose which workflow runs when the scheduler picks up this task. The Global Rule Set
              default is pre-selected — change it here for this queue action only.
            </p>
          </div>
          <button type="button" className="isc-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="wrq-modal-body wrq-queue-confirm__body">
            <div className="wrq-queue-confirm__record">
              <span className="wrq-queue-confirm__record-kicker">
                {isBulk ? "Selected accounts" : "Account"}
              </span>
              <strong className="wrq-queue-confirm__record-value">
                {isBulk ? `${recordCount} uncorrelated accounts` : recordLabel || "—"}
              </strong>
              <span className="wrq-queue-confirm__event-badge">{eventTypeLabel}</span>
            </div>

            {loadingWorkflows && (
              <div className="wrq-workflow-loading">Loading workflows for {eventTypeLabel}…</div>
            )}
            {loadError && <p className="wrq-modal-error">{loadError}</p>}

            {!loadingWorkflows && !loadError && workflows.length === 0 && (
              <div className="wrq-workflow-empty">
                <strong>No enabled workflows found</strong>
                <p>
                  Create and enable a workflow with trigger{" "}
                  {triggerLabel ? `"${triggerLabel}"` : "for this event"} in the Workflow Builder,
                  then map it in Global Rule Set.
                </p>
                <Link
                  to="/org-admin/global-rule-set/remediation-workflow-rules"
                  className="wrq-queue-confirm__error-link"
                  onClick={onClose}
                >
                  Open remediation workflow rules
                </Link>
              </div>
            )}

            {!loadingWorkflows && workflows.length > 0 && (
              <>
                <div className="wrq-intake-field-label">Workflow</div>
                <p className="wrq-queue-confirm__workflow-hint">
                  All enabled workflows for this trigger. The Global Rule Set default is marked and
                  selected automatically.
                </p>
                <div className="wrq-workflow-picker" role="radiogroup" aria-label="Workflow">
                  {workflows.map((wf) => {
                    const isSelected = workflowId === wf.id;
                    const isDefault = Boolean(defaultWorkflowId && wf.id === defaultWorkflowId);
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
                          <span className="wrq-workflow-option-name-row">
                            <span className="wrq-workflow-option-name">
                              {workflowDisplayLabel(workflows, wf)}
                            </span>
                            {isDefault && (
                              <span className="wrq-workflow-option-badge">Global Rule Set default</span>
                            )}
                          </span>
                          {wf.description && (
                            <span className="wrq-workflow-option-desc">{wf.description}</span>
                          )}
                          <span className="wrq-workflow-option-meta">
                            {wf.trigger?.type || triggerLabel || "Unknown trigger"}
                            {wf.version ? ` · Version ${wf.version}` : ""}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            <div className="wrq-queue-confirm__pipeline">
              <span className="wrq-queue-confirm__pipeline-label">What happens next</span>
              <ol className="wrq-queue-confirm__steps" aria-label="Remediation flow">
                {pipelineWithWorkflow.map((step, index) => (
                  <li key={step.label} className="wrq-queue-confirm__step">
                    <span className="wrq-queue-confirm__step-marker">{index + 1}</span>
                    <div className="wrq-queue-confirm__step-copy">
                      <span className="wrq-queue-confirm__step-title">{step.label}</span>
                      {step.hint && (
                        <span className="wrq-queue-confirm__step-hint">{step.hint}</span>
                      )}
                    </div>
                    {index < pipelineWithWorkflow.length - 1 && (
                      <span className="wrq-queue-confirm__step-line" aria-hidden />
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {displayError && (
              <div className="wrq-queue-confirm__error">
                <p className="wrq-modal-error">{displayError}</p>
                {displayError.includes("Global Rule Set") && (
                  <Link
                    to="/org-admin/global-rule-set/remediation-workflow-rules"
                    className="wrq-queue-confirm__error-link"
                    onClick={onClose}
                  >
                    Open remediation workflow rules
                  </Link>
                )}
              </div>
            )}
          </div>

          <div className="wrq-modal-footer">
            <button type="button" className="isc-btn isc-btn-outline" onClick={onClose} disabled={loading}>
              Not now
            </button>
            <button type="submit" className="isc-btn isc-btn-primary" disabled={submitDisabled}>
              {loading ? "Queuing…" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
