import { useEffect, useMemo, useState } from "react";
import { workflowApi } from "../../services/api";
import TestExecutionDebugger from "./TestExecutionDebugger";
import { pickDefaultStepId, resolveExecutionSteps } from "../../utils/testRunnerUtils";

export default function RunHistoryPanel({ workflowId }) {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedStepId, setSelectedStepId] = useState(null);

  const load = () => {
    if (!workflowId) return;
    setLoading(true);
    workflowApi
      .listRuns(workflowId)
      .then((r) => setRuns(r.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [workflowId]);

  const executionSteps = useMemo(() => resolveExecutionSteps(detail), [detail]);

  useEffect(() => {
    if (!executionSteps.length) {
      setSelectedStepId(null);
      return;
    }
    setSelectedStepId(pickDefaultStepId(executionSteps, detail?.failedStepId));
  }, [executionSteps, detail?.failedStepId]);

  const openRun = (runId) => {
    setSelected(runId);
    workflowApi.getRun(runId).then((r) => setDetail(r.data.data));
  };

  if (!workflowId) return null;

  return (
    <div className="isc-run-history">
      <div className="isc-run-history-header">
        <h3>Run history</h3>
        <button type="button" className="isc-btn isc-btn-outline" onClick={load}>
          Refresh
        </button>
      </div>
      {loading ? (
        <p className="isc-run-history-empty">Loading runs…</p>
      ) : runs.length === 0 ? (
        <p className="isc-run-history-empty">No runs yet. Start a test to record execution history.</p>
      ) : (
        <div className="isc-run-history-layout isc-run-history-layout-debug">
          <ul className="isc-run-list">
            {runs.map((run) => (
              <li key={run.runId}>
                <button
                  type="button"
                  className={`isc-run-item ${selected === run.runId ? "active" : ""}`}
                  onClick={() => openRun(run.runId)}
                >
                  <span className={`isc-run-status status-${(run.status || "").toLowerCase()}`}>
                    {run.status}
                  </span>
                  <span className="isc-run-meta">
                    {new Date(run.startedAt).toLocaleString()} · {run.stepCount ?? run.steps?.length ?? 0} steps
                    {run.durationMs != null ? ` · ${run.durationMs}ms` : ""}
                  </span>
                  {run.skipReason && (
                    <span className="isc-run-skip">{run.skipReason}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {detail && (
            <div className="isc-run-detail isc-run-detail-debug">
              <div className="isc-run-detail-head">
                <strong>Run {detail.runId?.slice(0, 8)}</strong>
                <span className={`isc-run-status status-${(detail.status || "").toLowerCase()}`}>
                  {detail.status}
                </span>
              </div>
              {detail.success === false && detail.failedStepLabel && (
                <div className="isc-test-failure-summary isc-test-failure-summary-compact">
                  <strong>Workflow failed at step: {detail.failedStepLabel}</strong>
                  {detail.error && <span>{detail.error}</span>}
                </div>
              )}
              {executionSteps.length > 0 ? (
                <TestExecutionDebugger
                  executionSteps={executionSteps}
                  failedStepId={detail.failedStepId}
                  selectedStepId={selectedStepId}
                  onSelectStep={setSelectedStepId}
                />
              ) : (
                <p className="isc-run-history-empty">No step trace recorded.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
