import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Link,
  alpha,
  Stack,
  Pagination,
  FormControl,
  Select,
  MenuItem,
  Chip,
  Tooltip,
  IconButton,
  Checkbox,
  TextField,
  InputAdornment,
} from '@mui/material';
import {
  ArrowBack,
  Refresh as RefreshIcon,
  OpenInNew,
  Troubleshoot,
  Search as SearchIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import OrphanIamDecisionDialog from '../identities/OrphanIamDecisionDialog';
import { dataHygieneAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';
import { resolveDataHygieneDetailTheme } from './components/widgetTheme';
import { readDataHygieneSummaryCache } from './dataHygieneSummaryCache';
import WorkflowRemediationBulkAction from '../../components/remediation/WorkflowRemediationBulkAction';
import WorkflowRemediationRowAction from '../../components/remediation/WorkflowRemediationRowAction';
import QueueFirstRemediationAction from '../../components/remediation/QueueFirstRemediationAction';
import QueueFirstRemediationRowAction from '../../components/remediation/QueueFirstRemediationRowAction';
import useWrqPageQueueStatus from '../../hooks/useWrqPageQueueStatus';
import useQueueTaskPageStatus from '../../hooks/useQueueTaskPageStatus';
import { IAM_ORPHAN_QUEUE_MODAL_PIPELINE } from '../../features/remediation-events/utils/iamOrphanReviewPipeline';
import {
  WIDGET_TITLES,
  VALID_WIDGETS,
  hasPresentValue,
  resolveTenantId,
  buildBackTo,
  parseRecord,
  lifecycleChipColors,
  riskChipColors,
  managerHygieneIssueLabel,
  managerHygieneIssueChipColors,
  certificationStatusChipColors,
  countColumnTextColor,
} from './widgetDetailSupport';

function managerMismatchLabel(type) {
  if (type === 'missing_in_profile') return 'Missing in profile';
  if (type === 'missing_in_application') return 'Missing in application';
  return 'Different manager';
}

function managerMismatchChipColors(type) {
  if (type === 'missing_in_profile') {
    return { bgcolor: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' };
  }
  if (type === 'missing_in_application') {
    return { bgcolor: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
  }
  return { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
}

function statusMismatchLabel(type) {
  if (type === 'identity_active_app_inactive') return 'Identity active · account inactive';
  if (type === 'identity_inactive_app_active') return 'Identity inactive · account active';
  return 'Status mismatch';
}

function statusMismatchChipColors(type) {
  if (type === 'identity_active_app_inactive') {
    return { bgcolor: '#fff7ed', color: '#c2410c', border: '#fed7aa' };
  }
  if (type === 'identity_inactive_app_active') {
    return { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' };
  }
  return { bgcolor: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
}

function managerDisplayText(name, email) {
  return [name, email].filter(Boolean).join(' · ') || '—';
}

function SmartChip({ colKey, value, colorFn }) {
  const colors = colorFn
    ? colorFn(value)
    : colKey === 'lifecycleState' ||
        colKey === 'status' ||
        colKey === 'identityStatus' ||
        colKey === 'accountStatus'
      ? lifecycleChipColors(value)
      : riskChipColors(value);
  return (
    <Chip
      label={value}
      size="small"
      sx={{
        bgcolor: colors.bgcolor,
        color: colors.color,
        fontWeight: 700,
        fontSize: 11,
        height: 22,
        border: `1px solid ${colors.border}`,
        letterSpacing: '0.03em',
      }}
    />
  );
}

/** Prevent long cell values from overlapping the next column. */
function CellText({ value, lineClamp }) {
  const text = String(value ?? '');
  if (!text) return null;
  const sx = lineClamp
    ? {
        display: '-webkit-box',
        WebkitLineClamp: lineClamp,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        wordBreak: 'break-word',
        maxWidth: '100%',
      }
    : {
        display: 'block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      };
  return (
    <Tooltip
      title={text}
      placement="top-start"
      enterDelay={400}
      disableHoverListener={text.length < 48 && !lineClamp}
    >
      <Typography component="span" sx={sx}>
        {text}
      </Typography>
    </Tooltip>
  );
}

function columnWidthSx(col) {
  if (!col.minWidth) return {};
  return { minWidth: col.minWidth };
}

/* ── stat card ───────────────────────────────────────────────────────── */

function StatCard({ label, value, wt }) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.5,
        borderRadius: 2,
        bgcolor: alpha(wt.main, 0.08),
        border: `1px solid ${alpha(wt.main, 0.2)}`,
        minWidth: 100,
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontWeight: 800, fontSize: 22, color: wt.main, lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 11, color: wt.dark, fontWeight: 600, mt: 0.25, opacity: 0.75 }}>
        {label}
      </Typography>
    </Box>
  );
}

/* ── column defs ─────────────────────────────────────────────────────── */

const ENTITLEMENT_HYGIENE_COLUMNS = [
  {
    key: 'entitlementName',
    header: 'Name',
    alwaysShow: true,
    minWidth: 200,
    present: (rec) => hasPresentValue(rec.e.entitlementName || rec.e.displayName),
    cellSx: () => ({ fontWeight: 600, whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.entitlementName || rec.e.displayName || '—',
  },
  {
    key: 'entitlementId',
    header: 'Entitlement ID',
    alwaysShow: true,
    minWidth: 120,
    present: (rec) => hasPresentValue(rec.e.entitlementId || rec.e.name),
    cellSx: () => ({ fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.entitlementId || rec.e.name || '—',
  },
  {
    key: 'description',
    header: 'Description',
    alwaysShow: true,
    minWidth: 200,
    truncate: true,
    clipWidth: 280,
    lineClamp: 2,
    present: (rec) => hasPresentValue(rec.e.description),
    cellSx: () => ({ fontSize: 13 }),
    render: (rec) => rec.e.description || '—',
  },
  {
    key: 'entitlementType',
    header: 'Type',
    present: (rec) => hasPresentValue(rec.e.entitlementType),
    cellSx: () => ({ fontSize: 13 }),
    render: (rec) => rec.e.entitlementType,
  },
  {
    key: 'classification',
    header: 'Classification',
    present: (rec) => hasPresentValue(rec.e.classification),
    cellSx: () => ({}),
    renderChip: true,
    render: (rec) => rec.e.classification,
  },
  {
    key: 'isPrivileged',
    header: 'Privileged',
    alwaysShow: true,
    minWidth: 88,
    present: (rec) => rec.e.isPrivileged === true || hasPresentValue(rec.e.isPrivilege),
    cellSx: () => ({ whiteSpace: 'nowrap' }),
    render: (rec) =>
      rec.e.isPrivileged === true || String(rec.e.isPrivilege).toLowerCase() === 'true' ? 'Yes' : 'No',
  },
  {
    key: 'owner',
    header: 'Owner',
    minWidth: 130,
    present: (rec) => hasPresentValue(rec.e.owner),
    cellSx: () => ({ fontSize: 13, whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.owner,
  },
  {
    key: 'ownerEmail',
    header: 'Owner email',
    present: (rec) => hasPresentValue(rec.e.ownerEmail),
    cellSx: () => ({ fontSize: 13 }),
    render: (rec) => rec.e.ownerEmail,
  },
  {
    key: 'grantedVia',
    header: 'Granted via',
    minWidth: 140,
    present: (rec) => hasPresentValue(rec.e.grantedVia),
    cellSx: () => ({ fontSize: 13, whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.grantedVia,
  },
  {
    key: 'source',
    header: 'Source',
    minWidth: 100,
    present: (rec) => hasPresentValue(rec.e.source),
    cellSx: () => ({ fontSize: 13, whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.source,
  },
  {
    key: 'applicationCode',
    header: 'App code',
    present: (rec) => hasPresentValue(rec.e.applicationCode),
    cellSx: () => ({ fontSize: 13 }),
    render: (rec) => rec.e.applicationCode,
  },
  {
    key: 'validFrom',
    header: 'Valid from',
    minWidth: 108,
    present: (rec) => hasPresentValue(rec.e.validFrom),
    cellSx: () => ({ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.validFrom,
  },
  {
    key: 'validTo',
    header: 'Valid to',
    minWidth: 108,
    present: (rec) => hasPresentValue(rec.e.validTo),
    cellSx: () => ({ fontSize: 13, color: 'text.secondary', whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.validTo,
  },
  {
    key: 'isActive',
    header: 'Active',
    present: (rec) => hasPresentValue(rec.e.isActive),
    cellSx: () => ({}),
    renderChip: true,
    render: (rec) => rec.e.isActive,
  },
  {
    key: 'tags',
    header: 'Tags',
    minWidth: 180,
    truncate: true,
    clipWidth: 240,
    present: (rec) => hasPresentValue(rec.e.tags),
    cellSx: () => ({ fontSize: 12 }),
    render: (rec) => rec.e.tags,
  },
  {
    key: 'riskLevel',
    header: 'Risk',
    present: (rec) => hasPresentValue(rec.e.riskLevel),
    cellSx: () => ({}),
    renderChip: true,
    render: (rec) => rec.e.riskLevel,
  },
  {
    key: 'applicationLabel',
    header: 'Application',
    minWidth: 120,
    present: (rec) => hasPresentValue(rec.e.applicationLabel),
    cellSx: () => ({ whiteSpace: 'nowrap' }),
    render: (rec) => rec.e.applicationLabel,
  },
];

const HYGIENE_WRQ_WIDGETS = new Set([
  'missingManagers',
  'missingManagersByApplication',
  'inactiveUsersWithAccess',
  'orphanedProfiles',
]);

function buildHygieneRemediateItem(rec, widgetId, { applicationIdForApi, applicationLabel }) {
  if (widgetId === 'inactiveUsersWithAccess' && rec.kind === 'ina') {
    const targetId = rec.a.userId || rec.a.accountId || rec.a.id;
    if (!targetId) return null;
    return {
      id: String(targetId),
      label: rec.a.displayName || rec.a.email || String(targetId),
      context: {
        applicationId: applicationIdForApi,
        applicationName: applicationLabel !== '—' ? applicationLabel : rec.a.applicationLabel,
        userId: String(targetId),
        identityName: rec.a.displayName || rec.a.email || String(targetId),
        identityEmail: rec.a.email || '',
      },
    };
  }
  if (
    (widgetId === 'missingManagers' || widgetId === 'missingManagersByApplication')
    && (rec.kind === 'mm' || rec.kind === 'mma')
    && rec.i?.id
  ) {
    return {
      id: String(rec.i.id),
      label: rec.i.displayName || rec.i.email || String(rec.i.id),
      context: {
        applicationId: applicationIdForApi,
        applicationName: applicationLabel !== '—' ? applicationLabel : rec.i.linkedApplicationLabel,
        userId: String(rec.i.id),
        identityName: rec.i.displayName || rec.i.email || String(rec.i.id),
        identityEmail: rec.i.email || '',
      },
    };
  }
  if (widgetId === 'orphanedProfiles' && rec.kind === 'orphan' && rec.o?.id) {
    const ws = rec.o.workflowStatus;
    if (['IN_PROGRESS', 'WAITING_IAM', 'PENDING'].includes(ws)) return null;
    return {
      id: String(rec.o.id),
      label: rec.o.accountName || rec.o.accountId || String(rec.o.id),
    };
  }
  return null;
}

function hygieneWrqEventType(widgetId) {
  if (widgetId === 'inactiveUsersWithAccess') return 'DORMANT_ACCOUNT';
  if (widgetId === 'orphanedProfiles') return 'UNCORRELATED_ACCOUNT';
  return 'MISSING_MANAGER';
}

function hygieneWrqEventLabel(widgetId) {
  if (widgetId === 'inactiveUsersWithAccess') return 'Dormant Account';
  if (widgetId === 'orphanedProfiles') return 'Uncorrelated Account';
  return 'Missing Manager';
}

function hygieneWrqQueueSlug(widgetId) {
  if (widgetId === 'inactiveUsersWithAccess') return 'dormant-account';
  if (widgetId === 'orphanedProfiles') return 'uncorrelated-account';
  return 'missing-manager';
}

const WIDGET_COLUMN_DEFS = {
  orphanedProfiles: [
    { key: 'accountName', header: 'Account', alwaysShow: true, present: (rec) => hasPresentValue(rec.o.accountName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.o.accountName || rec.o.accountId || '—' },
    {
      key: 'userDisplayName',
      header: 'Display name',
      present: (rec) => hasPresentValue(rec.o.userDisplayName),
      cellSx: () => ({}),
      render: (rec) => rec.o.userDisplayName,
    },
    {
      key: 'userEmail',
      header: 'Email',
      present: (rec) => hasPresentValue(rec.o.userEmail),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.o.userEmail,
    },
    {
      key: 'userEmployeeId',
      header: 'Employee ID',
      present: (rec) => hasPresentValue(rec.o.userEmployeeId),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.o.userEmployeeId,
    },
    {
      key: 'userUsername',
      header: 'Username',
      present: (rec) => hasPresentValue(rec.o.userUsername),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.o.userUsername,
    },
    {
      key: 'correlationDisplay',
      header: 'Correlation value',
      present: (rec) => hasPresentValue(rec.o.correlationDisplay || rec.o.correlationKey),
      cellSx: () => ({ fontSize: 13, color: 'text.secondary' }),
      render: (rec) => rec.o.correlationDisplay || rec.o.correlationKey,
    },
    { key: 'riskLevel', header: 'Risk', present: (rec) => hasPresentValue(rec.o.riskLevel), cellSx: () => ({}), renderChip: true, render: (rec) => rec.o.riskLevel },
    { key: 'status', header: 'Status', present: (rec) => hasPresentValue(rec.o.status), cellSx: () => ({}), renderChip: true, render: (rec) => rec.o.status },
    { key: 'detectedAt', header: 'Detected', present: (rec) => hasPresentValue(rec.o.detectedAt), cellSx: () => ({ fontSize: 13, color: 'text.secondary' }), render: (rec) => rec.o.detectedAt ? new Date(rec.o.detectedAt).toLocaleString() : null },
    {
      key: 'workflowStatus',
      header: 'Workflow',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.o.workflowStatus),
      cellSx: () => ({}),
      render: (rec) => {
        const ws = rec.o.workflowStatus;
        const colors = {
          PENDING: { bgcolor: '#f1f5f9', color: '#64748b', border: '#cbd5e1' },
          IN_PROGRESS: { bgcolor: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
          WAITING_IAM: { bgcolor: '#fef3c7', color: '#b45309', border: '#fcd34d' },
          COMPLETED: { bgcolor: '#d1fae5', color: '#047857', border: '#6ee7b7' },
          FAILED: { bgcolor: '#fee2e2', color: '#b91c1c', border: '#fca5a5' },
        };
        const c = colors[ws] || colors.PENDING;
        return (
          <Chip
            label={ws === 'WAITING_IAM' ? 'Awaiting IAM' : ws?.replace(/_/g, ' ') || ws}
            size="small"
            sx={{
              bgcolor: c.bgcolor,
              color: c.color,
              fontWeight: 600,
              fontSize: 11,
              height: 22,
              border: `1px solid ${c.border}`,
            }}
          />
        );
      },
    },
    {
      key: 'currentStepLabel',
      header: 'Step',
      present: (rec) => hasPresentValue(rec.o.currentStepLabel),
      cellSx: () => ({ fontSize: 12, color: 'text.secondary', maxWidth: 200 }),
      render: (rec) => rec.o.currentStepLabel,
    },
    {
      key: 'nextCheckAt',
      header: 'Next reminder',
      present: (rec) => hasPresentValue(rec.o.nextCheckAt),
      cellSx: () => ({ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }),
      render: (rec) => (rec.o.nextCheckAt ? new Date(rec.o.nextCheckAt).toLocaleString() : null),
    },
    {
      key: 'remediate',
      header: 'Actions',
      alwaysShow: true,
      present: () => true,
      stopPropagation: true,
      cellSx: () => ({ whiteSpace: 'nowrap' }),
      render: (rec, ctx) => {
        if (!rec.o?.id) return null;
        const ws = rec.o.workflowStatus;
        if (ws === 'WAITING_IAM') {
          return (
            <Tooltip title="Record IAM decision">
              <IconButton
                size="small"
                color="warning"
                onClick={() => ctx.onIamDecision(rec.o)}
              >
                <Troubleshoot fontSize="small" />
              </IconButton>
            </Tooltip>
          );
        }
        const label = rec.o.accountName || rec.o.accountId || String(rec.o.id);
        return (
          <QueueFirstRemediationRowAction
            targetId={rec.o.id}
            recordLabel={label}
            eventTypeLabel="IAM Orphan Review"
            queueAction="IAM_ORPHAN_REVIEW"
            pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
            queuedInfo={ctx.getQueuedInfo?.(rec.o.id)}
            disabled={['IN_PROGRESS', 'WAITING_IAM', 'PENDING'].includes(ws)}
            onQueuedRefresh={ctx.refreshQueueStatus}
            size="small"
            variant="outlined"
          />
        );
      },
    },
  ],
  missingManagers: [
    { key: 'displayName', header: 'Name', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.displayName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.i.displayName || '—' },
    { key: 'email', header: 'Email', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.email), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.i.email || '—' },
    { key: 'employeeId', header: 'Employee ID', present: (rec) => hasPresentValue(rec.i.employeeId), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.i.employeeId },
    {
      key: 'managerIssue',
      header: 'Manager status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.i.managerIssue) || hasPresentValue(rec.i.managerResolutionStatus),
      cellSx: () => ({}),
      render: (rec) => {
        const issue = rec.i.managerIssue || rec.i.managerResolutionStatus;
        const label = managerHygieneIssueLabel(issue, rec.i);
        const colors = managerHygieneIssueChipColors(issue);
        return (
          <Chip
            label={label}
            size="small"
            sx={{
              bgcolor: colors.bgcolor,
              color: colors.color,
              fontWeight: 600,
              fontSize: 11,
              height: 'auto',
              minHeight: 22,
              py: 0.25,
              border: `1px solid ${colors.border}`,
              '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3 },
            }}
          />
        );
      },
    },
    { key: 'lifecycleState', header: 'Lifecycle', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.lifecycleState), cellSx: () => ({}), renderChip: true, render: (rec) => rec.i.lifecycleState || '—' },
    { key: 'identityType', header: 'Type', present: (rec) => hasPresentValue(rec.i.identityType), cellSx: () => ({}), render: (rec) => rec.i.identityType },
    { key: 'sourceApplicationLabel', header: 'Identity source', present: (rec) => hasPresentValue(rec.i.sourceApplicationLabel), cellSx: () => ({}), render: (rec) => rec.i.sourceApplicationLabel },
    { key: 'totalEntitlements', header: 'Entitlements', present: (rec) => rec.i.totalEntitlements != null && !Number.isNaN(Number(rec.i.totalEntitlements)), cellSx: () => ({ textAlign: 'right' }), headerSx: { textAlign: 'right' }, render: (rec) => rec.i.totalEntitlements ?? 0 },
  ],
  missingManagersByApplication: [
    { key: 'displayName', header: 'Name', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.displayName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.i.displayName || '—' },
    { key: 'email', header: 'Email', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.email), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.i.email || '—' },
    { key: 'employeeId', header: 'Employee ID', present: (rec) => hasPresentValue(rec.i.employeeId), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.i.employeeId },
    {
      key: 'managerIssue',
      header: 'Manager status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.i.managerIssue) || hasPresentValue(rec.i.managerResolutionStatus),
      cellSx: () => ({}),
      render: (rec) => {
        const issue = rec.i.managerIssue || rec.i.managerResolutionStatus;
        const label = managerHygieneIssueLabel(issue, rec.i);
        const colors = managerHygieneIssueChipColors(issue);
        return (
          <Chip
            label={label}
            size="small"
            sx={{
              bgcolor: colors.bgcolor,
              color: colors.color,
              fontWeight: 600,
              fontSize: 11,
              height: 'auto',
              minHeight: 22,
              py: 0.25,
              border: `1px solid ${colors.border}`,
              '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3 },
            }}
          />
        );
      },
    },
    { key: 'lifecycleState', header: 'Lifecycle', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.lifecycleState), cellSx: () => ({}), renderChip: true, render: (rec) => rec.i.lifecycleState || '—' },
    { key: 'sourceApplicationLabel', header: 'Source app', present: (rec) => hasPresentValue(rec.i.sourceApplicationLabel), cellSx: () => ({}), render: (rec) => rec.i.sourceApplicationLabel },
    { key: 'linkedApplicationLabel', header: 'Linked app', alwaysShow: true, present: (rec) => hasPresentValue(rec.i.linkedApplicationLabel), cellSx: () => ({}), render: (rec) => rec.i.linkedApplicationLabel || '—' },
  ],
  managerMismatches: [
    { key: 'displayName', header: 'Name', alwaysShow: true, present: (rec) => hasPresentValue(rec.m.displayName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.m.displayName || '—' },
    { key: 'email', header: 'Email', alwaysShow: true, present: (rec) => hasPresentValue(rec.m.email), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.m.email || '—' },
    { key: 'employeeId', header: 'Employee ID', present: (rec) => hasPresentValue(rec.m.employeeId), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.m.employeeId },
    {
      key: 'mismatchType',
      header: 'Mismatch',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.m.mismatchType),
      cellSx: () => ({}),
      render: (rec) => {
        const colors = managerMismatchChipColors(rec.m.mismatchType);
        return (
          <Chip
            label={managerMismatchLabel(rec.m.mismatchType)}
            size="small"
            sx={{
              bgcolor: colors.bgcolor,
              color: colors.color,
              fontWeight: 600,
              fontSize: 11,
              height: 'auto',
              minHeight: 22,
              py: 0.25,
              border: `1px solid ${colors.border}`,
              '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3 },
            }}
          />
        );
      },
    },
    {
      key: 'profileManager',
      header: 'Profile manager',
      alwaysShow: true,
      minWidth: 180,
      present: (rec) => hasPresentValue(rec.m.profileManagerName) || hasPresentValue(rec.m.profileManagerEmail),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => managerDisplayText(rec.m.profileManagerName, rec.m.profileManagerEmail),
    },
    {
      key: 'applicationManager',
      header: 'Application manager',
      alwaysShow: true,
      minWidth: 180,
      present: (rec) => hasPresentValue(rec.m.applicationManagerName) || hasPresentValue(rec.m.applicationManagerEmail),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => managerDisplayText(rec.m.applicationManagerName, rec.m.applicationManagerEmail),
    },
    {
      key: 'applicationManagerReference',
      header: 'App manager ref',
      present: (rec) => hasPresentValue(rec.m.applicationManagerReference),
      cellSx: () => ({ fontSize: 13, color: 'text.secondary' }),
      render: (rec) => rec.m.applicationManagerReference,
    },
    {
      key: 'accountName',
      header: 'Account',
      present: (rec) => hasPresentValue(rec.m.accountName) || hasPresentValue(rec.m.accountId),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.m.accountName || rec.m.accountId || '—',
    },
    { key: 'lifecycleState', header: 'Lifecycle', alwaysShow: true, present: (rec) => hasPresentValue(rec.m.lifecycleState), cellSx: () => ({}), renderChip: true, render: (rec) => rec.m.lifecycleState || '—' },
    { key: 'identityType', header: 'Type', present: (rec) => hasPresentValue(rec.m.identityType), cellSx: () => ({}), render: (rec) => rec.m.identityType },
  ],
  statusMismatches: [
    { key: 'displayName', header: 'Name', alwaysShow: true, present: (rec) => hasPresentValue(rec.s.displayName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.s.displayName || '—' },
    { key: 'email', header: 'Email', alwaysShow: true, present: (rec) => hasPresentValue(rec.s.email), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.s.email || '—' },
    { key: 'employeeId', header: 'Employee ID', present: (rec) => hasPresentValue(rec.s.employeeId), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.s.employeeId },
    {
      key: 'identityStatus',
      header: 'Identity status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.s.identityStatus),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.s.identityStatus || '—',
    },
    {
      key: 'accountStatus',
      header: 'Account status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.s.accountStatus),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.s.accountStatus || '—',
    },
    {
      key: 'mismatchType',
      header: 'Mismatch type',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.s.mismatchType),
      cellSx: () => ({}),
      render: (rec) => {
        const colors = statusMismatchChipColors(rec.s.mismatchType);
        return (
          <Chip
            label={statusMismatchLabel(rec.s.mismatchType)}
            size="small"
            sx={{
              bgcolor: colors.bgcolor,
              color: colors.color,
              fontWeight: 600,
              fontSize: 11,
              height: 'auto',
              minHeight: 22,
              py: 0.25,
              border: `1px solid ${colors.border}`,
              '& .MuiChip-label': { whiteSpace: 'normal', lineHeight: 1.3 },
            }}
          />
        );
      },
    },
    {
      key: 'accountName',
      header: 'Account',
      present: (rec) => hasPresentValue(rec.s.accountName) || hasPresentValue(rec.s.accountId),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.s.accountName || rec.s.accountId || '—',
    },
    {
      key: 'applicationLabel',
      header: 'Application',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.s.applicationLabel),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.s.applicationLabel || '—',
    },
  ],
  unassignedEntitlements: ENTITLEMENT_HYGIENE_COLUMNS,
  privilegedEntitlements: ENTITLEMENT_HYGIENE_COLUMNS,
  entitlementsMissingOwner: ENTITLEMENT_HYGIENE_COLUMNS,
  inactiveUsersWithAccess: [
    { key: 'displayName', header: 'User', alwaysShow: true, present: (rec) => hasPresentValue(rec.a.displayName), cellSx: () => ({ fontWeight: 600 }), render: (rec) => rec.a.displayName || '—' },
    { key: 'email', header: 'Email', alwaysShow: true, present: (rec) => hasPresentValue(rec.a.email), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.a.email || '—' },
    { key: 'status', header: 'Status', alwaysShow: true, present: (rec) => hasPresentValue(rec.a.status) || hasPresentValue(rec.a.lifecycleState), cellSx: () => ({}), renderChip: true, render: (rec) => rec.a.status || rec.a.lifecycleState || '—' },
    { key: 'account', header: 'Account', present: (rec) => hasPresentValue(rec.a.accountName) || hasPresentValue(rec.a.accountId), cellSx: () => ({}), render: (rec) => rec.a.accountName || rec.a.accountId },
    { key: 'entitlementCount', header: 'Entitlements', present: (rec) => rec.a.entitlementCount != null && !Number.isNaN(Number(rec.a.entitlementCount)), cellSx: () => ({ textAlign: 'right' }), headerSx: { textAlign: 'right' }, render: (rec) => rec.a.entitlementCount ?? 0 },
    {
      key: 'entitlementsPreview',
      header: 'Access',
      minWidth: 180,
      truncate: true,
      clipWidth: 240,
      present: (rec) => hasPresentValue(rec.a.entitlementsPreview),
      cellSx: () => ({ fontSize: 12 }),
      render: (rec) => rec.a.entitlementsPreview,
    },
    { key: 'applicationLabel', header: 'Application', present: (rec) => hasPresentValue(rec.a.applicationLabel), cellSx: () => ({}), render: (rec) => rec.a.applicationLabel },
  ],
  accessCertificationCampaigns: [
    { key: 'name', header: 'Campaign', alwaysShow: true, present: (rec) => hasPresentValue(rec.c.name), cellSx: () => ({ fontWeight: 600, minWidth: 160 }), render: (rec) => rec.c.name || '—' },
    {
      key: 'totalItems',
      header: 'Total',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.c.totalItems != null && !Number.isNaN(Number(rec.c.totalItems)),
      cellSx: () => ({ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.c.totalItems ?? 0,
    },
    {
      key: 'approvedItems',
      header: 'Approved',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.c.approvedItems != null && !Number.isNaN(Number(rec.c.approvedItems)),
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.c.approvedItems ?? 0,
    },
    {
      key: 'revokedItems',
      header: 'Revoked',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.c.revokedItems != null && !Number.isNaN(Number(rec.c.revokedItems)),
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.c.revokedItems ?? 0,
    },
    {
      key: 'pendingItems',
      header: 'Pending',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.c.pendingItems != null && !Number.isNaN(Number(rec.c.pendingItems)),
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.c.pendingItems ?? 0,
    },
    { key: 'status', header: 'Status', alwaysShow: true, present: (rec) => hasPresentValue(rec.c.status), cellSx: () => ({}), renderChip: true, render: (rec) => rec.c.status || '—' },
    { key: 'category', header: 'Category', present: (rec) => hasPresentValue(rec.c.category), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.c.category },
    { key: 'certificationScope', header: 'Scope', present: (rec) => hasPresentValue(rec.c.certificationScope), cellSx: () => ({ fontSize: 13 }), render: (rec) => rec.c.certificationScope },
    { key: 'startDate', header: 'Start', present: (rec) => hasPresentValue(rec.c.startDate), cellSx: () => ({ fontSize: 13, color: 'text.secondary' }), render: (rec) => (rec.c.startDate ? new Date(rec.c.startDate).toLocaleDateString() : null) },
    { key: 'dueDate', header: 'Due', present: (rec) => hasPresentValue(rec.c.dueDate), cellSx: () => ({ fontSize: 13, color: 'text.secondary' }), render: (rec) => (rec.c.dueDate ? new Date(rec.c.dueDate).toLocaleDateString() : null) },
  ],
  sodPoliciesViolations: [
    {
      key: 'name',
      header: 'Policy',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.p.name),
      cellSx: () => ({ fontWeight: 600, minWidth: 160 }),
      render: (rec) => rec.p.name || rec.p.policyId || '—',
    },
    {
      key: 'policyId',
      header: 'Policy ID',
      present: (rec) => hasPresentValue(rec.p.policyId),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.p.policyId,
    },
    {
      key: 'type',
      header: 'Type',
      present: (rec) => hasPresentValue(rec.p.type),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.p.type,
    },
    {
      key: 'totalViolations',
      header: 'Total violations',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.p.totalViolations != null,
      cellSx: () => ({ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.p.totalViolations ?? 0,
    },
    {
      key: 'openViolations',
      header: 'Open violations',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.p.openViolations != null,
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.p.openViolations ?? 0,
    },
    {
      key: 'remediated',
      header: 'Remediated',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.p.remediated != null,
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.p.remediated ?? 0,
    },
    {
      key: 'exceptionGranted',
      header: 'Exceptions',
      alwaysShow: true,
      renderCountColor: true,
      present: (rec) => rec.p.exceptionGranted != null,
      cellSx: () => ({ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }),
      headerSx: { textAlign: 'right' },
      render: (rec) => rec.p.exceptionGranted ?? 0,
    },
    {
      key: 'severity',
      header: 'Severity',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.p.severity),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.p.severity,
    },
    {
      key: 'status',
      header: 'Status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.p.status),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.p.status,
    },
    {
      key: 'owner',
      header: 'Owner',
      present: (rec) => hasPresentValue(rec.p.owner) || hasPresentValue(rec.p.ownerEmail),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => [rec.p.owner, rec.p.ownerEmail].filter(Boolean).join(' · ') || null,
    },
    {
      key: 'lastScanDate',
      header: 'Last scan',
      present: (rec) => hasPresentValue(rec.p.lastScanDate),
      cellSx: () => ({ fontSize: 13, color: 'text.secondary' }),
      render: (rec) =>
        rec.p.lastScanDate ? new Date(rec.p.lastScanDate).toLocaleString() : null,
    },
    {
      key: 'description',
      header: 'Description',
      minWidth: 200,
      truncate: true,
      clipWidth: 280,
      lineClamp: 2,
      present: (rec) => hasPresentValue(rec.p.description),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.p.description,
    },
  ],
  duplicateAccountsByApplication: [
    {
      key: 'displayName',
      header: 'Display name',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.d.displayName),
      cellSx: () => ({ fontWeight: 600, minWidth: 140 }),
      render: (rec) => rec.d.displayName || '—',
    },
    {
      key: 'email',
      header: 'Email',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.d.email),
      cellSx: () => ({ fontSize: 13, minWidth: 160 }),
      render: (rec) => rec.d.email || '—',
    },
    {
      key: 'username',
      header: 'Username',
      present: (rec) => hasPresentValue(rec.d.username),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.username,
    },
    {
      key: 'employeeId',
      header: 'Employee ID',
      present: (rec) => hasPresentValue(rec.d.employeeId),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.employeeId,
    },
    {
      key: 'department',
      header: 'Department',
      present: (rec) => hasPresentValue(rec.d.department),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.department,
    },
    {
      key: 'jobTitle',
      header: 'Job title',
      present: (rec) => hasPresentValue(rec.d.jobTitle),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.jobTitle,
    },
    {
      key: 'managerName',
      header: 'Manager',
      present: (rec) => hasPresentValue(rec.d.managerName),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.managerName,
    },
    {
      key: 'organizationRole',
      header: 'Role',
      present: (rec) => hasPresentValue(rec.d.organizationRole),
      cellSx: () => ({ fontSize: 13 }),
      render: (rec) => rec.d.organizationRole,
    },
    {
      key: 'status',
      header: 'Status',
      alwaysShow: true,
      present: (rec) => hasPresentValue(rec.d.status),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.d.status || '—',
    },
    {
      key: 'suspended',
      header: 'Suspended',
      present: (rec) => hasPresentValue(rec.d.suspended),
      cellSx: () => ({}),
      renderChip: true,
      render: (rec) => rec.d.suspended,
    },
  ],
};

function computeVisibleColumns(widgetId, records) {
  const defs = WIDGET_COLUMN_DEFS[widgetId];
  if (!defs || !records.length) return [];
  return defs.filter((col) => {
    if (col.alwaysShow) return true;
    return records.some((rec) => col.present(rec));
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   Main component
═══════════════════════════════════════════════════════════════════════ */

export default function DataHygieneWidgetDetail() {
  const { widgetId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isPlatformAdmin } = useAuth();

  const tenantFromUser = resolveTenantId(user);
  const tenantFromQuery = searchParams.get('tenantId');
  const effectiveTenantId = tenantFromUser || tenantFromQuery || null;
  const dashboardView = searchParams.get('dashboardView') === 'application' ? 'application' : null;

  const applicationIdParam = searchParams.get('applicationId');
  const applicationIdForApi =
    applicationIdParam == null || applicationIdParam === '' ? undefined : applicationIdParam;
  const appThemeIndexParam = searchParams.get('appThemeIndex');

  const wt = useMemo(
    () =>
      resolveDataHygieneDetailTheme(widgetId, {
        dashboardView,
        appThemeIndex: appThemeIndexParam,
        applicationId: applicationIdForApi ?? applicationIdParam,
        cachedSummary: readDataHygieneSummaryCache(effectiveTenantId),
      }),
    [
      widgetId,
      dashboardView,
      appThemeIndexParam,
      applicationIdForApi,
      applicationIdParam,
      effectiveTenantId,
    ],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [payload, setPayload] = useState(null);
  const loadAbortRef = useRef(null);
  const [searchInput, setSearchInput] = useState(() => searchParams.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(() => (searchParams.get('q') || '').trim());
  const [iamDecisionModal, setIamDecisionModal] = useState({
    open: false,
    orphanId: null,
    accountName: '',
  });
  const [selectedWrqIds, setSelectedWrqIds] = useState(() => new Set());

  const applicationLabel = payload?.applicationLabel || '—';

  const isOrphanQueueFirst = widgetId === 'orphanedProfiles';

  const orphanRowActions = useMemo(
    () => ({
      onIamDecision: (o) =>
        setIamDecisionModal({
          open: true,
          orphanId: o.id,
          accountName: o.accountName || '',
        }),
    }),
    [],
  );

  const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0);
  const rowsPerPage = Math.min(
    100,
    Math.max(5, parseInt(searchParams.get('rowsPerPage') || '25', 10) || 25),
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const currentQ = (searchParams.get('q') || '').trim();
    if (debouncedQ === currentQ) return;
    if (debouncedQ) next.set('q', debouncedQ);
    else next.delete('q');
    next.delete('page');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync URL q from debounced input only
  }, [debouncedQ]);

  const goToPage = (p) => {
    const next = new URLSearchParams(searchParams);
    if (p <= 0) next.delete('page');
    else next.set('page', String(p));
    setSearchParams(next, { replace: true });
  };

  const updateRowsPerPage = (n) => {
    const next = new URLSearchParams(searchParams);
    next.set('rowsPerPage', String(n));
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!VALID_WIDGETS.has(widgetId)) {
      setLoading(false);
      return;
    }
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const params = { widget: widgetId, page: page + 1, limit: rowsPerPage };
      if (applicationIdForApi != null) params.applicationId = applicationIdForApi;
      if (effectiveTenantId) params.tenantId = effectiveTenantId;
      if (debouncedQ) params.q = debouncedQ;
      const res = await dataHygieneAPI.getWidgetItems(params, { signal: controller.signal });
      if (loadAbortRef.current !== controller) return;
      setPayload(res.data?.data ?? res.data);
    } catch (e) {
      if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError') return;
      if (loadAbortRef.current !== controller) return;
      setError(e?.response?.data?.message || e.message || 'Failed to load details');
      setPayload(null);
    } finally {
      if (loadAbortRef.current === controller) setLoading(false);
    }
  }, [widgetId, page, rowsPerPage, applicationIdForApi, effectiveTenantId, debouncedQ]);

  useEffect(() => {
    void load();
    return () => { loadAbortRef.current?.abort(); };
  }, [load]);

  const title = WIDGET_TITLES[widgetId] || 'Data hygiene';
  const total = Number(payload?.total) || 0;
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const pageCount = Math.max(1, Math.ceil(total / rowsPerPage) || 1);
  const rangeFrom = total === 0 || !items.length ? 0 : page * rowsPerPage + 1;
  const rangeTo = total === 0 || !items.length ? 0 : Math.min(total, page * rowsPerPage + items.length);

  const rowModels = useMemo(
    () => items.map((row) => ({ row, rec: parseRecord(row, widgetId) })),
    [items, widgetId],
  );
  const parsedRecords = useMemo(
    () => rowModels.map((m) => m.rec).filter(Boolean),
    [rowModels],
  );

  const supportsWrqBulk = HYGIENE_WRQ_WIDGETS.has(widgetId);

  const pageSelectableItems = useMemo(() => {
    if (!supportsWrqBulk) return [];
    return parsedRecords
      .map((rec) =>
        buildHygieneRemediateItem(rec, widgetId, {
          applicationIdForApi,
          applicationLabel,
        }),
      )
      .filter(Boolean);
  }, [supportsWrqBulk, parsedRecords, widgetId, applicationIdForApi, applicationLabel]);

  const selectedBulkItems = useMemo(
    () => pageSelectableItems.filter((item) => selectedWrqIds.has(item.id)),
    [pageSelectableItems, selectedWrqIds],
  );

  const allPageSelected =
    pageSelectableItems.length > 0
    && pageSelectableItems.every((item) => selectedWrqIds.has(item.id));

  const toggleWrqSelection = (id) => {
    setSelectedWrqIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllWrq = () => {
    if (allPageSelected) {
      setSelectedWrqIds(new Set());
      return;
    }
    setSelectedWrqIds(new Set(pageSelectableItems.map((item) => item.id)));
  };

  useEffect(() => {
    setSelectedWrqIds(new Set());
  }, [widgetId, page, applicationIdForApi, debouncedQ]);

  const prevWidgetIdRef = useRef(widgetId);
  useEffect(() => {
    if (prevWidgetIdRef.current === widgetId) return;
    prevWidgetIdRef.current = widgetId;
    setSearchInput('');
    setDebouncedQ('');
  }, [widgetId]);

  const pageTargetIds = useMemo(
    () => pageSelectableItems.map((item) => item.id),
    [pageSelectableItems],
  );

  const { getQueuedInfo: getWrqQueuedInfo, refresh: refreshWrqQueueStatus } = useWrqPageQueueStatus({
    eventType: hygieneWrqEventType(widgetId),
    targetIds: isOrphanQueueFirst ? [] : pageTargetIds,
    enabled: supportsWrqBulk && !isOrphanQueueFirst,
  });

  const { getQueuedInfo: getOrphanQueuedInfo, refresh: refreshOrphanQueueStatus } = useQueueTaskPageStatus({
    action: 'IAM_ORPHAN_REVIEW',
    targetIds: isOrphanQueueFirst ? pageTargetIds : [],
    enabled: isOrphanQueueFirst,
  });

  const getQueuedInfo = isOrphanQueueFirst ? getOrphanQueuedInfo : getWrqQueuedInfo;
  const refreshQueueStatus = isOrphanQueueFirst ? refreshOrphanQueueStatus : refreshWrqQueueStatus;

  const orphanRowActionsWithQueue = useMemo(
    () => ({
      ...orphanRowActions,
      getQueuedInfo,
      refreshQueueStatus,
    }),
    [orphanRowActions, getQueuedInfo, refreshQueueStatus],
  );

  const visibleColumns = useMemo(
    () => computeVisibleColumns(widgetId, parsedRecords),
    [widgetId, parsedRecords],
  );

  const columnsWithWrq = useMemo(() => {
    if (!supportsWrqBulk || isOrphanQueueFirst) return visibleColumns;
    return [
      ...visibleColumns,
      {
        key: 'wrqAction',
        header: 'Actions',
        alwaysShow: true,
        present: () => true,
        stopPropagation: true,
        cellSx: () => ({ whiteSpace: 'nowrap' }),
        render: (rec) => {
          const item = buildHygieneRemediateItem(rec, widgetId, {
            applicationIdForApi,
            applicationLabel,
          });
          if (!item) return null;
          return (
            <WorkflowRemediationRowAction
              targetId={item.id}
              recordLabel={item.label}
              eventType={hygieneWrqEventType(widgetId)}
              eventTypeLabel={hygieneWrqEventLabel(widgetId)}
              queueSlug={hygieneWrqQueueSlug(widgetId)}
              queuedInfo={getQueuedInfo(item.id)}
              context={item.context}
              sharedContext={{
                applicationId: applicationIdForApi,
                applicationName: applicationLabel !== '—' ? applicationLabel : undefined,
              }}
              onQueuedRefresh={refreshQueueStatus}
            />
          );
        },
      },
    ];
  }, [
    supportsWrqBulk,
    isOrphanQueueFirst,
    visibleColumns,
    widgetId,
    applicationIdForApi,
    applicationLabel,
    getQueuedInfo,
    refreshQueueStatus,
  ]);
  const backHref = useMemo(
    () => buildBackTo('/datahygine', tenantFromUser ? null : effectiveTenantId, dashboardView),
    [tenantFromUser, effectiveTenantId, dashboardView],
  );

  const needsTenantHint = isPlatformAdmin && !effectiveTenantId;

  const emptyColSpan = Math.max(1, columnsWithWrq.length + (supportsWrqBulk ? 1 : 0));

  /* ── invalid widget ───────────────────────────────────────────────── */
  if (!VALID_WIDGETS.has(widgetId)) {
    return (
      <Box sx={{ bgcolor: palette.bg.primary, minHeight: '100%', p: 3 }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
          <Alert severity="error">Unknown hygiene widget. Return to the dashboard.</Alert>
          <Button component={RouterLink} to={backHref} startIcon={<ArrowBack />} sx={{ mt: 2 }} variant="outlined">
            Back
          </Button>
        </Box>
      </Box>
    );
  }

  /* ── main render ──────────────────────────────────────────────────── */
  return (
    <Box sx={{ minHeight: '100%', bgcolor: palette.bg.primary, position: 'relative' }}>

    <Box sx={{ py: 3, px: { xs: 2, sm: 3 } }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto' }}>

        {/* Back link — uses same accent */}
        <Link
          component={RouterLink}
          to={backHref}
          underline="none"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 2.5,
            color: wt.main,
            fontWeight: 700,
            fontSize: 14,
            transition: 'opacity 0.15s',
            '&:hover': { opacity: 0.7 },
          }}
        >
          <ArrowBack sx={{ fontSize: 17 }} />
          Data hygiene
        </Link>

        {/* ── Header card ─────────────────────────────────────────── */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: 3,
            overflow: 'hidden',
            mb: 3,
            border: `1px solid ${alpha(wt.main, 0.25)}`,
            boxShadow: `0 4px 24px ${alpha(wt.main, 0.12)}`,
          }}
        >
          {/* Gradient banner — same gradient as tile */}
          <Box sx={{ background: wt.gradient, px: 3, pt: 3, pb: 5, position: 'relative', overflow: 'hidden' }}>
            {/* Decorative circles */}
            <Box sx={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', bgcolor: alpha('#fff', 0.08), pointerEvents: 'none' }} />
            <Box sx={{ position: 'absolute', bottom: -20, right: 100, width: 100, height: 100, borderRadius: '50%', bgcolor: alpha('#fff', 0.06), pointerEvents: 'none' }} />

            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={2} flexWrap="wrap">
              <Box>
                <Stack direction="row" alignItems="center" spacing={1.5} mb={1.5}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: 2.5,
                      bgcolor: alpha('#fff', 0.2),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 24,
                      boxShadow: `0 2px 12px ${alpha('#000', 0.1)}`,
                      backdropFilter: 'blur(4px)',
                    }}
                  >
                    {wt.icon}
                  </Box>
                  <Box>
                    <Typography
                      variant="h5"
                      sx={{
                        fontWeight: 800,
                        color: '#fff',
                        letterSpacing: '-0.02em',
                        lineHeight: 1.2,
                        textShadow: '0 1px 6px rgba(0,0,0,0.2)',
                      }}
                    >
                      {title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: alpha('#fff', 0.75), mt: 0.25, fontSize: 13 }}>
                      {wt.description}
                    </Typography>
                  </Box>
                </Stack>

              <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                <Chip
                    label={applicationLabel}
                    size="small"
                    sx={{
                      bgcolor: alpha('#fff', 0.22),
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      height: 26,
                      backdropFilter: 'blur(4px)',
                      border: `1px solid ${alpha('#fff', 0.3)}`,
                    }}
                  />
                {payload?.builtAt || payload?.computedAt ? (
                  <Chip
                    label={`Data as of ${new Date(payload.builtAt || payload.computedAt).toLocaleString()}`}
                    size="small"
                    sx={{
                      bgcolor: alpha('#fff', 0.12),
                      color: alpha('#fff', 0.9),
                      fontWeight: 600,
                      fontSize: 11,
                      height: 26,
                      border: `1px solid ${alpha('#fff', 0.2)}`,
                    }}
                  />
                ) : null}
                </Stack>
              </Box>

              <Button
                variant="contained"
                size="small"
                onClick={() => void load()}
                disabled={loading}
                startIcon={
                  loading
                    ? <CircularProgress size={15} sx={{ color: wt.main }} />
                    : <RefreshIcon sx={{ fontSize: 17 }} />
                }
                sx={{
                  flexShrink: 0,
                  bgcolor: '#fff',
                  color: wt.dark,
                  fontWeight: 700,
                  textTransform: 'none',
                  px: 2.5,
                  py: 1,
                  borderRadius: 2,
                  boxShadow: '0 2px 12px rgba(0,0,0,0.18)',
                  '&:hover': { bgcolor: alpha('#fff', 0.92), boxShadow: '0 4px 16px rgba(0,0,0,0.22)', transform: 'translateY(-1px)' },
                  '&.Mui-disabled': { bgcolor: alpha('#fff', 0.45), color: alpha(wt.dark, 0.45) },
                  transition: 'all 0.2s',
                }}
              >
                Refresh
              </Button>
            </Stack>
          </Box>

          {/* Stats strip — same light shade */}
          <Box
            sx={{
              px: 3,
              py: 2,
              bgcolor: wt.light,
              borderTop: `1px solid ${alpha(wt.main, 0.15)}`,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              flexWrap: 'wrap',
            }}
          >
            <StatCard label="Total records" value={total.toLocaleString()} wt={wt} />
            {total > 0 && (
              <>
                <StatCard label="Current page" value={`${page + 1} / ${pageCount}`} wt={wt} />
                <StatCard label="Showing" value={`${rangeFrom}–${rangeTo}`} wt={wt} />
              </>
            )}
          </Box>
        </Paper>

        {needsTenantHint && (
          <Alert severity="info" sx={{ mb: 2, borderRadius: 2 }}>
            Platform accounts need a tenant. Add <strong>?tenantId=…</strong> to this page’s URL, or return to the dashboard and open a row from a summary loaded for that tenant.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2, borderRadius: 2, border: '1px solid #fca5a5', bgcolor: '#fef2f2' }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* ── Table card ──────────────────────────────────────────── */}
        <Paper
          elevation={0}
          sx={{
            borderRadius: 3,
            border: `1px solid ${alpha(wt.main, 0.18)}`,
            bgcolor: palette.bg.secondary,
            overflow: 'hidden',
            position: 'relative',
            opacity: loading && !items.length ? 0.7 : 1,
            transition: 'opacity 0.2s',
            boxShadow: `0 2px 16px ${alpha(wt.main, 0.08)}`,
          }}
        >
          {/* Same gradient accent bar as tile */}
          <Box sx={{ height: 4, background: wt.gradient }} />

          <Box
            sx={{
              px: { xs: 1.5, sm: 2.5 },
              py: 1.75,
              borderBottom: `1px solid ${alpha(wt.main, 0.12)}`,
              bgcolor: alpha(wt.main, 0.03),
            }}
          >
            <TextField
              size="small"
              fullWidth
              placeholder="Search name, email, account, status…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              sx={{
                maxWidth: 480,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 2,
                  bgcolor: palette.bg.secondary,
                  fontSize: 14,
                  '&:hover': { bgcolor: '#fff' },
                  '&.Mui-focused': {
                    bgcolor: '#fff',
                    boxShadow: `0 0 0 3px ${alpha(wt.main, 0.15)}`,
                  },
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: alpha(wt.main, 0.7), fontSize: 20 }} />
                  </InputAdornment>
                ),
                endAdornment: searchInput ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      aria-label="Clear search"
                      onClick={() => setSearchInput('')}
                      edge="end"
                    >
                      <ClearIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              }}
            />
            {debouncedQ ? (
              <Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
                {loading
                  ? 'Searching…'
                  : `${total.toLocaleString()} match${total === 1 ? '' : 'es'} for “${debouncedQ}”`}
              </Typography>
            ) : null}
          </Box>

          {loading && !items.length && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, pointerEvents: 'none', bgcolor: alpha(palette.bg.secondary, 0.75) }}>
              <Box sx={{ textAlign: 'center' }}>
                <CircularProgress size={36} sx={{ color: wt.main }} />
                <Typography sx={{ mt: 1.5, fontSize: 13, color: wt.dark, fontWeight: 600 }}>
                  Loading records…
                </Typography>
              </Box>
            </Box>
          )}

          {supportsWrqBulk && selectedBulkItems.length > 0 && (
            <Box
              sx={{
                px: 2,
                py: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                flexWrap: 'wrap',
                borderBottom: `1px solid ${alpha(wt.main, 0.12)}`,
                bgcolor: alpha(wt.main, 0.04),
              }}
            >
              <Chip label={`${selectedBulkItems.length} selected`} size="small" sx={{ fontWeight: 700 }} />
              {isOrphanQueueFirst ? (
                <QueueFirstRemediationAction
                  queueAction="IAM_ORPHAN_REVIEW"
                  eventTypeLabel="IAM Orphan Review"
                  pipelineSteps={IAM_ORPHAN_QUEUE_MODAL_PIPELINE}
                  selectedItems={selectedBulkItems.filter((item) => !getQueuedInfo(item.id))}
                  onClearSelection={() => setSelectedWrqIds(new Set())}
                  onQueuedRefresh={refreshQueueStatus}
                  size="small"
                  variant="contained"
                />
              ) : (
                <WorkflowRemediationBulkAction
                  eventType={hygieneWrqEventType(widgetId)}
                  eventTypeLabel={hygieneWrqEventLabel(widgetId)}
                  queueSlug={hygieneWrqQueueSlug(widgetId)}
                  selectedItems={selectedBulkItems.filter((item) => !getQueuedInfo(item.id))}
                  sharedContext={{
                    applicationId: applicationIdForApi,
                    applicationName: applicationLabel !== '—' ? applicationLabel : undefined,
                  }}
                  onClearSelection={() => setSelectedWrqIds(new Set())}
                  onQueuedRefresh={refreshQueueStatus}
                  size="small"
                  variant="contained"
                />
              )}
              <Button
                size="small"
                onClick={() => setSelectedWrqIds(new Set())}
                sx={{ textTransform: 'none' }}
              >
                Clear selection
              </Button>
            </Box>
          )}

          <TableContainer sx={{ overflowX: 'auto', width: '100%' }}>
            <Table size="medium" sx={{ width: 'max-content', minWidth: '100%' }}>
              {columnsWithWrq.length > 0 && (
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(wt.main, 0.06) }}>
                    {supportsWrqBulk && (
                      <TableCell
                        padding="checkbox"
                        sx={{
                          borderBottom: `2px solid ${alpha(wt.main, 0.22)}`,
                          bgcolor: 'transparent',
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={allPageSelected}
                          indeterminate={
                            selectedBulkItems.length > 0 && !allPageSelected
                          }
                          disabled={!pageSelectableItems.length}
                          onChange={toggleSelectAllWrq}
                          inputProps={{ 'aria-label': 'Select all on page' }}
                        />
                      </TableCell>
                    )}
                    {columnsWithWrq.map((col) => (
                      <TableCell
                        key={col.key}
                        sx={{
                          color: wt.dark,
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          borderBottom: `2px solid ${alpha(wt.main, 0.22)}`,
                          py: 1.75,
                          whiteSpace: 'nowrap',
                          bgcolor: 'transparent',
                          ...columnWidthSx(col),
                          ...(col.headerSx || {}),
                        }}
                      >
                        {col.header}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
              )}

              <TableBody>
                {items.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={emptyColSpan} sx={{ py: 8, textAlign: 'center', borderBottom: 0 }}>
                      <Box sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ fontSize: 48, opacity: 0.35 }}>{wt.icon}</Box>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: wt.dark }}>
                          No items found
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          No records match this slice.
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                )}

                {items.length > 0 && !loading && parsedRecords.length > 0 && columnsWithWrq.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={1} sx={{ py: 3 }}>
                      <Typography variant="body2" color="text.secondary">
                        No displayable fields. Check the API response shape.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {rowModels.map(({ rec }, rowIdx) => {
                  if (!rec) {
                    return (
                      <TableRow key={`unparsed-${rowIdx}`} sx={{ '&:last-of-type td': { borderBottom: 0 } }}>
                        <TableCell colSpan={Math.max(1, columnsWithWrq.length + (supportsWrqBulk ? 1 : 0))}>
                          <Typography variant="body2" color="text.secondary">
                            Row could not be mapped for this widget.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  }
                  if (!columnsWithWrq.length) return null;

                  const handleRowClick = () => {
                    if ((rec.kind === 'mm' || rec.kind === 'mma') && rec.i.id) {
                      navigate(`/identities/${rec.i.id}`);
                    }
                  };

                  const clickable =
                    ((rec.kind === 'mm' || rec.kind === 'mma') && !!rec.i.id);

                  const rowKey =
                    rec.kind === 'orphan' ? rec.o.id
                    : rec.kind === 'ent' ? rec.e.id
                    : rec.kind === 'ina' ? rec.a.linkId
                    : rec.kind === 'camp' ? rec.c.id
                    : rec.kind === 'sodPol' ? rec.p.id
                    : rec.kind === 'dup' ? rec.d.id
                    : rec.kind === 'mgrx' ? rec.m.id
                    : rec.kind === 'stmx' ? rec.s.id
                    : rec.i?.id;

                  const isOdd = rowIdx % 2 === 0;
                  const remediateItem = supportsWrqBulk
                    ? buildHygieneRemediateItem(rec, widgetId, {
                        applicationIdForApi,
                        applicationLabel,
                      })
                    : null;

                  return (
                    <TableRow
                      key={rowKey ?? rowIdx}
                      hover
                      sx={{
                        cursor: clickable ? 'pointer' : 'default',
                        bgcolor: isOdd ? alpha(wt.main, 0.025) : 'transparent',
                        transition: 'background-color 0.15s',
                        '&:last-of-type td': { borderBottom: 0 },
                        '&:hover': { bgcolor: clickable ? alpha(wt.main, 0.08) : alpha(wt.main, 0.04) },
                      }}
                      onClick={clickable ? handleRowClick : undefined}
                    >
                      {supportsWrqBulk && (
                        <TableCell
                          padding="checkbox"
                          onClick={(e) => e.stopPropagation()}
                          sx={{ borderBottom: `1px solid ${alpha(wt.main, 0.08)}`, verticalAlign: 'top' }}
                        >
                          {remediateItem ? (
                            <Checkbox
                              size="small"
                              checked={selectedWrqIds.has(remediateItem.id)}
                              onChange={() => toggleWrqSelection(remediateItem.id)}
                              inputProps={{ 'aria-label': `Select ${remediateItem.label}` }}
                            />
                          ) : null}
                        </TableCell>
                      )}
                      {columnsWithWrq.map((col, colIdx) => {
                        const rowCtx =
                          widgetId === 'orphanedProfiles' && col.key === 'remediate'
                            ? orphanRowActionsWithQueue
                            : undefined;
                        const raw = col.render.length > 1 ? col.render(rec, rowCtx) : col.render(rec);
                        const show =
                          col.key === 'remediate' && widgetId === 'orphanedProfiles'
                            ? Boolean(raw)
                            : hasPresentValue(raw);

                        return (
                          <TableCell
                            key={col.key}
                            onClick={col.stopPropagation ? (e) => e.stopPropagation() : undefined}
                            sx={{
                              borderBottom: `1px solid ${alpha(wt.main, 0.08)}`,
                              color: palette.text.primary,
                              fontSize: 14,
                              py: 1.75,
                              verticalAlign: 'top',
                              ...columnWidthSx(col),
                              ...col.cellSx(rec),
                              ...(colIdx === 0 && show ? { color: wt.dark, fontWeight: 700 } : {}),
                            }}
                          >
                            {show ? (
                              col.renderChip ? (
                                <SmartChip
                                  colKey={col.key}
                                  value={String(raw)}
                                  colorFn={
                                    widgetId === 'accessCertificationCampaigns' && col.key === 'status'
                                      ? certificationStatusChipColors
                                      : (widgetId === 'sodPoliciesViolations' && col.key === 'severity'
                                        ? riskChipColors
                                        : undefined)
                                  }
                                />
                              ) : col.renderCountColor ? (
                                <Typography
                                  component="span"
                                  sx={{
                                    color: countColumnTextColor(col.key),
                                    fontWeight:
                                      col.key === 'totalItems' || col.key === 'totalViolations'
                                        ? 800
                                        : 700,
                                    fontSize: 14,
                                  }}
                                >
                                  {Number(raw).toLocaleString()}
                                </Typography>
                              ) : colIdx === 0 && clickable ? (
                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: wt.dark }}>
                                  {raw}
                                  <OpenInNew sx={{ fontSize: 14, opacity: 0.5 }} />
                                </Box>
                              ) : col.truncate ? (
                                <Box sx={{ maxWidth: col.clipWidth ?? 240 }}>
                                  <CellText value={raw} lineClamp={col.lineClamp} />
                                </Box>
                              ) : raw
                            ) : (
                              <Typography component="span" sx={{ color: alpha(palette.text.primary, 0.3), fontSize: 13 }}>
                                —
                              </Typography>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Footer — same accent */}
          <Box
            sx={{
              borderTop: `1px solid ${alpha(wt.main, 0.15)}`,
              background: `linear-gradient(to right, ${alpha(wt.main, 0.05)}, transparent)`,
              px: { xs: 1.5, sm: 2.5 },
              py: 2,
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems="center"
              justifyContent="space-between"
            >
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.75,
                  py: 0.75,
                  borderRadius: 99,
                  bgcolor: alpha(wt.main, 0.1),
                  border: `1px solid ${alpha(wt.main, 0.22)}`,
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: wt.main, boxShadow: `0 0 0 3px ${alpha(wt.main, 0.25)}` }} />
                <Typography variant="body2" sx={{ color: wt.dark, fontSize: 13, fontWeight: 700 }}>
                  {total === 0
                    ? 'No rows'
                    : `${rangeFrom.toLocaleString()}–${rangeTo.toLocaleString()} of ${total.toLocaleString()}`}
                </Typography>
              </Box>

              {total > rowsPerPage && (
                <Pagination
                  color="primary"
                  size="medium"
                  siblingCount={1}
                  boundaryCount={1}
                  count={pageCount}
                  page={page + 1}
                  disabled={loading}
                  onChange={(_, value) => goToPage(value - 1)}
                  showFirstButton
                  showLastButton
                  sx={{
                    '& .MuiPagination-ul': { justifyContent: 'center' },
                    '& .MuiPaginationItem-root': { fontWeight: 600, fontSize: 13 },
                    '& .Mui-selected': {
                      background: `${wt.gradient} !important`,
                      color: '#fff !important',
                      boxShadow: `0 2px 8px ${alpha(wt.main, 0.4)}`,
                    },
                  }}
                />
              )}

              <FormControl size="small" sx={{ minWidth: 140 }}>
                <Select
                  value={rowsPerPage}
                  disabled={loading}
                  onChange={(e) => updateRowsPerPage(Number(e.target.value))}
                  aria-label="Rows per page"
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: palette.text.primary,
                    bgcolor: palette.bg.secondary,
                    borderRadius: 2,
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: alpha(wt.main, 0.3) },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: wt.main },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: wt.main, borderWidth: 2 },
                  }}
                >
                  {[25, 50, 100].map((n) => (
                    <MenuItem key={n} value={n} dense>{n} per page</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </Box>
        </Paper>
      </Box>

    </Box>

      {widgetId === 'orphanedProfiles' && (
        <>
          <OrphanIamDecisionDialog
            open={iamDecisionModal.open}
            orphanId={iamDecisionModal.orphanId}
            accountName={iamDecisionModal.accountName}
            onClose={() => setIamDecisionModal((m) => ({ ...m, open: false }))}
            onSuccess={() => void load()}
          />
        </>
      )}
    </Box>
  );
}