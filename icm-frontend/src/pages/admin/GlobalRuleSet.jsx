import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Stack,
  Paper,
} from '@mui/material';
import { FingerprintOutlined, AssessmentOutlined, ScheduleOutlined, LinkOutlined, NotificationsActiveOutlined, Lock as LockIcon } from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { BRANDING } from '../../constants/branding';

const ORG_ADMIN_BASE = '/org-admin';

function buildTiles() {
  return [
    {
      id: 'identity-posture',
      title: 'Identity posture rules',
      description:
        'Define global rules and weights used when calculating identity posture scores across the tenant.',
      cta: 'Open rule set',
      icon: <FingerprintOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/identity-posture`,
      status: { label: 'Available', color: 'success' },
      disabled: false,
    },
    {
      id: 'reporting-rule-set',
      title: 'Iso reporting rule set',
      description:
        'Tenant-wide report thresholds, notifications, and risk bands for governance intelligence reports.',
      cta: 'Open rule set',
      icon: <AssessmentOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/reporting`,
      status: { label: 'Available', color: 'success' },
    },
    {
      id: 'remediation-workflow-rules',
      title: 'Remediation workflow rules',
      description:
        'Map certification remediation actions (e.g. access revoke) to enabled workflows for the task queue.',
      cta: 'Open rules',
      icon: <ScheduleOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/remediation-workflow-rules`,
      status: { label: 'Available', color: 'success' },
      disabled: false,
    },
    {
      id: 'remediation-queue-scheduler',
      title: 'Remediation queue scheduler',
      description:
        'Configure scheduled remediation queue processing and routing rules for tenant workflows.',
      cta: 'Open scheduler',
      icon: <ScheduleOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/remediation-queue-scheduler`,
      status: { label: 'Available', color: 'warning' },
      disabled: false,
    },
    {
      id: 'certification-email-reminders',
      title: 'Certification email reminders',
      description:
        'Tenant-wide frequency for access-certification nudge emails. Campaigns set to Global Reminder Setting inherit this cadence.',
      cta: 'Open reminders',
      icon: <NotificationsActiveOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/certification-email-reminders`,
      status: { label: 'Available', color: 'success' },
      disabled: false,
    },
    {
      id: 'uncorrelated-trust-mapping',
      title: 'Uncorrelated Account Trust Mapping',
      description:
        'Configure how predefined uncorrelated account scenarios are classified as LOW, MEDIUM or HIGH Trust.',
      cta: 'Configure mapping',
      icon: <LinkOutlined />,
      path: `${ORG_ADMIN_BASE}/global-rule-set/uncorrelated-trust-mapping`,
      status: { label: 'Available', color: 'success' },
      disabled: false,
    },
  ];
}

export default function GlobalRuleSet() {
  const navigate = useNavigate();
  const { isOrgAdmin, isPlatformAdmin, user, loading } = useAuth();
  const tiles = useMemo(() => buildTiles(), []);

  if (loading) return null;

  if (!isOrgAdmin || isPlatformAdmin) {
    return (
      <Box
        sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}
        data-testid="org-admin-access-denied"
        role="alert"
      >
        <Paper sx={{ p: 5, textAlign: 'center', maxWidth: 460 }}>
          <LockIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="h5" fontWeight={700} gutterBottom>Access Denied</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            You need org admin privileges to access this page.
          </Typography>
          <Typography variant="caption" color="text.disabled" display="block" sx={{ mb: 3 }}>
            Signed in as {user?.email} ({user?.role}) &middot; {BRANDING.domain}
          </Typography>
          <Button variant="outlined" href="/">Back to Dashboard</Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Global rule set
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage tenant-wide rule sets that drive posture, detection, certification reminders, and governance scoring.
          </Typography>
        </Box>
      </Stack>

      <Grid container spacing={2.5}>
        {tiles.map((tile) => (
          <Grid item xs={12} sm={6} md={4} key={tile.id}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                borderRadius: 2,
                borderColor: 'divider',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Box
                    sx={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'linear-gradient(135deg,#2563eb22,#2563eb11)',
                      color: '#1e3a8a',
                    }}
                  >
                    {tile.icon}
                  </Box>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {tile.title}
                  </Typography>
                  <Chip size="small" label={tile.status.label} color={tile.status.color} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {tile.description}
                </Typography>
              </CardContent>
              <CardActions sx={{ px: 2, pb: 2, pt: 0 }}>
                <Button
                  fullWidth
                  variant={tile.disabled ? 'outlined' : 'contained'}
                  disabled={tile.disabled}
                  onClick={() => !tile.disabled && navigate(tile.path)}
                >
                  {tile.cta}
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
