import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import { workflowApi } from "../../workflows/services/api";
import { workflowTaskQueueApi } from "../services/api";
import EnterpriseEventCard from "../components/EnterpriseEventCard";
import RemediationKpiStrip from "../components/RemediationKpiStrip";
import RemediationPageShell from "../components/RemediationPageShell";
import {
  REMEDIATION_EVENT_CATALOG,
  computeExecutionStats,
  computeQueueStats,
  matchesExecutionEventType,
} from "../constants";

export default function RemediationEventsCatalog() {
  const [executions, setExecutions] = useState([]);
  const [queueTasks, setQueueTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return Promise.all([
      workflowApi.executions().then((r) => setExecutions(r.data?.data || [])).catch(() => setExecutions([])),
      workflowTaskQueueApi.listTasks({ limit: 500 }).then((r) => setQueueTasks(r.data?.data || [])).catch(() => setQueueTasks([])),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statsBySlug = useMemo(() => {
    const map = {};
    for (const config of REMEDIATION_EVENT_CATALOG) {
      if (config.source === "queue") {
        const filtered = queueTasks.filter((t) => t.action === config.action);
        map[config.slug] = computeQueueStats(filtered);
      } else {
        const filtered = executions.filter((e) => matchesExecutionEventType(e, config));
        map[config.slug] = computeExecutionStats(filtered);
      }
    }
    return map;
  }, [executions, queueTasks]);

  const totals = useMemo(() => {
    return Object.values(statsBySlug).reduce(
      (acc, s) => ({
        total: acc.total + (s?.total || 0),
        inProgress: acc.inProgress + (s?.inProgress || 0),
        completed: acc.completed + (s?.completed || 0),
        failed: acc.failed + (s?.failed || 0),
      }),
      { total: 0, inProgress: 0, completed: 0, failed: 0 },
    );
  }, [statsBySlug]);

  return (
    <RemediationPageShell
      eyebrow="Governance"
      title="Remediation Events"
      subtitle="Monitor and work remediation queues by event type — orphan reviews and access revokes."
      actions={(
        <>
          <Link to="/governance/workflows" className="re-btn re-btn--secondary">
            <AccountTreeOutlinedIcon sx={{ fontSize: 18 }} />
            Workflows
          </Link>
          <button type="button" className="re-btn re-btn--primary" onClick={load} disabled={loading}>
            <RefreshRoundedIcon sx={{ fontSize: 18 }} />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </>
      )}
    >
      {loading ? (
        <div className="re-loading">Loading remediation events…</div>
      ) : (
        <>
          <RemediationKpiStrip
            items={[
              { label: "Open tasks", value: totals.total, hint: "Across all event types" },
              { label: "In progress", value: totals.inProgress, tone: "active", hint: "Awaiting action" },
              { label: "Completed", value: totals.completed, tone: "ok", hint: "Closed successfully" },
              { label: "Failed", value: totals.failed, tone: "fail", hint: "Needs investigation" },
            ]}
          />
          <h2 className="re-catalog-section-title">Event queues</h2>
          <div className="re-catalog-grid">
            {REMEDIATION_EVENT_CATALOG.map((config) => (
              <EnterpriseEventCard
                key={config.slug}
                config={config}
                stats={statsBySlug[config.slug]}
              />
            ))}
          </div>
        </>
      )}
    </RemediationPageShell>
  );
}
