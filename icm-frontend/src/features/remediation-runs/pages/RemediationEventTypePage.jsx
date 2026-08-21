import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { workflowApi } from "../../workflows/services/api";
import { REMEDIATION_RUNS_BASE } from "../paths";
import ExecutionDetailPanel from "../components/ExecutionDetailPanel";
import ExecutionEventCard from "../components/ExecutionEventCard";
import {
  IN_FLIGHT,
  REMEDIATION_EVENT_TYPES,
  STATUS_FILTERS,
  computeStats,
  getEventTypeBySlug,
  matchesEventType,
} from "../constants";

export default function RemediationEventTypePage({
  forcedSlug,
  basePath: basePathProp,
  eventTypes: eventTypesProp,
  catalogLabel = "Remediation Runs",
}) {
  const { eventType: eventTypeSlug } = useParams();
  const [searchParams] = useSearchParams();
  const initOrphanId = searchParams.get("orphanId") || "";
  const initExecutionId = searchParams.get("executionId") || "";
  const basePath = basePathProp || REMEDIATION_RUNS_BASE;
  const catalogTypes = eventTypesProp || REMEDIATION_EVENT_TYPES;
  const slug = forcedSlug || eventTypeSlug;
  const config = catalogTypes.find((t) => t.slug === slug) || getEventTypeBySlug(slug);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const pollRef = useRef(null);
  const didAutoSelect = useRef(false);
  const menuRef = useRef(null);

  const load = () =>
    workflowApi
      .executions()
      .then((r) => setExecutions(r.data.data || []))
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    didAutoSelect.current = false;
    setSelectedId(null);
    setDetail(null);
    setFilter("all");
    load();
  }, [eventTypeSlug, forcedSlug, initOrphanId, initExecutionId]);

  useEffect(() => {
    const typeExecutions = executions.filter((e) => matchesEventType(e, config));
    const anyInFlight = typeExecutions.some((e) => IN_FLIGHT.has(e.status));
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
  }, [executions, config]);

  useEffect(() => {
    if (!typeMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setTypeMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [typeMenuOpen]);

  const typeExecutions = useMemo(
    () => executions.filter((e) => matchesEventType(e, config)),
    [executions, config],
  );

  const scopedExecutions = useMemo(() => {
    if (!initOrphanId) return typeExecutions;
    return typeExecutions.filter((e) => String(e.orphanId || "") === initOrphanId);
  }, [typeExecutions, initOrphanId]);

  const filtered = useMemo(() => {
    if (filter === "all") return scopedExecutions;
    if (filter === "active") return scopedExecutions.filter((e) => IN_FLIGHT.has(e.status));
    return scopedExecutions.filter((e) => e.status === filter);
  }, [scopedExecutions, filter]);

  const stats = useMemo(() => computeStats(scopedExecutions), [scopedExecutions]);

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
      const match = initExecutionId
        ? filtered.find((e) => e.executionId === initExecutionId)
        : filtered[0];
      if (match) openDetail(match);
    }
  }, [loading, filtered, initExecutionId]);

  if (!config) {
    return <Navigate to={basePath} replace />;
  }

  return (
    <div className="isc-page isc-rem-exec-page">
      <div className="isc-rem-exec-inner">
        <nav className="isc-breadcrumb">
          {catalogLabel !== "Remediation Events" && (
            <>
              <Link to="/governance/workflows" className="isc-link-btn" style={{ textDecoration: "none" }}>
                Workflows
              </Link>
              <span className="isc-breadcrumb-sep">/</span>
            </>
          )}
          <Link to={basePath} className="isc-link-btn" style={{ textDecoration: "none" }}>
            {catalogLabel}
          </Link>
          <span className="isc-breadcrumb-sep">/</span>
          <span>{config.title}</span>
        </nav>

        <header className="isc-rem-exec-header">
          <div>
            {catalogLabel === "Remediation Events" && (
              <span className="re-page__eyebrow">Governance · Remediation Framework</span>
            )}
            <h1 className="isc-page-title">{config.title}</h1>
            <p className="isc-page-sub">{config.description}</p>
          </div>
          <div className="isc-rem-exec-actions">
            <div className="isc-rem-type-dropdown" ref={menuRef}>
              <button
                type="button"
                className="isc-btn isc-btn-outline isc-rem-type-dropdown-btn"
                onClick={() => setTypeMenuOpen((v) => !v)}
                aria-expanded={typeMenuOpen}
              >
                All types
                <span className="isc-rem-type-dropdown-caret" aria-hidden>▾</span>
              </button>
              {typeMenuOpen && (
                <div className="isc-rem-type-dropdown-menu">
                  <Link
                    to={basePath}
                    className="isc-rem-type-dropdown-item"
                    onClick={() => setTypeMenuOpen(false)}
                  >
                    All event types
                  </Link>
                  {catalogTypes.map((t) => (
                    <Link
                      key={t.slug}
                      to={`${basePath}/${t.slug}`}
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

        <div className="isc-rem-exec-stats">
          <div className="isc-rem-stat"><span className="isc-rem-stat-val">{stats.total}</span><span className="isc-rem-stat-lbl">Total</span></div>
          <div className="isc-rem-stat isc-rem-stat-active"><span className="isc-rem-stat-val">{stats.inProgress}</span><span className="isc-rem-stat-lbl">In progress</span></div>
          <div className="isc-rem-stat isc-rem-stat-ok"><span className="isc-rem-stat-val">{stats.completed}</span><span className="isc-rem-stat-lbl">Completed</span></div>
          <div className="isc-rem-stat isc-rem-stat-fail"><span className="isc-rem-stat-val">{stats.failed}</span><span className="isc-rem-stat-lbl">Failed</span></div>
        </div>

        {initOrphanId && (
          <div className="isc-exec-waiting-banner" style={{ marginBottom: 8 }}>
            <span className="isc-exec-waiting-banner-label">Filtered</span>
            <strong>Showing tasks for account <code>{initOrphanId}</code></strong>
          </div>
        )}

        <div className="isc-rem-exec-filters">
          {STATUS_FILTERS.map((f) => (
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
            <p>No remediation executions for {config.title.toLowerCase()} yet.</p>
          </div>
        ) : (
          <div className="isc-rem-exec-split">
            <div className="isc-rem-exec-list">
              <div className="isc-rem-exec-list-head">
                <span>Executions ({filtered.length})</span>
              </div>
              <div className="isc-rem-exec-list-scroll">
                {filtered.map((e) => (
                  <ExecutionEventCard
                    key={e.executionId}
                    exec={e}
                    selected={selectedId === e.executionId}
                    onSelect={openDetail}
                    eventTypeAccent={config.accent}
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
}
