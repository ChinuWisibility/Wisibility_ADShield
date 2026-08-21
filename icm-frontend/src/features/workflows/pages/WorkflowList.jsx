import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Pagination, TablePagination } from "@mui/material";
import {
  AccountTreeOutlined,
  CheckCircleOutline,
  ErrorOutline,
  NotificationsNone,
  PersonOffOutlined,
  PlaylistPlay,
  FormatListBulleted,
  PublicOutlined,
  Search,
  ShowChart,
  BusinessOutlined,
  AutoAwesomeOutlined,
  Add,
} from "@mui/icons-material";
import { REMEDIATION_RUNS_BASE } from "../../remediation-runs/paths";
import { WORKFLOW_REMEDIATION_QUEUE_BASE } from "../../workflow-remediation-queue/paths";
import { workflowApi } from "../services/api";
import { tenantAPI } from "../../../services/api";
import { useAuth } from "../../../contexts/AuthContext";
import { palette } from "../../../theme/palette";
import { buildDuplicatePayload } from "../utils/workflowDuplicate";
import {
  computeWorkflowListStats,
  filterWorkflows,
  formatWorkflowDateShort,
  getWorkflowNodeCount,
  getWorkflowRunStats,
  getWorkflowTypeMeta,
  summarizeWorkflowTags,
} from "../utils/workflowListSupport";

const TENANT_STORAGE_KEY = "iga_workflows_tenant_id";

/** Same numbered footer used by DataTable across the app. */
function NumberedPaginationActions({ count, page, rowsPerPage, onPageChange }) {
  const pageCount = Math.max(1, Math.ceil(count / Math.max(1, rowsPerPage)));

  return (
    <Pagination
      count={pageCount}
      page={page + 1}
      onChange={(event, value) => onPageChange(event, value - 1)}
      siblingCount={1}
      boundaryCount={1}
      size="small"
      shape="rounded"
      color="primary"
      sx={{
        ml: 2,
        "& .MuiPaginationItem-root": {
          fontSize: "0.8125rem",
          minWidth: 30,
          height: 30,
          borderRadius: 1.5,
        },
      }}
    />
  );
}

function resolveUserTenantId(user) {
  if (!user?.tenantId) return null;
  return typeof user.tenantId === "object"
    ? String(user.tenantId._id || user.tenantId.id || "")
    : String(user.tenantId);
}

function tenantLabel(t) {
  if (!t) return "";
  const name = t.name || t.code || "Tenant";
  return t.code && t.name ? `${t.name} (${t.code})` : name;
}

function resolveTenantTimezone(user, tenants, tenantId) {
  const fromUser =
    (typeof user?.tenantId === "object" && (user.tenantId.timezone || user.tenantId.timeZone))
    || user?.timezone
    || user?.timeZone;
  if (fromUser) return String(fromUser);
  const t = tenants.find((row) => String(row._id) === String(tenantId));
  if (t?.timezone || t?.timeZone) return String(t.timezone || t.timeZone);
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatTimezoneLabel(tz) {
  if (!tz) return "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const abbr = parts.find((p) => p.type === "timeZoneName")?.value;
    return abbr && abbr !== tz ? `${tz} (${abbr})` : tz;
  } catch {
    return tz;
  }
}

function TypeIcon({ tone }) {
  const common = { fontSize: 22 };
  if (tone === "violet") return <PersonOffOutlined sx={common} />;
  if (tone === "blue") return <AccountTreeOutlined sx={common} />;
  if (tone === "amber") return <ShowChart sx={common} />;
  return <AccountTreeOutlined sx={common} />;
}

export default function WorkflowList() {
  const { user, isPlatformAdmin } = useAuth();
  const userTenantId = resolveUserTenantId(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState(() => {
    if (userTenantId) return userTenantId;
    return searchParams.get("tenantId")
      || sessionStorage.getItem(TENANT_STORAGE_KEY)
      || "";
  });

  const effectiveTenantId = userTenantId || selectedTenantId || "";
  const needsTenantPicker = isPlatformAdmin && !userTenantId;

  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [usingTemplateId, setUsingTemplateId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [menuWorkflowId, setMenuWorkflowId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  const tenantParams = useMemo(
    () => (effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
    [effectiveTenantId],
  );

  const closeActionMenu = () => setMenuWorkflowId(null);

  useEffect(() => {
    if (!needsTenantPicker) return undefined;
    let cancelled = false;
    tenantAPI
      .list()
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data || res.data || [];
        setTenants(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setTenants([]);
      });
    return () => {
      cancelled = true;
    };
  }, [needsTenantPicker]);

  useEffect(() => {
    if (!needsTenantPicker) return;
    if (!selectedTenantId) return;
    sessionStorage.setItem(TENANT_STORAGE_KEY, selectedTenantId);
    const next = new URLSearchParams(searchParams);
    if (next.get("tenantId") !== selectedTenantId) {
      next.set("tenantId", selectedTenantId);
      setSearchParams(next, { replace: true });
    }
  }, [needsTenantPicker, selectedTenantId, searchParams, setSearchParams]);

  const load = useCallback(() => {
    if (!effectiveTenantId) {
      setWorkflows([]);
      setLoading(false);
      setLoadError("");
      return Promise.resolve();
    }
    setLoading(true);
    setLoadError("");
    return workflowApi
      .list(tenantParams)
      .then((r) => setWorkflows(r.data.data || []))
      .catch((e) => {
        setWorkflows([]);
        setLoadError(
          e.response?.data?.message || "Could not load workflows. Check that the backend is running.",
        );
      })
      .finally(() => setLoading(false));
  }, [effectiveTenantId, tenantParams]);

  const loadEnterpriseTemplate = async () => {
    if (!effectiveTenantId) return;
    setSeeding(true);
    setLoadError("");
    try {
      const res = await workflowApi.seedTemplate(tenantParams);
      const wf = res.data?.data;
      if (wf?.id) {
        navigate(`/governance/workflows/${wf.id}/edit`);
        return;
      }
      await load();
    } catch (e) {
      setLoadError(e.response?.data?.message || "Could not load enterprise template.");
    } finally {
      setSeeding(false);
    }
  };

  const openTemplateLibrary = async () => {
    if (!effectiveTenantId) return;
    setTemplateLibraryOpen(true);
    setTemplatesLoading(true);
    setTemplateError("");
    try {
      const res = await workflowApi.templates(tenantParams);
      setTemplates(res.data?.data || []);
    } catch (error) {
      setTemplates([]);
      setTemplateError(
        error.response?.data?.message || "Could not load the workflow template library.",
      );
    } finally {
      setTemplatesLoading(false);
    }
  };

  const useGlobalTemplate = async (template) => {
    if (!effectiveTenantId || !template?.id) return;
    if (template.tenantWorkflowId) {
      navigate(`/governance/workflows/${template.tenantWorkflowId}/edit`);
      return;
    }
    setUsingTemplateId(template.id);
    setTemplateError("");
    try {
      const res = await workflowApi.useTemplate(template.id, tenantParams);
      const workflow = res.data?.data;
      if (!workflow?.id) throw new Error("The tenant workflow was not returned.");
      setTemplateLibraryOpen(false);
      navigate(`/governance/workflows/${workflow.id}/edit`);
    } catch (error) {
      setTemplateError(
        error.response?.data?.message || error.message || "Could not use this template.",
      );
    } finally {
      setUsingTemplateId(null);
    }
  };

  const loadDualNotifyTemplate = async () => {
    if (!effectiveTenantId) return;
    setSeeding(true);
    setLoadError("");
    try {
      const res = await workflowApi.seedAccessRevokeDualNotifyTemplate(tenantParams);
      const wf = res.data?.data;
      if (wf?.id) {
        navigate(`/governance/workflows/${wf.id}/edit`);
        return;
      }
      await load();
    } catch (e) {
      setLoadError(
        e.response?.data?.message || "Could not load dual notify template.",
      );
    } finally {
      setSeeding(false);
    }
  };

  const seedIamOrphan = async () => {
    if (!effectiveTenantId) return;
    setSeeding(true);
    setLoadError("");
    try {
      const res = await workflowApi.seedIamOrphanTemplate(tenantParams);
      const wf = res.data?.data;
      if (wf?.id) navigate(`/governance/workflows/${wf.id}/edit`);
      else await load();
    } catch (e) {
      setLoadError(e.response?.data?.message || "Could not seed IAM orphan workflow.");
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [search, statusFilter, typeFilter, pageSize, effectiveTenantId]);

  useEffect(() => {
    if (!menuWorkflowId) return undefined;
    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeActionMenu();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeActionMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuWorkflowId]);

  const stats = useMemo(() => computeWorkflowListStats(workflows), [workflows]);
  const visibleWorkflows = useMemo(() => {
    let list = filterWorkflows(workflows, { query: search, status: statusFilter });
    if (typeFilter !== "all") {
      list = list.filter((wf) => getWorkflowTypeMeta(wf).label === typeFilter);
    }
    return list;
  }, [workflows, search, statusFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(visibleWorkflows.length / pageSize) || 1);
  const safePage = Math.min(page, pageCount - 1);
  const pagedWorkflows = useMemo(() => {
    const start = safePage * pageSize;
    return visibleWorkflows.slice(start, start + pageSize);
  }, [visibleWorkflows, safePage, pageSize]);

  const typeOptions = useMemo(() => {
    const labels = new Set(workflows.map((wf) => getWorkflowTypeMeta(wf).label));
    return [...labels].sort();
  }, [workflows]);

  const selectedTenantName = useMemo(() => {
    if (userTenantId && user?.tenantId && typeof user.tenantId === "object") {
      return tenantLabel(user.tenantId);
    }
    const t = tenants.find((row) => String(row._id) === String(effectiveTenantId));
    return tenantLabel(t) || (effectiveTenantId ? "Selected tenant" : "");
  }, [userTenantId, user, tenants, effectiveTenantId]);

  const timezoneLabel = useMemo(
    () => formatTimezoneLabel(resolveTenantTimezone(user, tenants, effectiveTenantId)),
    [user, tenants, effectiveTenantId],
  );

  const downloadJson = (wf) => {
    const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(wf.name || "workflow").replace(/[^\w.-]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const duplicateWorkflow = async (wf) => {
    if (!effectiveTenantId) return;
    setDuplicatingId(wf.id);
    setLoadError("");
    try {
      const [fullRes, listRes] = await Promise.all([
        workflowApi.get(wf.id, tenantParams),
        workflowApi.list(tenantParams),
      ]);
      const payload = buildDuplicatePayload(fullRes.data.data, listRes.data.data || []);
      const res = await workflowApi.create(payload, tenantParams);
      navigate(`/governance/workflows/${res.data.data.id}/edit`);
    } catch (e) {
      setLoadError(e.response?.data?.message || "Could not duplicate workflow.");
    } finally {
      setDuplicatingId(null);
    }
  };

  const toggleWorkflowEnabled = async (wf) => {
    if (!wf?.id || togglingId || !effectiveTenantId) return;
    const nextEnabled = wf.enabled === false;
    setTogglingId(wf.id);
    setLoadError("");
    try {
      const res = await workflowApi.update(
        wf.id,
        { enabled: nextEnabled },
        { allowInvalid: true, tenantId: effectiveTenantId },
      );
      const updated = res.data?.data;
      setWorkflows((prev) =>
        prev.map((row) =>
          row.id === wf.id
            ? { ...row, ...(updated || {}), enabled: updated?.enabled ?? nextEnabled }
            : row,
        ),
      );
    } catch (e) {
      setLoadError(
        e.response?.data?.message ||
          `Could not ${nextEnabled ? "activate" : "deactivate"} workflow.`,
      );
    } finally {
      setTogglingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !effectiveTenantId) return;
    setDeleting(true);
    try {
      await workflowApi.remove(deleteTarget.id, tenantParams);
      setDeleteTarget(null);
      await load();
    } catch (e) {
      alert(e.response?.data?.message || "Could not delete workflow.");
    } finally {
      setDeleting(false);
    }
  };

  const createHref = effectiveTenantId
    ? `/governance/workflows/create?tenantId=${encodeURIComponent(effectiveTenantId)}`
    : "/governance/workflows/create";

  return (
    <div className="isc-page isc-wf-list-page-wrap">
      <div className="isc-wf-list-page isc-wf-dash">
        <nav className="isc-wf-dash__crumb" aria-label="Breadcrumb">
          <span>Governance</span>
          <span className="isc-wf-dash__crumb-sep" aria-hidden>/</span>
          <span>Automation</span>
        </nav>

        <header className="isc-wf-dash__hero">
          <div className="isc-wf-dash__hero-copy">
            <h1 className="isc-wf-dash__title">Workflows</h1>
            <p className="isc-wf-dash__subtitle">
              Tenant-scoped remediation flows — create and manage canvases for the selected tenant only.
            </p>
          </div>
          <div className="isc-wf-dash__actions">
            <Link to={WORKFLOW_REMEDIATION_QUEUE_BASE} className="isc-wf-dash__btn isc-wf-dash__btn--ghost">
              <FormatListBulleted sx={{ fontSize: 18 }} />
              Remediation queue
            </Link>
            <Link to={REMEDIATION_RUNS_BASE} className="isc-wf-dash__btn isc-wf-dash__btn--ghost">
              <PlaylistPlay sx={{ fontSize: 18 }} />
              Remediation runs
            </Link>
            <button
              type="button"
              className="isc-wf-dash__btn isc-wf-dash__btn--ghost"
              disabled={!effectiveTenantId}
              onClick={openTemplateLibrary}
            >
              <AutoAwesomeOutlined sx={{ fontSize: 18 }} />
              Template library
            </button>
            <button
              type="button"
              className="isc-wf-dash__btn isc-wf-dash__btn--ghost"
              disabled={seeding || !effectiveTenantId}
              onClick={loadDualNotifyTemplate}
            >
              <NotificationsNone sx={{ fontSize: 18 }} />
              {seeding ? "Loading…" : "Dual notify template"}
            </button>
            <button
              type="button"
              className="isc-wf-dash__btn isc-wf-dash__btn--ghost"
              disabled={seeding || !effectiveTenantId}
              onClick={seedIamOrphan}
            >
              <PersonOffOutlined sx={{ fontSize: 18 }} />
              IAM template
            </button>
            <Link
              to={createHref}
              className={`isc-wf-dash__btn isc-wf-dash__btn--primary${!effectiveTenantId ? " is-disabled" : ""}`}
              aria-disabled={!effectiveTenantId}
              onClick={(e) => {
                if (!effectiveTenantId) e.preventDefault();
              }}
            >
              <Add sx={{ fontSize: 18 }} />
              New workflow
            </Link>
          </div>
        </header>

        {needsTenantPicker ? (
          <div className="isc-wf-dash__tenant isc-wf-dash__tenant--pick">
            <label className="isc-wf-dash__tenant-pick">
              <span>Tenant</span>
              <select
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                aria-label="Select tenant"
              >
                <option value="">Select tenant…</option>
                {tenants.map((t) => (
                  <option key={t._id} value={String(t._id)}>
                    {tenantLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : effectiveTenantId ? (
          <div className="isc-wf-dash__tenant">
            <div className="isc-wf-dash__tenant-left">
              <BusinessOutlined sx={{ fontSize: 20, color: "#2563eb" }} />
              <div>
                <span className="isc-wf-dash__tenant-kicker">Tenant</span>
                <strong className="isc-wf-dash__tenant-name">{selectedTenantName || "Your tenant"}</strong>
              </div>
            </div>
            <p className="isc-wf-dash__tenant-hint">
              New workflows and templates are created for this tenant only — not shared across all tenants.
            </p>
            <div className="isc-wf-dash__tenant-tz">
              <PublicOutlined sx={{ fontSize: 16 }} />
              <span>
                <em>Tenant timezone</em>
                {timezoneLabel}
              </span>
            </div>
          </div>
        ) : null}

        {!effectiveTenantId ? (
          <div className="isc-wf-empty isc-wf-dash__empty">
            <h3>Select a tenant</h3>
            <p>Choose a tenant to view and create workflows for that organization.</p>
          </div>
        ) : (
          <>
            <div className="isc-wf-dash__kpis">
              <div className="isc-wf-dash__kpi">
                <div className="isc-wf-dash__kpi-icon isc-wf-dash__kpi-icon--violet">
                  <AccountTreeOutlined sx={{ fontSize: 22 }} />
                </div>
                <div>
                  <span className="isc-wf-dash__kpi-label">Workflows</span>
                  <strong className="isc-wf-dash__kpi-value">{loading ? "—" : stats.total}</strong>
                  <span className="isc-wf-dash__kpi-sub">Total workflows</span>
                </div>
              </div>
              <div className="isc-wf-dash__kpi">
                <div className="isc-wf-dash__kpi-icon isc-wf-dash__kpi-icon--green">
                  <CheckCircleOutline sx={{ fontSize: 22 }} />
                </div>
                <div>
                  <span className="isc-wf-dash__kpi-label">Enabled</span>
                  <strong className="isc-wf-dash__kpi-value">{loading ? "—" : stats.enabled}</strong>
                  <span className="isc-wf-dash__kpi-sub">Active workflows</span>
                </div>
              </div>
              <div className="isc-wf-dash__kpi">
                <div className="isc-wf-dash__kpi-icon isc-wf-dash__kpi-icon--blue">
                  <ShowChart sx={{ fontSize: 22 }} />
                </div>
                <div>
                  <span className="isc-wf-dash__kpi-label">Successful runs</span>
                  <strong className="isc-wf-dash__kpi-value">{loading ? "—" : stats.success}</strong>
                  <span className="isc-wf-dash__kpi-sub">All recorded runs</span>
                </div>
              </div>
              <div className="isc-wf-dash__kpi">
                <div className="isc-wf-dash__kpi-icon isc-wf-dash__kpi-icon--red">
                  <ErrorOutline sx={{ fontSize: 22 }} />
                </div>
                <div>
                  <span className="isc-wf-dash__kpi-label">Errors</span>
                  <strong className={`isc-wf-dash__kpi-value${stats.errors > 0 ? " is-danger" : ""}`}>
                    {loading ? "—" : stats.errors}
                  </strong>
                  <span className="isc-wf-dash__kpi-sub">All recorded runs</span>
                </div>
              </div>
            </div>

            <div className="isc-wf-dash__filters">
              <div className="isc-wf-dash__search">
                <Search sx={{ fontSize: 18, color: "#94a3b8" }} />
                <input
                  type="search"
                  placeholder="Search workflows…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search workflows"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                aria-label="Filter by type"
              >
                <option value="all">All types</option>
                {typeOptions.map((label) => (
                  <option key={label} value={label}>{label}</option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>

            {loadError ? <div className="isc-wf-dash__error">{loadError}</div> : null}

            {loading ? (
              <div className="isc-wf-empty">Loading workflows…</div>
            ) : !workflows.length ? (
              <div className="isc-wf-empty isc-wf-dash__empty">
                <h3>No workflows yet</h3>
                <p>Start from a template or create a blank canvas for {selectedTenantName || "this tenant"}.</p>
                <div className="isc-wf-dash__empty-actions">
                  <button
                    type="button"
                    className="isc-wf-dash__btn isc-wf-dash__btn--primary"
                    disabled={seeding}
                    onClick={loadDualNotifyTemplate}
                  >
                    Dual notify template
                  </button>
                  <button
                    type="button"
                    className="isc-wf-dash__btn isc-wf-dash__btn--ghost"
                    disabled={seeding}
                    onClick={loadEnterpriseTemplate}
                  >
                    Enterprise template
                  </button>
                  <Link to={createHref} className="isc-wf-dash__btn isc-wf-dash__btn--ghost">
                    Create workflow
                  </Link>
                </div>
              </div>
            ) : visibleWorkflows.length === 0 ? (
              <div className="isc-wf-empty">No workflows match your filters.</div>
            ) : (
              <div className="isc-wf-dash__list">
                {pagedWorkflows.map((wf) => {
                  const typeMeta = getWorkflowTypeMeta(wf);
                  const runStats = getWorkflowRunStats(wf);
                  const nodeCount = getWorkflowNodeCount(wf);
                  const tagSummary = summarizeWorkflowTags(wf.tags);

                  return (
                    <article
                      key={wf.id}
                      className={`isc-wf-dash__card isc-wf-dash__card--${typeMeta.tone}`}
                    >
                      <div className={`isc-wf-dash__card-icon isc-wf-dash__card-icon--${typeMeta.tone}`}>
                        <TypeIcon tone={typeMeta.tone} />
                      </div>

                      <div className="isc-wf-dash__card-main">
                        <div className="isc-wf-dash__card-badges">
                          <span className={`isc-wf-dash__type isc-wf-dash__type--${typeMeta.tone}`}>
                            {typeMeta.label}
                          </span>
                          <span
                            className={`isc-wf-dash__status ${wf.enabled !== false ? "is-on" : "is-off"}`}
                          >
                            {wf.enabled !== false ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="isc-wf-dash__card-name"
                          title={wf.description || wf.name}
                          onClick={() => navigate(`/governance/workflows/${wf.id}/edit`)}
                        >
                          {wf.name}
                        </button>
                        {wf.description ? (
                          <p className="isc-wf-dash__card-desc" title={wf.description}>
                            {wf.description}
                          </p>
                        ) : null}
                        <div className="isc-wf-dash__card-meta">
                          <span>{nodeCount} steps</span>
                          {tagSummary ? (
                            <>
                              <span aria-hidden>·</span>
                              <span>{tagSummary}</span>
                            </>
                          ) : null}
                          <span aria-hidden>·</span>
                          <span>Updated {formatWorkflowDateShort(wf.updatedAt)}</span>
                        </div>
                      </div>

                      <div className="isc-wf-dash__card-stats">
                        <div className="isc-wf-dash__stat">
                          <span>Success</span>
                          <strong className="is-success">{runStats.success}</strong>
                        </div>
                        <div className="isc-wf-dash__stat">
                          <span>Errors</span>
                          <strong className={runStats.errors > 0 ? "is-danger" : ""}>
                            {runStats.errors}
                          </strong>
                        </div>
                        <div className="isc-wf-dash__stat">
                          <span>Rate</span>
                          <strong className="is-rate">
                            {runStats.rate != null ? `${runStats.rate}%` : "—"}
                          </strong>
                        </div>
                      </div>

                      <div
                        className="isc-wf-dash__card-menu"
                        ref={menuWorkflowId === wf.id ? menuRef : null}
                      >
                        <button
                          type="button"
                          className="isc-wf-dash__menu-trigger"
                          aria-label={`Actions for ${wf.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menuWorkflowId === wf.id}
                          disabled={togglingId === wf.id || duplicatingId === wf.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuWorkflowId((id) => (id === wf.id ? null : wf.id));
                          }}
                        >
                          ⋮
                        </button>
                        {menuWorkflowId === wf.id ? (
                          <div className="isc-wf-dash__menu-panel" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeActionMenu();
                                navigate(`/governance/workflows/${wf.id}/edit`);
                              }}
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={togglingId === wf.id}
                              onClick={() => {
                                closeActionMenu();
                                toggleWorkflowEnabled(wf);
                              }}
                            >
                              {togglingId === wf.id
                                ? "Updating…"
                                : wf.enabled !== false
                                  ? "Deactivate"
                                  : "Activate"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              disabled={duplicatingId === wf.id}
                              onClick={() => {
                                closeActionMenu();
                                duplicateWorkflow(wf);
                              }}
                            >
                              {duplicatingId === wf.id ? "Copying…" : "Duplicate"}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeActionMenu();
                                navigate(`/governance/workflows/${wf.id}/test`);
                              }}
                            >
                              Test
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeActionMenu();
                                downloadJson(wf);
                              }}
                            >
                              Export
                            </button>
                            <div className="isc-wf-dash__menu-divider" />
                            <button
                              type="button"
                              role="menuitem"
                              className="is-danger"
                              onClick={() => {
                                closeActionMenu();
                                setDeleteTarget(wf);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}

                <TablePagination
                  component="div"
                  count={visibleWorkflows.length}
                  page={safePage}
                  onPageChange={(_, p) => setPage(p)}
                  rowsPerPage={pageSize}
                  onRowsPerPageChange={(e) => {
                    setPageSize(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[5, 10, 25, 50]}
                  ActionsComponent={NumberedPaginationActions}
                  sx={{
                    mt: 1,
                    borderTop: `1px solid ${palette.border.default}`,
                    borderRadius: "0 0 12px 12px",
                    bgcolor: "#fff",
                    "& .MuiTablePagination-toolbar": { flexWrap: "wrap", rowGap: 1 },
                    "& .MuiTablePagination-spacer": { flex: "1 1 auto" },
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      {deleteTarget && (
        <div
          className="isc-modal-overlay open"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && !deleting && setDeleteTarget(null)}
        >
          <div className="isc-modal" role="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="isc-modal-header">
              <div className="isc-modal-title">Delete workflow?</div>
              <button
                type="button"
                className="isc-modal-close"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                ×
              </button>
            </div>
            <p className="isc-modal-desc">
              This permanently removes <strong>{deleteTarget.name}</strong> from this tenant and cannot be undone.
            </p>
            <div className="isc-modal-footer">
              <button
                type="button"
                className="isc-btn isc-btn-outline"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="isc-btn isc-btn-danger"
                disabled={deleting}
                onClick={confirmDelete}
              >
                {deleting ? "Deleting…" : "Delete workflow"}
              </button>
            </div>
          </div>
        </div>
      )}

      {templateLibraryOpen && (
        <div
          className="isc-modal-overlay open"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !usingTemplateId) {
              setTemplateLibraryOpen(false);
            }
          }}
        >
          <div
            className="isc-modal isc-wf-template-library"
            role="dialog"
            aria-modal="true"
            aria-labelledby="workflow-template-library-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="isc-modal-header">
              <div>
                <div id="workflow-template-library-title" className="isc-modal-title">
                  Workflow template library
                </div>
                <p className="isc-wf-template-library__subtitle">
                  Create an editable copy owned by {selectedTenantName || "this tenant"}.
                </p>
              </div>
              <button
                type="button"
                className="isc-modal-close"
                disabled={Boolean(usingTemplateId)}
                onClick={() => setTemplateLibraryOpen(false)}
                aria-label="Close template library"
              >
                ×
              </button>
            </div>

            <div className="isc-wf-template-library__body">
              {templateError ? (
                <div className="isc-wf-dash__error" role="alert">{templateError}</div>
              ) : null}
              {templatesLoading ? (
                <div className="isc-wf-template-library__empty">Loading templates…</div>
              ) : templates.length === 0 ? (
                <div className="isc-wf-template-library__empty">
                  No global workflow templates are available.
                </div>
              ) : (
                <div className="isc-wf-template-library__grid">
                  {templates.map((template) => {
                    const nodeCount = getWorkflowNodeCount(template);
                    const tagSummary = summarizeWorkflowTags(template.tags);
                    const isUsing = usingTemplateId === template.id;
                    return (
                      <article key={template.id} className="isc-wf-template-library__card">
                        <div className="isc-wf-template-library__card-head">
                          <span className="isc-wf-template-library__icon">
                            <AutoAwesomeOutlined sx={{ fontSize: 20 }} />
                          </span>
                          {template.tenantWorkflowId ? (
                            <span className="isc-wf-template-library__owned">In your tenant</span>
                          ) : (
                            <span className="isc-wf-template-library__global">Global template</span>
                          )}
                        </div>
                        <h3>{template.name}</h3>
                        <p>{template.description || "Reusable workflow starter."}</p>
                        <div className="isc-wf-template-library__meta">
                          <span>{nodeCount} steps</span>
                          {tagSummary ? <span>{tagSummary}</span> : null}
                        </div>
                        <button
                          type="button"
                          className="isc-wf-dash__btn isc-wf-dash__btn--primary"
                          disabled={Boolean(usingTemplateId)}
                          onClick={() => useGlobalTemplate(template)}
                        >
                          {isUsing
                            ? "Creating tenant copy…"
                            : template.tenantWorkflowId
                              ? "Open tenant copy"
                              : "Use in my tenant"}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
