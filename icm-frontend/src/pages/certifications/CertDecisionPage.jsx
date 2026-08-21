import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Card, Typography, Button, CircularProgress, Stack, Chip,
  LinearProgress, Divider, IconButton, Tooltip, Avatar, Paper, Alert, Popover,
  ToggleButton, ToggleButtonGroup, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import EmailOutlinedIcon from '@mui/icons-material/EmailOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import axios from 'axios';
import { useBranding } from '../../contexts/BrandingContext';
import { BRANDING } from '../../constants/branding';

const API = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || window.location.origin;

/* ── Design tokens ───────────────────────────────────────────────────── */
const COLORS = {
  pageBg: '#f0f4f8',
  card: '#ffffff',
  header: 'linear-gradient(135deg, #0c1929 0%, #1a365d 50%, #0f2744 100%)',
  accent: '#2563eb',
  approve: '#059669',
  approveBg: '#ecfdf5',
  approveBorder: '#a7f3d0',
  revoke: '#dc2626',
  revokeBg: '#fef2f2',
  revokeBorder: '#fecaca',
  pending: '#64748b',
  pendingBg: '#f8fafc',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
};

/* ── Helpers ─────────────────────────────────────────────────────────── */
function resolveIdentityName(item) {
  if (!item) return 'Unknown User';
  for (const c of [item.identityName, item.name, item.displayName, item.userName, item.itemName, item.identity?.displayName, item.identity?.name]) {
    const s = String(c || '').trim();
    if (s && s !== '—' && s !== '-') return s;
  }
  return 'Unknown User';
}

function resolveIdentityEmail(item) {
  if (!item) return '';
  for (const c of [item.identityEmail, item.email, item.userEmail, item.identity?.email]) {
    const s = String(c || '').trim();
    if (s && s !== '—' && s !== '-') return s;
  }
  return '';
}

function renderText(value, fallback = '-') {
  return String(value || '').trim() || fallback;
}

function renderAccessDetails(accessDetails) {
  if (!Array.isArray(accessDetails) || accessDetails.length === 0) return '-';
  return accessDetails.join(', ');
}

function getCategoryLabel(category) {
  const map = {
    IDENTITY: 'Identity Profile',
    ACCESS_ITEMS: 'Application Access',
    MANAGER: 'Manager',
    SOD: 'SoD',
    UNCORRELATED_ACCOUNTS: 'Uncorrelated Accounts',
    ROLE_COMPOSITION: 'Role Composition',
  };
  return map[String(category || '').toUpperCase()] || category || 'Certification';
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function resolveIdentityMeta(item) {
  const clean = (v) => {
    const s = String(v || '').trim();
    return s && s !== '—' && s !== '-' ? s : '';
  };
  const title = clean(item.role) || clean(item.itemTitle);
  const manager = clean(item.manager);
  const managerEmail = clean(item.managerEmail);
  return {
    email: resolveIdentityEmail(item),
    title,
    department: clean(item.department),
    manager,
    managerEmail,
    managerDisplay:
      manager && managerEmail && manager.toLowerCase() !== managerEmail.toLowerCase()
        ? `${manager} · ${managerEmail}`
        : manager || managerEmail,
    employeeId: clean(item.employeeId) || clean(item.userPrimaryKey) || clean(item.userId) || clean(item.itemId),
  };
}

function normalizePortalItem(item) {
  const accessDetails = Array.isArray(item.accessDetails)
    ? item.accessDetails.filter(Boolean)
    : [];
  let entitlementDecisions = Array.isArray(item.entitlementDecisions)
    ? item.entitlementDecisions
    : [];
  if (entitlementDecisions.length === 0 && accessDetails.length > 0) {
    entitlementDecisions = accessDetails.map((name) => ({
      entitlementName: String(name),
      applicationName: item.appName && item.appName !== '—' ? item.appName : undefined,
      status: 'PENDING',
    }));
  }
  return { ...item, accessDetails, entitlementDecisions };
}

function IdentityMetaSummary({ item }) {
  const meta = resolveIdentityMeta(item);
  const parts = [
    meta.email,
    meta.title,
    meta.department,
    meta.managerDisplay,
    meta.employeeId ? `ID ${meta.employeeId}` : '',
  ].filter(Boolean);

  if (parts.length === 0) return null;

  return (
    <Typography sx={{ fontSize: '0.68rem', color: COLORS.muted, mt: 0.35, lineHeight: 1.45 }}>
      {parts.join(' · ')}
    </Typography>
  );
}

function UserInfoPopover({ item, name }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const meta = resolveIdentityMeta(item);
  const rows = [
    { icon: EmailOutlinedIcon, label: 'Email', value: meta.email },
    { icon: WorkOutlineIcon, label: 'Title', value: meta.title },
    { icon: BusinessOutlinedIcon, label: 'Department', value: meta.department },
    { icon: SupervisorAccountOutlinedIcon, label: 'Manager', value: meta.managerDisplay },
    { icon: BadgeOutlinedIcon, label: 'Employee ID', value: meta.employeeId },
  ].filter((r) => r.value);

  if (rows.length === 0) return null;

  const open = Boolean(anchorEl);

  return (
    <>
      <Tooltip title="Identity details">
        <IconButton
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            color: COLORS.muted,
            border: `1px solid ${COLORS.border}`,
            bgcolor: '#fff',
            width: 28,
            height: 28,
            '&:hover': { bgcolor: '#eff6ff', color: COLORS.accent, borderColor: '#bfdbfe' },
          }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              borderRadius: 2,
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 12px 32px rgba(15,23,42,0.12)',
              minWidth: 280,
              maxWidth: 340,
            },
          },
        }}
      >
        <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${COLORS.border}`, bgcolor: '#f8fafc' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: COLORS.text }}>
            {name || resolveIdentityName(item)}
          </Typography>
          {meta.title && (
            <Typography sx={{ fontSize: '0.72rem', color: COLORS.muted, mt: 0.15 }}>
              {meta.title}
            </Typography>
          )}
        </Box>
        <Stack spacing={0} sx={{ py: 0.5 }}>
          {rows.map(({ icon: Icon, label, value }) => (
            <Box
              key={label}
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1.25,
                px: 2,
                py: 1,
                borderBottom: `1px solid ${COLORS.border}`,
                '&:last-child': { borderBottom: 'none' },
              }}
            >
              <Icon sx={{ fontSize: 16, color: COLORS.muted, mt: 0.15, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: COLORS.text, wordBreak: 'break-word', lineHeight: 1.4 }}>
                  {value}
                </Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Popover>
    </>
  );
}

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const daysLeft = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  return {
    label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    daysLeft,
    urgent: daysLeft <= 3 && daysLeft >= 0,
    overdue: daysLeft < 0,
  };
}

const STATUS_CONFIG = {
  approved: { label: 'Approved', bg: COLORS.approveBg, color: COLORS.approve, border: COLORS.approveBorder },
  revoked: { label: 'Revoked', bg: COLORS.revokeBg, color: COLORS.revoke, border: COLORS.revokeBorder },
  provisioning: { label: 'Revoked · In progress', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  'revoked-failed': { label: 'Revoked · Failed', bg: COLORS.revokeBg, color: COLORS.revoke, border: COLORS.revokeBorder },
  pending: { label: 'Pending', bg: COLORS.pendingBg, color: COLORS.pending, border: COLORS.border },
  submitting: { label: 'Saving…', bg: COLORS.pendingBg, color: COLORS.pending, border: COLORS.border },
  error: { label: 'Error', bg: COLORS.revokeBg, color: COLORS.revoke, border: COLORS.revokeBorder },
};

function resolveEntitlementUiState(ed) {
  const st = String(ed?.status || 'PENDING').toUpperCase();
  if (st === 'APPROVED') return 'approved';
  if (st === 'REVOKE_IN_PROGRESS') return 'provisioning';
  if (st !== 'REVOKED') return 'pending';
  const rem = ed?.remediationStatus;
  const prov = ed?.provisioningStatus;
  if (rem === 'FAILED' || prov === 'FAILED') return 'revoked-failed';
  if (rem === 'COMPLETED' && prov === 'EXECUTED') return 'revoked';
  if (['PENDING', 'RUNNING', 'WAITING_ITSM'].includes(rem) || prov === 'PENDING') {
    return 'provisioning';
  }
  return 'revoked';
}

function StatusChip({ state }) {
  const c = STATUS_CONFIG[state] || STATUS_CONFIG.pending;
  return (
    <Chip
      label={c.label}
      size="small"
      sx={{
        fontWeight: 700,
        fontSize: '0.68rem',
        height: 22,
        bgcolor: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    />
  );
}

function DecisionButton({ variant, onClick, disabled, compact = false }) {
  const isApprove = variant === 'approve';
  return (
    <Button
      size="small"
      variant="outlined"
      disabled={disabled}
      onClick={onClick}
      startIcon={isApprove ? <CheckIcon sx={{ fontSize: 15 }} /> : <CloseIcon sx={{ fontSize: 15 }} />}
      sx={{
        minWidth: compact ? 36 : 88,
        px: compact ? 0.75 : 1.5,
        py: 0.5,
        fontWeight: 700,
        fontSize: '0.72rem',
        textTransform: 'none',
        borderRadius: 1.5,
        borderColor: isApprove ? COLORS.approveBorder : COLORS.revokeBorder,
        color: isApprove ? COLORS.approve : COLORS.revoke,
        bgcolor: isApprove ? COLORS.approveBg : COLORS.revokeBg,
        '&:hover': {
          bgcolor: isApprove ? COLORS.approve : COLORS.revoke,
          color: '#fff',
          borderColor: isApprove ? COLORS.approve : COLORS.revoke,
        },
        '& .MuiButton-startIcon': compact ? { mr: 0 } : undefined,
      }}
    >
      {compact ? null : (isApprove ? 'Approve' : 'Revoke')}
    </Button>
  );
}

function StatCard({ label, value, color, bg }) {
  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        minWidth: 72,
        px: 1.5,
        py: 1.25,
        borderRadius: 2,
        border: `1px solid ${COLORS.border}`,
        bgcolor: bg || '#fff',
        textAlign: 'center',
      }}
    >
      <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1.1 }}>
        {value}
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 600, color: COLORS.muted, mt: 0.25, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
    </Paper>
  );
}

/* ── Revoke confirmation ─────────────────────────────────────────────── */
function RevokeConfirmDialog({
  open,
  onClose,
  onConfirm,
  submitting,
  title,
  subtitle,
}) {
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (open) setComment('');
  }, [open]);

  const canSubmit = comment.trim().length > 0 && !submitting;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>{title || 'Confirm revoke'}</DialogTitle>
      <DialogContent dividers>
        {subtitle && (
          <Typography sx={{ fontSize: '0.85rem', color: COLORS.muted, mb: 2 }}>{subtitle}</Typography>
        )}
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="Comment (required)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={submitting}
          sx={{ mb: 2 }}
        />
        <Typography sx={{ fontSize: '0.72rem', color: COLORS.muted }}>
          Revoke is recorded as in progress. Remediation runs from the Global Rule Set workflow mapping.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          disabled={!canSubmit}
          onClick={() => onConfirm({ comment: comment.trim() })}
        >
          {submitting ? 'Submitting…' : 'Confirm revoke'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── Entitlement table header ────────────────────────────────────────── */
function EntitlementTableHeader() {
  return (
    <Box
      sx={{
        display: { xs: 'none', sm: 'grid' },
        gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(120px, 1fr) 88px 96px',
        gap: 1.5,
        px: 2,
        py: 0.85,
        bgcolor: '#f1f5f9',
        borderTop: `1px solid ${COLORS.border}`,
        alignItems: 'center',
      }}
    >
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Application
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Access / Entitlement
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        Status
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4, textAlign: 'right' }}>
        Actions
      </Typography>
    </Box>
  );
}

/* ── Entitlement row ─────────────────────────────────────────────────── */
function EntitlementRow({ entitlementName, applicationName, state, onApprove, onRevoke }) {
  const done = state === 'approved' || state === 'revoked' || state === 'provisioning' || state === 'revoked-failed';
  const appLabel = renderText(applicationName);

  return (
    <Box
      sx={{
        display: { xs: 'block', sm: 'grid' },
        gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(120px, 1fr) 88px 96px',
        alignItems: 'center',
        gap: { xs: 0, sm: 1.5 },
        px: 2,
        py: 1.25,
        borderTop: `1px solid ${COLORS.border}`,
        bgcolor: state === 'approved' ? '#fafffe' : state === 'revoked' ? '#fffbfc' : '#fff',
        transition: 'background 0.15s',
      }}
    >
      {/* Mobile layout */}
      <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase' }}>
          Application
        </Typography>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: '#1d4ed8', mb: 0.75 }}>
          {appLabel}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: COLORS.muted, textTransform: 'uppercase' }}>
          Access
        </Typography>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: COLORS.text, mb: 1 }}>
          {entitlementName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <StatusChip state={state} />
          {state === 'submitting' ? (
            <CircularProgress size={20} />
          ) : done ? (
            state === 'approved'
              ? <CheckCircleOutlineIcon sx={{ color: COLORS.approve, fontSize: 22 }} />
              : <CancelOutlinedIcon sx={{ color: COLORS.revoke, fontSize: 22 }} />
          ) : (
            <Box sx={{ display: 'flex', gap: 0.75 }}>
              <DecisionButton variant="approve" onClick={onApprove} compact />
              <DecisionButton variant="revoke" onClick={onRevoke} compact />
            </Box>
          )}
        </Box>
      </Box>

      {/* Desktop columns */}
      <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.78rem', fontWeight: 600, color: '#1e40af', wordBreak: 'break-word' }}>
        {appLabel}
      </Typography>
      <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontSize: '0.82rem', fontWeight: 700, color: COLORS.text, wordBreak: 'break-word' }}>
        {entitlementName}
      </Typography>
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center' }}>
        <StatusChip state={state} />
      </Box>
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.75, justifyContent: 'flex-end', alignItems: 'center' }}>
        {state === 'submitting' ? (
          <CircularProgress size={20} />
        ) : done ? (
          state === 'approved'
            ? <CheckCircleOutlineIcon sx={{ color: COLORS.approve, fontSize: 22 }} />
            : <CancelOutlinedIcon sx={{ color: COLORS.revoke, fontSize: 22 }} />
        ) : (
          <>
            <DecisionButton variant="approve" onClick={onApprove} compact />
            <DecisionButton variant="revoke" onClick={onRevoke} compact />
          </>
        )}
      </Box>
    </Box>
  );
}

/* ── Identity card (entitlement mode) ────────────────────────────────── */
function IdentityCard({ item, index, entitlementStates, onDecideEntitlement, onRequestRevoke, onDecide, onApproveAll, onRequestRevokeAll }) {
  const name = resolveIdentityName(item);
  const meta = resolveIdentityMeta(item);
  const eds = item.entitlementDecisions || [];

  if (eds.length === 0) {
    return (
      <LegacyItemCard
        item={item}
        index={index}
        onDecide={onDecide}
        onRequestRevoke={onRequestRevoke}
      />
    );
  }

  const states = eds.map((ed) => entitlementStates.get(`${item.reviewItemId}::${ed.entitlementName}`) || 'pending');
  const pending = states.filter((s) => s === 'pending' || s === 'submitting').length;
  const approved = states.filter((s) => s === 'approved').length;
  const revoked = states.filter((s) => s === 'revoked' || s === 'provisioning' || s === 'revoked-failed').length;
  const allDone = pending === 0;

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2.5,
        border: `1px solid ${allDone ? (revoked > 0 ? COLORS.revokeBorder : COLORS.approveBorder) : COLORS.border}`,
        overflow: 'hidden',
        bgcolor: COLORS.card,
      }}
    >
      {/* Identity header */}
      <Box sx={{ px: 2, py: 1.75, bgcolor: '#f8fafc', borderBottom: `1px solid ${COLORS.border}` }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Avatar
            sx={{
              width: 40,
              height: 40,
              bgcolor: '#dbeafe',
              color: '#1d4ed8',
              fontWeight: 800,
              fontSize: '0.85rem',
              flexShrink: 0,
            }}
          >
            {getInitials(name)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: '0.92rem', color: COLORS.text, lineHeight: 1.3 }}>
                  {name}
                </Typography>
                {meta.title && (
                  <Typography sx={{ fontSize: '0.72rem', color: COLORS.muted, mt: 0.2, fontWeight: 600 }}>
                    {meta.title}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, alignItems: 'center' }}>
                {approved > 0 && <Chip label={`${approved} ✓`} size="small" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: COLORS.approveBg, color: COLORS.approve }} />}
                {revoked > 0 && <Chip label={`${revoked} ✗`} size="small" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: COLORS.revokeBg, color: COLORS.revoke }} />}
                {pending > 0 && <Chip label={`${pending} pending`} size="small" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: '#fef9c3', color: '#a16207' }} />}
                <UserInfoPopover item={item} name={name} />
              </Box>
            </Box>
            {pending > 0 && (
              <Box sx={{ display: 'flex', gap: 0.75, mt: 1.25 }}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CheckIcon sx={{ fontSize: 14 }} />}
                  onClick={() => onApproveAll(item)}
                  sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'none', py: 0.25, borderColor: COLORS.approveBorder, color: COLORS.approve }}
                >
                  Approve all
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<CloseIcon sx={{ fontSize: 14 }} />}
                  onClick={() => onRequestRevokeAll(item)}
                  sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'none', py: 0.25, borderColor: COLORS.revokeBorder, color: COLORS.revoke }}
                >
                  Revoke all
                </Button>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <EntitlementTableHeader />
      {eds.map((ed) => {
        const key = `${item.reviewItemId}::${ed.entitlementName}`;
        const state = entitlementStates.get(key) || 'pending';
        return (
          <EntitlementRow
            key={ed.entitlementName}
            entitlementName={ed.entitlementName}
            applicationName={ed.applicationName || item.appName}
            state={state}
            onApprove={() => onDecideEntitlement(item, ed.entitlementName, 'Approved')}
            onRevoke={() => onRequestRevoke(item, ed.entitlementName)}
          />
        );
      })}
    </Paper>
  );
}

/* ── Legacy flat item card ───────────────────────────────────────────── */
function LegacyItemCard({ item, index, onDecide, onRequestRevoke }) {
  const state = item.status;
  const name = resolveIdentityName(item);
  const done = state === 'approved' || state === 'revoked';

  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2.5,
        border: `1px solid ${done ? (state === 'approved' ? COLORS.approveBorder : COLORS.revokeBorder) : COLORS.border}`,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 2, py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
          <Avatar sx={{ width: 36, height: 36, bgcolor: '#dbeafe', color: '#1d4ed8', fontWeight: 800, fontSize: '0.8rem' }}>
            {getInitials(name)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 140 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: COLORS.text }}>{name}</Typography>
              <UserInfoPopover item={item} name={name} />
            </Box>
            <IdentityMetaSummary item={item} />
            {Array.isArray(item.accessDetails) && item.accessDetails.length > 0 ? (
              <Typography sx={{ fontSize: '0.68rem', color: COLORS.muted, mt: 0.75 }}>
                Access: {renderAccessDetails(item.accessDetails)}
              </Typography>
            ) : item.reviewItemType === 'NO_ACCESS' ? (
              <Typography sx={{ fontSize: '0.68rem', color: COLORS.muted, mt: 0.75, fontStyle: 'italic' }}>
                No application entitlements on record for this identity.
              </Typography>
            ) : null}
            {item.error && (
              <Typography sx={{ fontSize: '0.68rem', color: COLORS.revoke, mt: 0.35 }}>{item.error}</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <StatusChip state={state} />
            {state === 'submitting' ? (
              <CircularProgress size={20} />
            ) : done ? (
              state === 'approved'
                ? <CheckCircleOutlineIcon sx={{ color: COLORS.approve, fontSize: 22 }} />
                : <CancelOutlinedIcon sx={{ color: COLORS.revoke, fontSize: 22 }} />
            ) : (
              <Box sx={{ display: 'flex', gap: 0.75 }}>
                <DecisionButton
                  variant="approve"
                  onClick={() => onDecide(item, 'Approved')}
                />
                {Array.isArray(item?.accessDetails) && item.accessDetails.length > 0 && (
                  <DecisionButton
                    variant="revoke"
                    onClick={() => (onRequestRevoke ? onRequestRevoke(item) : onDecide(item, 'Revoked'))}
                  />
                )}
              </Box>
            )}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}

/* ── Main page ───────────────────────────────────────────────────────── */
export default function CertDecisionPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const bulkIntent = params.get('bulk') || '';
  const { branding, refreshBranding } = useBranding();

  useEffect(() => {
    refreshBranding();
  }, [refreshBranding]);

  const [phase, setPhase] = useState('loading');
  const [campaign, setCampaign] = useState(null);
  const [reviewer, setReviewer] = useState(null);
  const [items, setItems] = useState([]);
  const [showNoAccess, setShowNoAccess] = useState(true);
  const [accessViewMode, setAccessViewMode] = useState('ALL'); // ALL | WITH_ACCESS | WITHOUT_ACCESS
  const [entitlementStates, setEntitlementStates] = useState(new Map());
  const [bulkTokens, setBulkTokens] = useState({ approveAll: null, revokeAll: null });
  const [bulkLoading, setBulkLoading] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [errMsg, setErrMsg] = useState('');
  const [jwtMode, setJwtMode] = useState(false);
  const [bulkAutoTriggered, setBulkAutoTriggered] = useState(false);
  const [revokeDialog, setRevokeDialog] = useState(null);
  const [revokeSubmitting, setRevokeSubmitting] = useState(false);

  const isReviewerJwt = (t) => typeof t === 'string' && t.split('.').length >= 3 && t.includes('.');

  /* ── Load portal data ── */
  useEffect(() => {
    if (!token) { setPhase('error'); setErrMsg('No token provided.'); return; }

    const useJwt = isReviewerJwt(token);
    setJwtMode(useJwt);

    const load = useJwt
      ? API.get(`/certifications/review?token=${encodeURIComponent(token)}`)
      : API.get(`/certifications/reviewer-portal?token=${encodeURIComponent(token)}`);

    load.then(({ data }) => {
      const d = data.data;
      setCampaign(d.campaign);
      setReviewer(d.reviewer);
      setExpiresAt(d.expiresAt);
      setBulkTokens(d.bulkTokens || { approveAll: null, revokeAll: null });

      let mapped;
      if (useJwt) {
        mapped = (d.items || []).map((i) => ({
          ...i,
          sessionToken: token,
          status:
            i.status === 'PENDING' ? 'pending'
            : i.status === 'REVOKED' || i.status === 'REVOKE_IN_PROGRESS' ? 'revoked'
            : (i.status === 'APPROVED' || i.status === 'DELEGATED' || i.status === 'EXCEPTION') ? 'approved'
            : 'pending',
        }));
      } else {
        mapped = (d.items || []).map((i) => ({ ...i, status: 'pending' }));
      }
      mapped = mapped.map(normalizePortalItem);
      setItems(mapped);

      const initMap = new Map();
      mapped.forEach((item) => {
        (item.entitlementDecisions || []).forEach((ed) => {
          initMap.set(`${item.reviewItemId}::${ed.entitlementName}`, resolveEntitlementUiState(ed));
        });
      });
      setEntitlementStates(initMap);

      setPhase(mapped.length === 0 ? 'done' : 'portal');
    }).catch((err) => {
      setErrMsg(err.response?.data?.message || 'This link is invalid or has expired.');
      setPhase('error');
    });
  }, [token]);

  /* ── Derived values ── */
  const hasEntitlementMode = useMemo(
    () => items.some((i) => Array.isArray(i.entitlementDecisions) && i.entitlementDecisions.length > 0),
    [items],
  );

  // True while any entitlement's remediation workflow is still running/waiting.
  const hasProvisioning = useMemo(
    () => [...entitlementStates.values()].some((s) => s === 'provisioning'),
    [entitlementStates],
  );

  /* ── Poll remediation progress while a revoke workflow is in flight ── */
  useEffect(() => {
    if (phase !== 'portal' || !hasProvisioning) return undefined;
    const url = jwtMode
      ? `/certifications/review?token=${encodeURIComponent(token)}`
      : `/certifications/reviewer-portal?token=${encodeURIComponent(token)}`;
    const id = setInterval(() => {
      API.get(url)
        .then(({ data }) => {
          const d = data.data;
          setEntitlementStates((prev) => {
            const m = new Map(prev);
            (d.items || []).forEach((item) => {
              (item.entitlementDecisions || []).forEach((ed) => {
                const key = `${item.reviewItemId}::${ed.entitlementName}`;
                // Only advance entries that are still waiting on remediation.
                if (m.get(key) === 'provisioning') {
                  m.set(key, resolveEntitlementUiState(ed));
                }
              });
            });
            return m;
          });
        })
        .catch(() => {});
    }, 8000);
    return () => clearInterval(id);
  }, [phase, hasProvisioning, jwtMode, token]);

  const isNoAccessItem = useCallback((item) => {
    const access = Array.isArray(item?.accessDetails) ? item.accessDetails : [];
    const eds = Array.isArray(item?.entitlementDecisions) ? item.entitlementDecisions : [];
    return access.length === 0 && eds.length === 0;
  }, []);

  const visibleItems = useMemo(() => {
    if (accessViewMode === 'WITHOUT_ACCESS') return items.filter((i) => isNoAccessItem(i));
    if (accessViewMode === 'WITH_ACCESS') return items.filter((i) => !isNoAccessItem(i));
    // ALL
    if (showNoAccess) return items;
    return items.filter((i) => !isNoAccessItem(i));
  }, [items, showNoAccess, isNoAccessItem, accessViewMode]);

  const { totalCount, pendingCount, reviewedCount, approvedCount, revokedCount } = useMemo(() => {
    if (!hasEntitlementMode) {
      const pending = visibleItems.filter((i) => i.status === 'pending' || i.status === 'submitting').length;
      const approved = visibleItems.filter((i) => i.status === 'approved').length;
      const revoked = visibleItems.filter((i) => i.status === 'revoked').length;
      return {
        totalCount: visibleItems.length,
        pendingCount: pending,
        reviewedCount: approved + revoked,
        approvedCount: approved,
        revokedCount: revoked,
      };
    }
    let total = 0, pending = 0, approved = 0, revoked = 0;
    for (const item of visibleItems) {
      const eds = item.entitlementDecisions || [];
      if (eds.length > 0) {
        for (const ed of eds) {
          total++;
          const st = entitlementStates.get(`${item.reviewItemId}::${ed.entitlementName}`) || 'pending';
          if (st === 'pending' || st === 'submitting') pending++;
          else if (st === 'approved') approved++;
          else if (st === 'revoked' || st === 'provisioning' || st === 'revoked-failed') revoked++;
        }
      } else {
        total++;
        if (item.status === 'pending' || item.status === 'submitting') pending++;
        else if (item.status === 'approved') approved++;
        else if (item.status === 'revoked') revoked++;
      }
    }
    return { totalCount: total, pendingCount: pending, reviewedCount: approved + revoked, approvedCount: approved, revokedCount: revoked };
  }, [visibleItems, entitlementStates, hasEntitlementMode]);

  const progress = totalCount > 0 ? (reviewedCount / totalCount) * 100 : 0;
  const dueInfo = useMemo(() => formatDueDate(campaign?.dueDate), [campaign?.dueDate]);

  useEffect(() => {
    if (phase === 'portal' && totalCount > 0 && pendingCount === 0) {
      setPhase('done');
    }
  }, [phase, totalCount, pendingCount]);

  useEffect(() => {
    if (phase === 'portal' && bulkIntent && !bulkAutoTriggered) {
      setBulkAutoTriggered(true);
    }
  }, [phase, bulkIntent, bulkAutoTriggered]);

  /* ── Entitlement decision ── */
  const handleDecideEntitlement = useCallback(async (item, entitlementName, decision, opts = {}) => {
    const key = `${item.reviewItemId}::${entitlementName}`;
    setEntitlementStates((prev) => { const m = new Map(prev); m.set(key, 'submitting'); return m; });
    try {
      await API.post('/certifications/entitlement-decision', {
        token: item.sessionToken,
        reviewItemId: item.reviewItemId,
        entitlementName,
        decision,
        comment: opts.comment || '',
      });
      setEntitlementStates((prev) => {
        const m = new Map(prev);
        const next = decision === 'Approved' ? 'approved' : 'provisioning';
        m.set(key, next);
        return m;
      });
    } catch (err) {
      setEntitlementStates((prev) => { const m = new Map(prev); m.set(key, 'pending'); return m; });
      setErrMsg(err.response?.data?.message || 'Failed to save decision. Please try again.');
      setTimeout(() => setErrMsg(''), 4000);
      throw err;
    }
  }, []);

  const openRevokeDialog = useCallback((target) => {
    setRevokeDialog(target);
  }, []);

  const itemKey = (i) => i.reviewItemId || i.token;

  const handleDecide = useCallback(async (item, decision, opts = {}) => {
    const k = itemKey(item);
    setItems((prev) => prev.map((i) => itemKey(i) === k ? { ...i, status: 'submitting', error: undefined } : i));
    try {
      if (item.reviewItemId && item.sessionToken) {
        await API.post('/certifications/decision', {
          token: item.sessionToken,
          reviewItemId: item.reviewItemId,
          decision,
          comment: opts.comment || '',
        });
      } else {
        await API.post('/certifications/email-review', { token: item.token, decision });
      }
      setItems((prev) => prev.map((i) => itemKey(i) === k ? { ...i, status: decision === 'Approved' ? 'approved' : 'revoked' } : i));
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save decision.';
      setItems((prev) => prev.map((i) => itemKey(i) === k ? { ...i, status: 'pending', error: msg } : i));
      throw err;
    }
  }, []);

  const handleRevokeDialogConfirm = useCallback(async ({ comment }) => {
    if (!revokeDialog) return;
    setRevokeSubmitting(true);
    try {
      if (revokeDialog.type === 'entitlement') {
        await handleDecideEntitlement(
          revokeDialog.item,
          revokeDialog.entitlementName,
          'Revoked',
          { comment },
        );
      } else if (revokeDialog.type === 'identity') {
        const eds = revokeDialog.item.entitlementDecisions || [];
        for (const ed of eds) {
          const key = `${revokeDialog.item.reviewItemId}::${ed.entitlementName}`;
          const st = entitlementStates.get(key) || 'pending';
          if (st === 'pending') {
            await handleDecideEntitlement(
              revokeDialog.item,
              ed.entitlementName,
              'Revoked',
              { comment },
            );
          }
        }
      } else if (revokeDialog.type === 'bulk') {
        const endpoint = hasEntitlementMode
          ? '/certifications/bulk-entitlement-decision'
          : '/certifications/bulk-decision';
        await API.post(endpoint, {
          token,
          decision: 'Revoked',
          comment,
        });
        if (hasEntitlementMode) {
          setEntitlementStates((prev) => {
            const m = new Map(prev);
            items.forEach((item) => {
              (item.entitlementDecisions || []).forEach((ed) => {
                const k = `${item.reviewItemId}::${ed.entitlementName}`;
                if ((m.get(k) || 'pending') === 'pending') m.set(k, 'provisioning');
              });
            });
            return m;
          });
        } else {
          setItems((prev) =>
            prev.map((i) => (i.status === 'pending' ? { ...i, status: 'revoked' } : i)),
          );
        }
        setPhase('done');
      } else if (revokeDialog.type === 'legacy') {
        await handleDecide(revokeDialog.item, 'Revoked', { comment });
      }
      setRevokeDialog(null);
    } catch {
      // error surfaced by handlers
    } finally {
      setRevokeSubmitting(false);
    }
  }, [revokeDialog, handleDecideEntitlement, handleDecide, entitlementStates, hasEntitlementMode, token, items]);

  const handleDecideAllForIdentity = useCallback((item) => {
    openRevokeDialog({ type: 'identity', item });
  }, [openRevokeDialog]);

  const handleBulk = useCallback(async (type) => {
    if (type === 'revoke') {
      openRevokeDialog({ type: 'bulk' });
      return;
    }
    if (jwtMode) {
      setBulkLoading(type);
      try {
        const decision = type === 'approve' ? 'Approved' : 'Revoked';
        const endpoint = hasEntitlementMode
          ? '/certifications/bulk-entitlement-decision'
          : '/certifications/bulk-decision';
        await API.post(endpoint, { token, decision });

        if (hasEntitlementMode) {
          setEntitlementStates((prev) => {
            const m = new Map(prev);
            items.forEach((item) => {
              (item.entitlementDecisions || []).forEach((ed) => {
                const k = `${item.reviewItemId}::${ed.entitlementName}`;
                if ((m.get(k) || 'pending') === 'pending') {
                  m.set(k, type === 'approve' ? 'approved' : 'revoked');
                }
              });
            });
            return m;
          });
        } else {
          setItems((prev) =>
            prev.map((i) => i.status === 'pending' ? { ...i, status: type === 'approve' ? 'approved' : 'revoked' } : i),
          );
        }
        setPhase('done');
      } catch (err) {
        setErrMsg(err.response?.data?.message || 'Bulk action failed.');
      } finally {
        setBulkLoading(null);
      }
      return;
    }

    const bulkToken = type === 'approve' ? bulkTokens.approveAll : bulkTokens.revokeAll;
    if (!bulkToken) return;
    setBulkLoading(type);
    try {
      await API.post('/certifications/email-bulk', { token: bulkToken });
      setItems((prev) =>
        prev.map((i) => i.status === 'pending' ? { ...i, status: type === 'approve' ? 'approved' : 'revoked' } : i),
      );
      setPhase('done');
    } catch (err) {
      setErrMsg(err.response?.data?.message || 'Bulk action failed.');
    } finally {
      setBulkLoading(null);
    }
  }, [bulkTokens, hasEntitlementMode, items, jwtMode, token, openRevokeDialog]);

  const doneApproved = hasEntitlementMode
    ? [...entitlementStates.values()].filter((s) => s === 'approved').length
    : visibleItems.filter((i) => i.status === 'approved').length;
  const doneRevoked = hasEntitlementMode
    ? [...entitlementStates.values()].filter((s) => s === 'revoked').length
    : visibleItems.filter((i) => i.status === 'revoked').length;

  const platformUrl = campaign
    ? `${FRONTEND_URL}/governance/certifications/access?campaign=${campaign.id}`
    : `${FRONTEND_URL}/governance/certifications/access`;

  const showBulkBar = (jwtMode || bulkTokens.approveAll || bulkTokens.revokeAll) && pendingCount > 0;

  return (
    <Box sx={{
      minHeight: '100vh',
      bgcolor: COLORS.pageBg,
      backgroundImage: 'radial-gradient(ellipse at top, #ffffff 0%, #f0f4f8 60%)',
    }}>
      {/* Top bar */}
      <Box sx={{
        background: COLORS.header,
        px: { xs: 2, sm: 3 },
        py: 1.75,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
      }}>
        {branding.logoUrl ? (
          <Box
            component="img"
            src={branding.logoUrl}
            alt={branding.companyName || 'Wisibility'}
            sx={{
              height: 38,
              maxWidth: 180,
              objectFit: 'contain',
              display: 'block',
            }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: 2,
              bgcolor: 'rgba(37,99,235,0.25)',
              border: '1px solid rgba(96,165,250,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ShieldOutlinedIcon sx={{ color: '#93c5fd', fontSize: 20 }} />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#f8fafc', lineHeight: 1.2, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                {branding.companyName || 'WISIBILITY'}
              </Typography>
              <Typography sx={{ fontSize: '0.62rem', color: '#94a3b8', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {BRANDING.tagline || 'ADSecurity'}
              </Typography>
            </Box>
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: '0.68rem', color: '#94a3b8', fontWeight: 500, display: { xs: 'none', sm: 'block' } }}>
          Access Certification Portal
        </Typography>
        {campaign && (
          <Tooltip title="Open in Platform">
            <IconButton size="small" href={platformUrl} target="_blank" sx={{ color: '#64748b', '&:hover': { color: '#f8fafc' } }}>
              <OpenInNewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box sx={{ maxWidth: 860, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2.5, sm: 4 } }}>
        {/* Loading */}
        {phase === 'loading' && (
          <Card sx={{ borderRadius: 3, p: 6, textAlign: 'center', border: `1px solid ${COLORS.border}` }}>
            <CircularProgress size={36} sx={{ color: COLORS.accent }} />
            <Typography sx={{ mt: 2, color: COLORS.muted, fontSize: '0.88rem' }}>
              Loading your review items…
            </Typography>
          </Card>
        )}

        {/* Portal */}
        {phase === 'portal' && campaign && (
          <Stack spacing={2.5}>
            {/* Campaign hero card */}
            <Card sx={{ borderRadius: 3, border: `1px solid ${COLORS.border}`, overflow: 'hidden', boxShadow: '0 4px 24px rgba(15,23,42,0.06)' }}>
              <Box sx={{ px: 2.5, py: 2.25 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', color: COLORS.text, lineHeight: 1.25 }}>
                      {campaign.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                      <Chip
                        label={getCategoryLabel(campaign.category)}
                        size="small"
                        sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: '0.68rem', height: 22 }}
                      />
                      {dueInfo && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <CalendarTodayOutlinedIcon sx={{ fontSize: 13, color: dueInfo.overdue ? COLORS.revoke : dueInfo.urgent ? '#d97706' : COLORS.muted }} />
                          <Typography sx={{
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: dueInfo.overdue ? COLORS.revoke : dueInfo.urgent ? '#d97706' : COLORS.muted,
                          }}>
                            Due {dueInfo.label}
                            {dueInfo.overdue ? ' (overdue)' : dueInfo.urgent ? ` (${dueInfo.daysLeft}d left)` : ''}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                  <Paper
                    elevation={0}
                    sx={{
                      px: 1.75, py: 1.25, borderRadius: 2,
                      border: `1px solid ${COLORS.border}`, bgcolor: '#f8fafc',
                      display: 'flex', alignItems: 'center', gap: 1,
                    }}
                  >
                    <PersonOutlineIcon sx={{ fontSize: 18, color: COLORS.muted }} />
                    <Box>
                      <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Reviewing as
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: COLORS.text }}>
                        {reviewer?.name || reviewer?.email}
                      </Typography>
                      {reviewer?.name && reviewer?.email && (
                        <Typography sx={{ fontSize: '0.68rem', color: COLORS.muted }}>{reviewer.email}</Typography>
                      )}
                    </Box>
                  </Paper>
                </Box>

                {/* Stats row */}
                <Box sx={{ display: 'flex', gap: 1, mt: 2.25, flexWrap: 'wrap', alignItems: 'center' }}>
                  <StatCard label="Pending" value={pendingCount} color="#d97706" bg="#fffbeb" />
                  <StatCard label="Approved" value={approvedCount} color={COLORS.approve} bg={COLORS.approveBg} />
                  <StatCard label="Revoked" value={revokedCount} color={COLORS.revoke} bg={COLORS.revokeBg} />
                  <StatCard label="Total" value={totalCount} color={COLORS.text} />
                  <Box sx={{ flex: 1 }} />
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={accessViewMode}
                    onChange={(_, v) => { if (v) setAccessViewMode(v); }}
                    sx={{ bgcolor: '#fff' }}
                  >
                    <ToggleButton value="ALL" sx={{ textTransform: 'none', fontWeight: 800, fontSize: '0.72rem' }}>
                      All
                    </ToggleButton>
                    <ToggleButton value="WITH_ACCESS" sx={{ textTransform: 'none', fontWeight: 800, fontSize: '0.72rem' }}>
                      With access
                    </ToggleButton>
                    <ToggleButton value="WITHOUT_ACCESS" sx={{ textTransform: 'none', fontWeight: 800, fontSize: '0.72rem' }}>
                      Without access
                    </ToggleButton>
                  </ToggleButtonGroup>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setShowNoAccess((v) => !v)}
                    disabled={accessViewMode !== 'ALL'}
                    sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}
                  >
                    {showNoAccess ? 'Hide users with no access' : 'Show users with no access'}
                  </Button>
                </Box>

                {/* Progress */}
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: COLORS.muted }}>
                      {hasEntitlementMode ? 'Progress (per entitlement)' : 'Overall progress'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: COLORS.text }}>
                      {Math.round(progress)}% · {reviewedCount}/{totalCount}
                    </Typography>
                  </Box>
                  <LinearProgress
                    variant="determinate"
                    value={progress}
                    sx={{
                      height: 10, borderRadius: 5, bgcolor: '#e2e8f0',
                      '& .MuiLinearProgress-bar': {
                        borderRadius: 5,
                        bgcolor: progress === 100 ? COLORS.approve : COLORS.accent,
                        transition: 'width 0.4s ease',
                      },
                    }}
                  />
                </Box>
              </Box>
            </Card>

            {/* Error alert */}
            {errMsg && (
              <Alert severity="error" onClose={() => setErrMsg('')} sx={{ borderRadius: 2 }}>
                {errMsg}
              </Alert>
            )}

            {/* Bulk actions */}
            {showBulkBar && (
              <Paper
                elevation={0}
                sx={{
                  px: 2, py: 1.75, borderRadius: 2.5,
                  border: `1px solid ${bulkIntent ? '#fde68a' : COLORS.border}`,
                  bgcolor: bulkIntent ? '#fffbeb' : '#fff',
                  display: 'flex', gap: 1.25, flexWrap: 'wrap', alignItems: 'center',
                  position: 'sticky', top: 12, zIndex: 10,
                  boxShadow: '0 2px 12px rgba(15,23,42,0.06)',
                }}
              >
                <PendingActionsOutlinedIcon sx={{ fontSize: 20, color: COLORS.muted }} />
                <Typography sx={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: COLORS.text, minWidth: 140 }}>
                  {bulkIntent
                    ? (bulkIntent === 'approve_all' ? 'Confirm: Approve all pending items' : 'Confirm: Revoke all pending items')
                    : `${pendingCount} item${pendingCount !== 1 ? 's' : ''} awaiting your decision`}
                </Typography>
                {(jwtMode || bulkTokens.approveAll) && (
                  <Button
                    variant={bulkIntent === 'approve_all' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={bulkLoading === 'approve' ? <CircularProgress size={14} color="inherit" /> : <CheckIcon />}
                    disabled={!!bulkLoading}
                    onClick={() => handleBulk('approve')}
                    sx={{
                      fontWeight: 700, textTransform: 'none', fontSize: '0.78rem',
                      bgcolor: bulkIntent === 'approve_all' ? COLORS.approve : undefined,
                      borderColor: COLORS.approveBorder, color: bulkIntent === 'approve_all' ? '#fff' : COLORS.approve,
                      '&:hover': { bgcolor: COLORS.approve, color: '#fff', borderColor: COLORS.approve },
                    }}
                  >
                    Approve All ({pendingCount})
                  </Button>
                )}
                {(jwtMode || bulkTokens.revokeAll) && (
                  <Button
                    variant={bulkIntent === 'revoke_all' ? 'contained' : 'outlined'}
                    size="small"
                    startIcon={bulkLoading === 'revoke' ? <CircularProgress size={14} color="inherit" /> : <CloseIcon />}
                    disabled={!!bulkLoading}
                    onClick={() => handleBulk('revoke')}
                    sx={{
                      fontWeight: 700, textTransform: 'none', fontSize: '0.78rem',
                      bgcolor: bulkIntent === 'revoke_all' ? COLORS.revoke : undefined,
                      borderColor: COLORS.revokeBorder, color: bulkIntent === 'revoke_all' ? '#fff' : COLORS.revoke,
                      '&:hover': { bgcolor: COLORS.revoke, color: '#fff', borderColor: COLORS.revoke },
                    }}
                  >
                    Revoke All ({pendingCount})
                  </Button>
                )}
              </Paper>
            )}

            {/* Review items */}
            <Stack spacing={2}>
              {hasEntitlementMode
                ? visibleItems.map((item, idx) => (
                    <IdentityCard
                      key={item.reviewItemId || item.token || idx}
                      item={item}
                      index={idx}
                      entitlementStates={entitlementStates}
                      onDecideEntitlement={handleDecideEntitlement}
                      onRequestRevoke={(it, ent) => openRevokeDialog({ type: 'entitlement', item: it, entitlementName: ent })}
                      onDecide={handleDecide}
                      onApproveAll={(it) => {
                        const eds = it.entitlementDecisions || [];
                        eds.forEach((ed) => {
                          const key = `${it.reviewItemId}::${ed.entitlementName}`;
                          if ((entitlementStates.get(key) || 'pending') === 'pending') {
                            handleDecideEntitlement(it, ed.entitlementName, 'Approved');
                          }
                        });
                      }}
                      onRequestRevokeAll={handleDecideAllForIdentity}
                    />
                  ))
                : visibleItems.map((item, idx) => (
                    <LegacyItemCard
                      key={item.reviewItemId || item.token || idx}
                      item={item}
                      index={idx}
                      onDecide={handleDecide}
                      onRequestRevoke={(it) => openRevokeDialog({ type: 'legacy', item: it })}
                    />
                  ))
              }
            </Stack>

            {/* Footer */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, pt: 1, pb: 2 }}>
              <Typography sx={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                {expiresAt
                  ? `Session expires ${new Date(expiresAt).toLocaleString()}`
                  : jwtMode ? 'Secured reviewer session · no login required' : 'Links expire soon'}
              </Typography>
              <Button
                size="small"
                endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                href={platformUrl}
                target="_blank"
                sx={{ textTransform: 'none', fontSize: '0.72rem', color: COLORS.accent, fontWeight: 600 }}
              >
                Open Platform
              </Button>
            </Box>
          </Stack>
        )}

        {/* Done */}
        {phase === 'done' && (
          <Card sx={{ borderRadius: 3, p: { xs: 4, sm: 5 }, textAlign: 'center', border: `1px solid ${COLORS.approveBorder}`, bgcolor: '#fafffe' }}>
            <Box sx={{
              width: 72, height: 72, borderRadius: '50%', bgcolor: COLORS.approveBg,
              border: `2px solid ${COLORS.approveBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
            }}>
              <CheckCircleOutlineIcon sx={{ fontSize: 40, color: COLORS.approve }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', color: COLORS.text }}>
              Review Complete
            </Typography>
            <Typography sx={{ fontSize: '0.88rem', color: COLORS.muted, mt: 0.75, maxWidth: 360, mx: 'auto' }}>
              All assigned items have been reviewed. Thank you — you can safely close this tab.
            </Typography>
            {campaign && (
              <>
                <Divider sx={{ my: 2.5 }} />
                <Typography sx={{ fontSize: '0.78rem', color: COLORS.muted, mb: 1.5 }}>{campaign.name}</Typography>
                <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {doneApproved > 0 && (
                    <Chip label={`${doneApproved} Approved`} sx={{ bgcolor: COLORS.approveBg, color: COLORS.approve, fontWeight: 700, fontSize: '0.75rem' }} />
                  )}
                  {doneRevoked > 0 && (
                    <Chip label={`${doneRevoked} Revoked`} sx={{ bgcolor: COLORS.revokeBg, color: COLORS.revoke, fontWeight: 700, fontSize: '0.75rem' }} />
                  )}
                </Box>
              </>
            )}
            <Button
              variant="outlined"
              size="small"
              endIcon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
              href={platformUrl}
              target="_blank"
              sx={{ mt: 2.5, textTransform: 'none', fontWeight: 600, borderColor: COLORS.border }}
            >
              View Campaign in Platform
            </Button>
          </Card>
        )}

        {/* Error */}
        {phase === 'error' && (
          <Card sx={{ borderRadius: 3, p: { xs: 4, sm: 5 }, textAlign: 'center', border: `1px solid ${COLORS.revokeBorder}` }}>
            <Box sx={{
              width: 72, height: 72, borderRadius: '50%', bgcolor: COLORS.revokeBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2,
            }}>
              <ErrorOutlineIcon sx={{ fontSize: 40, color: COLORS.revoke }} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: COLORS.text }}>
              Unable to Load
            </Typography>
            <Typography sx={{ fontSize: '0.88rem', color: COLORS.muted, mt: 1, maxWidth: 400, mx: 'auto' }}>
              {errMsg}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: '#94a3b8', mt: 1.5 }}>
              This link may have expired. Please contact your campaign owner for a new link.
            </Typography>
          </Card>
        )}
      </Box>

      <RevokeConfirmDialog
        open={Boolean(revokeDialog)}
        onClose={() => !revokeSubmitting && setRevokeDialog(null)}
        onConfirm={handleRevokeDialogConfirm}
        submitting={revokeSubmitting}
        title={
          revokeDialog?.type === 'bulk'
            ? 'Revoke all pending access'
            : revokeDialog?.type === 'identity'
              ? 'Revoke all entitlements for this user'
              : 'Confirm revoke'
        }
        subtitle={
          revokeDialog?.type === 'entitlement'
            ? `${revokeDialog.entitlementName} — ${resolveIdentityName(revokeDialog.item)}`
            : revokeDialog?.type === 'identity'
              ? resolveIdentityName(revokeDialog.item)
              : revokeDialog?.type === 'bulk'
                ? `${pendingCount} pending entitlement(s) will be revoked`
                : undefined
        }
      />
    </Box>
  );
}
