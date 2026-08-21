import { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Switch,
  FormControlLabel, Grid, Alert, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Select, MenuItem, FormControl, InputLabel, Chip, Stack, alpha,
} from '@mui/material';
import {
  Add,
  Save,
  Settings as SettingsIcon,
  Dns,
  Security,
  Business,
  ToggleOn,
  Notifications,
  Storage,
  Mail,
  Public,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { settingsAPI, tenantAPI } from '../../services/api';
import { palette } from '../../theme/palette';
import { BRANDING } from '../../constants/branding';
import { useAuth } from '../../contexts/AuthContext';
import CatalogCurvedTabs from '../identities/catalog/CatalogCurvedTabs';
import { CATALOG } from '../identities/catalog/catalogTheme';

function TabPanel({ children, value, index }) {
  return value === index ? <Box>{children}</Box> : null;
}

const cardSx = {
  p: { xs: 1.5, md: 2 },
  height: '100%',
  borderRadius: `${CATALOG.radius}px`,
  border: `1px solid ${CATALOG.border}`,
  bgcolor: palette.bg.primary,
  boxShadow: CATALOG.cardShadow,
};

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    bgcolor: CATALOG.surface,
    transition: 'box-shadow 160ms ease, border-color 160ms ease, background-color 160ms ease',
    '&:hover': {
      bgcolor: CATALOG.surface,
    },
    '&.Mui-focused': {
      bgcolor: palette.bg.secondary,
      boxShadow: `0 0 0 3px ${alpha(palette.brand.primary, 0.12)}`,
    },
  },
  '& .MuiFormHelperText-root': {
    mx: 0,
    mt: 0.75,
    color: palette.text.secondary,
  },
};

function SectionCard({ icon, title, description, children, sx }) {
  return (
    <Paper elevation={0} sx={{ ...cardSx, ...sx }}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: description ? 2 : 1.5 }}>
        {icon ? (
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              color: palette.brand.primary,
              bgcolor: palette.brand.primaryLight,
              flexShrink: 0,
              '& svg': { fontSize: 20 },
            }}
          >
            {icon}
          </Box>
        ) : null}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, color: palette.text.primary, lineHeight: 1.25 }}>
            {title}
          </Typography>
          {description ? (
            <Typography variant="body2" sx={{ color: palette.text.secondary, mt: 0.5 }}>
              {description}
            </Typography>
          ) : null}
        </Box>
      </Stack>
      {children}
    </Paper>
  );
}

function LoadingState() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 220 }}>
      <CircularProgress size={28} />
    </Box>
  );
}

function ActionFooter({ children }) {
  return (
    <Box
      sx={{
        mt: 3,
        pt: 2.5,
        borderTop: `1px solid ${palette.border.light}`,
        display: 'flex',
        justifyContent: 'flex-end',
        gap: 1,
      }}
    >
      {children}
    </Box>
  );
}

const DEFAULT_PLATFORM_SETTINGS = {
  sessionTimeoutMinutes: 1440,
  maintenanceMode: false,
  maintenanceMessage: 'ADSecurity is temporarily unavailable for maintenance.',
  supportEmail: 'support@ADSecurity.io',
  auditRetentionDays: 365,
};

function PlatformSettingsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [settings, setSettings] = useState(DEFAULT_PLATFORM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    settingsAPI.getPlatform()
      .then((res) => {
        if (active) setSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...res.data.data });
      })
      .catch(() => enqueueSnackbar('Failed to load platform settings', { variant: 'error' }))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [enqueueSnackbar]);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setSettings((previous) => ({ ...previous, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await settingsAPI.updatePlatform({
        sessionTimeoutMinutes: Number(settings.sessionTimeoutMinutes),
        maintenanceMode: settings.maintenanceMode,
        maintenanceMessage: settings.maintenanceMessage,
        supportEmail: settings.supportEmail,
        auditRetentionDays: Number(settings.auditRetentionDays),
      });
      setSettings(res.data.data);
      enqueueSnackbar('Platform settings saved', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar(
        error.response?.data?.message || 'Failed to save platform settings',
        { variant: 'error' },
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <Box>
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<Security />}
            title="Session security"
            description="Control how long authenticated admin sessions remain valid."
          >
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Session timeout (minutes)"
              value={settings.sessionTimeoutMinutes}
              onChange={updateField('sessionTimeoutMinutes')}
              inputProps={{ min: 15, max: 1440 }}
              helperText="Applies to newly issued login sessions. Allowed range: 15-1440 minutes."
            />
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<Mail />}
            title="Support"
            description="Set the help contact users see during platform interruptions."
          >
            <TextField
              fullWidth
              size="small"
              type="email"
              label="Support email"
              value={settings.supportEmail}
              onChange={updateField('supportEmail')}
              placeholder="support@company.com"
              helperText="Shown to users when the platform is unavailable."
            />
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<Storage />}
            title="Audit retention"
            description="Define the audit evidence window retained by the platform."
          >
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Retain audit logs (days)"
              value={settings.auditRetentionDays}
              onChange={updateField('auditRetentionDays')}
              inputProps={{ min: 30, max: 3650 }}
              helperText="Old audit records are removed daily. Allowed range: 30-3650 days."
            />
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<SettingsIcon />}
            title="Maintenance"
            description="Temporarily protect tenant access while administrators recover service."
          >
            <FormControlLabel
              control={(
                <Switch
                  checked={settings.maintenanceMode}
                  onChange={updateField('maintenanceMode')}
                />
              )}
              label="Enable maintenance mode"
            />
            <TextField
              fullWidth
              size="small"
              multiline
              rows={2}
              label="Maintenance message"
              value={settings.maintenanceMessage}
              onChange={updateField('maintenanceMessage')}
              sx={{ mt: 2 }}
            />
            {settings.maintenanceMode && (
              settings.maintenanceForcedOff ? (
                <Alert severity="error" sx={{ mt: 2 }}>
                  Emergency override is active: MAINTENANCE_MODE_FORCE_OFF=true.
                  Maintenance is not being enforced. Remove the override and restart the API
                  after recovery.
                </Alert>
              ) : settings.maintenanceEnforced ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  All tenant users receive the maintenance response. Super Admin login and
                  platform access remain available so maintenance can be disabled.
                </Alert>
              ) : (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Saved, but not enforced on this server because it is not running in production.
                  Nobody is blocked. To test the maintenance screen here, start the API with
                  MAINTENANCE_MODE_ENFORCE=true.
                </Alert>
              )
            )}
          </SectionCard>
        </Grid>
      </Grid>

      <ActionFooter>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={saving}
          sx={{ px: 2.25, textTransform: 'none', fontWeight: 700 }}
        >
          {saving ? 'Saving...' : 'Save Platform Settings'}
        </Button>
      </ActionFooter>
    </Box>
  );
}

const EMPTY_DEPLOYMENT_ACCESS = {
  mode: 'internal',
  publicUrl: '',
  allowedOrigins: [],
  requireMfa: false,
  smtp: {
    host: '',
    port: 465,
    user: '',
    pass: '',
    secure: true,
    passwordConfigured: false,
  },
};

function DeploymentAccessTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [settings, setSettings] = useState(EMPTY_DEPLOYMENT_ACCESS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    settingsAPI.getDeploymentAccess()
      .then((res) => {
        if (!active) return;
        setSettings({
          ...EMPTY_DEPLOYMENT_ACCESS,
          ...res.data.data,
          smtp: {
            ...EMPTY_DEPLOYMENT_ACCESS.smtp,
            ...res.data.data?.smtp,
            pass: '',
          },
        });
      })
      .catch(() => enqueueSnackbar('Failed to load deployment settings', { variant: 'error' }))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [enqueueSnackbar]);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setSettings((previous) => ({ ...previous, [field]: value }));
  };

  const updateSmtp = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setSettings((previous) => ({
      ...previous,
      smtp: { ...previous.smtp, [field]: value },
    }));
  };

  const handleSave = async () => {
    let parsed;
    try {
      parsed = new URL(settings.publicUrl);
    } catch {
      enqueueSnackbar('Enter a valid application URL', { variant: 'warning' });
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      enqueueSnackbar('Application URL must use HTTP or HTTPS', { variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      const res = await settingsAPI.updateDeploymentAccess({
        publicUrl: settings.publicUrl,
        requireMfa: settings.requireMfa,
        smtp: {
          host: settings.smtp.host,
          port: Number(settings.smtp.port),
          user: settings.smtp.user,
          pass: settings.smtp.pass,
          secure: settings.smtp.secure,
        },
      });
      setSettings({
        ...EMPTY_DEPLOYMENT_ACCESS,
        ...res.data.data,
        smtp: {
          ...EMPTY_DEPLOYMENT_ACCESS.smtp,
          ...res.data.data.smtp,
          pass: '',
        },
      });
      enqueueSnackbar('Deployment access settings updated', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar(
        error.response?.data?.message || 'Failed to update deployment settings',
        { variant: 'error' },
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  let corsOrigin = '';
  try {
    corsOrigin = new URL(settings.publicUrl).origin;
  } catch {
    corsOrigin = '';
  }

  return (
    <Box>
      <Alert
        severity="info"
        sx={{
          mb: 2.5,
          borderRadius: 2,
          border: `1px solid ${alpha(palette.status.info, 0.22)}`,
          bgcolor: alpha(palette.status.info, 0.08),
          color: palette.text.primary,
        }}
      >
        Configure the Application URL for browser users (links in email, CORS).
        Saving this URL does not publish the site — DNS, TLS, and reverse proxy must
        point that hostname at this server. The desktop app always uses http://127.0.0.1
        and must keep working after save.
      </Alert>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={7}>
          <SectionCard
            icon={<Public />}
            title="Application access"
            description="Wisibility only needs the URL users type in the browser. The organization decides how that URL is reached."
          >
            <TextField
              fullWidth
              size="small"
              label="Application URL"
              value={settings.publicUrl}
              onChange={updateField('publicUrl')}
              placeholder="https://newdom.codenextech.in"
              helperText="Users will access Wisibility using this URL. Network access is controlled by the organization's IT/network policies."
              sx={{ mb: 2 }}
            />
            <Box
              sx={{
                p: 2,
                borderRadius: 2,
                bgcolor: alpha(palette.brand.primary, 0.05),
                border: `1px dashed ${alpha(palette.brand.primary, 0.35)}`,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Allowed origin
                </Typography>
                <Chip label="Automatically derived" size="small" variant="outlined" />
              </Box>
              <Typography variant="body2">
                {corsOrigin || 'Enter a valid application URL above'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Generated from Application URL. Not configured separately.
              </Typography>
            </Box>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard
            icon={<Storage />}
            title="Internal services"
            description="These stay private on the organization server and cannot be changed here."
          >
            <Box sx={{ mt: 2 }}>
              <Chip label="API: 127.0.0.1" size="small" sx={{ mr: 1, mb: 1, fontWeight: 700 }} />
              <Chip label="MongoDB: 127.0.0.1" size="small" sx={{ mb: 1, fontWeight: 700 }} />
            </Box>
            <Typography variant="body2" sx={{ mt: 2 }}>
              Users only see the Application URL. IIS or Nginx terminates HTTPS and proxies to the
              local API. MongoDB stays private on this server.
            </Typography>
          </SectionCard>
        </Grid>

        <Grid item xs={12}>
          <SectionCard
            icon={<Mail />}
            title="SMTP delivery"
            description="Configure outbound email used for notifications, workflow messages, and platform alerts."
          >
            <Grid container spacing={2}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth size="small" label="SMTP host"
                  value={settings.smtp.host} onChange={updateSmtp('host')}
                />
              </Grid>
              <Grid item xs={12} md={2}>
                <TextField
                  fullWidth size="small" type="number" label="Port"
                  value={settings.smtp.port} onChange={updateSmtp('port')}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth size="small" label="Username"
                  value={settings.smtp.user} onChange={updateSmtp('user')}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth size="small" type="password"
                  label={settings.smtp.passwordConfigured ? 'Password (leave blank to keep)' : 'Password'}
                  value={settings.smtp.pass} onChange={updateSmtp('pass')}
                />
              </Grid>
              <Grid item xs={12}>
                <FormControlLabel
                  control={(
                    <Switch
                      checked={settings.smtp.secure}
                      onChange={updateSmtp('secure')}
                    />
                  )}
                  label="Use TLS immediately (typically port 465)"
                />
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>
      </Grid>

      <ActionFooter>
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={handleSave}
          disabled={saving}
          sx={{ px: 2.25, textTransform: 'none', fontWeight: 700 }}
        >
          {saving ? 'Saving...' : 'Save Deployment Settings'}
        </Button>
      </ActionFooter>
    </Box>
  );
}

function OrgNotificationsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [iamTeamEmail, setIamTeamEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    tenantAPI.getConfig()
      .then((res) => {
        if (!active) return;
        setIamTeamEmail(res.data.data?.iamTeamEmail || '');
      })
      .catch(() => enqueueSnackbar('Failed to load org settings', { variant: 'error' }))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [enqueueSnackbar]);

  const handleSave = async () => {
    const email = String(iamTeamEmail || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      enqueueSnackbar('Enter a valid IAM team email', { variant: 'warning' });
      return;
    }
    setSaving(true);
    try {
      const res = await tenantAPI.updateConfig({ iamTeamEmail: email });
      setIamTeamEmail(res.data.data?.iamTeamEmail || '');
      enqueueSnackbar('Org notification settings saved', { variant: 'success' });
    } catch (error) {
      enqueueSnackbar(
        error.response?.data?.message || 'Failed to save org settings',
        { variant: 'error' },
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <Box sx={{ maxWidth: 640 }}>
      <SectionCard
        icon={<Notifications />}
        title="Notifications"
        description="Tenant inbox used for IAM escalation, orphan actions, and workflow notifications."
      >
        <TextField
          fullWidth
          size="small"
          type="email"
          label="IAM team email"
          value={iamTeamEmail}
          onChange={(e) => setIamTeamEmail(e.target.value)}
          placeholder="iam-team@company.com"
          sx={{ mb: 2 }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={handleSave}
            disabled={saving}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </Box>
      </SectionCard>
    </Box>
  );
}

function PasswordPolicyTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testPassword, setTestPassword] = useState('');
  const [validation, setValidation] = useState(null);

  const fetchPolicy = async () => {
    setLoading(true);
    try {
      const res = await settingsAPI.getPasswordPolicy();
      setPolicy(res.data.data || {
        policyName: 'Default Policy', minLength: 8, requireUppercase: true,
        requireNumbers: true, requireSpecialChars: true, maxAgeDays: 90,
        historyCount: 5, lockoutAttempts: 5, lockoutDurationMinutes: 30,
      });
    } catch { enqueueSnackbar('Failed to load policy', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPolicy(); }, []);

  const handleSave = async () => {
    try {
      await settingsAPI.updatePasswordPolicy(policy);
      enqueueSnackbar('Password policy updated', { variant: 'success' });
    } catch { enqueueSnackbar('Failed to update policy', { variant: 'error' }); }
  };

  const handleValidate = async () => {
    try {
      const res = await settingsAPI.validatePassword(testPassword);
      setValidation(res.data.data);
    } catch { enqueueSnackbar('Validation failed', { variant: 'error' }); }
  };

  if (loading) return <LoadingState />;

  const updateField = (field) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setPolicy((prev) => ({ ...prev, [field]: val }));
  };

  return (
    <Box>
      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<Security />}
            title="Complexity rules"
            description="Define the baseline password strength requirements for tenant users."
          >
            <TextField fullWidth size="small" label="Policy Name" value={policy.policyName || ''}
              onChange={updateField('policyName')} sx={{ mb: 2 }} />
            <TextField fullWidth size="small" label="Minimum Length" type="number"
              value={policy.minLength} onChange={updateField('minLength')} sx={{ mb: 2 }} />
            <FormControlLabel control={<Switch checked={policy.requireUppercase} onChange={updateField('requireUppercase')} />}
              label="Require uppercase letter" />
            <FormControlLabel control={<Switch checked={policy.requireNumbers} onChange={updateField('requireNumbers')} />}
              label="Require number" />
            <FormControlLabel control={<Switch checked={policy.requireSpecialChars} onChange={updateField('requireSpecialChars')} />}
              label="Require special character" />
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard
            icon={<SettingsIcon />}
            title="Rotation and lockout"
            description="Set password expiry, reuse limits, and failed login response."
          >
            <TextField fullWidth size="small" label="Max Age (days)" type="number"
              value={policy.maxAgeDays} onChange={updateField('maxAgeDays')} sx={{ mb: 2 }} />
            <TextField fullWidth size="small" label="Password History Count" type="number"
              value={policy.historyCount} onChange={updateField('historyCount')} sx={{ mb: 2 }} />
            <TextField fullWidth size="small" label="Lockout After Attempts" type="number"
              value={policy.lockoutAttempts} onChange={updateField('lockoutAttempts')} sx={{ mb: 2 }} />
            <TextField fullWidth size="small" label="Lockout Duration (minutes)" type="number"
              value={policy.lockoutDurationMinutes} onChange={updateField('lockoutDurationMinutes')} />
          </SectionCard>
        </Grid>
        <Grid item xs={12}>
          <ActionFooter>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              sx={{ px: 2.25, textTransform: 'none', fontWeight: 700 }}
            >
              Save Policy
            </Button>
          </ActionFooter>
        </Grid>
        <Grid item xs={12}>
          <SectionCard
            icon={<Security />}
            title="Test password"
            description="Validate a sample password against the current policy before saving or communicating it."
          >
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <TextField size="small" label="Test password" value={testPassword}
                onChange={(e) => setTestPassword(e.target.value)} sx={{ minWidth: 300 }} />
              <Button
                variant="outlined"
                onClick={handleValidate}
                disabled={!testPassword}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Validate
              </Button>
            </Box>
            {validation && (
              <Alert severity={validation.valid ? 'success' : 'warning'} sx={{ mt: 2, borderRadius: 2 }}>
                {validation.valid ? 'Password meets policy requirements' : (
                  <Box>{validation.violations.map((v, i) => <Typography key={i} variant="body2">{v}</Typography>)}</Box>
                )}
              </Alert>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}

function TenantConfigTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const SUBSCRIPTION_TIERS = ['core', 'premium', 'enterprise'];
  const initialFormState = { name: '', code: '', subscriptionTier: 'core' };
  const [formData, setFormData] = useState(initialFormState);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const res = await tenantAPI.list();
      if (res.data?.success) setTenants(res.data.data);
    } catch { enqueueSnackbar('Failed to load tenants', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchTenants(); }, []);

  const handleClose = () => { setOpenModal(false); setFormData(initialFormState); };

  const handleSubmit = async () => {
    if (!formData.name || !formData.code) {
      enqueueSnackbar('Name and Code are required', { variant: 'warning' });
      return;
    }
    try {
      setSubmitting(true);
      await tenantAPI.create(formData);
      enqueueSnackbar('Tenant created successfully', { variant: 'success' });
      handleClose();
      fetchTenants();
    } catch (err) {
      enqueueSnackbar(err.response?.data?.message || 'Failed to create tenant', { variant: 'error' });
    } finally { setSubmitting(false); }
  };

  return (
    <Box>
      <SectionCard
        icon={<Business />}
        title="Tenant directory"
        description="Manage the tenants registered in this IGA platform."
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setOpenModal(true)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Add Tenant
          </Button>
        </Box>

        <TableContainer
          component={Paper}
          elevation={0}
          sx={{
            border: `1px solid ${palette.border.default}`,
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Table size="small">
            <TableHead sx={{ bgcolor: palette.bg.primary }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 800, color: palette.text.secondary }}>Name</TableCell>
                <TableCell sx={{ fontWeight: 800, color: palette.text.secondary }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 800, color: palette.text.secondary }}>Subscription Tier</TableCell>
                <TableCell sx={{ fontWeight: 800, color: palette.text.secondary }}>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : tenants.length === 0 ? (
                <TableRow><TableCell colSpan={4} align="center" sx={{ color: palette.text.secondary }}>No tenants found. Click "Add Tenant" to create one.</TableCell></TableRow>
              ) : tenants.map((t) => (
                <TableRow key={t._id} hover>
                  <TableCell><Typography variant="body2" fontWeight={600}>{t.name}</Typography></TableCell>
                  <TableCell>{t.code}</TableCell>
                  <TableCell><Chip label={t.subscriptionTier} size="small" color={t.subscriptionTier === 'enterprise' ? 'primary' : 'default'} sx={{ textTransform: 'capitalize' }} /></TableCell>
                  <TableCell><Chip label={t.isActive ? 'Active' : 'Inactive'} size="small" color={t.isActive ? 'success' : 'error'} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={openModal} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Register New Tenant</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField name="name" label="Tenant Name" value={formData.name} onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))} fullWidth required size="small" />
          <TextField name="code" label="Tenant Code (Unique)" value={formData.code} onChange={(e) => setFormData(p => ({ ...p, code: e.target.value }))} fullWidth required size="small" />
          <TextField select name="subscriptionTier" label="Subscription Tier" value={formData.subscriptionTier} onChange={(e) => setFormData(p => ({ ...p, subscriptionTier: e.target.value }))} fullWidth size="small">
            {SUBSCRIPTION_TIERS.map(tier => <MenuItem key={tier} value={tier}>{tier.toUpperCase()}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleClose} sx={{ textTransform: 'none', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            {submitting ? 'Creating...' : 'Create Tenant'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function FeatureFlagsTab() {
  const { enqueueSnackbar } = useSnackbar();
  const [features, setFeatures] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchFeatures = async () => {
    setLoading(true);
    try {
      const res = await tenantAPI.getFeatures();
      setFeatures(res.data.data);
    } catch { enqueueSnackbar('Failed to load feature flags', { variant: 'error' }); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchFeatures(); }, []);

  const handleToggle = (key) => async () => {
    const updated = { ...features, [key]: !features[key] };
    setFeatures(updated);
    try {
      await tenantAPI.updateFeatures(updated);
      enqueueSnackbar(`${key} ${updated[key] ? 'enabled' : 'disabled'}`, { variant: 'success' });
    } catch {
      setFeatures(features);
      enqueueSnackbar('Failed to update feature flag', { variant: 'error' });
    }
  };

  if (loading) return <LoadingState />;
  if (!features) return <Alert severity="info" sx={{ borderRadius: 2 }}>No features configured</Alert>;

  const featureLabels = {
    sod: 'Separation of Duties',
    certification: 'Access Certification',
    provisioning: 'Provisioning',
    roleManagement: 'Role Management',
    dataHygiene: 'Data Hygiene',
    aiInsights: 'AI Insights',
    correlationEngine: 'Identity & account correlation',
    accessIntelligence: 'Access Intelligence',
  };

  return (
    <SectionCard
      icon={<ToggleOn />}
      title="Feature flags"
      description="Enable or disable IGA modules for this tenant."
    >
      {Object.entries(features).map(([key, enabled]) => (
        <Box
          key={key}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
            py: 1.4,
            borderBottom: `1px solid ${palette.border.light}`,
            '&:last-of-type': { borderBottom: 0 },
          }}
        >
          <Box>
            <Typography variant="body2" fontWeight={600}>{featureLabels[key] || key}</Typography>
            <Typography variant="caption" color="text.secondary">{key}</Typography>
          </Box>
          <Switch checked={enabled} onChange={handleToggle(key)} />
        </Box>
      ))}
    </SectionCard>
  );
}

export default function SystemSettings() {
  const { isOrgAdmin, user } = useAuth();
  const [tab, setTab] = useState(0);
  const isSuperAdmin = user?.role === 'superAdmin';

  const tabs = [
    { label: 'Password Policy', icon: <Security />, render: () => <PasswordPolicyTab /> },
  ];

  if (isSuperAdmin) {
    tabs.unshift(
      { label: 'Platform Settings', icon: <SettingsIcon />, render: () => <PlatformSettingsTab /> },
      {
        label: 'Deployment / Access',
        icon: <Dns />,
        render: () => <DeploymentAccessTab />,
      },
    );
  }

  if (isOrgAdmin) {
    tabs.push({ label: 'Notifications', icon: <Notifications />, render: () => <OrgNotificationsTab /> });
  }

  if (!isOrgAdmin) {
    tabs.push({ label: 'Tenant Config', icon: <Business />, render: () => <TenantConfigTab /> });
    tabs.push({ label: 'Feature Flags', icon: <ToggleOn />, render: () => <FeatureFlagsTab /> });
  }

  useEffect(() => {
    if (tab >= tabs.length) {
      setTab(0);
    }
  }, [tab, tabs.length]);

  return (
    <Box
      sx={{
        ...fieldSx,
        '& .MuiButton-root': { borderRadius: 2 },
        '& .MuiFormControlLabel-label': { fontWeight: 600, color: palette.text.primary },
      }}
    >
      <Paper
        elevation={0}
        sx={{
          mb: 2.25,
          p: { xs: 2, md: 2.4 },
          borderRadius: 2.5,
          border: `1px solid ${alpha(palette.brand.primary, 0.18)}`,
          background: `linear-gradient(135deg, ${alpha(palette.brand.primary, 0.12)} 0%, ${alpha(palette.brand.primary, 0.05)} 35%, ${palette.bg.secondary} 100%)`,
          boxShadow: `0 10px 24px ${alpha(palette.brand.primary, 0.08)}`,
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
        >
          <Stack direction="row" spacing={1.75} alignItems="center">
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 2.5,
                display: 'grid',
                placeItems: 'center',
                color: palette.bg.secondary,
                background: `linear-gradient(135deg, ${palette.brand.primary}, ${palette.brand.secondary})`,
                boxShadow: `0 12px 28px ${alpha(palette.brand.primary, 0.28)}`,
              }}
            >
              <SettingsIcon />
            </Box>
            <Box>
              <Typography
                variant="overline"
                sx={{ color: 'primary.main', letterSpacing: '0.08em', fontWeight: 800 }}
              >
                Admin Console
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                System Configuration
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, maxWidth: 720 }}>
                {BRANDING.name} {BRANDING.product} &mdash; {isOrgAdmin
                  ? 'Manage tenant-scoped settings and password policy.'
                  : 'Manage platform settings, password policies, tenant configuration, and feature flags.'}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip
              label={isSuperAdmin ? 'Super Admin' : 'Org Admin'}
              size="small"
              sx={{ fontWeight: 800, bgcolor: palette.brand.primaryLight, color: palette.brand.primary }}
            />
            <Chip
              label={`${tabs.length} control areas`}
              size="small"
              variant="outlined"
              sx={{ fontWeight: 700, bgcolor: palette.bg.secondary }}
            />
          </Stack>
        </Stack>
      </Paper>

      <CatalogCurvedTabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        tabs={tabs.map((item) => ({ id: item.label, icon: item.icon, label: item.label }))}
      />

      <Box
        sx={{
          bgcolor: CATALOG.surface,
          border: `1px solid ${CATALOG.border}`,
          borderRadius: '0 0 12px 12px',
          mt: '-1px',
          position: 'relative',
          zIndex: 1,
          px: { xs: 1.5, md: 2 },
          pt: 2.25,
          pb: 2,
        }}
      >
        {tabs.map((item, index) => (
          <TabPanel key={item.label} value={tab} index={index}>
            {item.render()}
          </TabPanel>
        ))}
      </Box>
    </Box>
  );
}
