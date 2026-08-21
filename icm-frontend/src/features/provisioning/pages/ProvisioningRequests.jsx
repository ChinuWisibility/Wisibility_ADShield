import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import HighlightOffIcon from "@mui/icons-material/HighlightOff";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import ReplayIcon from "@mui/icons-material/Replay";
import { useSnackbar } from "notistack";
import { apiErrorMessage, provisioningApi } from "../services/api";
import { useProvisioningTenant } from "../hooks/useProvisioningTenant";
import TenantPickerBar from "../components/TenantPickerBar";
import StageChip, { TaskStatusChip } from "../components/StageChip";

const POLL_INTERVAL_MS = 5000;

const STAGE_FILTERS = [
  { value: "", label: "All stages" },
  { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
  { value: "READY_TO_PROVISION", label: "Ready to provision" },
  { value: "COMPLETED", label: "Provisioned" },
  { value: "FAILED", label: "Failed" },
  { value: "REJECTED", label: "Rejected" },
];

function formatTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function SummaryCard({ label, value, color }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h5" fontWeight={700} color={color}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

export default function ProvisioningRequests() {
  const { enqueueSnackbar } = useSnackbar();
  const { effectiveTenantId, tenantParams, tenants, needsTenantPicker, selectTenant } =
    useProvisioningTenant();

  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Polling must not flash a spinner or the table jumps every few seconds on screen.
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    ({ silent = false } = {}) => {
      if (!effectiveTenantId) {
        setRequests([]);
        setSummary(null);
        return Promise.resolve();
      }
      if (!silent) setLoading(true);
      return provisioningApi
        .listLifecycleRequests({ ...tenantParams, limit: 100 })
        .then((res) => {
          setRequests(res.data?.data || []);
          setSummary(res.data?.summary || null);
          setLoadError("");
          hasLoadedRef.current = true;
        })
        .catch((error) => {
          setLoadError(apiErrorMessage(error, "Could not load provisioning requests."));
          if (!hasLoadedRef.current) setRequests([]);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [effectiveTenantId, tenantParams],
  );

  useEffect(() => {
    hasLoadedRef.current = false;
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh || !effectiveTenantId) return undefined;
    const timer = setInterval(() => load({ silent: true }), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, effectiveTenantId, load]);

  const visibleRequests = useMemo(() => {
    if (!stageFilter) return requests;
    if (stageFilter === "READY_TO_PROVISION") {
      return requests.filter((r) => ["READY_TO_PROVISION", "PROVISIONING", "COMPILING"].includes(r.stage));
    }
    if (stageFilter === "COMPLETED") {
      return requests.filter((r) => ["COMPLETED", "ALREADY_SATISFIED"].includes(r.stage));
    }
    return requests.filter((r) => r.stage === stageFilter);
  }, [requests, stageFilter]);

  const decide = async (request, decision) => {
    setBusyId(request.id);
    try {
      const call = decision === "approve" ? provisioningApi.approve : provisioningApi.reject;
      await call(request.id, tenantParams);
      enqueueSnackbar(
        decision === "approve"
          ? `Approved — compiling the provisioning plan for ${request.identity?.displayName || "identity"}`
          : "Request rejected",
        { variant: decision === "approve" ? "success" : "info" },
      );
      await load({ silent: true });
    } catch (error) {
      enqueueSnackbar(apiErrorMessage(error, "The decision could not be recorded."), {
        variant: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  const runTask = async (task, { retry = false } = {}) => {
    setBusyId(task.id);
    try {
      const call = retry ? provisioningApi.retryTask : provisioningApi.runTask;
      const res = await call(task.id, tenantParams);
      const payload = res.data || {};
      if (payload.ok === false || payload.result?.status === "FAILED") {
        enqueueSnackbar(
          payload.result?.message || payload.error || "The task ran but did not succeed.",
          { variant: "warning" },
        );
      } else if (payload.skipped) {
        enqueueSnackbar(`Task skipped: ${payload.reason}`, { variant: "info" });
      } else {
        enqueueSnackbar("Task executed against the target application", { variant: "success" });
      }
      await load({ silent: true });
    } catch (error) {
      enqueueSnackbar(apiErrorMessage(error, "Could not run the task."), { variant: "error" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h6" fontWeight={700}>
            Lifecycle provisioning requests
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every Joiner, Mover and Leaver request with its approval, plan, tasks and the
            account written to the target application.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
            }
            label={<Typography variant="body2">Live</Typography>}
          />
          <Button startIcon={<RefreshIcon />} onClick={() => load()} disabled={!effectiveTenantId}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      <TenantPickerBar
        needsTenantPicker={needsTenantPicker}
        tenants={tenants}
        effectiveTenantId={effectiveTenantId}
        onSelectTenant={selectTenant}
      />

      {summary && (
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          <Grid item xs={6} md={3}>
            <SummaryCard
              label="Awaiting approval"
              value={summary.awaitingApproval}
              color="warning.main"
            />
          </Grid>
          <Grid item xs={6} md={3}>
            <SummaryCard label="In provisioning" value={summary.readyToProvision} color="info.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <SummaryCard label="Provisioned" value={summary.provisioned} color="success.main" />
          </Grid>
          <Grid item xs={6} md={3}>
            <SummaryCard label="Failed" value={summary.failed} color="error.main" />
          </Grid>
        </Grid>
      )}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {loadError}
        </Alert>
      )}

      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }}>
        <TextField
          select
          size="small"
          label="Stage"
          value={stageFilter}
          onChange={(event) => setStageFilter(event.target.value)}
          sx={{ minWidth: 220 }}
        >
          {STAGE_FILTERS.map((filter) => (
            <MenuItem key={filter.value || "all"} value={filter.value}>
              {filter.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Paper variant="outlined">
        {loading ? (
          <Box sx={{ p: 6, display: "flex", justifyContent: "center" }}>
            <CircularProgress size={28} />
          </Box>
        ) : !visibleRequests.length ? (
          <Box sx={{ p: 6, textAlign: "center" }}>
            <InboxOutlinedIcon sx={{ fontSize: 44, color: "text.disabled", mb: 1 }} />
            <Typography variant="subtitle1" fontWeight={600}>
              No provisioning requests
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {effectiveTenantId
                ? "Create an identity that matches a provisioning rule to see a Joiner request appear here."
                : "Select a tenant to see its requests."}
            </Typography>
          </Box>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={48} />
                <TableCell>Identity</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Target application</TableCell>
                <TableCell>Stage</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell align="right">Decision</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleRequests.map((request) => {
                const expanded = expandedId === request.id;
                const awaiting = request.stage === "AWAITING_APPROVAL";
                return (
                  <Fragment key={request.id}>
                    <TableRow hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => setExpandedId(expanded ? null : request.id)}
                        >
                          {expanded ? (
                            <KeyboardArrowDownIcon fontSize="small" />
                          ) : (
                            <KeyboardArrowRightIcon fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {request.identity?.displayName || "Unknown identity"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {[request.identity?.email, request.identity?.department]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={request.requestType} variant="outlined" />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {request.application?.name || "—"}
                        </Typography>
                        {request.application?.isCsvTestTarget && (
                          <Typography variant="caption" color="text.secondary">
                            CSV connector
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <StageChip stage={request.stage} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{formatTime(request.submittedAt)}</Typography>
                      </TableCell>
                      <TableCell align="right">
                        {awaiting ? (
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              startIcon={<CheckCircleOutlineIcon />}
                              onClick={() => decide(request, "approve")}
                              disabled={busyId === request.id}
                            >
                              Approve
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<HighlightOffIcon />}
                              onClick={() => decide(request, "reject")}
                              disabled={busyId === request.id}
                            >
                              Reject
                            </Button>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            {request.approvalStatus === "NOT_REQUIRED"
                              ? "No approval needed"
                              : request.approvalStatus}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded ? undefined : "none" }}>
                        <Collapse in={expanded} timeout="auto" unmountOnExit>
                          <RequestDetail
                            request={request}
                            busyId={busyId}
                            onRunTask={runTask}
                          />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  );
}

function RequestDetail({ request, busyId, onRunTask }) {
  return (
    <Box sx={{ py: 2.5, px: 1 }}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Typography variant="overline" color="text.secondary">
            Why this was requested
          </Typography>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {request.justification || "—"}
          </Typography>
          {request.rule?.name && (
            <Typography variant="caption" color="text.secondary" display="block">
              Matched rule: <strong>{request.rule.name}</strong>
            </Typography>
          )}
          {request.workflowExecutionId && (
            <Typography variant="caption" color="text.secondary" display="block">
              Workflow execution: {request.workflowExecutionId}
            </Typography>
          )}
          {request.nativeIdentifier && (
            <Typography variant="caption" color="text.secondary" display="block">
              Account identifier: <strong>{request.nativeIdentifier}</strong>
            </Typography>
          )}
        </Grid>

        <Grid item xs={12} md={8}>
          <Typography variant="overline" color="text.secondary">
            Plan and tasks
          </Typography>
          {!request.plan ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              {request.stage === "AWAITING_APPROVAL"
                ? "The plan is compiled once the request is approved."
                : "No plan has been compiled for this request."}
            </Alert>
          ) : (
            <>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, mb: 1.5 }}>
                <Chip size="small" label={`Plan ${request.plan.status}`} />
                <Typography variant="caption" color="text.secondary">
                  {request.plan.completedOperations}/{request.plan.totalOperations} operations
                  complete
                  {request.plan.failedOperations
                    ? ` · ${request.plan.failedOperations} failed`
                    : ""}
                </Typography>
              </Stack>
              <Divider sx={{ mb: 1 }} />
            </>
          )}

          {request.tasks?.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Operation</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Detail</TableCell>
                  <TableCell align="right">Run</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {request.tasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <Typography variant="body2">{task.operationType}</Typography>
                    </TableCell>
                    <TableCell>
                      <TaskStatusChip status={task.status} />
                      {task.retryCount > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          retry {task.retryCount}/{task.maxRetries}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {task.errorMessage ? (
                        <Typography variant="caption" color="error.main">
                          {task.errorMessage}
                        </Typography>
                      ) : task.nativeIdentifier ? (
                        <Typography variant="caption" color="text.secondary">
                          Created as <strong>{task.nativeIdentifier}</strong>
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {task.completedAt ? formatTime(task.completedAt) : "—"}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {task.canRun && (
                        <Tooltip title="Run this task now instead of waiting for the worker">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onRunTask(task)}
                              disabled={busyId === task.id}
                            >
                              <PlayArrowIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      {task.canRetry && (
                        <Tooltip title="Reset and retry this failed task">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => onRunTask(task, { retry: true })}
                              disabled={busyId === task.id}
                            >
                              <ReplayIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            request.plan && (
              <Typography variant="body2" color="text.secondary">
                No executable tasks were materialized from this plan.
              </Typography>
            )
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
