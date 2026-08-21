import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import WorkflowRemediationEventTypeCard from "../components/WorkflowRemediationEventTypeCard";
import {
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  computeSummaryStats,
  defaultQueueSourceForSlug,
} from "../constants";
import { workflowRemediationApi } from "../services/api";
import "../../remediation-runs/styles/remediation-runs.css";
import "../styles/workflow-remediation-queue.css";

export default function WorkflowRemediationQueueDashboard() {
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);

  const load = () =>
    workflowRemediationApi
      .summary()
      .then((r) => setSummary(r.data.data || {}))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const statsByType = useMemo(() => {
    const map = {};
    WORKFLOW_REMEDIATION_EVENT_TYPES.forEach((config) => {
      map[config.slug] = computeSummaryStats(
        summary,
        config.eventType,
        defaultQueueSourceForSlug(config.slug),
      );
    });
    return map;
  }, [summary]);

  return (
    <div className="isc-page isc-rem-runs-page">
      <div className="isc-rem-runs-inner">
        <header className="isc-rem-exec-header">
          <div>
            <h1 className="isc-page-title">Workflow Remediation Queue</h1>
            <p className="isc-page-sub">
              Central orchestration for workflow-driven remediation — review events, create tickets, and trigger workflows.
            </p>
          </div>
          <div className="isc-rem-exec-actions">
            <Link to="/governance/workflows" className="isc-btn isc-btn-outline" style={{ textDecoration: "none" }}>
              Workflows
            </Link>
            <button type="button" className="isc-btn isc-btn-outline" onClick={load}>
              Refresh
            </button>
          </div>
        </header>

        {loading ? (
          <div className="isc-wf-empty">Loading workflow remediation queue…</div>
        ) : (
          <div className="wrq-dashboard-grid">
            {WORKFLOW_REMEDIATION_EVENT_TYPES.map((config) => (
              <WorkflowRemediationEventTypeCard
                key={config.slug}
                config={config}
                stats={statsByType[config.slug]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
