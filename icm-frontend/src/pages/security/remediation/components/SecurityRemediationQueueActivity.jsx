import { useMemo } from "react";
import {
  Box,
  Paper,
  Stack,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Button,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { workflowTaskQueueApi } from "../../../../features/remediation-events/services/api";
import SecurityRemediationStatusChip from "./SecurityRemediationStatusChip";

function statusTone(status) {
  const s = String(status || "").toUpperCase();
  if (s === "COMPLETED") return "completed";
  if (s === "FAILED") return "failed";
  if (s === "IN_PROGRESS") return "in_progress";
  if (s === "WAITING") return "waiting";
  return "queued";
}

/**
 * Recent workflow task queue activity for the remediation dashboard.
 */
export default function SecurityRemediationQueueActivity({ limit = 8 }) {
  const query = useQuery({
    queryKey: ["security", "remediation-queue-activity", limit],
    queryFn: async () => {
      const res = await workflowTaskQueueApi.listTasks({ limit });
      const payload = res.data?.data ?? res.data;
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload?.tasks)) return payload.tasks;
      if (Array.isArray(payload?.items)) return payload.items;
      return [];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const summary = useMemo(() => {
    const tasks = query.data || [];
    const counts = { COMPLETED: 0, IN_PROGRESS: 0, WAITING: 0, FAILED: 0, NEW: 0 };
    for (const t of tasks) {
      const s = String(t.status || "").toUpperCase();
      if (counts[s] != null) counts[s] += 1;
    }
    return counts;
  }, [query.data]);

  return (
    <Paper sx={{ p: 2, border: 1, borderColor: "divider" }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ xs: "stretch", sm: "center" }}
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Box>
          <Typography variant="subtitle2" fontWeight={800}>
            Recent fixes
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Remediation tasks you have started
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={`Completed ${summary.COMPLETED}`} color="success" variant="outlined" />
          <Chip size="small" label={`Running ${summary.IN_PROGRESS}`} color="info" variant="outlined" />
          <Chip size="small" label={`Waiting ${summary.WAITING}`} variant="outlined" />
          <Chip size="small" label={`Failed ${summary.FAILED}`} color="error" variant="outlined" />
          <Button
            size="small"
            component={RouterLink}
            to="/governance/remediation-events"
            sx={{ textTransform: "none" }}
          >
            Open Remediation Events
          </Button>
        </Stack>
      </Stack>

      {query.isLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      )}
      {query.isError && (
        <Alert severity="warning">
          {query.error?.response?.data?.message || query.error?.message || "Failed to load queue"}
        </Alert>
      )}
      {!query.isLoading && !(query.data || []).length && (
        <Typography variant="body2" color="text.secondary">
          No remediation tasks yet. Open a finding and choose Remediate to start.
        </Typography>
      )}
      <Stack spacing={1}>
        {(query.data || []).slice(0, limit).map((task) => (
          <Stack
            key={task.taskId || task._id}
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ xs: "flex-start", sm: "center" }}
            spacing={0.5}
            sx={{ py: 0.75, borderBottom: 1, borderColor: "divider" }}
          >
            <Box>
              <Typography variant="body2" fontWeight={700}>
                {task.taskName || task.action || task.taskId}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {task.action}
                {task.updatedAt || task.createdAt
                  ? ` · ${new Date(task.updatedAt || task.createdAt).toLocaleString()}`
                  : ""}
              </Typography>
            </Box>
            <SecurityRemediationStatusChip status={statusTone(task.status)} />
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
