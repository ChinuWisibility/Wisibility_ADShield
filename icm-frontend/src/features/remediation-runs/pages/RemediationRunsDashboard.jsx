import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { workflowApi } from "../../workflows/services/api";
import RemediationEventTypeCard from "../components/RemediationEventTypeCard";
import { REMEDIATION_EVENT_TYPES, computeStats, matchesEventType } from "../constants";

export default function RemediationRunsDashboard() {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    workflowApi
      .executions()
      .then((r) => setExecutions(r.data.data || []))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const statsByType = useMemo(() => {
    const map = {};
    REMEDIATION_EVENT_TYPES.forEach((config) => {
      const filtered = executions.filter((e) => matchesEventType(e, config));
      map[config.slug] = computeStats(filtered);
    });
    return map;
  }, [executions]);

  return (
    <div className="isc-page isc-rem-runs-page">
      <div className="isc-rem-runs-inner">
        <header className="isc-rem-exec-header">
          <div>
            <h1 className="isc-page-title">Remediation Runs</h1>
            <p className="isc-page-sub">
              Select a remediation event type to view its workflow executions and audit details.
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
          <div className="isc-wf-empty">Loading remediation runs…</div>
        ) : (
          <div className="isc-rem-type-card-grid">
            {REMEDIATION_EVENT_TYPES.map((config) => (
              <RemediationEventTypeCard
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
