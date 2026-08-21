import { useEffect, useMemo, useState } from "react";
import { workflowApi } from "../../services/api";
import RunHistoryPanel from "./RunHistoryPanel";
import TestExecutionDebugger from "./TestExecutionDebugger";
import { pickDefaultStepId, resolveExecutionSteps } from "../../utils/testRunnerUtils";

function hasEmptyVerificationFields(trigger, triggerType) {
  if (!trigger || typeof trigger !== "object") return true;
  if (triggerType === "UncorrelatedAccountIAMDecision") {
    return !String(trigger.orphanId || "").trim();
  }
  const missingIdentity = !String(trigger.identityId || "").trim();
  const missingEntitlement =
    !String(trigger.entitlementId || "").trim() &&
    !String(trigger.entitlementName || "").trim();
  return missingIdentity || missingEntitlement;
}

export default function TestWorkflowPanel({
  workflowId,
  workflowName,
  onClose,
  getDefinition,
}) {
  const [triggerJson, setTriggerJson] = useState("");
  const [scenarios, setScenarios] = useState({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [helpText, setHelpText] = useState("");
  const [statusText, setStatusText] = useState("Ready to run");
  const [useCanvas, setUseCanvas] = useState(Boolean(getDefinition));
  const [runHistoryKey, setRunHistoryKey] = useState(0);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [showInput, setShowInput] = useState(true);
  const [loadExecutionId, setLoadExecutionId] = useState("");
  const [inputWarning, setInputWarning] = useState("");

  useEffect(() => {
    workflowApi.sampleTriggers().then((r) => {
      const data = r.data?.data || {};
      const def = getDefinition?.();
      const triggerType = def?.trigger?.type;
      const isOrphan = triggerType === "UncorrelatedAccountIAMDecision";
      const template = isOrphan
        ? data.orphanIamTemplate || data.template || data
        : data.template || data;
      setHelpText(data.description || "");
      setScenarios(
        isOrphan ? data.orphanIamScenarios || {} : data.scenarios || {},
      );
      setTriggerJson(JSON.stringify(template, null, 2));
    });
  }, [getDefinition]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(triggerJson || "{}");
      const triggerType = getDefinition?.()?.trigger?.type;
      setInputWarning(
        hasEmptyVerificationFields(parsed, triggerType)
          ? triggerType === "UncorrelatedAccountIAMDecision"
            ? "Missing orphanId — orphan workflow steps need a valid orphan account id."
            : "Missing identityId or entitlement identifier — verification will fail (VERIFICATION_FAILED), not route to Removed."
          : "",
      );
    } catch {
      setInputWarning("Invalid JSON — fix syntax before running.");
    }
  }, [triggerJson, getDefinition]);

  const applyScenario = (key) => {
    const scenario = scenarios[key];
    if (!scenario?.trigger) return;
    setTriggerJson(JSON.stringify(scenario.trigger, null, 2));
  };

  const loadFromExecution = async () => {
    const id = loadExecutionId.trim();
    if (!id) return;
    try {
      const res = await workflowApi.getExecution(id);
      const payload =
        res.data?.data?.execution?.triggerPayload ||
        res.data?.data?.execution?.trigger ||
        res.data?.data?.run?.trigger;
      if (!payload) {
        setInputWarning("Execution found but no triggerPayload on record.");
        return;
      }
      setTriggerJson(JSON.stringify(payload, null, 2));
      setInputWarning("");
    } catch (e) {
      setInputWarning(e.response?.data?.message || e.message || "Failed to load execution.");
    }
  };

  const executionSteps = useMemo(() => resolveExecutionSteps(result), [result]);
  const workflowSuccess = result?.success ?? result?.status === "SUCCESS";
  const failedStepLabel = result?.failedStepLabel;
  const rootError = result?.error;

  useEffect(() => {
    if (!executionSteps.length) {
      setSelectedStepId(null);
      return;
    }
    setSelectedStepId(pickDefaultStepId(executionSteps, result?.failedStepId));
  }, [executionSteps, result?.failedStepId]);

  const runTest = async () => {
    setRunning(true);
    setResult(null);
    setSelectedStepId(null);
    setStatusText("Running…");
    try {
      const trigger = JSON.parse(triggerJson);
      let data;
      if (useCanvas && getDefinition) {
        const res = await workflowApi.testDefinition(getDefinition(), trigger);
        data = res.data;
      } else {
        const res = await workflowApi.test(workflowId, trigger);
        data = res.data;
      }
      const run = data.data;
      setResult(run);
      const steps = resolveExecutionSteps(run);
      if (run.status === "SKIPPED") {
        setStatusText(run.skipReason || "Run skipped by trigger filter");
      } else if (run.success) {
        setStatusText("All steps completed successfully");
      } else {
        const failed = steps.find((s) => s.status === "FAILED");
        setStatusText(
          failed
            ? `Workflow failed at step: ${run.failedStepLabel || failed.label}`
            : `Workflow ${run.status || "FAILED"}`,
        );
      }
      setShowInput(false);
      setRunHistoryKey((k) => k + 1);
    } catch (e) {
      const message = e.response?.data?.message || e.message;
      setResult({
        success: false,
        status: "FAILED",
        error: message,
        steps: [],
        executionSteps: [],
      });
      setStatusText("Test failed");
    } finally {
      setRunning(false);
    }
  };

  const hasExecutionView = !running && (executionSteps.length > 0 || result?.error);

  return (
    <>
      <div className="isc-test-panel-header">
        <div className="isc-test-panel-title">Test Workflow: {workflowName || "Workflow"}</div>
        <button type="button" className="isc-modal-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="isc-test-panel-body isc-test-panel-body-debug">
        {getDefinition && (
          <label className="isc-test-canvas-opt isc-test-canvas-opt-top">
            <input
              type="checkbox"
              checked={useCanvas}
              onChange={(e) => setUseCanvas(e.target.checked)}
            />
            Test current canvas (unsaved changes)
          </label>
        )}

        {showInput && (
          <div className="isc-test-input-section">
            <div className="isc-test-input-head">
              <div className="isc-test-input-title">Workflow test input</div>
              {hasExecutionView && (
                <button
                  type="button"
                  className="isc-link-btn"
                  onClick={() => setShowInput(false)}
                >
                  Hide input
                </button>
              )}
            </div>
            {helpText && <p className="isc-test-input-help">{helpText}</p>}
            {Object.keys(scenarios).length > 0 && (
              <div className="isc-test-scenario-row">
                {Object.entries(scenarios).map(([key, scenario]) => (
                  <button
                    key={key}
                    type="button"
                    className="isc-btn isc-btn-outline isc-btn-sm"
                    onClick={() => applyScenario(key)}
                    title={scenario.description}
                  >
                    {scenario.label || key}
                  </button>
                ))}
              </div>
            )}
            <div className="isc-test-load-execution">
              <input
                type="text"
                className="isc-test-load-execution-input"
                placeholder="Remediation executionId"
                value={loadExecutionId}
                onChange={(e) => setLoadExecutionId(e.target.value)}
              />
              <button
                type="button"
                className="isc-btn isc-btn-outline isc-btn-sm"
                onClick={loadFromExecution}
              >
                Load from execution
              </button>
            </div>
            {inputWarning && <p className="isc-test-input-warn">{inputWarning}</p>}
            {!running && executionSteps.length === 0 && !result?.error && !inputWarning && (
              <p className="isc-test-input-help">
                Use a scenario above or load a live execution trigger for accurate branch testing.
              </p>
            )}
            <textarea
              className="isc-test-input-textarea"
              value={triggerJson}
              onChange={(e) => setTriggerJson(e.target.value)}
            />
          </div>
        )}

        {!showInput && (
          <button type="button" className="isc-link-btn isc-test-show-input" onClick={() => setShowInput(true)}>
            Show test input
          </button>
        )}

        {running && (
          <div className="isc-test-running-banner">Running workflow test…</div>
        )}

        {result?.skipReason && !executionSteps.length && (
          <div className="isc-test-skipped-banner">{result.skipReason}</div>
        )}

        {hasExecutionView && executionSteps.length > 0 && (
          <TestExecutionDebugger
            executionSteps={executionSteps}
            failedStepId={result?.failedStepId}
            selectedStepId={selectedStepId}
            onSelectStep={setSelectedStepId}
          />
        )}

        {hasExecutionView && !executionSteps.length && result?.error && (
          <div className="isc-test-debugger-detail isc-test-debugger-detail-only">
            <div className="isc-test-debugger-error-row">
              <strong>Error</strong>
              <p>{result.error}</p>
            </div>
          </div>
        )}
      </div>

      <div className="isc-test-panel-footer isc-test-panel-footer-debug">
        <div className="isc-test-footer-status">
          {!workflowSuccess && failedStepLabel && (
            <div className="isc-test-failure-summary">
              <strong>Workflow failed at step: {failedStepLabel}</strong>
              {rootError && <span>{rootError}</span>}
            </div>
          )}
          {workflowSuccess && executionSteps.length > 0 && (
            <div className="isc-test-success-summary">{statusText}</div>
          )}
          {!executionSteps.length && <span className="isc-test-footer-text">{statusText}</span>}
        </div>
        <div className="isc-test-footer-actions">
          <button type="button" className="isc-btn isc-btn-outline" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="isc-btn isc-btn-primary"
            onClick={runTest}
            disabled={running}
          >
            {running ? "Running…" : result ? "Run again" : "Start test"}
          </button>
        </div>
      </div>

      {workflowId && !useCanvas && (
        <div key={runHistoryKey} className="isc-test-run-history-wrap">
          <RunHistoryPanel workflowId={workflowId} />
        </div>
      )}
    </>
  );
}
