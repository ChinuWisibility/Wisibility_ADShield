import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  Link,
} from "@mui/material";
import {
  Assignment,
  MoreVert,
  Refresh,
  Rule,
  TaskAlt,
} from "@mui/icons-material";
import { Link as RouterLink, useOutletContext } from "react-router-dom";
import DataTable from "../../../components/DataTable";
import { palette } from "../../../theme/palette";
import { sodAPI } from "../../../services/sodService";
import WorkflowRemediationBulkAction from "../../../components/remediation/WorkflowRemediationBulkAction";
import WorkflowRemediationRowAction from "../../../components/remediation/WorkflowRemediationRowAction";
import useWrqPageQueueStatus from "../../../hooks/useWrqPageQueueStatus";
import {
  violationDepartmentLabel,
  violationEmailLine,
  violationPrimaryLabel,
} from "../../../utils/sodViolationPresentation";

function StatusChip({ value }) {
  const v = String(value || "").toLowerCase();
  const cfg =
    v === "open"
      ? { color: palette.status.error, bg: palette.status.errorBg, label: "Open" }
      : v === "remediated"
        ? { color: palette.status.success, bg: palette.status.successBg, label: "Remediated" }
        : v === "exception_granted"
          ? { color: palette.status.info, bg: palette.status.infoBg, label: "Exception" }
          : v === "false_positive"
            ? { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: "False positive" }
            : v
              ? { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: v }
              : { color: palette.text.secondary, bg: `${palette.text.secondary}14`, label: "—" };
  return (
    <Chip
      size="small"
      label={cfg.label}
      sx={{
        fontWeight: 700,
        fontSize: "0.7rem",
        height: 24,
        bgcolor: cfg.bg,
        color: cfg.color,
        borderRadius: 1,
      }}
    />
  );
}

function SeverityChip({ value }) {
  const v = String(value || "").toUpperCase();
  const hot = v === "CRITICAL" || v === "HIGH";
  return (
    <Chip
      size="small"
      label={v || "—"}
      sx={{
        fontWeight: 700,
        fontSize: "0.65rem",
        letterSpacing: "0.04em",
        height: 22,
        borderRadius: 1,
        bgcolor: hot ? palette.status.errorBg : palette.status.warningBg,
        color: hot ? palette.status.error : palette.status.warning,
      }}
    />
  );
}

function ToolbarMetric({ label, value, loading, accent }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minWidth: 64, mr: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          fontWeight: 600,
          letterSpacing: "0.04em",
          lineHeight: 1.2,
          textTransform: "uppercase",
          fontSize: "0.65rem",
        }}
      >
        {label}
      </Typography>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 700,
          lineHeight: 1.3,
          color: accent || palette.text.primary,
        }}
      >
        {loading ? <Skeleton width={40} /> : value}
      </Typography>
    </Box>
  );
}

function ConflictCell({ row }) {
  const left = row.leftEntitlements?.[0]?.name || "—";
  const right = row.rightEntitlements?.[0]?.name || "—";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, flexWrap: "wrap" }}>
      <Chip
        size="small"
        label={left}
        title={left}
        sx={{
          maxWidth: 140,
          height: 24,
          fontSize: "0.7rem",
          fontWeight: 600,
          bgcolor: palette.bg.elevated,
          borderRadius: 1,
          "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
        }}
      />
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: palette.text.disabled, flexShrink: 0 }}
      >
        vs
      </Typography>
      <Chip
        size="small"
        label={right}
        title={right}
        sx={{
          maxWidth: 140,
          height: 24,
          fontSize: "0.7rem",
          fontWeight: 600,
          bgcolor: palette.bg.elevated,
          borderRadius: 1,
          "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" },
        }}
      />
    </Box>
  );
}

function RowActionsMenu({
  row,
  queuedInfo,
  onQueuedRefresh,
  onMarkRemediated,
  onException,
  onAction,
  onClearSelection,
}) {
  const [anchor, setAnchor] = useState(null);
  const isOpen = String(row.status || "").toLowerCase() === "open";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, justifyContent: "flex-end" }}>
      <WorkflowRemediationRowAction
        targetId={String(row._id)}
        recordLabel={violationPrimaryLabel(row)}
        eventType="SOD_VIOLATION"
        eventTypeLabel="SoD Violation"
        queueSlug="sod-violation"
        queuedInfo={queuedInfo}
        disabled={!isOpen}
        onQueuedRefresh={onQueuedRefresh}
        onClearSelection={onClearSelection}
        size="small"
        variant="outlined"
        sx={{ py: 0.25, px: 1, minHeight: 28, fontSize: "0.75rem" }}
      />
      <Tooltip title="More actions">
        <span>
          <IconButton
            size="small"
            disabled={!isOpen && !queuedInfo?.eventId}
            onClick={(e) => setAnchor(e.currentTarget)}
            aria-label="More actions"
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          disabled={!isOpen}
          onClick={() => {
            setAnchor(null);
            onMarkRemediated(row._id);
          }}
        >
          <ListItemIcon>
            <TaskAlt fontSize="small" />
          </ListItemIcon>
          <ListItemText>Mark remediated</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={!isOpen}
          onClick={() => {
            setAnchor(null);
            onException(row._id);
          }}
        >
          <ListItemIcon>
            <Rule fontSize="small" />
          </ListItemIcon>
          <ListItemText>Grant exception</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={!isOpen}
          onClick={() => {
            setAnchor(null);
            onAction(row._id);
          }}
        >
          <ListItemIcon>
            <Assignment fontSize="small" />
          </ListItemIcon>
          <ListItemText>Create remediation</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

export default function SodViolations() {
  const { embeddedInSodHub = false } = useOutletContext() || {};
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [error, setError] = useState("");

  const [selected, setSelected] = useState([]);
  const [filters, setFilters] = useState({ status: "", policyId: "", hasCertification: "" });

  const [exceptionDlg, setExceptionDlg] = useState({ open: false, violationId: null });
  const [remediationDlg, setRemediationDlg] = useState({ open: false, violationId: null });
  const [exceptionForm, setExceptionForm] = useState({ reason: "", validTo: "" });
  const [remediationForm, setRemediationForm] = useState({ type: "REMOVE_ACCESS", assignedTo: "" });
  const [policyOptions, setPolicyOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await sodAPI.listPolicies();
        if (!cancelled) setPolicyOptions(res.data?.data || []);
      } catch {
        if (!cancelled) setPolicyOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const load = async (page0 = 0, limit0 = pagination.limit) => {
    setError("");
    setLoading(true);
    try {
      const params = {
        page: (page0 ?? 0) + 1,
        limit: limit0,
      };
      if (filters.status) params.status = filters.status;
      if (filters.policyId) params.policyId = filters.policyId;
      if (filters.hasCertification) params.hasCertification = filters.hasCertification;

      const res = await sodAPI.listViolations(params);
      const data = res.data?.data || [];
      const pg = res.data?.pagination || { page: 1, limit: limit0, total: data.length, pages: 1 };
      setRows(data);
      setPagination(pg);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to load violations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected([]);
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.policyId, filters.hasCertification]);

  const openViolationIds = useMemo(
    () =>
      rows
        .filter((row) => String(row.status || "").toLowerCase() === "open")
        .map((row) => String(row._id)),
    [rows],
  );

  const openOnPage = openViolationIds.length;

  const { getQueuedInfo, refresh: refreshQueueStatus } = useWrqPageQueueStatus({
    eventType: "SOD_VIOLATION",
    targetIds: openViolationIds,
    enabled: openViolationIds.length > 0,
  });

  const clearSelection = useCallback(() => setSelected([]), []);

  const updateOne = async (id, status) => {
    try {
      await sodAPI.updateViolationStatus(id, status);
      clearSelection();
      await load((pagination.page || 1) - 1, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to update violation.");
    }
  };

  const bulk = async (status) => {
    if (!selected.length) return;
    try {
      await sodAPI.bulkUpdateViolations(selected, status);
      clearSelection();
      await load((pagination.page || 1) - 1, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.message || "Bulk update failed.");
    }
  };

  const createException = async () => {
    try {
      await sodAPI.createException({
        violationId: exceptionDlg.violationId,
        exceptionReason: exceptionForm.reason,
        validTo: exceptionForm.validTo || undefined,
      });
      setExceptionDlg({ open: false, violationId: null });
      setExceptionForm({ reason: "", validTo: "" });
      clearSelection();
      await load((pagination.page || 1) - 1, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to grant exception.");
    }
  };

  const createRemediation = async () => {
    try {
      await sodAPI.createRemediation({
        violationId: remediationDlg.violationId,
        remediationType: remediationForm.type,
        assignedTo: remediationForm.assignedTo || undefined,
      });
      setRemediationDlg({ open: false, violationId: null });
      setRemediationForm({ type: "REMOVE_ACCESS", assignedTo: "" });
      clearSelection();
      await load((pagination.page || 1) - 1, pagination.limit);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to create remediation action.");
    }
  };

  const columns = useMemo(
    () => [
      {
        field: "identityName",
        headerName: "Identity",
        minWidth: 200,
        renderCell: (row) => (
          <Box sx={{ minWidth: 0, py: 0.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }} noWrap title={violationPrimaryLabel(row)}>
              {violationPrimaryLabel(row)}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap title={violationEmailLine(row)} sx={{ display: "block", lineHeight: 1.3 }}>
              {violationEmailLine(row)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "department",
        headerName: "Dept",
        width: 120,
        renderCell: (row) => (
          <Typography
            variant="body2"
            color={violationDepartmentLabel(row) !== "—" ? "text.primary" : "text.secondary"}
            noWrap
          >
            {violationDepartmentLabel(row)}
          </Typography>
        ),
      },
      {
        field: "policyName",
        headerName: "Policy",
        minWidth: 180,
        renderCell: (row) => {
          const mongoPolicyId = row.policy ? String(row.policy) : "";
          const title = row.policyName || "—";
          const rule = String(row.ruleName || "").trim();
          const showRule = rule && rule.toLowerCase() !== String(title).toLowerCase();
          return (
            <Box sx={{ minWidth: 0, py: 0.25 }}>
              {mongoPolicyId ? (
                <Link
                  component={RouterLink}
                  to={`/governance/sod-policies/${mongoPolicyId}`}
                  underline="hover"
                  sx={{ fontWeight: 600, fontSize: "0.875rem", color: "inherit", display: "block" }}
                  noWrap
                >
                  {title}
                </Link>
              ) : (
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {title}
                </Typography>
              )}
              {showRule ? (
                <Typography variant="caption" color="text.secondary" display="block" noWrap>
                  {rule}
                </Typography>
              ) : null}
            </Box>
          );
        },
      },
      {
        field: "entitlements",
        headerName: "Conflict",
        minWidth: 280,
        sortable: false,
        renderCell: (row) => <ConflictCell row={row} />,
      },
      {
        field: "severity",
        headerName: "Severity",
        width: 110,
        renderCell: (row) => <SeverityChip value={row.severity} />,
      },
      {
        field: "status",
        headerName: "Status",
        width: 120,
        renderCell: (row) => <StatusChip value={row.status} />,
      },
      {
        field: "detectedAt",
        headerName: "Detected",
        width: 110,
        renderCell: (row) => (
          <Typography variant="body2" color="text.secondary">
            {row.detectedAt ? new Date(row.detectedAt).toLocaleDateString() : "—"}
          </Typography>
        ),
      },
      {
        field: "_actions",
        headerName: "",
        width: 168,
        sortable: false,
        renderCell: (row) => (
          <RowActionsMenu
            row={row}
            queuedInfo={getQueuedInfo(row._id)}
            onQueuedRefresh={refreshQueueStatus}
            onClearSelection={clearSelection}
            onMarkRemediated={(id) => updateOne(id, "remediated")}
            onException={(id) => setExceptionDlg({ open: true, violationId: id })}
            onAction={(id) => setRemediationDlg({ open: true, violationId: id })}
          />
        ),
      },
    ],
    // updateOne is stable enough via closure; include queue helpers
    [getQueuedInfo, refreshQueueStatus, clearSelection],
  );

  return (
    <Box sx={{ p: embeddedInSodHub ? 0 : { xs: 2, md: 3 } }}>
      {!embeddedInSodHub ? (
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 2, flexWrap: "wrap" }}>
          <Box sx={{ flex: 1, minWidth: 240 }}>
            <Typography variant="h5" sx={{ fontWeight: 800 }}>
              SoD Violations
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Review conflicts and track remediation and exception decisions.
            </Typography>
          </Box>
        </Box>
      ) : null}

      {error ? <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert> : null}

      <Paper
        elevation={0}
        sx={{
          borderRadius: embeddedInSodHub ? 0 : 2,
          overflow: "hidden",
          border: embeddedInSodHub ? "none" : `1px solid ${palette.border.default}`,
        }}
      >
        <Toolbar
          sx={{
            px: 2,
            gap: 1.5,
            borderBottom: `1px solid ${palette.border.default}`,
            flexWrap: "wrap",
            alignItems: "center",
            minHeight: "auto !important",
            py: 1.5,
            bgcolor: "grey.50",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <ToolbarMetric
              label="Total"
              value={(pagination.total || 0).toLocaleString()}
              loading={loading && !pagination.total}
            />
            <ToolbarMetric
              label="Open"
              value={openOnPage.toLocaleString()}
              loading={loading && rows.length === 0}
              accent={openOnPage > 0 ? palette.status.error : undefined}
            />
          </Box>

          <Divider
            orientation="vertical"
            flexItem
            sx={{ display: { xs: "none", md: "block" }, mx: 0.5 }}
          />

          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              alignItems: "center",
              flex: 1,
              minWidth: 0,
            }}
          >
            <TextField
              select
              label="Status"
              size="small"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">All</MenuItem>
              {["open", "remediated", "exception_granted", "false_positive", "expired"].map((s) => (
                <MenuItem key={s} value={s}>{s.replace(/_/g, " ")}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Policy"
              size="small"
              value={filters.policyId}
              onChange={(e) => setFilters((f) => ({ ...f, policyId: e.target.value }))}
              sx={{ minWidth: 180, maxWidth: 240 }}
            >
              <MenuItem value="">All policies</MenuItem>
              {policyOptions.map((p) => (
                <MenuItem key={p._id} value={String(p._id)}>
                  {p.policyId ? `${p.policyId} — ` : ""}{p.name || p._id}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Certification"
              size="small"
              value={filters.hasCertification}
              onChange={(e) => setFilters((f) => ({ ...f, hasCertification: e.target.value }))}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="true">In certification</MenuItem>
              <MenuItem value="false">Not in certification</MenuItem>
            </TextField>
          </Box>

          <Tooltip title="Refresh">
            <IconButton
              size="small"
              onClick={() => load((pagination.page || 1) - 1, pagination.limit)}
              sx={{ ml: "auto" }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>

        {selected.length > 0 ? (
          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              alignItems: "center",
              px: 2,
              py: 1,
              borderBottom: `1px solid ${palette.border.default}`,
              bgcolor: "rgba(37, 99, 235, 0.04)",
            }}
          >
            <Chip
              label={`${selected.length} selected`}
              color="primary"
              size="small"
              onDelete={clearSelection}
            />
            <WorkflowRemediationBulkAction
              eventType="SOD_VIOLATION"
              eventTypeLabel="SoD Violation"
              selectedItems={selected
                .map((id) => rows.find((r) => String(r._id) === String(id)))
                .filter((row) => row && String(row.status || "").toLowerCase() === "open")
                .map((row) => ({
                  id: String(row._id),
                  label: violationPrimaryLabel(row),
                }))}
              queueSlug="sod-violation"
              onClearSelection={clearSelection}
              onQueuedRefresh={refreshQueueStatus}
              size="small"
              variant="contained"
            />
            <Button size="small" variant="contained" onClick={() => bulk("remediated")} sx={{ textTransform: "none" }}>
              Mark remediated
            </Button>
            <Button size="small" variant="outlined" onClick={() => bulk("false_positive")} sx={{ textTransform: "none" }}>
              False positive
            </Button>
            <Button size="small" variant="outlined" onClick={() => bulk("open")} sx={{ textTransform: "none" }}>
              Reopen
            </Button>
          </Box>
        ) : null}

        <Box sx={{ px: 1.5, pt: 1.5, pb: 1.5 }}>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            selectable
            searchable={false}
            onRefresh={null}
            selectedIds={selected}
            showSelectionChip={false}
            onSelectionChange={setSelected}
            serverPagination
            totalCount={pagination.total || 0}
            page={(pagination.page || 1) - 1}
            rowsPerPage={pagination.limit || 25}
            onPageChange={(p) => load(p, pagination.limit)}
            onRowsPerPageChange={(n) => load(0, n)}
            emptyMessage="No violations found for the current filters."
          />
        </Box>
      </Paper>

      <Dialog open={exceptionDlg.open} onClose={() => setExceptionDlg({ open: false, violationId: null })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Grant exception</DialogTitle>
        <DialogContent dividers>
          <TextField
            label="Reason"
            required
            fullWidth
            size="small"
            multiline
            minRows={2}
            value={exceptionForm.reason}
            onChange={(e) => setExceptionForm((f) => ({ ...f, reason: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Valid until"
            type="date"
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
            value={exceptionForm.validTo}
            onChange={(e) => setExceptionForm((f) => ({ ...f, validTo: e.target.value }))}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setExceptionDlg({ open: false, violationId: null })} color="inherit" sx={{ fontWeight: 700 }}>
            Cancel
          </Button>
          <Button onClick={createException} variant="contained" disabled={!exceptionForm.reason.trim()} sx={{ fontWeight: 800 }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={remediationDlg.open} onClose={() => setRemediationDlg({ open: false, violationId: null })} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Create remediation action</DialogTitle>
        <DialogContent dividers>
          <TextField
            select
            label="Type"
            fullWidth
            size="small"
            value={remediationForm.type}
            onChange={(e) => setRemediationForm((f) => ({ ...f, type: e.target.value }))}
            sx={{ mb: 2 }}
          >
            {["REMOVE_ACCESS", "REASSIGN", "RESTRUCTURE", "ACCEPT"].map((t) => (
              <MenuItem key={t} value={t}>{t}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Assigned to (email)"
            fullWidth
            size="small"
            value={remediationForm.assignedTo}
            onChange={(e) => setRemediationForm((f) => ({ ...f, assignedTo: e.target.value }))}
            placeholder="owner@company.com"
          />
          <Alert severity="info" sx={{ mt: 2 }}>
            This creates a remediation record and marks the violation remediated.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRemediationDlg({ open: false, violationId: null })} color="inherit" sx={{ fontWeight: 700 }}>
            Cancel
          </Button>
          <Button onClick={createRemediation} variant="contained" sx={{ fontWeight: 800 }}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
