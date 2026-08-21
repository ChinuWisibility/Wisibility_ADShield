import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import RemediationPageShell from "../components/RemediationPageShell";
import RemediationKpiStrip from "../components/RemediationKpiStrip";
import RemediationEmptyState from "../components/RemediationEmptyState";
import IamOrphanTaskListRow from "../components/IamOrphanTaskListRow";
import { workflowTaskQueueApi } from "../services/api";
import { REMEDIATION_EVENT_CATALOG, computeQueueStats, IN_FLIGHT_QUEUE } from "../constants";
import { REMEDIATION_EVENTS_BASE } from "../paths";

const STATUS_FILTERS = [
  { id: "all", label: "All tasks" },
  { id: "active", label: "In progress" },
  { id: "COMPLETED", label: "Completed" },
  { id: "FAILED", label: "Failed" },
  { id: "CANCELLED", label: "Cancelled" },
];

export default function IamOrphanReviewTasksPage() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("all");
  const inFlightRef = useRef(false);

  const config = REMEDIATION_EVENT_CATALOG.find((c) => c.slug === "iam-orphan-review");

  const load = useCallback((options = {}) => {
    const silent = Boolean(options.silent);
    if (inFlightRef.current) return Promise.resolve();
    inFlightRef.current = true;
    if (silent) setRefreshing(true);
    else setLoading(true);

    return workflowTaskQueueApi
      .listTasks({ action: "IAM_ORPHAN_REVIEW", limit: 500 })
      .then((r) => {
        const next = r.data?.data || [];
        setTasks(next);
        return next;
      })
      .catch(() => {
        if (!silent) setTasks([]);
        return [];
      })
      .finally(() => {
        inFlightRef.current = false;
        if (silent) setRefreshing(false);
        else setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "active") return tasks.filter((t) => IN_FLIGHT_QUEUE.has(t.status));
    return tasks.filter((t) => t.status === filter);
  }, [tasks, filter]);

  const stats = useMemo(() => computeQueueStats(tasks), [tasks]);

  return (
    <RemediationPageShell
      eyebrow="Governance · Remediation Framework"
      title={config?.title || "IAM Orphan Review"}
      subtitle={config?.description}
      actions={(
        <>
          <Link to={REMEDIATION_EVENTS_BASE} className="re-btn re-btn--secondary">
            <ArrowBackRoundedIcon sx={{ fontSize: 18 }} />
            Back
          </Link>
          <button
            type="button"
            className={`re-btn re-btn--primary ${refreshing ? "is-refreshing" : ""}`}
            onClick={() => load({ silent: true })}
            disabled={loading || refreshing}
            aria-busy={refreshing}
          >
            <RefreshRoundedIcon sx={{ fontSize: 18 }} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </>
      )}
    >
      <div className="re-flow-banner re-flow-banner--enterprise">
        <p className="re-flow-banner__title">Enterprise IAM orphan remediation</p>
        <p className="re-flow-banner__lead">
          Same queue-first model as Access Revoke. Remediate from Uncorrelated Accounts enqueues a
          task; the scheduler starts the workflow mapped in Global Rule Set.
        </p>
      </div>

      <RemediationKpiStrip
        items={[
          { label: "Total tasks", value: stats.total },
          { label: "In progress", value: stats.inProgress, tone: "active" },
          { label: "Completed", value: stats.completed, tone: "ok" },
          { label: "Failed", value: stats.failed, tone: "fail" },
        ]}
      />

      <div className="re-filter-bar">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`re-filter-chip ${filter === f.id ? "is-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && tasks.length === 0 ? (
        <div className="re-loading">Loading IAM orphan review tasks…</div>
      ) : filtered.length === 0 ? (
        <RemediationEmptyState
          icon={<InboxOutlinedIcon />}
          title="No IAM orphan review tasks"
          description="Tasks are created when you remediate uncorrelated accounts. Map IAM_ORPHAN_REVIEW in Global Rule Set."
        />
      ) : (
        <div className={`re-task-list ${refreshing ? "re-task-list--refreshing" : ""}`}>
          <div className="re-task-list__head">
            <span>Type</span>
            <span>Task</span>
            <span>Workflow</span>
            <span>Application</span>
            <span>Status</span>
            <span aria-hidden />
          </div>
          <div className="re-task-list__body">
            {filtered.map((task) => (
              <IamOrphanTaskListRow key={task.taskId} task={task} />
            ))}
          </div>
        </div>
      )}
    </RemediationPageShell>
  );
}
