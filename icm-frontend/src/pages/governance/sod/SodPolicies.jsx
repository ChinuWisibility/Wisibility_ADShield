import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem as MuiMenuItem,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  alpha,
  Alert,
  Tooltip,
  Link,
} from "@mui/material";
import {
  Add,
  Assessment,
  ContentCopy,
  DeleteForever,
  Edit,
  MoreVert,
  PauseCircleOutline,
  PlayArrow,
  Search,
  Shield,
  Visibility,
} from "@mui/icons-material";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import DataTable from "../../../components/DataTable";
import { palette } from "../../../theme/palette";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useSnackbar } from "notistack";
import { applicationAPI } from "../../../services/api";
import { sodAPI, isSodEvaluationTimeoutError, SOD_EVAL_TIMEOUT_MESSAGE } from "../../../services/sodService";
import { useAuth } from "../../../contexts/AuthContext";

const createDefaultRule = () => ({
  name: "",
  description: "",
  operator: "AND",
  isActive: true,
  leftEntitlements: [],
  rightEntitlements: [],
});

const normalizeRule = (rule) => ({
  name: String(rule?.name || ""),
  description: String(rule?.description || ""),
  operator: rule?.operator === "OR" ? "OR" : "AND",
  isActive: rule?.isActive !== false,
  leftEntitlements: Array.isArray(rule?.leftEntitlements)
    ? rule.leftEntitlements
        .map((item) => ({
          id: String(item?.id || ""),
          name: String(item?.name || ""),
          applicationName: String(item?.applicationName || ""),
        }))
        .filter((item) => item.id || item.name)
    : [],
  rightEntitlements: Array.isArray(rule?.rightEntitlements)
    ? rule.rightEntitlements
        .map((item) => ({
          id: String(item?.id || ""),
          name: String(item?.name || ""),
          applicationName: String(item?.applicationName || ""),
        }))
        .filter((item) => item.id || item.name)
    : [],
});

const looksLikeObjectId = (value) => /^[a-f0-9]{24}$/i.test(String(value || "").trim());

const isAuthoritativeApp = (app) =>
  Boolean(
    app?.authoritativeSource ||
      app?.authoritative ||
      app?.isAuthoritative ||
      app?.authoritativeApplication ||
      app?.authoritativeIdentitySource,
  );

const NAME_MAX = 120;
const DESCRIPTION_MAX = 1000;
const RULE_NAME_MAX = 120;

/** Sidebar width and top bar height (align with AccessCertificationWizard) */
const LAYOUT_SIDEBAR_W = 265;
const LAYOUT_TOPBAR_H = 70;
const GAP_RIGHT = 30;
const GAP_BOTTOM = 40;

const chooseBestEntitlementLabel = (ent) => {
  const candidates = [
    ent?.displayName,
    ent?.display_name,
    ent?.entitlementName,
    ent?.entitlement_name,
    ent?.name,
    ent?.resource_name,
    ent?.roleName,
    ent?.role,
    ent?.groupName,
    ent?.group,
    ent?.cn,
    ent?.sourceValue,
    ent?.value,
    ent?.description,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!candidates.length) return "";
  const preferred = candidates.find((x) => !looksLikeObjectId(x));
  if (preferred) return preferred;
  const fallbackId = String(ent?._id || ent?.id || ent?.entitlementId || "").trim();
  if (looksLikeObjectId(fallbackId)) return `Entitlement ${fallbackId.slice(-6)}`;
  return candidates[0];
};

function SeverityChip({ value }) {
  const v = String(value || "").toUpperCase();
  const cfg =
    v === "CRITICAL"
      ? { color: palette.status.error, bg: palette.status.errorBg }
      : v === "HIGH"
        ? { color: palette.risk.high, bg: `${palette.risk.high}1A` }
        : v === "MEDIUM"
          ? { color: palette.status.warning, bg: palette.status.warningBg }
          : { color: palette.status.success, bg: palette.status.successBg };
  return (
    <Chip
      size="small"
      label={v || "—"}
      sx={{ fontWeight: 700, bgcolor: cfg.bg, color: cfg.color }}
    />
  );
}

function StatusChip({ value }) {
  const v = String(value || "").toLowerCase();
  const cfg =
    v === "active"
      ? { color: palette.status.success, bg: palette.status.successBg, label: "Active" }
      : v === "draft"
        ? { color: palette.status.warning, bg: palette.status.warningBg, label: "Draft" }
        : v
          ? { color: palette.text.secondary, bg: alpha(palette.text.secondary, 0.08), label: v }
          : { color: palette.text.secondary, bg: alpha(palette.text.secondary, 0.08), label: "—" };
  return (
    <Chip size="small" label={cfg.label} sx={{ fontWeight: 700, bgcolor: cfg.bg, color: cfg.color }} />
  );
}

export default function SodPolicies() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [policies, setPolicies] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

  const [listPage, setListPage] = useState(0);
  const [listRowsPerPage, setListRowsPerPage] = useState(25);
  const [listTotal, setListTotal] = useState(0);
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortField, setSortField] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");

  const [apps, setApps] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState("create"); // create | edit
  const [current, setCurrent] = useState(null);
  const [nextPolicyIdPreview, setNextPolicyIdPreview] = useState("");
  const [entitlementOptions, setEntitlementOptions] = useState([]);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [actionAnchorEl, setActionAnchorEl] = useState(null);
  const [actionPolicy, setActionPolicy] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    severity: "MEDIUM",
    status: "draft",
    applications: [],
    rules: [createDefaultRule()],
  });
  const [fieldErrors, setFieldErrors] = useState({});

  const [evalUi, setEvalUi] = useState({
    running: false,
    scope: "all", // all | policy
    label: "",
    startedAt: null,
    lastMessage: "",
  });
  const [evalTick, setEvalTick] = useState(0);

  useEffect(() => {
    if (!evalUi.running) return;
    setEvalTick(0);
    const t = setInterval(() => setEvalTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [evalUi.running]);

  const loadStats = useCallback(async () => {
    try {
      const sRes = await sodAPI.getPolicyStats();
      setStats(sRes.data?.data || null);
    } catch {
      setStats(null);
    }
  }, []);

  const loadPoliciesList = useCallback(async () => {
    setError("");
    setTableLoading(true);
    try {
      const pRes = await sodAPI.listPolicies({
        page: listPage + 1,
        limit: listRowsPerPage,
        ...(debouncedQ.trim() ? { q: debouncedQ.trim() } : {}),
        ...(filterSeverity ? { severity: filterSeverity } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        sortField,
        sortDir,
      });
      const rows = pRes.data?.data || [];
      const pg = pRes.data?.pagination;
      setPolicies(rows);
      setListTotal(pg?.total ?? rows.length);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to load SoD policies.");
      setPolicies([]);
      setListTotal(0);
    } finally {
      setTableLoading(false);
      setLoading(false);
    }
  }, [
    listPage,
    listRowsPerPage,
    debouncedQ,
    filterSeverity,
    filterStatus,
    sortField,
    sortDir,
  ]);

  const load = async () => {
    setLoading(true);
    await loadStats();
    await loadPoliciesList();
  };

  const loadApps = async () => {
    try {
      const userTenantId =
        typeof user?.tenantId === "object" ? user?.tenantId?._id : user?.tenantId;
      const res = await applicationAPI.list({
        limit: 500,
        page: 1,
        ...(userTenantId ? { tenantId: String(userTenantId) } : {}),
      });
      const rawApps = res.data?.data || res.data?.applications || [];
      const filtered = !userTenantId
        ? rawApps
        : rawApps.filter((a) => {
            const appTenantId =
              typeof a?.tenantId === "object" ? a?.tenantId?._id : a?.tenantId;
            return String(appTenantId || "") === String(userTenantId);
          });
      setApps(filtered);
    } catch {
      setApps([]);
    }
  };

  useEffect(() => {
    if (!searchQ.trim()) {
      setDebouncedQ("");
      setListPage(0);
      return;
    }
    const t = setTimeout(() => {
      setDebouncedQ(searchQ);
      setListPage(0);
    }, 320);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    loadApps();
  }, [user?.tenantId]);

  useEffect(() => {
    setLoading(true);
    loadStats();
  }, [user?.tenantId, loadStats]);

  useEffect(() => {
    loadPoliciesList();
  }, [user?.tenantId, loadPoliciesList]);

  const appNameById = useMemo(() => {
    const m = new Map();
    for (const a of apps) m.set(String(a._id), a.applicationName || a.name || a.displayName || "Application");
    return m;
  }, [apps]);

  /** Target apps only — hide authoritative / HR source applications from the picker. */
  const selectableApps = useMemo(() => {
    const selectedId = String(form.applications[0] || "");
    return apps.filter((app) => {
      if (!isAuthoritativeApp(app)) return true;
      const appId = String(app?._id || app?.id || "");
      return Boolean(selectedId && appId === selectedId);
    });
  }, [apps, form.applications]);

  const openCreate = async () => {
    setEditMode("create");
    setCurrent(null);
    setError("");
    setFieldErrors({});
    setForm({
      name: "",
      description: "",
      severity: "MEDIUM",
      status: "draft",
      applications: [],
      rules: [createDefaultRule()],
    });
    setNextPolicyIdPreview("");
    try {
      const res = await sodAPI.getNextPolicyId();
      setNextPolicyIdPreview(res.data?.data?.policyId || "");
    } catch {
      setNextPolicyIdPreview("");
    }
    setEditOpen(true);
  };

  const openEdit = (p) => {
    setEditMode("edit");
    setCurrent(p);
    setError("");
    setFieldErrors({});
    setNextPolicyIdPreview(p?.policyId || "");
    setForm({
      name: p?.name || "",
      description: p?.description || "",
      severity: p?.severity || "MEDIUM",
      status: p?.status || "draft",
      applications: (p?.applications || []).slice(0, 1).map((x) => String(x)),
      rules: Array.isArray(p?.rules) && p.rules.length
        ? p.rules.map((rule) => normalizeRule(rule))
        : [createDefaultRule()],
    });
    setEditOpen(true);
  };

  const clearFieldError = (key) => {
    setFieldErrors((prev) => {
      if (!prev?.[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  useEffect(() => {
    let mounted = true;
    const fetchEntitlements = async () => {
      const appId = form.applications[0];
      if (!editOpen || !appId) {
        setEntitlementOptions([]);
        return;
      }
      setEntitlementsLoading(true);
      try {
        const res = await sodAPI.getAppEntitlements(appId);
        const optionsMap = new Map();
        const appName = appNameById.get(String(appId)) || "Application";
        const rows = res.data?.data || [];
        rows.forEach((ent) => {
          const rawId = ent?._id || ent?.id || "";
          const fallbackName = chooseBestEntitlementLabel(ent);
          const name = String(fallbackName || rawId).trim();
          const id = String(rawId || name).trim();
          if (!id || !name) return;
          const optionKey = `${appId}:${id}`;
          if (!optionsMap.has(optionKey)) {
            optionsMap.set(optionKey, {
              key: optionKey,
              id,
              name,
              applicationName: appName,
              label: `${name} (${appName})`,
            });
          }
        });
        if (mounted) setEntitlementOptions([...optionsMap.values()]);
      } catch {
        if (mounted) setEntitlementOptions([]);
      } finally {
        if (mounted) setEntitlementsLoading(false);
      }
    };
    fetchEntitlements();
    return () => {
      mounted = false;
    };
  }, [appNameById, editOpen, form.applications]);

  const updateRule = (idx, patch) => {
    setForm((prev) => ({
      ...prev,
      rules: prev.rules.map((rule, index) => (index === idx ? { ...rule, ...patch } : rule)),
    }));
  };

  const removeRule = (idx) => {
    setForm((prev) => ({
      ...prev,
      rules:
        prev.rules.length === 1
          ? [createDefaultRule()]
          : prev.rules.filter((_, index) => index !== idx),
    }));
  };

  const validateForm = () => {
    const errors = {};
    const name = String(form.name || "").trim();
    const description = String(form.description || "").trim();
    const severity = String(form.severity || "").trim();
    const status = String(form.status || "").trim();
    const appId0 = String(form.applications[0] || "").trim();
    const rules = Array.isArray(form.rules) ? form.rules : [];

    if (!name) {
      errors.name = "Display name is required.";
    } else if (name.length > NAME_MAX) {
      errors.name = `Display name must be ${NAME_MAX} characters or fewer.`;
    }

    if (description.length > DESCRIPTION_MAX) {
      errors.description = `Description must be ${DESCRIPTION_MAX} characters or fewer.`;
    }

    if (!severity || !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity)) {
      errors.severity = "Select a valid severity.";
    }

    if (!status || !["draft", "active", "disabled"].includes(status)) {
      errors.status = "Select a valid status.";
    }

    if (!appId0) {
      errors.application = "Select an application to scope this policy.";
    } else {
      const selectedApp = apps.find((a) => String(a._id) === appId0);
      if (selectedApp && isAuthoritativeApp(selectedApp)) {
        errors.application =
          "Authoritative source applications cannot be used for SoD policies. Select a target application.";
      }
    }

    if (!rules.length) {
      errors.rules = "Add at least one policy rule.";
    }

    const activeRules = rules.filter((r) => r?.isActive !== false);
    if (rules.length && !activeRules.length) {
      errors.rules = "At least one rule must be active.";
    }

    rules.forEach((rule, idx) => {
      const active = rule?.isActive !== false;
      const ruleName = String(rule?.name || "").trim();
      const left = Array.isArray(rule?.leftEntitlements) ? rule.leftEntitlements : [];
      const right = Array.isArray(rule?.rightEntitlements) ? rule.rightEntitlements : [];

      if (active && !ruleName) {
        errors[`ruleName_${idx}`] = "Rule name is required for active rules.";
      } else if (ruleName.length > RULE_NAME_MAX) {
        errors[`ruleName_${idx}`] = `Rule name must be ${RULE_NAME_MAX} characters or fewer.`;
      }

      if (active && !left.length) {
        errors[`ruleLeft_${idx}`] = "Select at least one left entitlement.";
      }
      if (active && !right.length) {
        errors[`ruleRight_${idx}`] = "Select at least one right entitlement.";
      }
      if (active && left.length && right.length) {
        const leftIds = new Set(left.map((e) => String(e?.id || e?.name || "")));
        const overlap = right.some((e) => leftIds.has(String(e?.id || e?.name || "")));
        if (overlap) {
          errors[`ruleRight_${idx}`] =
            "Left and right sides must use different entitlements (no overlap).";
        }
      }
    });

    return errors;
  };

  const save = async () => {
    setError("");
    const errors = validateForm();
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setError("Please correct the highlighted fields before saving.");
      return;
    }

    const appId0 = form.applications[0];
    const payload = {
      name: form.name?.trim(),
      description: form.description?.trim(),
      severity: form.severity,
      status: form.status,
      applications: appId0 ? [appId0] : [],
      applicationNames: appId0 ? [appNameById.get(String(appId0)) || String(appId0)] : [],
      rules: (form.rules || []).map((rule) => normalizeRule(rule)),
    };
    try {
      if (editMode === "create") await sodAPI.createPolicy(payload);
      else await sodAPI.updatePolicy(current?._id, payload);
      setEditOpen(false);
      setFieldErrors({});
      await load();
    } catch (e) {
      const msg = e.response?.data?.message || "Failed to save policy.";
      setError(msg);
      if (/name already exists/i.test(msg)) {
        setFieldErrors({ name: msg });
      }
    }
  };

  const handleDelete = async (p) => {
    if (!p?._id) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete policy "${p.name}"? This will remove its violations.`);
    if (!ok) return;
    try {
      await sodAPI.deletePolicy(p._id);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || "Failed to delete policy.");
    }
  };

  const handleClone = async (p) => {
    if (!p?._id) return;
    try {
      await sodAPI.clonePolicy(p._id);
      await load();
    } catch (e) {
      setError(e.response?.data?.message || "Failed to clone policy.");
    }
  };

  const handleRunEvaluation = async (opts = {}) => {
    if (evalUi.running) return;
    const { _uiLabel, ...payload } = opts || {};
    const scope = payload?.policyMongoId ? "policy" : "all";
    const label = String(_uiLabel || "").trim();
    setEvalUi({
      running: true,
      scope,
      label,
      startedAt: Date.now(),
      lastMessage: "",
    });
    try {
      const res = await sodAPI.runEvaluation(payload);
      const st = res.data?.stats || {};
      const msg = `Evaluated ${st.evaluatedPolicyCount ?? st.scannedPolicies ?? 0} polic(y/ies). New violations: ${st.violationsCreated ?? 0}.`;
      const draftNote =
        st.skippedDraftPolicies > 0
          ? ` (${st.skippedDraftPolicies} draft policies skipped — use per-policy run or include drafts.)`
          : "";
      const doneMsg = `${msg}${draftNote}`;
      setEvalUi({
        running: false,
        scope,
        label,
        startedAt: null,
        lastMessage: doneMsg,
      });
      enqueueSnackbar(doneMsg, { variant: "success" });
      await load();
    } catch (e) {
      const m = isSodEvaluationTimeoutError(e)
        ? SOD_EVAL_TIMEOUT_MESSAGE
        : e.response?.data?.message || "Failed to run evaluation.";
      setError(m);
      enqueueSnackbar(m, { variant: "error" });
      setEvalUi({
        running: false,
        scope,
        label,
        startedAt: null,
        lastMessage: m,
      });
    } finally {
      window.setTimeout(() => {
        setEvalUi((prev) => (prev.running ? prev : { ...prev, lastMessage: "" }));
      }, 6000);
    }
  };

  const goToPolicy = (policy) => {
    if (policy?._id) navigate(`/governance/sod-policies/${policy._id}`);
  };

  const closeActionMenu = () => {
    setActionAnchorEl(null);
    setActionPolicy(null);
  };

  const openActionMenu = (event, policy) => {
    setActionAnchorEl(event.currentTarget);
    setActionPolicy(policy);
  };

  const formatPolicyId = (row) => {
    if (row?.policyId) return String(row.policyId);
    return "—";
  };

  const columns = useMemo(
    () => [
      {
        field: "policyId",
        headerName: "Policy ID",
        width: 120,
        renderCell: (row) => (
          <Link
            component={RouterLink}
            to={`/governance/sod-policies/${row._id}`}
            onClick={(e) => e.stopPropagation()}
            underline="hover"
            sx={{ fontWeight: 700, fontSize: "0.75rem" }}
          >
            {formatPolicyId(row)}
          </Link>
        ),
      },
      {
        field: "name",
        headerName: "Policy Name",
        minWidth: 200,
        renderCell: (row) => (
          <Box sx={{ minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {row.description || "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "severity",
        headerName: "Risk",
        width: 120,
        renderCell: (row) => <SeverityChip value={row.severity} />,
      },
      {
        field: "scope",
        headerName: "Scope",
        width: 120,
        sortable: false,
        renderCell: (row) => {
          const cross = Boolean(row?.isCrossApplication);
          const label = cross ? "Cross-app" : "Application";
          const title = cross
            ? "Cross-application: the policy is meant to detect conflicts when the same person holds conflicting entitlements across more than one linked application."
            : "Single application: evaluation runs against users and entitlements within the policy’s linked application(s). This is not tenant-wide “global” access—it’s scoped to those systems.";
          return (
            <Tooltip title={title} enterDelay={400}>
              <Chip size="small" label={label} variant="outlined" sx={{ fontWeight: 600 }} />
            </Tooltip>
          );
        },
      },
      {
        field: "status",
        headerName: "Status",
        width: 120,
        renderCell: (row) => <StatusChip value={row.status} />,
      },
      {
        field: "applications",
        headerName: "Application",
        minWidth: 220,
        sortable: false,
        renderCell: (row) => {
          const ids = (row.applications || []).map((x) => String(x));
          const names = ids.map((id) => appNameById.get(id) || id).filter(Boolean);
          return (
            <Typography variant="body2" color="text.secondary" noWrap>
              {names.length ? names.join(", ") : "—"}
            </Typography>
          );
        },
      },
      {
        field: "totalViolations",
        headerName: "Violations",
        width: 110,
        renderCell: (row) => (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              color: Number(row?.totalViolations || 0) > 0 ? palette.status.error : "text.secondary",
            }}
          >
            {Number(row?.totalViolations || 0)}
          </Typography>
        ),
      },
      {
        field: "rules",
        headerName: "Rules",
        width: 140,
        sortable: false,
        renderCell: (row) => {
          const rules = Array.isArray(row.rules) ? row.rules : [];
          const activeRules = rules.filter((r) => r?.isActive !== false).length;
          return (
            <Typography variant="body2" color="text.secondary">
              {rules.length} total / {activeRules} active
            </Typography>
          );
        },
      },
      {
        field: "_actions",
        headerName: "Actions",
        width: 90,
        sortable: false,
        renderCell: (row) => (
          <Box sx={{ display: "flex", justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
            <Tooltip title="More actions">
              <IconButton size="small" onClick={(e) => openActionMenu(e, row)}>
                <MoreVert fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [appNameById],
  );

  const inactivePolicies = useMemo(() => {
    const t = Number(stats?.total);
    const a = Number(stats?.active);
    if (!Number.isFinite(t) || !Number.isFinite(a)) return null;
    return Math.max(0, t - a);
  }, [stats?.total, stats?.active]);

  const severityChartData = useMemo(() => {
    const rows = stats?.bySeverity || [];
    const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];
    const mapped = rows.map((r) => ({
      name: String(r._id || "Unknown").toUpperCase(),
      count: r.count,
    }));
    mapped.sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name));
    return mapped;
  }, [stats?.bySeverity]);

  const statCardSx = {
    borderRadius: 2,
    border: 1,
    borderColor: "divider",
    boxShadow: "none",
    height: "100%",
    background: (theme) =>
      theme.palette.mode === "dark" ? alpha(theme.palette.common.white, 0.04) : theme.palette.background.paper,
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1600, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>
            Segregation of Duties
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
            Define toxic combinations of access, run evaluation against application data, and track violations in one place.
          </Typography>
        </Box>
        <Stack spacing={1} sx={{ minWidth: 280, flex: "0 0 auto", alignItems: "flex-end" }}>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
            <Button
              variant="outlined"
              startIcon={evalUi.running && evalUi.scope === "all" ? <CircularProgress size={16} /> : <PlayArrow />}
              onClick={() => handleRunEvaluation({})}
              disabled={evalUi.running}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              {evalUi.running && evalUi.scope === "all" ? "Running…" : "Run evaluation"}
            </Button>
            <Button
              variant="contained"
              color="primary"
              startIcon={<Add />}
              onClick={openCreate}
              disabled={evalUi.running}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Create policy
            </Button>
          </Box>

          {evalUi.running ? (
            <Box sx={{ width: "100%" }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} noWrap>
                {`${evalUi.scope === "policy" ? "Evaluating policy" : "Evaluating policies"}${
                  evalUi.scope === "policy" && evalUi.label ? ` • ${evalUi.label}` : ""
                } • Running for ${evalTick}s`}
              </Typography>
              <Box sx={{ mt: 0.5 }}>
                <LinearProgress />
              </Box>
            </Box>
          ) : evalUi.lastMessage ? (
            <Typography variant="caption" color="text.secondary" sx={{ width: "100%", textAlign: "right" }} noWrap>
              {evalUi.lastMessage}
            </Typography>
          ) : null}
        </Stack>
      </Box>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Grid container spacing={2} sx={{ mb: 2 }}>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Shield sx={{ fontSize: 20, color: palette.text.secondary }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Total policies
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{stats?.total ?? "—"}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Assessment sx={{ fontSize: 20, color: palette.status.success }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Active
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800, color: palette.status.success }}>{stats?.active ?? "—"}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <PauseCircleOutline sx={{ fontSize: 20, color: palette.status.warning }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Non-active
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{inactivePolicies ?? "—"}</Typography>
              <Typography variant="caption" color="text.secondary">Draft or disabled</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", mb: 0.5 }}>
                All violations
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800 }}>{stats?.totalViolations ?? "—"}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <Card sx={{ ...statCardSx, borderColor: alpha(palette.status.error, 0.35) }}>
            <CardContent sx={{ py: 2 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", display: "block", mb: 0.5 }}>
                Open violations
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, color: palette.status.error }}>
                {stats?.openViolations ?? "—"}
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        {/* <Grid item xs={12} md={5}>
          <Card sx={{ ...statCardSx, height: 220 }}>
            <CardContent sx={{ height: "100%", pt: 2, pb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                Violation summary
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Totals across all SoD policies in your tenant.
              </Typography>
              <Stack direction="row" spacing={4} sx={{ mb: 1 }}>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>{stats?.totalViolations ?? 0}</Typography>
                  <Typography variant="caption" color="text.secondary">Total findings</Typography>
                </Box>
                <Box>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: palette.status.error }}>{stats?.openViolations ?? 0}</Typography>
                  <Typography variant="caption" color="text.secondary">Open</Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid> */}
        {/* <Grid item xs={12} md={7}>
          <Card sx={{ ...statCardSx, height: 220 }}>
            <CardContent sx={{ height: "100%", pt: 2, pb: 1, display: "flex", flexDirection: "column" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
                Policies by risk level
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5 }}>
                Count of policies per severity.
              </Typography>
              <Box sx={{ flex: 1, minHeight: 0 }}>
                {severityChartData.length === 0 ? (
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: 140 }}>
                    <Typography variant="body2" color="text.secondary">No policy data yet</Typography>
                  </Box>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={severityChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.border.default} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: palette.text.secondary }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: palette.text.secondary }} axisLine={false} tickLine={false} width={32} />
                      <RechartsTooltip
                        contentStyle={{ borderRadius: 8, border: `1px solid ${palette.border.default}` }}
                        formatter={(value) => [value, "Policies"]}
                      />
                      <Bar dataKey="count" fill={palette.brand.primary} radius={[4, 4, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid> */}
      </Grid>

      <DataTable
        title="SoD policies"
        columns={columns}
        rows={policies}
        loading={loading && policies.length === 0 ? true : tableLoading}
        onRowClick={goToPolicy}
        onRefresh={load}
        emptyMessage="No policies match your filters. Adjust search or create a new policy."
        searchable={false}
        serverPagination
        totalCount={listTotal}
        page={listPage}
        rowsPerPage={listRowsPerPage}
        onPageChange={setListPage}
        onRowsPerPageChange={(n) => {
          setListRowsPerPage(n);
          setListPage(0);
        }}
        sortField={sortField}
        sortDir={sortDir}
        onSortChange={(field, dir) => {
          setSortField(field);
          setSortDir(dir);
          setListPage(0);
        }}
        toolbarRight={(
          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" justifyContent="flex-end">
            <TextField
              size="small"
              placeholder="Search name, ID, description…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              sx={{ width: { xs: "100%", sm: 240 } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ fontSize: 20, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              select
              label="Risk"
              size="small"
              value={filterSeverity}
              onChange={(e) => {
                setFilterSeverity(e.target.value);
                setListPage(0);
              }}
              sx={{ width: 130 }}
            >
              <MenuItem value="">All</MenuItem>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                <MenuItem key={s} value={s}>{s}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status"
              size="small"
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setListPage(0);
              }}
              sx={{ width: 130 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="disabled">Disabled</MenuItem>
            </TextField>
          </Stack>
        )}
      />

      <Menu
        anchorEl={actionAnchorEl}
        open={Boolean(actionAnchorEl)}
        onClose={closeActionMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MuiMenuItem
          onClick={() => {
            const p = actionPolicy;
            closeActionMenu();
            if (p) goToPolicy(p);
          }}
        >
          <ListItemIcon><Visibility fontSize="small" /></ListItemIcon>
          <ListItemText>View details</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={() => {
            if (actionPolicy) openEdit(actionPolicy);
            closeActionMenu();
          }}
        >
          <ListItemIcon><Edit fontSize="small" /></ListItemIcon>
          <ListItemText>Edit policy</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={async () => {
            closeActionMenu();
            if (!actionPolicy) return;
            await handleClone(actionPolicy);
          }}
        >
          <ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>
          <ListItemText>Clone policy</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={async () => {
            const p = actionPolicy;
            closeActionMenu();
            if (!p) return;
            await handleRunEvaluation({
              policyMongoId: p._id,
              _uiLabel: `${formatPolicyId(p)} • ${p.name || "Policy"}`,
            });
          }}
        >
          <ListItemIcon><PlayArrow fontSize="small" /></ListItemIcon>
          <ListItemText>Run evaluation for this policy</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={async () => {
            const policy = actionPolicy;
            closeActionMenu();
            if (!policy) return;
            try {
              await sodAPI.updatePolicy(policy._id, {
                status: policy?.status === "active" ? "draft" : "active",
              });
              await load();
            } catch (e) {
              setError(e.response?.data?.message || "Failed to update policy status.");
            }
          }}
        >
          <ListItemIcon><PauseCircleOutline fontSize="small" /></ListItemIcon>
          <ListItemText>{actionPolicy?.status === "active" ? "Set draft" : "Set active"}</ListItemText>
        </MuiMenuItem>
        <MuiMenuItem
          onClick={async () => {
            const policy = actionPolicy;
            closeActionMenu();
            if (!policy) return;
            await handleDelete(policy);
          }}
          sx={{ color: palette.status.error }}
        >
          <ListItemIcon sx={{ color: "inherit" }}><DeleteForever fontSize="small" /></ListItemIcon>
          <ListItemText>Delete policy</ListItemText>
        </MuiMenuItem>
      </Menu>

      <Dialog
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setFieldErrors({});
        }}
        fullWidth
        maxWidth={false}
        scroll="paper"
        sx={{
          "& .MuiDialog-container": {
            margin: 0,
            padding: 0,
            alignItems: "flex-start",
            justifyContent: "flex-start",
          },
        }}
        PaperProps={{
          elevation: 8,
          sx: {
            position: "fixed",
            left: { xs: 10, sm: LAYOUT_SIDEBAR_W },
            top: LAYOUT_TOPBAR_H,
            right: GAP_RIGHT,
            bottom: GAP_BOTTOM,
            m: 0,
            maxWidth: { xs: "calc(100% - 20px)", sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            width: { xs: "auto", sm: `calc(100vw - ${LAYOUT_SIDEBAR_W}px - ${GAP_RIGHT}px)` },
            height: `calc(100vh - ${LAYOUT_TOPBAR_H}px - ${GAP_BOTTOM}px)`,
            maxHeight: "none",
            borderRadius: 2,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          },
        }}
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 2, pb: 1 }}>
          <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
              {editMode === "create" ? "Create SoD policy" : "Edit SoD policy"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Define conflicting entitlements for a target application.
            </Typography>
          </Box>
          <Button
            onClick={() => {
              setEditOpen(false);
              setFieldErrors({});
            }}
            color="inherit"
            size="small"
          >
            Cancel
          </Button>
        </DialogTitle>
        <DialogContent sx={{ flex: 1, overflow: "auto", pt: 1, px: { xs: 2, sm: 3 } }}>
          {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <TextField
                label="Policy ID"
                fullWidth
                size="small"
                value={nextPolicyIdPreview || "—"}
                disabled
                helperText={editMode === "create" ? "Assigned automatically on save." : "System identifier"}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                label="Display name"
                required
                fullWidth
                size="small"
                value={form.name}
                onChange={(e) => {
                  clearFieldError("name");
                  setForm((f) => ({ ...f, name: e.target.value }));
                }}
                error={Boolean(fieldErrors.name)}
                helperText={fieldErrors.name || "Unique name within this tenant."}
                inputProps={{ maxLength: NAME_MAX }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                required
                label="Severity"
                fullWidth
                size="small"
                value={form.severity}
                onChange={(e) => {
                  clearFieldError("severity");
                  setForm((f) => ({ ...f, severity: e.target.value }));
                }}
                error={Boolean(fieldErrors.severity)}
                helperText={fieldErrors.severity || " "}
              >
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Description"
                fullWidth
                multiline
                minRows={2}
                size="small"
                value={form.description}
                onChange={(e) => {
                  clearFieldError("description");
                  setForm((f) => ({ ...f, description: e.target.value }));
                }}
                error={Boolean(fieldErrors.description)}
                helperText={
                  fieldErrors.description ||
                  `${String(form.description || "").length}/${DESCRIPTION_MAX}`
                }
                inputProps={{ maxLength: DESCRIPTION_MAX }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                required
                label="Status"
                fullWidth
                size="small"
                value={form.status}
                onChange={(e) => {
                  clearFieldError("status");
                  setForm((f) => ({ ...f, status: e.target.value }));
                }}
                error={Boolean(fieldErrors.status)}
                helperText={fieldErrors.status || " "}
              >
                <MenuItem value="draft">Draft</MenuItem>
                <MenuItem value="active">Active</MenuItem>
                <MenuItem value="disabled">Disabled</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                required
                label="Application"
                fullWidth
                size="small"
                value={form.applications[0] || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  clearFieldError("application");
                  setForm((f) => ({
                    ...f,
                    applications: v ? [v] : [],
                    rules: (f.rules || []).map((rule) => ({
                      ...rule,
                      leftEntitlements: [],
                      rightEntitlements: [],
                    })),
                  }));
                }}
                error={Boolean(fieldErrors.application)}
                helperText={
                  fieldErrors.application ||
                  "Target application only — authoritative sources are hidden."
                }
              >
                <MenuItem value="">
                  <em>Select application</em>
                </MenuItem>
                {selectableApps.map((a) => (
                  <MenuItem key={a._id} value={String(a._id)}>
                    {a.applicationName || a.name || a.displayName || "Application"}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </Grid>
          <Divider sx={{ my: 2 }} />
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Policy rules
            </Typography>
            <Button
              size="small"
              startIcon={<Add />}
              onClick={() => {
                clearFieldError("rules");
                setForm((prev) => ({ ...prev, rules: [...prev.rules, createDefaultRule()] }));
              }}
              sx={{ textTransform: "none", fontWeight: 700 }}
            >
              Add rule
            </Button>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Define conflicting entitlement combinations for this policy.
          </Typography>
          {fieldErrors.rules ? (
            <Alert severity="error" sx={{ mb: 2 }}>{fieldErrors.rules}</Alert>
          ) : null}
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
            Total rules: {(form.rules || []).length} | Active rules: {(form.rules || []).filter((r) => r?.isActive !== false).length}
          </Typography>

          {!form.applications.length ? (
            <Alert severity="info" sx={{ mb: 2 }}>Select an application to load entitlement options.</Alert>
          ) : null}

          {(form.rules || []).map((rule, idx) => (
            <Paper key={`rule-${idx}`} variant="outlined" sx={{ p: 2, mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  Rule {idx + 1}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <FormControlLabel
                    sx={{ m: 0 }}
                    control={
                      <Switch
                        size="small"
                        checked={rule.isActive !== false}
                        onChange={(e) => {
                          clearFieldError("rules");
                          clearFieldError(`ruleName_${idx}`);
                          clearFieldError(`ruleLeft_${idx}`);
                          clearFieldError(`ruleRight_${idx}`);
                          updateRule(idx, { isActive: e.target.checked });
                        }}
                      />
                    }
                    label={rule.isActive !== false ? "Active" : "Inactive"}
                  />
                  <IconButton size="small" color="error" onClick={() => removeRule(idx)}>
                    <DeleteForever fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
              <Grid container spacing={2}>
                <Grid item xs={12} md={5}>
                  <TextField
                    fullWidth
                    size="small"
                    required={rule.isActive !== false}
                    label="Rule name"
                    value={rule.name || ""}
                    onChange={(e) => {
                      clearFieldError(`ruleName_${idx}`);
                      updateRule(idx, { name: e.target.value });
                    }}
                    error={Boolean(fieldErrors[`ruleName_${idx}`])}
                    helperText={fieldErrors[`ruleName_${idx}`] || " "}
                    inputProps={{ maxLength: RULE_NAME_MAX }}
                  />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Operator"
                    value={rule.operator || "AND"}
                    onChange={(e) => updateRule(idx, { operator: e.target.value })}
                  >
                    <MenuItem value="AND">AND</MenuItem>
                    <MenuItem value="OR">OR</MenuItem>
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Description"
                    value={rule.description || ""}
                    onChange={(e) => updateRule(idx, { description: e.target.value })}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    options={entitlementOptions}
                    loading={entitlementsLoading}
                    disabled={!form.applications.length}
                    value={rule.leftEntitlements || []}
                    onChange={(_e, value) => {
                      clearFieldError(`ruleLeft_${idx}`);
                      clearFieldError(`ruleRight_${idx}`);
                      updateRule(idx, {
                        leftEntitlements: value.map((item) => ({
                          id: String(item.id || ""),
                          name: String(item.name || ""),
                          applicationName: String(item.applicationName || ""),
                        })),
                      });
                    }}
                    isOptionEqualToValue={(option, value) =>
                      String(option.id || "") === String(value.id || "") &&
                      String(option.applicationName || "") === String(value.applicationName || "")
                    }
                    getOptionLabel={(option) =>
                      option?.label || `${option?.name || option?.id || "Entitlement"} (${option?.applicationName || "Application"})`
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Left entitlements"
                        required={rule.isActive !== false}
                        size="small"
                        placeholder="Select one or more"
                        error={Boolean(fieldErrors[`ruleLeft_${idx}`])}
                        helperText={fieldErrors[`ruleLeft_${idx}`] || " "}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {entitlementsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    multiple
                    options={entitlementOptions}
                    loading={entitlementsLoading}
                    disabled={!form.applications.length}
                    value={rule.rightEntitlements || []}
                    onChange={(_e, value) => {
                      clearFieldError(`ruleRight_${idx}`);
                      updateRule(idx, {
                        rightEntitlements: value.map((item) => ({
                          id: String(item.id || ""),
                          name: String(item.name || ""),
                          applicationName: String(item.applicationName || ""),
                        })),
                      });
                    }}
                    isOptionEqualToValue={(option, value) =>
                      String(option.id || "") === String(value.id || "") &&
                      String(option.applicationName || "") === String(value.applicationName || "")
                    }
                    getOptionLabel={(option) =>
                      option?.label || `${option?.name || option?.id || "Entitlement"} (${option?.applicationName || "Application"})`
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Right entitlements"
                        required={rule.isActive !== false}
                        size="small"
                        placeholder="Select one or more"
                        error={Boolean(fieldErrors[`ruleRight_${idx}`])}
                        helperText={fieldErrors[`ruleRight_${idx}`] || " "}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {entitlementsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                </Grid>
              </Grid>
            </Paper>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: "flex-end" }}>
          <Button onClick={save} variant="contained" sx={{ fontWeight: 600, px: 3 }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

