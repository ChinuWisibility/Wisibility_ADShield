import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import WorkflowRemediationQueueEventCard from "../components/WorkflowRemediationQueueEventCard";
import WorkflowRemediationDetailPanel from "../components/WorkflowRemediationDetailPanel";
import CreateTicketModal from "../components/CreateTicketModal";
import TriggerWorkflowModal from "../components/TriggerWorkflowModal";
import {
  DASHBOARD_STATUS_KEYS,
  QUEUE_STATUS_FILTERS,
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  computeQueueStats,
  defaultQueueSourceForSlug,
  getEventTypeBySlug,
} from "../constants";
import { workflowRemediationApi } from "../services/api";
import { WORKFLOW_REMEDIATION_QUEUE_BASE } from "../paths";
import { remediationRunsPath } from "../../remediation-runs/paths";
import "../../remediation-runs/styles/remediation-runs.css";
import "../styles/workflow-remediation-queue.css";

export default function WorkflowRemediationEventTypePage() {
  const { eventType: eventTypeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const initEventId = searchParams.get("eventId") || "";
  const config = getEventTypeBySlug(eventTypeSlug);

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const didAutoSelect = useRef(false);

  const STATUS_LABELS = {
    PENDING: "Pending",
    WITH_TICKET: "With Ticket",
    AWAITING_ITSM: "Awaiting ITSM",
    VALIDATION_PENDING: "Validation Pending",
    VALIDATED: "Validated",
    FAILED: "Failed",
  };

  const load = () =>
    workflowRemediationApi
      .listEvents({
        eventType: config?.eventType,
        queueSource: defaultQueueSourceForSlug(eventTypeSlug),
        limit: 200,
      })
      .then((r) => setEvents(r.data.items || []))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (!config) return;
    setLoading(true);
    didAutoSelect.current = false;
    setSelectedId(null);
    setDetail(null);
    setFilter("all");
    load();
  }, [eventTypeSlug, config?.eventType]);

  useEffect(() => {
    if (!typeMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setTypeMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [typeMenuOpen]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.queueStatus === filter);
  }, [events, filter]);

  const stats = useMemo(() => computeQueueStats(events), [events]);

  const openDetail = (ev) => {
    setSelectedId(ev.eventId);
    setDetail(null);
    setDetailLoading(true);
    workflowRemediationApi
      .getEvent(ev.eventId)
      .then((r) => {
        const data = r.data.data || {};
        setDetail({ event: data.event, items: data.items || [] });
      })
      .finally(() => setDetailLoading(false));
  };

  useEffect(() => {
    if (!loading && !didAutoSelect.current) {
      didAutoSelect.current = true;
      if (initEventId) {
        const match = filtered.find((e) => e.eventId === initEventId);
        if (match) {
          openDetail(match);
        } else {
          setSelectedId(initEventId);
          setDetailLoading(true);
          workflowRemediationApi
            .getEvent(initEventId)
            .then((r) => {
              const data = r.data.data || {};
              setDetail({ event: data.event, items: data.items || [] });
            })
            .finally(() => setDetailLoading(false));
        }
      } else if (filtered.length > 0) {
        openDetail(filtered[0]);
      }
    }
  }, [loading, filtered, initEventId]);

  const refreshDetail = async () => {
    if (!selectedId) return;
    const r = await workflowRemediationApi.getEvent(selectedId);
    const data = r.data.data || {};
    setDetail({ event: data.event, items: data.items || [] });
    await load();
  };

  const handleCreateTicket = async (form) => {
    setActionLoading(true);
    try {
      await workflowRemediationApi.createTicket(selectedId, form);
      setToast("ITSM ticket created.");
      await refreshDetail();
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerWorkflow = async ({ workflowId }) => {
    setActionLoading(true);
    try {
      const presetId = detail?.event?.selectedWorkflowId;
      const r = await workflowRemediationApi.triggerWorkflow(selectedId, {
        workflowId: workflowId || presetId || undefined,
      });
      const data = r.data.data || {};
      const execId = data.executionIds?.[0];
      setToast("Workflow triggered.");
      await refreshDetail();
      if (execId && config?.runsSlug) {
        const path = remediationRunsPath(config.runsSlug, { executionId: execId });
        setTimeout(() => {
          window.location.href = path;
        }, 800);
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (!config) {
    return <Navigate to={WORKFLOW_REMEDIATION_QUEUE_BASE} replace />;
  }

  return (
    <div className="isc-page isc-rem-exec-page">
      <div className="isc-rem-exec-inner">
        <nav className="isc-breadcrumb">
          <Link to="/governance/workflows" className="isc-link-btn" style={{ textDecoration: "none" }}>
            Workflows
          </Link>
          <span className="isc-breadcrumb-sep">/</span>
          <Link to={WORKFLOW_REMEDIATION_QUEUE_BASE} className="isc-link-btn" style={{ textDecoration: "none" }}>
            Workflow Remediation Queue
          </Link>
          <span className="isc-breadcrumb-sep">/</span>
          <span>{config.title}</span>
        </nav>

        <header className="isc-rem-exec-header">
          <div>
            <h1 className="isc-page-title">{config.title}</h1>
            <p className="isc-page-sub">{config.description}</p>
          </div>
          <div className="isc-rem-exec-actions">
            <div className="isc-rem-type-dropdown" ref={menuRef}>
              <button
                type="button"
                className="isc-btn isc-btn-outline isc-rem-type-dropdown-btn"
                onClick={() => setTypeMenuOpen((v) => !v)}
              >
                All types
                <span className="isc-rem-type-dropdown-caret" aria-hidden>▾</span>
              </button>
              {typeMenuOpen && (
                <div className="isc-rem-type-dropdown-menu">
                  <Link
                    to={WORKFLOW_REMEDIATION_QUEUE_BASE}
                    className="isc-rem-type-dropdown-item"
                    onClick={() => setTypeMenuOpen(false)}
                  >
                    All event types
                  </Link>
                  {WORKFLOW_REMEDIATION_EVENT_TYPES.map((t) => (
                    <Link
                      key={t.slug}
                      to={`${WORKFLOW_REMEDIATION_QUEUE_BASE}/${t.slug}`}
                      className={`isc-rem-type-dropdown-item ${t.slug === config.slug ? "active" : ""}`}
                      onClick={() => setTypeMenuOpen(false)}
                    >
                      {t.title}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="isc-btn isc-btn-outline" onClick={load}>
              Refresh
            </button>
          </div>
        </header>

        {toast && <div className="wrq-toast">{toast}</div>}

        <div className="wrq-queue-stats">
          <div className="wrq-queue-stat">
            <span className="wrq-queue-stat-val">{stats.total}</span>
            <span className="wrq-queue-stat-lbl">Total</span>
          </div>
          {DASHBOARD_STATUS_KEYS.map((key) => (
            <div key={key} className={`wrq-queue-stat ${key === "PENDING" ? "pending" : key === "VALIDATED" ? "validated" : ""}`}>
              <span className="wrq-queue-stat-val">{stats[key] ?? 0}</span>
              <span className="wrq-queue-stat-lbl">{STATUS_LABELS[key]}</span>
            </div>
          ))}
          <div className="wrq-queue-stat failed">
            <span className="wrq-queue-stat-val">{stats.FAILED ?? 0}</span>
            <span className="wrq-queue-stat-lbl">Failed</span>
          </div>
        </div>

        <div className="isc-rem-exec-filters">
          {QUEUE_STATUS_FILTERS.map((f) => (
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

        <div className="isc-rem-exec-split">
          <div className="isc-rem-exec-list">
            <div className="isc-rem-exec-list-head">Queue Events ({filtered.length})</div>
            <div className="isc-rem-exec-list-scroll">
            {loading ? (
              <div className="isc-wf-empty">Loading events…</div>
            ) : filtered.length === 0 ? (
              <div className="isc-wf-empty">No queue events for this type.</div>
            ) : (
              filtered.map((ev) => (
                <WorkflowRemediationQueueEventCard
                  key={ev.eventId}
                  event={ev}
                  selected={selectedId === ev.eventId}
                  onSelect={openDetail}
                  config={config}
                />
              ))
            )}
            </div>
          </div>

          <WorkflowRemediationDetailPanel
            event={detail?.event}
            items={detail?.items}
            loading={detailLoading}
            config={config}
            onCreateTicket={() => setTicketOpen(true)}
            onTriggerWorkflow={() => setTriggerOpen(true)}
            actionLoading={actionLoading}
          />
        </div>
      </div>

      <CreateTicketModal
        open={ticketOpen}
        onClose={() => setTicketOpen(false)}
        onSubmit={handleCreateTicket}
        subjectCount={detail?.items?.length || detail?.event?.subjectCount || 0}
        loading={actionLoading}
      />

      <TriggerWorkflowModal
        open={triggerOpen}
        onClose={() => setTriggerOpen(false)}
        onSubmit={handleTriggerWorkflow}
        triggerType={config.triggerType}
        loading={actionLoading}
        presetWorkflowId={detail?.event?.selectedWorkflowId}
        presetWorkflowName={detail?.event?.selectedWorkflowName}
      />
    </div>
  );
}
