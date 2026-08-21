import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  IconButton,
  InputAdornment,
  Link,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
  CircularProgress,
} from "@mui/material";
import {
  ArrowBack,
  Assessment,
  Campaign,
  Download,
  Gavel,
  People,
  PlayArrow,
  ReportProblem,
  Search,
  Shield,
} from "@mui/icons-material";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useSnackbar } from "notistack";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { palette } from "../../../theme/palette";
import { applicationAPI } from "../../../services/api";
import { sodAPI, isSodEvaluationTimeoutError, SOD_EVAL_TIMEOUT_MESSAGE } from "../../../services/sodService";
import { useAuth } from "../../../contexts/AuthContext";
import DataTable from "../../../components/DataTable";
import {
  violationDepartmentLabel,
  violationEmailLine,
  violationPrimaryLabel,
} from "../../../utils/sodViolationPresentation";

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
    <Chip size="small" label={v || "—"} sx={{ fontWeight: 700, bgcolor: cfg.bg, color: cfg.color }} />
  );
}

function StatusChip({ value }) {
  const v = String(value || "").toLowerCase();
  const label =
    v === "open" ? "Open" : v === "remediated" ? "Remediated" : v === "exception_granted" ? "Exception" : v || "—";
  return <Chip size="small" label={label} sx={{ fontWeight: 700 }} />;
}

const DEPT_CHART_COLORS = [
  "#5B8DB8", // muted steel blue
  "#6B9E8A", // muted sage
  "#8B7BB8", // muted mauve
  "#B89A5B", // muted amber
  "#6B9BB8", // muted teal
  "#B87B6B", // muted terracotta
  "#7B8B9E", // muted slate
  "#9E8B7B", // muted taupe
];

export default function SodPolicyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(false);
  const [error, setError] = useState("");
  const [policy, setPolicy] = useState(null);
  const [summary, setSummary] = useState(null);
  const [violations, setViolations] = useState([]);
  const [violPage, setViolPage] = useState(0);
  const [violRowsPerPage, setViolRowsPerPage] = useState(25);
  const [violTotal, setViolTotal] = useState(0);
  const [violStatus, setViolStatus] = useState("");
  const [violSearch, setViolSearch] = useState("");
  const [debouncedViolSearch, setDebouncedViolSearch] = useState("");
  const [violDepartment, setViolDepartment] = useState("");
  const [violManager, setViolManager] = useState("");
  const [groupBy, setGroupBy] = useState("department");
  const [sortField, setSortField] = useState("detectedAt");
  const [sortDir, setSortDir] = useState("desc");
  const [appName, setAppName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [evalUi, setEvalUi] = useState({
    running: false,
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

  const resolveAppName = useCallback(
    async (p) => {
      const appId = p?.applications?.[0];
      if (!appId) {
        setAppName("—");
        return;
      }
      try {
        const userTenantId =
          typeof user?.tenantId === "object" ? user?.tenantId?._id : user?.tenantId;
        const res = await applicationAPI.list({
          limit: 500,
          page: 1,
          ...(userTenantId ? { tenantId: String(userTenantId) } : {}),
        });
        const apps = res.data?.data || res.data?.applications || [];
        const found = apps.find((a) => String(a._id) === String(appId));
        setAppName(
          found?.applicationName || found?.name || found?.displayName || String(appId),
        );
      } catch {
        setAppName(String(appId));
      }
    },
    [user?.tenantId],
  );

  const loadPolicyAndSummary = useCallback(async () => {
    if (!id) return;
    setError("");
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        sodAPI.getPolicy(id),
        sodAPI.getPolicyViolationSummary(id, {
          groupBy,
          ...(violDepartment ? { department: violDepartment } : {}),
          ...(violManager ? { manager: violManager } : {}),
        }),
      ]);
      const p = pRes.data?.data;
      setPolicy(p || null);
      setSummary(sRes.data?.data || null);
      await resolveAppName(p);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to load policy.");
      setPolicy(null);
    } finally {
      setLoading(false);
    }
  }, [id, resolveAppName, groupBy, violDepartment, violManager]);

  const loadViolationsPage = useCallback(async () => {
    if (!id) return;
    setTableLoading(true);
    try {
      const params = {
        page: violPage + 1,
        limit: violRowsPerPage,
        policyId: id,
        sortField,
        sortDir,
      };
      if (violStatus) params.status = violStatus;
      if (violDepartment) params.department = violDepartment;
      if (violManager) params.manager = violManager;
      const q = debouncedViolSearch.trim();
      if (q) params.q = q;
      const vRes = await sodAPI.listViolations(params);
      const rows = vRes.data?.data || [];
      const pg = vRes.data?.pagination;
      setViolTotal(pg?.total ?? rows.length);
      setViolations(rows);
    } catch (e) {
      setViolations([]);
      setViolTotal(0);
      enqueueSnackbar(e.response?.data?.message || "Failed to load violations.", { variant: "error" });
    } finally {
      setTableLoading(false);
    }
  }, [
    id,
    violPage,
    violRowsPerPage,
    violStatus,
    violDepartment,
    violManager,
    debouncedViolSearch,
    sortField,
    sortDir,
    enqueueSnackbar,
  ]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedViolSearch(violSearch.trim());
    }, 280);
    return () => clearTimeout(t);
  }, [violSearch]);

  useEffect(() => {
    loadPolicyAndSummary();
  }, [loadPolicyAndSummary]);

  useEffect(() => {
    loadViolationsPage();
  }, [loadViolationsPage]);

  useEffect(() => {
    setViolPage(0);
  }, [violStatus, debouncedViolSearch, violRowsPerPage, violDepartment, violManager]);

  const policyIdLabel = policy?.policyId || (policy?._id ? `…${String(policy._id).slice(-6)}` : "—");

  const deptChartData = useMemo(() => {
    const base = Array.isArray(summary?.byGroup)
      ? summary.byGroup
      : groupBy === "manager"
        ? summary?.byManager || []
        : summary?.byDepartment || [];

    return base.map((r) => ({
      name: r.name || r.manager || r.department || "Unknown",
      count: r.count,
    }));
  }, [summary, groupBy]);

  const fetchAllViolationsForExport = async () => {
    const all = [];
    let page = 1;
    let totalPages = 1;
    const qEx = debouncedViolSearch.trim();
    do {
      const res = await sodAPI.listViolations({
        page,
        limit: 500,
        policyId: id,
        sortField,
        sortDir: "desc",
        ...(violStatus ? { status: violStatus } : {}),
        ...(violDepartment ? { department: violDepartment } : {}),
        ...(violManager ? { manager: violManager } : {}),
        ...(qEx ? { q: qEx } : {}),
      });
      const rows = res.data?.data || [];
      all.push(...rows);
      totalPages = res.data?.pagination?.pages || 1;
      page += 1;
      if (page > 500) break;
    } while (page <= totalPages);
    return all;
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const allRows = await fetchAllViolationsForExport();
      const headers = [
        "identityName",
        "identityEmail",
        "department",
        "manager",
        "leftEntitlement",
        "rightEntitlement",
        "status",
        "detectedAt",
      ];
      const rows = allRows.map((v) => [
        v.identityName || "",
        v.identityEmail || "",
        v.department || "",
        v.manager || v.managerName || v.managerEmail || "",
        v.leftEntitlements?.[0]?.name || "",
        v.rightEntitlements?.[0]?.name || "",
        v.status || "",
        v.detectedAt ? new Date(v.detectedAt).toISOString() : "",
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sod-policy-${policyIdLabel}-violations.csv`;
      a.click();
      URL.revokeObjectURL(url);
      enqueueSnackbar(`Exported ${allRows.length} filtered row(s)`, { variant: "success" });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Export failed", { variant: "error" });
    } finally {
      setExporting(false);
    }
  };

  const isDraftPolicy = String(policy?.status || "").toLowerCase() === "draft";
  const isDisabledPolicy = String(policy?.status || "").toLowerCase() === "disabled";
  const canRunEvaluation = !isDraftPolicy && !isDisabledPolicy;

  const activatePolicy = async () => {
    if (!id || !policy) return;
    try {
      await sodAPI.updatePolicy(id, { status: "active" });
      enqueueSnackbar("Policy activated.", { variant: "success" });
      await loadPolicyAndSummary();
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Failed to activate policy.", {
        variant: "error",
      });
    }
  };

  const runEval = async () => {
    if (!id || evalUi.running) return;
    if (!canRunEvaluation) {
      enqueueSnackbar(
        isDraftPolicy
          ? "Activate this policy first before running evaluation."
          : "Enable this policy before running evaluation.",
        { variant: "warning" },
      );
      return;
    }
    setEvalUi({ running: true, startedAt: Date.now(), lastMessage: "" });
    try {
      const res = await sodAPI.runEvaluation({ policyMongoId: id });
      const stats = res.data?.stats || {};
      const newViolations = stats.violationsCreated ?? 0;
      const autoResolved = stats.violationsAutoResolved ?? 0;
      const open = stats.openViolations;

      let doneMsg;
      if (open !== undefined) {
        const parts = [];
        if (newViolations > 0) parts.push(`${newViolations} new`);
        if (autoResolved > 0) parts.push(`${autoResolved} auto-resolved`);
        doneMsg = `Evaluation complete • ${open} open violation${open !== 1 ? "s" : ""}${parts.length ? ` (${parts.join(", ")})` : ""}`;
      } else {
        doneMsg = `Evaluation complete. New violations: ${newViolations}`;
      }

      // Stop "Running…" before refresh so success toast and progress UI don't conflict.
      setEvalUi({ running: false, startedAt: null, lastMessage: doneMsg });
      enqueueSnackbar(doneMsg, { variant: "success" });
      await loadPolicyAndSummary();
      await loadViolationsPage();
    } catch (e) {
      const m = isSodEvaluationTimeoutError(e)
        ? SOD_EVAL_TIMEOUT_MESSAGE
        : e.response?.data?.message || "Evaluation failed";
      enqueueSnackbar(m, { variant: "error" });
      setEvalUi({ running: false, startedAt: null, lastMessage: m });
    } finally {
      window.setTimeout(() => {
        setEvalUi((prev) => (prev.running ? prev : { ...prev, lastMessage: "" }));
      }, 6000);
    }
  };

  const violationColumns = useMemo(
    () => [
      {
        field: "identityName",
        headerName: "User",
        minWidth: 200,
        renderCell: (row) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap title={violationPrimaryLabel(row)}>
              {violationPrimaryLabel(row)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block" title={violationEmailLine(row)}>
              {violationEmailLine(row)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "department",
        headerName: "Department",
        width: 140,
        renderCell: (row) => (
          <Typography
            variant="body2"
            color={violationDepartmentLabel(row) !== "—" ? "text.primary" : "text.secondary"}
          >
            {violationDepartmentLabel(row)}
          </Typography>
        ),
      },
      {
        field: "leftEntitlements",
        headerName: "Entitlement A",
        minWidth: 160,
        sortable: false,
        renderCell: (row) => (
          <Chip
            size="small"
            label={row.leftEntitlements?.[0]?.name || "—"}
            variant="outlined"
            sx={{ fontWeight: 600, borderColor: alpha(palette.risk.medium, 0.5), maxWidth: "100%" }}
          />
        ),
      },
      {
        field: "rightEntitlements",
        headerName: "Entitlement B",
        minWidth: 160,
        sortable: false,
        renderCell: (row) => (
          <Chip
            size="small"
            label={row.rightEntitlements?.[0]?.name || "—"}
            variant="outlined"
            color="info"
            sx={{ fontWeight: 600, maxWidth: "100%" }}
          />
        ),
      },
      {
        field: "status",
        headerName: "Status",
        width: 130,
        renderCell: (row) => <StatusChip value={row.status} />,
      },
      {
        field: "detectedAt",
        headerName: "Detected",
        width: 160,
        renderCell: (row) => (
          <Typography variant="body2" color="text.secondary">
            {row.detectedAt ? new Date(row.detectedAt).toLocaleString() : "—"}
          </Typography>
        ),
      },
    ],
    [],
  );

  const statCardSx = {
    borderRadius: 2,
    border: 1,
    borderColor: "divider",
    boxShadow: "none",
    height: "100%",
    background: (theme) =>
      theme.palette.mode === "dark" ? alpha(theme.palette.common.white, 0.04) : theme.palette.background.paper,
  };

  if (loading && !policy) {
    return (
      <Box sx={{ p: 3, display: "flex", alignItems: "center", gap: 2 }}>
        <CircularProgress size={28} />
        <Typography color="text.secondary">Loading policy…</Typography>
      </Box>
    );
  }

  if (error && !policy) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
        <Button startIcon={<ArrowBack />} onClick={() => navigate("/governance/sod-policies")} sx={{ mt: 2 }}>
          Back to policies
        </Button>
      </Box>
    );
  }

  const rules = Array.isArray(policy?.rules) ? policy.rules : [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1680, mx: "auto" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <IconButton size="small" onClick={() => navigate("/governance/sod-policies")} aria-label="Back">
          <ArrowBack />
        </IconButton>
        <Breadcrumbs aria-label="breadcrumb">
          <Link component={RouterLink} to="/governance/sod-policies" underline="hover" color="inherit" sx={{ fontWeight: 600 }}>
            SoD Policies
          </Link>
          <Typography color="text.primary" fontWeight={800}>
            {policy?.name || policyIdLabel}
          </Typography>
        </Breadcrumbs>
      </Stack>

      <Paper
        elevation={0}
        sx={{
          p: { xs: 2, md: 2.5 },
          mb: 3,
          borderRadius: 2,
          border: 1,
          borderColor: "divider",
          background: (theme) =>
            theme.palette.mode === "dark" ? alpha(theme.palette.common.white, 0.03) : alpha(palette.brand.primary, 0.04),
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ xs: "stretch", md: "flex-start" }}
          justifyContent="space-between"
          gap={2}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.08em" }}>
              Policy review
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: "-0.02em", mt: 0.25 }}>
              {policy?.name || "Policy"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              <Box component="span" sx={{ fontWeight: 700, color: "text.primary" }}>{policyIdLabel}</Box>
              {policy?.description ? ` · ${policy.description}` : ""}
            </Typography>
            <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
              <SeverityChip value={policy?.severity} />
              <Chip
                size="small"
                label={policy?.status || "—"}
                sx={{ fontWeight: 700, textTransform: "capitalize" }}
                color={policy?.status === "active" ? "success" : "default"}
                variant={policy?.status === "active" ? "filled" : "outlined"}
              />
              <Chip size="small" variant="outlined" label={appName} icon={<Shield sx={{ "&&": { fontSize: 16 } }} />} />
            </Stack>
            {Array.isArray(policy?.rules) && policy.rules.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Conflict Access Items
                </Typography>
                <Stack spacing={1} sx={{ mt: 0.75 }}>
                  {policy.rules.filter((r) => r.isActive !== false).map((rule, idx) => (
                    <Stack key={idx} direction="row" alignItems="center" gap={1} flexWrap="wrap">
                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {(rule.leftEntitlements || []).map((e, i) => (
                          <Chip key={i} size="small" label={e.name || e.id || "—"} variant="outlined" sx={{ fontWeight: 600 }} />
                        ))}
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                        vs
                      </Typography>
                      <Stack direction="row" gap={0.5} flexWrap="wrap">
                        {(rule.rightEntitlements || []).map((e, i) => (
                          <Chip key={i} size="small" label={e.name || e.id || "—"} variant="outlined" sx={{ fontWeight: 600 }} />
                        ))}
                      </Stack>
                      {rule.name && (
                        <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
                          ({rule.name})
                        </Typography>
                      )}
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
          <Stack spacing={1} sx={{ minWidth: 280, alignItems: { xs: "stretch", md: "flex-end" } }}>
            <Stack direction="row" gap={1} flexWrap="wrap" justifyContent={{ xs: "stretch", md: "flex-end" }}>
              <Button
                variant="contained"
                color="primary"
                startIcon={evalUi.running ? <CircularProgress size={18} color="inherit" /> : <PlayArrow />}
                onClick={runEval}
                disabled={evalUi.running || !canRunEvaluation}
                sx={{ textTransform: "none", fontWeight: 700 }}
              >
                {evalUi.running ? "Running…" : "Run evaluation"}
              </Button>
              <Button
                variant="outlined"
                startIcon={exporting ? <CircularProgress size={18} color="inherit" /> : <Download />}
                onClick={exportCsv}
                disabled={exporting || evalUi.running}
                sx={{ textTransform: "none", fontWeight: 700 }}
              >
                Export CSV
              </Button>
            </Stack>

            {evalUi.running ? (
              <Box sx={{ width: "100%" }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }} noWrap>
                  {`Evaluating policy • ${policyIdLabel} • Running for ${evalTick}s`}
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
        </Stack>
      </Paper>

      {isDraftPolicy ? (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={activatePolicy} sx={{ fontWeight: 700 }}>
              Activate policy
            </Button>
          }
        >
          This policy is still in <strong>Draft</strong>. Activate it first before running evaluation
          or reviewing violations.
        </Alert>
      ) : null}

      {isDisabledPolicy ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This policy is <strong>Disabled</strong>. Set it to Active before running evaluation.
        </Alert>
      ) : null}

      {error ? <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "1fr",
            sm: "1fr 1fr",
            md: "repeat(5, minmax(0, 1fr))",
          },
          gap: 2,
          mb: 3,
        }}
      >
        {[
          { label: "Total violations", value: summary?.total ?? 0, color: palette.status.error, Icon: Gavel },
          { label: "Affected users", value: summary?.affectedUsers ?? 0, color: palette.risk.high, Icon: People },
          { label: "Open", value: summary?.open ?? 0, color: palette.status.warning, Icon: Assessment },
          { label: "Mitigated", value: summary?.remediated ?? 0, color: palette.status.success, Icon: Shield },
          { label: "Exceptions", value: summary?.exceptionGranted ?? 0, color: palette.text.secondary, Icon: ReportProblem },
        ].map((card) => (
          <Card key={card.label} sx={statCardSx}>
            <CardContent sx={{ py: 2 }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <card.Icon sx={{ fontSize: 20, color: palette.text.secondary }} />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  {card.label}
                </Typography>
              </Stack>
              <Typography variant="h4" sx={{ fontWeight: 800, color: card.color }}>
                {card.value}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Primary: violations table first (full width) so it is never buried below the fold */}
      <Card sx={{ ...statCardSx, mb: 2.5 }} id="affected-users">
        <CardContent sx={{ pt: 2, "&:last-child": { pb: 2 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "center" }}
            justifyContent="space-between"
            gap={1.5}
            sx={{ mb: 1 }}
          >
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-0.01em" }}>
                Affected users
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {violTotal
                  ? `Showing ${violations.length} of ${violTotal} violation(s). Search, filter, and sort are server-side.`
                  : "No violations loaded for this policy yet. Run evaluation after rules are active."}
              </Typography>
            </Box>
            <Chip
              size="small"
              label={`${violTotal} total`}
              sx={{ fontWeight: 800, bgcolor: alpha(palette.brand.primary, 0.12) }}
            />
          </Stack>
          <DataTable
            title=""
            columns={violationColumns}
            rows={violations}
            loading={tableLoading}
            searchable={false}
            emptyMessage="No violations for this policy. Run evaluation to populate this list."
            serverPagination
            totalCount={violTotal}
            page={violPage}
            rowsPerPage={violRowsPerPage}
            onPageChange={setViolPage}
            onRowsPerPageChange={(n) => {
              setViolRowsPerPage(n);
              setViolPage(0);
            }}
            onRefresh={loadViolationsPage}
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(field, dir) => {
              setSortField(field);
              setSortDir(dir);
              setViolPage(0);
            }}
            toolbarRight={(
              <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" justifyContent="flex-end">
                <TextField
                  size="small"
                  placeholder="Search name, email, dept…"
                  value={violSearch}
                  onChange={(e) => setViolSearch(e.target.value)}
                  sx={{ width: { xs: "100%", sm: 220 } }}
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
                  label="Status"
                  size="small"
                  value={violStatus}
                  onChange={(e) => {
                    setViolStatus(e.target.value);
                    setViolPage(0);
                  }}
                  sx={{ width: 160 }}
                >
                  <MenuItem value="">All</MenuItem>
                  <MenuItem value="open">Open</MenuItem>
                  <MenuItem value="remediated">Remediated</MenuItem>
                  <MenuItem value="exception_granted">Exception</MenuItem>
                  <MenuItem value="false_positive">False positive</MenuItem>
                </TextField>
                <TextField
                  select
                  label="Department"
                  size="small"
                  value={violDepartment}
                  onChange={(e) => {
                    setViolDepartment(e.target.value);
                    setViolPage(0);
                  }}
                  sx={{ width: 170 }}
                >
                  <MenuItem value="">All departments</MenuItem>
                  {(summary?.availableDepartments || []).map((d) => (
                    <MenuItem key={d} value={d}>{d}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Manager"
                  size="small"
                  value={violManager}
                  onChange={(e) => {
                    setViolManager(e.target.value);
                    setViolPage(0);
                  }}
                  sx={{ width: 180 }}
                >
                  <MenuItem value="">All managers</MenuItem>
                  {(summary?.availableManagers || []).map((m) => (
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}
          />
        </CardContent>
      </Card>

      <Grid container spacing={2.5} alignItems="flex-start">
        <Grid item xs={12}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Card sx={{ ...statCardSx, height: "100%" }}>
                <CardContent sx={{ pb: 1 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      {groupBy === "manager" ? "VIOLATIONS BY MANAGER" : "VIOLATIONS BY DEPARTMENT"}
                    </Typography>
                    <TextField
                      select
                      size="small"
                      value={groupBy}
                      onChange={(e) => setGroupBy(e.target.value)}
                      sx={{ width: 140 }}
                    >
                      <MenuItem value="department">Department</MenuItem>
                      <MenuItem value="manager">Manager</MenuItem>
                    </TextField>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                    {groupBy === "manager"
                      ? "Grouped by manager (name/email), resolved from linked application users when missing on violations."
                      : "Grouped from each violation’s department, resolved from linked application users when the stored field is empty."}
                  </Typography>
                  {deptChartData.length === 0 ? (
                    <Box sx={{ py: 3, textAlign: "center" }}>
                      <Typography variant="body2" color="text.secondary">No data</Typography>
                    </Box>
                  ) : (
                    <Box sx={{ width: "100%", height: 420 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={deptChartData}
                          margin={{ top: 8, right: 24, left: 16, bottom: 110 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={palette.border.default} />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: palette.text.secondary }}
                            angle={-45}
                            textAnchor="end"
                            interval={0}
                            tickFormatter={(v) => v.length > 16 ? `${v.slice(0, 15)}…` : v}
                          />
                          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: palette.text.secondary }} />
                          <RTooltip
                            formatter={(value) => [value, "Violations"]}
                            labelStyle={{ color: palette.text.primary, fontWeight: 600 }}
                          />
                          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                            {deptChartData.map((_, i) => (
                              <Cell key={i} fill={DEPT_CHART_COLORS[i % DEPT_CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
}
