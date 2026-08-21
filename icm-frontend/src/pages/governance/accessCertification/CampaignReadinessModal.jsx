/**
 * CampaignReadinessModal
 *
 * Pre-activation readiness report for PROFILE-scope campaigns.
 * Shown after the admin clicks "Start Campaign" on the wizard review step.
 *
 * Displays:
 *  - Total identities & review items (entitlements)
 *  - Email coverage %
 *  - Manager coverage % (for DEFAULT routing)
 *  - How many identities route to backup reviewer
 *  - Warnings when coverage is below enterprise thresholds
 *
 * The admin must explicitly click "Activate Campaign" to proceed.
 * Activating is disabled only when email coverage is critically low (< 10%).
 */

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  LinearProgress,
  Chip,
  Stack,
  Alert,
  CircularProgress,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon       from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon       from '@mui/icons-material/ErrorOutline';
import PeopleAltIcon          from '@mui/icons-material/PeopleAlt';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import ManageAccountsIcon     from '@mui/icons-material/ManageAccounts';
import EmailIcon              from '@mui/icons-material/Email';

/* ── Thresholds ─────────────────────────────────────────────── */
const MANAGER_WARN_THRESHOLD = 80;   // % below this → warning
const EMAIL_WARN_THRESHOLD   = 95;   // % below this → warning
const EMAIL_ERROR_THRESHOLD  = 10;   // % below this → block activation

/* ── Coverage Indicator ─────────────────────────────────────── */
function CoverageRow({ icon, label, percent, missing, warnThreshold, errorThreshold }) {
  const isError   = percent < (errorThreshold ?? 0);
  const isWarning = !isError && percent < warnThreshold;
  const isGood    = !isError && !isWarning;

  const color = isError ? 'error' : isWarning ? 'warning' : 'success';
  const StatusIcon = isError
    ? ErrorOutlineIcon
    : isWarning
    ? WarningAmberIcon
    : CheckCircleOutlineIcon;

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {icon}
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <StatusIcon fontSize="small" color={color} />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: `${color}.main` }}
          >
            {percent}%
          </Typography>
          {missing > 0 && (
            <Chip
              label={`${missing} missing`}
              size="small"
              color={isError ? 'error' : isWarning ? 'warning' : 'default'}
              variant="outlined"
            />
          )}
        </Box>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        color={color}
        sx={{ height: 6, borderRadius: 1 }}
      />
    </Box>
  );
}

/* ── Metric Row ─────────────────────────────────────────────── */
function MetricRow({ label, value, subtext }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        py: 0.75,
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ textAlign: 'right' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </Typography>
        {subtext && (
          <Typography variant="caption" color="text.secondary" display="block">
            {subtext}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/* ── Main Component ─────────────────────────────────────────── */
/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   onActivate: () => void,
 *   activating: boolean,
 *   readiness: {
 *     totalIdentities: number,
 *     totalReviewItems: number,
 *     managerResolved: number,
 *     managerMissing: number,
 *     emailMissing: number,
 *     backupReviewerEmail: string | null,
 *     managerCoveragePercent: number,
 *     emailCoveragePercent: number,
 *   } | null,
 *   readinessLoading: boolean,
 *   showManagerCoverage?: boolean,   // false for MANAGER cert (manager is always known)
 * }} props
 */
export default function CampaignReadinessModal({
  open,
  onClose,
  onActivate,
  activating = false,
  readiness = null,
  readinessLoading = false,
  showManagerCoverage = true,
}) {
  const emailCoverage   = readiness?.emailCoveragePercent   ?? 100;
  const managerCoverage = readiness?.managerCoveragePercent ?? 100;

  const emailCritical   = emailCoverage < EMAIL_ERROR_THRESHOLD;
  const canActivate     = !emailCritical && !activating && !readinessLoading;

  const hasWarnings =
    emailCoverage < EMAIL_WARN_THRESHOLD ||
    (showManagerCoverage && managerCoverage < MANAGER_WARN_THRESHOLD);

  return (
    <Dialog
      open={open}
      onClose={!activating ? onClose : undefined}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }}
    >
      {/* ── Header ── */}
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <AssignmentTurnedInIcon color="primary" />
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Campaign Readiness Report
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Review coverage before activating the campaign
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <Divider />

      <DialogContent sx={{ pt: 2.5, pb: 1 }}>
        {/* ── Loading state ── */}
        {readinessLoading && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 2 }}>
            <CircularProgress size={36} />
            <Typography variant="body2" color="text.secondary">
              Analysing scope coverage…
            </Typography>
          </Box>
        )}

        {!readinessLoading && readiness && (
          <>
            {/* ── Scope Metrics ── */}
            <Box
              sx={{
                bgcolor: 'grey.50',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                px: 2,
                py: 0.5,
                mb: 2.5,
              }}
            >
              <MetricRow
                label="Total Identities"
                value={readiness.totalIdentities}
                subtext="identities in the selected profile"
              />
              <Divider />
              <MetricRow
                label="Total Review Items"
                value={readiness.totalReviewItems}
                subtext="1 per entitlement per identity"
              />
            </Box>

            {/* ── Coverage Bars ── */}
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              Coverage
            </Typography>

            <CoverageRow
              icon={<EmailIcon fontSize="small" color="action" />}
              label="Email Coverage"
              percent={emailCoverage}
              missing={readiness.emailMissing}
              warnThreshold={EMAIL_WARN_THRESHOLD}
              errorThreshold={EMAIL_ERROR_THRESHOLD}
            />

            {showManagerCoverage && (
              <CoverageRow
                icon={<ManageAccountsIcon fontSize="small" color="action" />}
                label="Manager Coverage"
                percent={managerCoverage}
                missing={readiness.managerMissing}
                warnThreshold={MANAGER_WARN_THRESHOLD}
              />
            )}

            {/* ── Backup Reviewer Info ── */}
            {showManagerCoverage && readiness.managerMissing > 0 && (
              <Box
                sx={{
                  bgcolor: 'grey.50',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  px: 2,
                  py: 1.5,
                  mb: 2,
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Manager Routed
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Sent to direct manager
                    </Typography>
                  </Box>
                  <Chip label={readiness.managerResolved} size="small" color="primary" variant="outlined" />
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      Backup Reviewer
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {readiness.backupReviewerEmail || 'Not configured'}
                    </Typography>
                  </Box>
                  <Chip
                    label={readiness.managerMissing}
                    size="small"
                    color={readiness.managerMissing > 0 ? 'warning' : 'default'}
                    variant="outlined"
                  />
                </Stack>
              </Box>
            )}

            {/* ── Alerts ── */}
            {emailCritical && (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                Email coverage is critically low ({emailCoverage}%). Most identities have no
                email address — campaign cannot be activated until this is resolved.
              </Alert>
            )}

            {!emailCritical && hasWarnings && (
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                Some identities have incomplete data. Items without a manager will be routed
                to the backup reviewer. Items without an email will be skipped in reminders.
              </Alert>
            )}

            {!hasWarnings && (
              <Alert severity="success" sx={{ mb: 1.5 }}>
                Coverage looks good. The campaign is ready to activate.
              </Alert>
            )}
          </>
        )}

        {!readinessLoading && !readiness && (
          <Alert severity="error">
            Could not load readiness report. You can still try to activate the campaign.
          </Alert>
        )}
      </DialogContent>

      <Divider />

      {/* ── Actions ── */}
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={activating}
          color="inherit"
          variant="outlined"
        >
          Cancel
        </Button>
        <Button
          onClick={onActivate}
          disabled={!canActivate}
          variant="contained"
          color="primary"
          startIcon={activating ? <CircularProgress size={16} color="inherit" /> : <AssignmentTurnedInIcon />}
        >
          {activating ? 'Activating…' : 'Activate Campaign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
