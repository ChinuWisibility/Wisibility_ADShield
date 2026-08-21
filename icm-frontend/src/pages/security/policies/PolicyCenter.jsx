import { useMemo, useState } from "react";
import {
  Typography,
  Box,
  Paper,
  Button,
  Alert,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Chip,
  Stack,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  CircularProgress,
  Checkbox,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import LockIcon from "@mui/icons-material/Lock";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import SecurityApplicationBar from "../SecurityApplicationBar";
import { useSecurityWorkspace } from "../SecurityWorkspaceContext";
import EmptyStateSecurity from "../../../components/security/EmptyStateSecurity";
import AssessmentContextBar from "../../../components/security/AssessmentContextBar";
import SecurityPolicyEditorDialog from "../../../components/security/SecurityPolicyEditorDialog";
import RiskSeverityChip from "../../../components/security/RiskSeverityChip";
import { securityPageHeaderSx } from "../securityTheme";
import { securityAPI } from "../../../services/securityApi";
import { policyConditionLabel } from "../policySignalMeta";

export default function PolicyCenter() {
  const { applicationId, refreshWorkspace } = useSecurityWorkspace();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [actionError, setActionError] = useState("");

  const scopeParams = useMemo(
    () => (applicationId ? { applicationId } : {}),
    [applicationId],
  );

  const conditionsQuery = useQuery({
    queryKey: ["security", "policy-conditions"],
    queryFn: async () => {
      const res = await securityAPI.getPolicyConditions();
      const data = res.data?.data ?? res.data;
      if (Array.isArray(data?.conditions)) {
        return { signals: data.conditions, thresholdTypes: [] };
      }
      if (data?.conditions?.signals) return data.conditions;
      if (data?.signals) return data;
      return { signals: [], thresholdTypes: [] };
    },
    staleTime: 300_000,
  });

  const policiesQuery = useQuery({
    queryKey: ["security", "policies", applicationId],
    queryFn: async () => {
      const res = await securityAPI.listPolicies(scopeParams);
      return res.data?.data ?? res.data;
    },
    staleTime: 30_000,
  });

  const policies = useMemo(() => {
    const rows = Array.isArray(policiesQuery.data) ? policiesQuery.data : [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        (p.conditions || []).some((c) => policyConditionLabel(c).toLowerCase().includes(q)),
    );
  }, [policiesQuery.data, search]);

  const policyIds = useMemo(
    () => policies.map((p) => p.id || p._id),
    [policies],
  );

  const allSelected =
    policyIds.length > 0 && policyIds.every((id) => selectedIds.has(id));
  const someSelected =
    policyIds.some((id) => selectedIds.has(id)) && !allSelected;

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(policyIds));
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["security", "policies"] });
    refreshWorkspace();
  };

  const handleSave = async (form) => {
    setSaving(true);
    setActionError("");
    try {
      if (editingPolicy?.id || editingPolicy?._id) {
        const id = editingPolicy.id || editingPolicy._id;
        await securityAPI.updatePolicy(id, form, scopeParams);
      } else {
        await securityAPI.createPolicy(form, scopeParams);
      }
      setEditorOpen(false);
      setEditingPolicy(null);
      invalidate();
    } catch (err) {
      setActionError(err?.response?.data?.message || err.message || "Failed to save policy.");
    } finally {
      setSaving(false);
    }
  };

  const deletePoliciesById = async (ids) => {
    if (!ids.length) return { deleted: 0, failed: [] };

    const results = await Promise.allSettled(
      ids.map((id) => securityAPI.deletePolicy(id, scopeParams)),
    );

    const failed = [];
    let deleted = 0;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        deleted += 1;
      } else {
        const message =
          result.reason?.response?.data?.message ||
          result.reason?.message ||
          "Delete failed";
        failed.push({ id: ids[index], message });
      }
    });

    return { deleted, failed };
  };

  const handleDelete = async (policy) => {
    const id = policy.id || policy._id;
    if (!window.confirm(`Delete policy "${policy.name}"?`)) return;

    setActionError("");
    setDeleting(true);
    try {
      const { deleted, failed } = await deletePoliciesById([id]);
      if (failed.length) {
        setActionError(failed[0].message);
      } else if (deleted) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        invalidate();
      }
    } catch (err) {
      setActionError(err?.response?.data?.message || err.message || "Failed to delete policy.");
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;

    const names = policies
      .filter((p) => ids.includes(p.id || p._id))
      .map((p) => p.name)
      .slice(0, 3);
    const label =
      ids.length === 1
        ? `Delete policy "${names[0]}"?`
        : `Delete ${ids.length} selected policies?`;

    if (!window.confirm(label)) return;

    setActionError("");
    setDeleting(true);
    try {
      const { deleted, failed } = await deletePoliciesById(ids);
      setSelectedIds(new Set(failed.map((f) => f.id)));

      if (failed.length && deleted) {
        setActionError(
          `Deleted ${deleted} polic${deleted === 1 ? "y" : "ies"}. ${failed.length} could not be deleted: ${failed[0].message}`,
        );
      } else if (failed.length) {
        setActionError(failed.map((f) => f.message).join(" "));
      }

      if (deleted) invalidate();
    } catch (err) {
      setActionError(err?.response?.data?.message || err.message || "Failed to delete policies.");
    } finally {
      setDeleting(false);
    }
  };

  const handleClone = async (policy) => {
    setActionError("");
    try {
      await securityAPI.clonePolicy(policy.id || policy._id, {}, scopeParams);
      invalidate();
    } catch (err) {
      setActionError(err?.response?.data?.message || err.message || "Failed to clone policy.");
    }
  };

  return (
    <Box>
      <Box sx={securityPageHeaderSx}>
        <Box>
          <Typography variant="h5" fontWeight={800}>
            Policy Center
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Define how discovery findings map to risk levels — recalculated without rescanning AD
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingPolicy(null);
            setEditorOpen(true);
          }}
        >
          Create policy
        </Button>
      </Box>

      <SecurityApplicationBar />
      {applicationId && <AssessmentContextBar />}

      <Alert severity="info" sx={{ mb: 2 }}>
        Risk Model: policies score findings at read time without rescanning AD. Built-in policies are
        seeded automatically. Application-scoped policies extend tenant and platform defaults.
      </Alert>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError("")}>
          {actionError}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2, border: 1, borderColor: "divider" }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "center" }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search policies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
            }}
          />
          {selectedIds.size > 0 && (
            <Stack direction="row" spacing={1} flexShrink={0}>
              <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>
                {selectedIds.size} selected
              </Typography>
              <Button
                variant="outlined"
                color="error"
                size="small"
                startIcon={<DeleteOutlineIcon />}
                onClick={handleBulkDelete}
                disabled={deleting}
              >
                Delete selected
              </Button>
              <Button size="small" onClick={() => setSelectedIds(new Set())} disabled={deleting}>
                Clear
              </Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      {policiesQuery.isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <Paper sx={{ border: 1, borderColor: "divider", overflow: "hidden" }}>
          <Table size="small">
  <TableHead sx={{ bgcolor: "background.default" }}>
    <TableRow>
      <TableCell padding="checkbox" width={48}>
        <Checkbox
          size="small"
          indeterminate={someSelected}
          checked={allSelected}
          disabled={policyIds.length === 0 || deleting}
          onChange={toggleSelectAll}
          inputProps={{ "aria-label": "Select all policies" }}
        />
      </TableCell>
      <TableCell sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>POLICY</TableCell>
      <TableCell width={100} sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>RISK</TableCell>
      <TableCell width={80} sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>MODE</TableCell>
      <TableCell sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>CONDITIONS</TableCell>
      <TableCell width={120} sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>SOURCE</TableCell>
      <TableCell width={60} align="center" sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>
        DELETE
      </TableCell>
      <TableCell width={100} align="right" sx={{ fontWeight: 600, color: "text.secondary", fontSize: "0.75rem" }}>
        ACTIONS
      </TableCell>
    </TableRow>
  </TableHead>
  <TableBody>
    {policies.length === 0 && (
      <TableRow>
        <TableCell colSpan={8}>
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No policies found.
            </Typography>
          </Box>
        </TableCell>
      </TableRow>
    )}
    {policies.map((policy) => {
      const id = policy.id || policy._id;
      return (
        <TableRow 
          key={id} 
          hover 
          selected={selectedIds.has(id)}
          sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
        >
          <TableCell padding="checkbox">
            <Checkbox
              size="small"
              checked={selectedIds.has(id)}
              disabled={deleting}
              onChange={() => toggleSelect(id)}
              inputProps={{ "aria-label": `Select ${policy.name}` }}
            />
          </TableCell>
          <TableCell>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {policy.name}
            </Typography>
            {policy.description && (
              <Typography variant="caption" color="text.secondary" noWrap display="block" sx={{ mt: 0.25 }}>
                {policy.description}
              </Typography>
            )}
          </TableCell>
          <TableCell>
            {/* Assuming RiskSeverityChip handles its own enterprise styling */}
            <RiskSeverityChip severity={policy.riskLevel} />
          </TableCell>
          <TableCell>
            {/* Logic Operator Micro-Badge */}
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                px: 1,
                py: 0.25,
                borderRadius: 1,
                bgcolor: policy.conditionMode === "OR" ? "warning.50" : "grey.100",
                color: policy.conditionMode === "OR" ? "warning.800" : "grey.700",
                border: "1px solid",
                borderColor: policy.conditionMode === "OR" ? "warning.200" : "grey.300",
                fontSize: "0.65rem",
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              {policy.conditionMode || "AND"}
            </Box>
          </TableCell>
          <TableCell>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {(policy.conditions || []).slice(0, 4).map((c) => (
                <Chip
                  key={c}
                  label={policyConditionLabel(c)}
                  size="small"
                  sx={{
                    bgcolor: "background.paper",
                    border: "1px solid",
                    borderColor: "divider",
                    color: "text.primary",
                    fontWeight: 500,
                    fontSize: "0.75rem",
                    maxWidth: 180,
                    borderRadius: 1.5, // Squarer edges for a more technical look
                    boxShadow: "0 1px 2px rgba(0,0,0,0.02)", // Subtle depth
                  }}
                />
              ))}
              {(policy.conditions || []).length > 4 && (
                <Chip
                  label={`+${policy.conditions.length - 4}`}
                  size="small"
                  sx={{
                    bgcolor: "grey.100",
                    color: "text.secondary",
                    fontWeight: 600,
                    fontSize: "0.75rem",
                    borderRadius: 1.5,
                    border: "1px solid transparent",
                  }}
                />
              )}
            </Stack>
          </TableCell>
          <TableCell>
            {/* Semantic Source Chips with Icons */}
            <Chip
              icon={
                policy.builtIn ? (
                  <LockIcon sx={{ fontSize: "14px !important" }} />
                ) : (
                  <TuneIcon sx={{ fontSize: "14px !important" }} />
                )
              }
              label={policy.builtIn ? "Built-in" : "Custom"}
              size="small"
              sx={{
                bgcolor: policy.builtIn ? "grey.100" : "primary.50",
                color: policy.builtIn ? "grey.700" : "primary.700",
                fontWeight: 600,
                fontSize: "0.75rem",
                border: "none",
                borderRadius: 1.5,
                "& .MuiChip-icon": {
                  color: "inherit",
                  ml: 1,
                },
              }}
            />
          </TableCell>
          <TableCell align="center">
            <Tooltip title="Delete">
              <span>
                <IconButton
                  size="small"
                  color="error"
                  disabled={deleting} // Often built-in policies shouldn't be deleted
                  onClick={() => handleDelete(policy)}
                  sx={{ opacity: 0.8, "&:hover": { opacity: 1, bgcolor: "error.50" } }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </TableCell>
          <TableCell align="right">
            <Stack direction="row" spacing={0.5} justifyContent="flex-end">
              <Tooltip title={policy.builtIn ? "View Policy" : "Edit Policy"}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setEditingPolicy(policy);
                    setEditorOpen(true);
                  }}
                  sx={{ color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: "primary.50" } }}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Clone Policy">
                <IconButton 
                  size="small" 
                  onClick={() => handleClone(policy)}
                  sx={{ color: "text.secondary", "&:hover": { color: "primary.main", bgcolor: "primary.50" } }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          </TableCell>
        </TableRow>
      );
    })}
  </TableBody>
</Table>
        </Paper>
      )}

      {!applicationId && (
        <Box sx={{ mt: 2 }}>
          <EmptyStateSecurity
            title="Optional application scope"
            description="Select an application to create application-specific policy overrides."
          />
        </Box>
      )}

      <SecurityPolicyEditorDialog
        open={editorOpen}
        onClose={() => !saving && setEditorOpen(false)}
        onSave={handleSave}
        saving={saving}
        initial={editingPolicy}
        conditionCatalog={conditionsQuery.data || {}}
        title={editingPolicy ? "Edit security policy" : "Create security policy"}
      />
    </Box>
  );
}
