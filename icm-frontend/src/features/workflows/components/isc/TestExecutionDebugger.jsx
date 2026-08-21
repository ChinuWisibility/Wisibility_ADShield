import { useEffect, useState } from "react";
import {
  formatExecutionTime,
  formatJsonBlock,
  getStepStatusMeta,
} from "../../utils/testRunnerUtils";

export default function TestExecutionDebugger({
  executionSteps = [],
  failedStepId,
  selectedStepId,
  onSelectStep,
  variant = "default",
}) {
  const [internalSelectedId, setInternalSelectedId] = useState(null);
  const activeId = selectedStepId ?? internalSelectedId;
  const setActiveId = onSelectStep || setInternalSelectedId;

  useEffect(() => {
    if (selectedStepId != null) return;
    if (!executionSteps.length) {
      setInternalSelectedId(null);
      return;
    }
    const failed =
      executionSteps.find((s) => s.stepId === failedStepId) ||
      executionSteps.find((s) => s.status === "FAILED");
    const firstExecuted = executionSteps.find(
      (s) => s.status !== "SKIPPED" && s.status !== "PENDING",
    );
    setInternalSelectedId(failed?.stepId || firstExecuted?.stepId || executionSteps[0].stepId);
  }, [executionSteps, failedStepId, selectedStepId]);

  const selected = executionSteps.find((s) => s.stepId === activeId);
  const selectedMeta = selected ? getStepStatusMeta(selected.status) : null;

  return (
    <div className={`isc-test-debugger ${variant === "embedded" ? "isc-test-debugger-embedded" : ""}`}>
      <div className="isc-test-debugger-timeline">
        <div className="isc-test-debugger-timeline-head">Execution timeline</div>
        <ol className="isc-test-debugger-steps">
          {executionSteps.map((step, index) => {
            const meta = getStepStatusMeta(step.status);
            const isSelected = step.stepId === activeId;
            const isFailed = step.status === "FAILED";
            return (
              <li
                key={step.stepId}
                className={`isc-test-debugger-step ${meta.className} ${isSelected ? "selected" : ""} ${isFailed ? "is-failed-step" : ""}`}
              >
                <button
                  type="button"
                  className="isc-test-debugger-step-btn"
                  onClick={() => setActiveId(step.stepId)}
                >
                  <span className={`isc-test-debugger-icon ${meta.className}`} aria-hidden>
                    {meta.icon}
                  </span>
                  <span className="isc-test-debugger-step-body">
                    <span className="isc-test-debugger-step-label">{step.label}</span>
                    <span className="isc-test-debugger-step-type">{step.stepType}</span>
                  </span>
                  <span className={`isc-test-debugger-step-status ${meta.className}`}>
                    {step.status}
                  </span>
                </button>
                {index < executionSteps.length - 1 && (
                  <span className={`isc-test-debugger-connector ${meta.className}`} aria-hidden />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="isc-test-debugger-detail">
        {!selected ? (
          <div className="isc-test-debugger-detail-empty">
            Select a step to inspect execution details.
          </div>
        ) : (
          <>
            <div className="isc-test-debugger-detail-head">
              <div>
                <h4>{selected.label}</h4>
                <p>{selected.stepType}</p>
              </div>
              {selectedMeta && (
                <span className={`isc-test-debugger-detail-badge ${selectedMeta.className}`}>
                  {selected.status}
                </span>
              )}
            </div>

            <dl className="isc-test-debugger-dl">
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>
              <div>
                <dt>Execution time</dt>
                <dd>{formatExecutionTime(selected.executionTime)}</dd>
              </div>
              {selected.branch != null && (
                <div>
                  <dt>Branch</dt>
                  <dd>{selected.branch}</dd>
                </div>
              )}
              {(selected.retryCount > 0 || selected.attemptNumber > 1) && (
                <div>
                  <dt>Retries</dt>
                  <dd>{selected.retryCount ?? (selected.attemptNumber - 1)}</dd>
                </div>
              )}
              {selected.error && (
                <div className="isc-test-debugger-error-row">
                  <dt>Error message</dt>
                  <dd>{selected.error}</dd>
                </div>
              )}
              {selected.stackTrace && (
                <div className="isc-test-debugger-error-row">
                  <dt>Stack trace</dt>
                  <dd>
                    <pre className="isc-test-debugger-pre">{selected.stackTrace}</pre>
                  </dd>
                </div>
              )}
            </dl>

            <div className="isc-test-debugger-payload">
              <div className="isc-test-debugger-payload-block">
                <div className="isc-test-debugger-payload-label">Input payload</div>
                <pre className="isc-test-debugger-pre">{formatJsonBlock(selected.input)}</pre>
              </div>
              <div className="isc-test-debugger-payload-block">
                <div className="isc-test-debugger-payload-label">Output payload</div>
                <pre className="isc-test-debugger-pre">{formatJsonBlock(selected.output)}</pre>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
