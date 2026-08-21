import React, { useState, useEffect, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { remediationRunsPath } from '../../../features/remediation-runs/paths';
import {
  Box,
  Typography,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
  alpha,
  CircularProgress,
  Link,
} from '@mui/material';
import {
  Refresh,
  CheckCircle,
  ErrorOutline,
  HourglassEmpty,
  RadioButtonUnchecked,
  KeyboardArrowDown,
  KeyboardArrowUp,
  OpenInNew,
} from '@mui/icons-material';
import { palette } from '../../../theme/palette';
import { workflowAPI } from '../../../services/api';

const TASK_NAME_LABELS = {
  SOD_CRON: 'SoD Analysis',
  CERT_REMINDER: 'Cert Reminder',
  CONNECTOR_SYNC: 'Connector Sync',
  REPORT_GEN: 'Report Generation',
  IAM_ORPHAN_REVIEW: 'IAM Orphan — Start workflow',
  IAM_ORPHAN_REMINDER: 'IAM Orphan — Reminder email',
  IAM_ORPHAN_DECISION: 'IAM Orphan — Decision recorded',
};

const ORPHAN_TASK_NAMES = 'IAM_ORPHAN_REVIEW,IAM_ORPHAN_REMINDER,IAM_ORPHAN_DECISION';

const STATUS_META = {
  RUNNING: { label: 'Running', color: '#3b82f6', bg: alpha('#3b82f6', 0.12), icon: <CircularProgress size={12} thickness={5} sx={{ color: '#3b82f6' }} /> },
  COMPLETED: { label: 'Completed', color: '#10b981', bg: alpha('#10b981', 0.12), icon: <CheckCircle sx={{ fontSize: 13, color: '#10b981' }} /> },
  FAILED: { label: 'Failed', color: '#ef4444', bg: alpha('#ef4444', 0.12), icon: <ErrorOutline sx={{ fontSize: 13, color: '#ef4444' }} /> },
  SKIPPED: { label: 'Skipped', color: '#94a3b8', bg: alpha('#94a3b8', 0.12), icon: <RadioButtonUnchecked sx={{ fontSize: 13, color: '#94a3b8' }} /> },
};

function timeAgo(date) {
  if (!date) return '—';
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(ms) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function isOrphanTask(task) {
  return String(task.taskName || '').startsWith('IAM_ORPHAN');
}

function TaskRow({ task }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[task.status] || STATUS_META.SKIPPED;
  const name = TASK_NAME_LABELS[task.taskName] || task.taskName || '—';
  const subtitle = task.accountName
    ? task.accountName
    : task.detail
      ? task.detail
      : `${task.taskType || 'TRIGGERED'} · ${timeAgo(task.startedAt)}`;

  const execLink = task.executionId && isOrphanTask(task)
    ? remediationRunsPath('iam-orphan-review', {
        orphanId: task.orphanId || '',
        executionId: task.executionId,
      })
    : null;

  return (
    <>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: 'pointer',
          borderBottom: `1px solid ${palette.border.default}`,
          '&:hover': { bgcolor: alpha(palette.brand.primary, 0.04) },
          transition: 'background 0.15s',
        }}
      >
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{meta.icon}</Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3, fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle}
          </Typography>
        </Box>
        <Chip
          label={meta.label}
          size="small"
          sx={{ bgcolor: meta.bg, color: meta.color, fontWeight: 700, fontSize: '0.65rem', height: 18, flexShrink: 0 }}
        />
        <IconButton size="small" sx={{ p: 0.25, flexShrink: 0 }}>
          {open ? <KeyboardArrowUp sx={{ fontSize: 14 }} /> : <KeyboardArrowDown sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, py: 1, bgcolor: alpha(palette.bg.elevated, 0.5), borderBottom: `1px solid ${palette.border.default}` }}>
          {task.detail && (
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, wordBreak: 'break-word' }}>
              {task.detail}
            </Typography>
          )}
          {task.applicationName && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Application: {task.applicationName}
            </Typography>
          )}
          {task.startedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Started: {new Date(task.startedAt).toLocaleString()}
            </Typography>
          )}
          {task.errorMessage && (
            <Typography variant="caption" sx={{ display: 'block', color: '#ef4444', mb: 0.5, wordBreak: 'break-word' }}>
              Error: {task.errorMessage}
            </Typography>
          )}
          {task.durationMs != null && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Duration: {formatDuration(task.durationMs)}
            </Typography>
          )}
          {task.recordsProcessed != null && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Records: {task.recordsProcessed}
            </Typography>
          )}
          {task.completedAt && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Completed: {new Date(task.completedAt).toLocaleString()}
            </Typography>
          )}
          {execLink && (
            <Link
              component={RouterLink}
              to={execLink}
              variant="caption"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.5, fontWeight: 600 }}
              onClick={(e) => e.stopPropagation()}
            >
              View workflow execution
              <OpenInNew sx={{ fontSize: 12 }} />
            </Link>
          )}
          {!task.detail && !task.errorMessage && !task.durationMs && !task.recordsProcessed && !task.completedAt && !execLink && (
            <Typography variant="caption" color="text.secondary">No additional details.</Typography>
          )}
        </Box>
      </Collapse>
    </>
  );
}

/**
 * @param {{ orphanId?: string, orphanTasksOnly?: boolean, title?: string, limit?: number }} props
 */
export default function TasksPanel({
  orphanId,
  orphanTasksOnly = false,
  title = 'Tasks',
  limit = 50,
  onClearOrphanFilter,
}) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit };
      if (statusFilter) params.status = statusFilter;
      if (orphanId) params.orphanId = orphanId;
      if (orphanTasksOnly) params.taskNames = ORPHAN_TASK_NAMES;
      const res = await workflowAPI.listTasks(params);
      setTasks(res.data?.data || []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, orphanId, orphanTasksOnly, limit]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  return (
    <Paper
      elevation={0}
      sx={{
        border: `1px solid ${palette.border.default}`,
        borderRadius: 2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 320,
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          borderBottom: `1px solid ${palette.border.default}`,
          bgcolor: palette.bg.secondary,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, fontSize: '0.8rem' }}>
          {title}
        </Typography>
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel sx={{ fontSize: '0.72rem' }}>Status</InputLabel>
          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ fontSize: '0.72rem', '.MuiSelect-select': { py: 0.5 } }}
          >
            <MenuItem value="" sx={{ fontSize: '0.72rem' }}>All</MenuItem>
            <MenuItem value="RUNNING" sx={{ fontSize: '0.72rem' }}>Running</MenuItem>
            <MenuItem value="COMPLETED" sx={{ fontSize: '0.72rem' }}>Completed</MenuItem>
            <MenuItem value="FAILED" sx={{ fontSize: '0.72rem' }}>Failed</MenuItem>
            <MenuItem value="SKIPPED" sx={{ fontSize: '0.72rem' }}>Skipped</MenuItem>
          </Select>
        </FormControl>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={fetchTasks} disabled={loading}>
            {loading ? <CircularProgress size={14} /> : <Refresh sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
      </Box>

      {orphanId && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#3b82f6', 0.06), borderBottom: `1px solid ${palette.border.default}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
            Filtered to this account
          </Typography>
          {typeof onClearOrphanFilter === 'function' && (
            <Typography
              component="button"
              type="button"
              variant="caption"
              onClick={onClearOrphanFilter}
              sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#2563eb', border: 'none', bgcolor: 'transparent', cursor: 'pointer', p: 0 }}
            >
              Show all
            </Typography>
          )}
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {!loading && tasks.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <HourglassEmpty sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.78rem' }}>
              No tasks found{statusFilter ? ` with status "${statusFilter}"` : ''}.
            </Typography>
          </Box>
        )}
        {tasks.map((task) => (
          <TaskRow key={task._id} task={task} />
        ))}
      </Box>

      <Divider />
      <Box sx={{ px: 1.5, py: 0.75, bgcolor: palette.bg.secondary }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
          Auto-refreshes every 30s · Reminders &amp; decisions appear here
        </Typography>
      </Box>
    </Paper>
  );
}
