import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { workflowApi } from "../services/api";

const STATUS_META = {
  COMPLETED: { label: "Completed", className: "status-success", tone: "success" },
  FAILED: { label: "Failed", className: "status-failed", tone: "failed" },
  RUNNING: { label: "Running", className: "status-running", tone: "running" },
  PENDING: { label: "Queued", className: "status-running", tone: "running" },
  WAITING_ITSM: { label: "In progress", className: "status-waiting", tone: "waiting" },
  WAITING_VERIFICATION: { label: "In progress", className: "status-waiting", tone: "waiting" },
  WAITING: { label: "Awaiting IAM", className: "status-waiting", tone: "waiting" },
  SKIPPED: { label: "Skipped", className: "status-skipped", tone: "skipped" },
};

const WAIT_REASON_LABEL = {
  PROVISIONING: "Awaiting provisioning",
  ITSM: "Awaiting ITSM ticket closure",
  VERIFICATION: "Awaiting scheduled re-verification",
  IAM_DECISION: "Awaiting IAM decision · reminders scheduled",
};

const IN_FLIGHT = new Set(["PENDING", "RUNNING", "WAITING_ITSM", "WAITING_VERIFICATION", "WAITING"]);

const FILTERS = [
  { id: "all", label: "All events" },
  { id: "active", label: "In progress" },
  { id: "COMPLETED", label: "Completed" },
  { id: "FAILED", label: "Failed" },
];

const EVENT_TYPE_FILTERS = [
  { id: "", label: "All" },
  { id: "IAM_ORPHAN_REVIEW", label: "IAM Orphan Review" },
  { id: "ACCESS_REVOKE", label: "Access Revoke" },
];

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stepStatusClass(status) {
  if (status === "SUCCESS" || status === "COMPLETED") return "step-success";
  if (status === "FAILED" || status === "FAILURE") return "step-failed";
  if (status === "WAITING" || status === "RUNNING") return "step-waiting";
  if (status === "PENDING") return "step-pending";
  return "step-neutral";
}

function traceStatusLabel(status) {
  if (status === "SUCCESS" || status === "COMPLETED") return "Done";
  if (status === "WAITING") return "Waiting";
  if (status === "PENDING") return "Scheduled";
  if (status === "RUNNING") return "Running";
  if (status === "FAILED" || status === "FAILURE") return "Failed";
  return status || "—";
}

function buildFallbackTrace(exec, steps) {
  if (steps.length > 0) {
    return steps.map((s, idx) => ({
      id: s.stepId || `step-${idx}`,
      label: s.label || s.type,
      type: s.type,
      status: s.status,
      branch: s.branch,
      at: s.completedAt || s.startedAt,
      detail: s.output?.error ? String(s.output.error) : null,
    }));
  }
  return (exec?.stepStatuses || []).map((label, i) => ({
    id: `milestone-${i}`,
    label,
    type: "milestone",
    status: i === (exec.stepStatuses?.length || 0) - 1 && IN_FLIGHT.has(exec.status) ? "WAITING" : "SUCCESS",
    at: null,
    detail: null,
  }));
}

function latestProgressLabel(exec) {
  const bullets = exec.stepStatuses || [];
  if (bullets.length === 0) return exec.currentStepLabel || "Queued";
  return bullets[bullets.length - 1];
}

function ExecutionEventCard({ exec, selected, onSelect }) {
  const meta = STATUS_META[exec.status] || STATUS_META.PENDING;
  const inFlight = IN_FLIGHT.has(exec.status);

  return (
    <button
      type="button"
      className={`isc-exec-event-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(exec)}
    >
      <div className="isc-exec-event-card-top">
        <div className="isc-exec-event-identity">
          <span className="isc-exec-event-title">{exec.eventName || exec.entitlementName || "Access revoke"}</span>
          <span className="isc-exec-event-sub">{exec.identityName || "—"}</span>
        </div>
        <span className={`isc-exec-status-pill ${meta.className}`}>{meta.label}</span>
      </div>
      <div className="isc-exec-event-meta">
        <span>{exec.applicationName || "—"}</span>
        <span className="isc-exec-dot">·</span>
        <span>{exec.workflowName || "Workflow"}</span>
        <span className="isc-exec-dot">·</span>
        <span>{formatDate(exec.startedAt || exec.createdAt)}</span>
      </div>
      <div className="isc-exec-event-progress">
        {inFlight && <span className="isc-exec-live-dot" aria-hidden />}
        <span>
          {exec.status === "FAILED" && exec.failureReasonLabel
            ? exec.failureReasonLabel
            : latestProgressLabel(exec)}
        </span>
      </div>
      <div className="isc-exec-event-footer">
        <code className="isc-exec-id">{exec.executionId?.slice(0, 8)}</code>
        <span>{exec.eventOwner || "system"}</span>
      </div>
    </button>
  );
}

function formatItsmStatus(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "—";
  const labels = {
    OPEN: "Open",
    IN_PROGRESS: "In progress",
    CLOSED: "Closed",
    COMPLETED: "Closed",
    RESOLVED: "Resolved",
    CANCELED: "Canceled",
    FAILED: "Failed",
    TICKET_CREATED: "Open",
    NOTIFIED: "Open (notified)",
    TICKET_IN_PROGRESS: "In progress",
    TICKET_CLOSED: "Closed",
  };
  return labels[s] || s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

function ExecutionDetailPanel({ executionId, detail, loading, onClose }) {
  const exec = detail?.execution;
  const runs = detail?.runs || [];
  const steps = runs.length
    ? runs.flatMap((r) => r.steps || [])
    : detail?.run?.steps || [];
  const progressTrace = detail?.progressTrace?.length
    ? detail.progressTrace
    : buildFallbackTrace(exec, steps);
  const isIamOrphan = exec?.eventType === "IAM_ORPHAN_REVIEW";
  const meta = exec ? STATUS_META[exec.status] || STATUS_META.PENDING : null;

  if (!executionId) {
    return (
      <div className="isc-exec-detail-panel isc-exec-detail-empty">
        <p>Select an event to view workflow steps and audit details.</p>
      </div>
    );
  }

  if (loading || !exec) {
    return (
      <div className="isc-exec-detail-panel isc-exec-detail-empty">
        <p>Loading event details…</p>
      </div>
    );
  }

  return (
    <div className="isc-exec-detail-panel">
      <div className="isc-exec-detail-header">
        <div>
          <h2 className="isc-exec-detail-title">{exec.eventName || exec.entitlementName}</h2>
          <p className="isc-exec-detail-sub">
            {exec.identityName} · {exec.applicationName || "Application"} · {exec.campaignName || "Campaign"}
          </p>
        </div>
        <div className="isc-exec-detail-header-actions">
          {meta && <span className={`isc-exec-status-pill ${meta.className}`}>{meta.label}</span>}
          <button type="button" className="isc-btn isc-btn-outline isc-btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {exec.status === "FAILED" && exec.failureReasonLabel && (
        <div className="isc-exec-failure-banner" role="alert">
          <span className="isc-exec-failure-banner-label">Reason</span>
          <strong>{exec.failureReasonLabel}</strong>
          {exec.failureReasonDetail && (
            <p className="isc-exec-failure-banner-detail">{exec.failureReasonDetail}</p>
          )}
        </div>
      )}

      {IN_FLIGHT.has(exec.status) && exec.status !== "RUNNING" && exec.status !== "PENDING" && (
        <div className="isc-exec-waiting-banner">
          <span className="isc-exec-waiting-banner-label">In progress</span>
          <strong>{WAIT_REASON_LABEL[exec.waitReason] || "Awaiting removal + verification"}</strong>
          <p className="isc-exec-waiting-banner-detail">
            {exec.waitReason === "IAM_DECISION" ? (
              <>
                IAM has been notified. Background reminders run on schedule
                {exec.reminderPhases?.length
                  ? ` (${exec.reminderPhases.join(", ")})`
                  : " (1h, 3h, 6h, 12h)"}
                {exec.nextPollAt ? ` · next check ${formatDate(exec.nextPollAt)}` : ""}
                . The workflow resumes when IAM records a decision in the portal.
              </>
            ) : (
              <>
                Access has not been confirmed removed yet. The workflow will re-verify
                {exec.nextPollAt ? ` around ${formatDate(exec.nextPollAt)}` : " on schedule"}
                {exec.itsmTicketStatus ? `; ITSM ticket: ${formatItsmStatus(exec.itsmTicketStatus)}.` : "."}
              </>
            )}
          </p>
        </div>
      )}

      <div className="isc-exec-detail-grid">
        <div className="isc-exec-detail-section">
          <h3>Event details</h3>
          <dl className="isc-exec-dl">
            <div><dt>Event ID</dt><dd><code>{exec.executionId}</code></dd></div>
            <div><dt>Event type</dt><dd>{exec.eventType || "ACCESS_REVOKE"}</dd></div>
            <div><dt>Workflow</dt><dd>{exec.workflowName}</dd></div>
            <div><dt>Entitlement</dt><dd>{exec.entitlementName || "—"}</dd></div>
            <div><dt>Identity</dt><dd>{exec.identityName || "—"}</dd></div>
            {exec.orphanId && (
              <div><dt>Orphan account</dt><dd><code>{exec.orphanId}</code></dd></div>
            )}
            <div><dt>Application</dt><dd>{exec.applicationName || exec.triggerPayload?.applicationName || "—"}</dd></div>
            <div><dt>Campaign</dt><dd>{exec.campaignName || "—"}</dd></div>
            <div><dt>Reviewer / owner</dt><dd>{exec.eventOwner || "—"}</dd></div>
            <div><dt>Started</dt><dd>{formatDate(exec.startedAt || exec.createdAt)}</dd></div>
            <div><dt>Completed</dt><dd>{formatDate(exec.completedAt)}</dd></div>
            {exec.ticketEventId && (
              <div>
                <dt>Remediation ticket</dt>
                <dd>
                  <Link to="/governance/remediation" className="isc-exec-link">
                    {formatItsmStatus(exec.itsmTicketStatus)} · {exec.ticketEventId.slice(0, 8)}…
                  </Link>
                </dd>
              </div>
            )}
            {!exec.ticketEventId && exec.itsmTicketStatus && (
              <div><dt>ITSM ticket</dt><dd>{formatItsmStatus(exec.itsmTicketStatus)}</dd></div>
            )}
            {IN_FLIGHT.has(exec.status) && exec.nextPollAt && (
              <div>
                <dt>{exec.waitReason === "IAM_DECISION" ? "Next reminder check" : "Next re-verification"}</dt>
                <dd>{formatDate(exec.nextPollAt)}</dd>
              </div>
            )}
            {isIamOrphan && exec.reminderPhases?.length > 0 && (
              <div>
                <dt>Reminder schedule</dt>
                <dd>
                  {exec.reminderPhases.join(", ")}
                  {exec.reminderPhaseIndex != null
                    ? ` · ${exec.reminderPhaseIndex} sent`
                    : ""}
                </dd>
              </div>
            )}
            {exec.provisioningRequestId && (
              <div><dt>Provisioning request</dt><dd><code>{exec.provisioningRequestId}</code></dd></div>
            )}
            {exec.runId && (
              <div><dt>Run ID</dt><dd><code>{exec.runId}</code></dd></div>
            )}
            {exec.error && (
              <div className="isc-exec-error-row"><dt>Error</dt><dd>{exec.error}</dd></div>
            )}
            {exec.failureReasonCode && (
              <div className="isc-exec-error-row">
                <dt>Failure type</dt>
                <dd><code>{exec.failureReasonCode}</code></dd>
              </div>
            )}
          </dl>
        </div>

        <div className="isc-exec-detail-section">
          <h3>Workflow progress</h3>
          <p className="isc-exec-no-steps" style={{ marginTop: 0, marginBottom: 12 }}>
            {isIamOrphan
              ? "Tracing view — canvas steps, background reminders, and IAM decision checkpoint."
              : "Step-by-step trace for this remediation run."}
          </p>

          {progressTrace.length === 0 ? (
            <p className="isc-exec-no-steps">No progress recorded yet.</p>
          ) : (
            <ol className="isc-exec-step-timeline">
              {progressTrace.map((item, idx) => (
                <li
                  key={item.id || idx}
                  className={`isc-exec-step-item ${stepStatusClass(item.status)}`}
                >
                  <div className="isc-exec-step-marker" aria-hidden />
                  <div className="isc-exec-step-body">
                    <div className="isc-exec-step-row">
                      <span className="isc-exec-step-name">{item.label}</span>
                      <span className={`isc-exec-step-badge ${stepStatusClass(item.status)}`}>
                        {traceStatusLabel(item.status)}
                      </span>
                    </div>
                    {item.type && item.type !== "milestone" && (
                      <span className="isc-exec-step-type">
                        {item.type}
                        {item.branch ? ` · branch ${item.branch}` : ""}
                        {item.at ? ` · ${formatDate(item.at)}` : ""}
                      </span>
                    )}
                    {item.detail && (
                      <p className="isc-exec-step-detail">{item.detail}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {(exec.stepStatuses || []).length > 0 && (
            <>
              <h3 className="isc-exec-steps-heading">Activity log</h3>
              <ul className="isc-exec-milestones">
                {exec.stepStatuses.map((label, i) => (
                  <li key={`${label}-${i}`}>{label}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
import { Navigate } from "react-router-dom";
import { REMEDIATION_RUNS_BASE } from "../../remediation-runs/paths";

/** @deprecated Use /governance/workflows/runs */
export default function RemediationExecutions() {
  const [searchParams] = useSearchParams();
  const initEventType = searchParams.get("eventType") || "";
  const initOrphanId  = searchParams.get("orphanId")  || "";

  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState(initEventType);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const pollRef = useRef(null);
  const didAutoSelect = useRef(false);

  const load = useCallback(() => {
    const params = {};
    if (eventTypeFilter) params.eventType = eventTypeFilter;
    if (initOrphanId) params.orphanId = initOrphanId;
    return workflowApi
      .executions(params)
      .then((r) => setExecutions(r.data.data || []))
      .finally(() => setLoading(false));
  }, [eventTypeFilter, initOrphanId]);

  useEffect(() => {
    didAutoSelect.current = false;
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    const anyInFlight = executions.some((e) => IN_FLIGHT.has(e.status));
    if (anyInFlight && !pollRef.current) {
      pollRef.current = setInterval(load, 4000);
    } else if (!anyInFlight && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [executions, load]);

  const filtered = useMemo(() => {
    if (filter === "all") return executions;
    if (filter === "active") return executions.filter((e) => IN_FLIGHT.has(e.status));
    return executions.filter((e) => e.status === filter);
  }, [executions, filter]);

  const stats = useMemo(() => ({
    total: executions.length,
    active: executions.filter((e) => IN_FLIGHT.has(e.status)).length,
    completed: executions.filter((e) => e.status === "COMPLETED").length,
    failed: executions.filter((e) => e.status === "FAILED").length,
  }), [executions]);

  const openDetail = (exec) => {
    setSelectedId(exec.executionId);
    setDetail(null);
    setDetailLoading(true);
    workflowApi
      .getExecution(exec.executionId)
      .then((r) => setDetail(r.data.data))
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    if (!loading && filtered.length > 0 && !didAutoSelect.current) {
      didAutoSelect.current = true;
      openDetail(filtered[0]);
    }
  }, [loading, filtered]);

  return (
    <div className="isc-page isc-rem-exec-page">
      <div className="isc-rem-exec-inner">
        <header className="isc-rem-exec-header">
          <div>
            <h1 className="isc-page-title">Remediation Executions</h1>
            <p className="isc-page-sub">
              One row per remediation event. Select an event to see workflow progress, reminders, and step trace.
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

        <div className="isc-rem-exec-stats">
          <div className="isc-rem-stat"><span className="isc-rem-stat-val">{stats.total}</span><span className="isc-rem-stat-lbl">Total events</span></div>
          <div className="isc-rem-stat isc-rem-stat-active"><span className="isc-rem-stat-val">{stats.active}</span><span className="isc-rem-stat-lbl">In progress</span></div>
          <div className="isc-rem-stat isc-rem-stat-ok"><span className="isc-rem-stat-val">{stats.completed}</span><span className="isc-rem-stat-lbl">Completed</span></div>
          <div className="isc-rem-stat isc-rem-stat-fail"><span className="isc-rem-stat-val">{stats.failed}</span><span className="isc-rem-stat-lbl">Failed</span></div>
        </div>

        <div className="isc-rem-exec-filters" style={{ marginBottom: 4 }}>
          {EVENT_TYPE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`isc-rem-filter-btn ${eventTypeFilter === f.id ? "active" : ""}`}
              onClick={() => setEventTypeFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {initOrphanId && (
          <div className="isc-exec-waiting-banner" style={{ marginBottom: 8 }}>
            <span className="isc-exec-waiting-banner-label">Filtered</span>
            <strong>Showing tasks for account <code>{initOrphanId}</code></strong>
          </div>
        )}

        <div className="isc-rem-exec-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`isc-rem-filter-btn ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="isc-wf-empty">Loading executions…</div>
        ) : filtered.length === 0 ? (
          <div className="isc-wf-empty">
            <p>No remediation events in this view. Revoke access in certification and select a workflow to create events.</p>
          </div>
        ) : (
          <div className="isc-rem-exec-split">
            <div className="isc-rem-exec-list">
              <div className="isc-rem-exec-list-head">
                <span>Events ({filtered.length})</span>
              </div>
              <div className="isc-rem-exec-list-scroll">
                {filtered.map((e) => (
                  <ExecutionEventCard
                    key={e.executionId}
                    exec={e}
                    selected={selectedId === e.executionId}
                    onSelect={openDetail}
                  />
                ))}
              </div>
            </div>

            <ExecutionDetailPanel
              executionId={selectedId}
              detail={detail}
              loading={detailLoading}
              onClose={() => {
                setSelectedId(null);
                setDetail(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
  return <Navigate to={REMEDIATION_RUNS_BASE} replace />;
}
