import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Stack,
  Typography,
  Alert,
  Tabs,
  Tab,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  ArrowBack,
  RestartAlt,
  Save,
  // TuneOutlined,
  // NotificationsOutlined,
  AssessmentOutlined,
} from '@mui/icons-material';
import { useSnackbar } from 'notistack';
// import ReportThresholdsPanel from '../../../components/reports/ReportThresholdsPanel';
import IsoReportThresholdRiskBandsSection from '../../reports/IsoReportThresholdRiskBandsSection';
import { useTenantReportingRuleSet } from '../../../hooks/useReportingRuleSet';

const ORG_ADMIN_BASE = '/org-admin';

const NAV = [
  // { id: 'alerts', label: 'Risk alert thresholds', icon: <TuneOutlined fontSize="small" /> },
  // { id: 'notifications', label: 'Notification & escalation', icon: <NotificationsOutlined fontSize="small" /> },
  { id: 'risk-bands', label: 'Risk bands', icon: <AssessmentOutlined fontSize="small" /> },
];

const studioPageSx = { minHeight: '100%', bgcolor: '#f8fafc' };
const studioContentSx = { px: { xs: 2, sm: 3 }, py: 3, maxWidth: 1280, mx: 'auto', width: '100%' };
const studioPageHeaderSx = {
  px: { xs: 2, sm: 3 },
  py: 2.5,
  bgcolor: '#fff',
  borderBottom: '1px solid',
  borderColor: 'divider',
};
const studioTabsSx = {
  px: { xs: 2, sm: 3 },
  bgcolor: '#fff',
  borderBottom: '1px solid',
  borderColor: 'divider',
  '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem', minHeight: 48 },
};

export default function ReportingRuleSet() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { query, saveMutation, resetMutation } = useTenantReportingRuleSet();

  const [section, setSection] = useState('risk-bands');
  const [alertThresholds, setAlertThresholds] = useState(null);
  const [notifications, setNotifications] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [riskBandsResetKey, setRiskBandsResetKey] = useState(0);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setAlertThresholds({ ...query.data.alertThresholds });
    setNotifications({ ...query.data.notifications });
    setDirty(false);
  }, [query.data]);

  const handleSave = useCallback(async () => {
    try {
      await saveMutation.mutateAsync({
        alertThresholds,
        notifications,
        riskBands: query.data?.riskBands,
      });
      setDirty(false);
      enqueueSnackbar('Global report rule set saved.', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || err?.message || 'Save failed.', { variant: 'error' });
    }
  }, [saveMutation, alertThresholds, notifications, query.data?.riskBands, enqueueSnackbar]);

  const handleResetConfirm = useCallback(async () => {
    try {
      const config = await resetMutation.mutateAsync();
      setAlertThresholds({ ...config.alertThresholds });
      setNotifications({ ...config.notifications });
      setDirty(false);
      setRiskBandsResetKey((k) => k + 1);
      setResetDialogOpen(false);
      enqueueSnackbar('Reset to default rule set.', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || err?.message || 'Reset failed.', { variant: 'error' });
    }
  }, [resetMutation, enqueueSnackbar]);

  const markDirty = () => setDirty(true);
  const sectionIndex = NAV.findIndex((n) => n.id === section);
  const saving = saveMutation.isPending || resetMutation.isPending;
  const resetting = resetMutation.isPending;

  if (query.isLoading || !alertThresholds || !notifications) {
    return (
      <Box sx={{ ...studioPageSx, p: 3, display: 'flex', justifyContent: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={studioPageSx}>
      <Box sx={studioPageHeaderSx}>
        <Button
          startIcon={<ArrowBack />}
          onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
          size="small"
          sx={{ mb: 1.5, color: 'text.secondary' }}
        >
          Global rule set
        </Button>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'center' }}
          spacing={2}
        >
          <Box>
            <Typography variant="h5" fontWeight={700} letterSpacing="-0.02em">
              Iso reporting rule set
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Tenant-wide master configuration for report thresholds, notifications, and risk bands.
            </Typography>
          </Box>
          <Stack
            direction="row"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1.5,
              overflow: 'hidden',
              bgcolor: '#fff',
              flexShrink: 0,
            }}
          >
            <Button
              variant="text"
              size="medium"
              startIcon={<RestartAlt fontSize="small" />}
              onClick={() => setResetDialogOpen(true)}
              disabled={saving}
              sx={{
                px: 2,
                py: 0.875,
                color: 'text.secondary',
                borderRadius: 0,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                borderRight: '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              Reset
            </Button>
            <Button
              variant="contained"
              size="medium"
              startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save fontSize="small" />}
              onClick={handleSave}
              disabled={!dirty || saving}
              disableElevation
              sx={{
                px: 2.5,
                py: 0.875,
                borderRadius: 0,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                boxShadow: 'none',
                '&:hover': { boxShadow: 'none' },
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </Stack>
        </Stack>
      </Box>

      {query.isError && (
        <Alert severity="error" sx={{ mx: { xs: 2, sm: 3 }, mt: 2 }}>
          {query.error?.response?.data?.message || query.error?.message || 'Could not load rule set.'}
        </Alert>
      )}

      <Tabs
        value={sectionIndex >= 0 ? sectionIndex : 0}
        onChange={(_, idx) => setSection(NAV[idx]?.id || 'risk-bands')}
        sx={studioTabsSx}
        variant="scrollable"
        scrollButtons="auto"
      >
        {NAV.map((item) => (
          <Tab key={item.id} icon={item.icon} iconPosition="start" label={item.label} />
        ))}
      </Tabs>

      <Box sx={studioContentSx}>
        {/* Risk alert thresholds — temporarily hidden
        {section === 'alerts' && (
          <ReportThresholdsPanel
            alertThresholds={alertThresholds}
            notifications={notifications}
            onChangeAlertThresholds={(fn) => {
              setAlertThresholds(fn);
              markDirty();
            }}
            onChangeNotifications={(fn) => {
              setNotifications(fn);
              markDirty();
            }}
            sections="alerts"
            showActions={false}
          />
        )}
        */}

        {/* Notification & escalation — temporarily hidden
        {section === 'notifications' && (
          <ReportThresholdsPanel
            alertThresholds={alertThresholds}
            notifications={notifications}
            onChangeAlertThresholds={(fn) => {
              setAlertThresholds(fn);
              markDirty();
            }}
            onChangeNotifications={(fn) => {
              setNotifications(fn);
              markDirty();
            }}
            sections="notifications"
            showActions={false}
          />
        )}
        */}

        {section === 'risk-bands' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Low / Medium / High / Critical classifications applied across all applications unless overridden.
              Each metric saves independently.
            </Typography>
            <IsoReportThresholdRiskBandsSection
              key={riskBandsResetKey}
              scope="tenant"
              readOnly={false}
              stats={{ total: 0, active: 0, inactive: 0 }}
              privilegedDisplay={{ value: 0, source: '—' }}
              liveReportLoading={false}
            />
          </Box>
        )}
      </Box>

      <Dialog
        open={resetDialogOpen}
        onClose={resetting ? undefined : () => setResetDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2.5 } }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                bgcolor: alpha('#d97706', 0.12),
                color: '#b45309',
                flexShrink: 0,
              }}
            >
              <RestartAlt />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} lineHeight={1.3}>
                Reset to system defaults?
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                This removes your tenant report rule set and cannot be undone.
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Box
            sx={{
              px: 2,
              py: 1.5,
              borderRadius: 2,
              bgcolor: alpha('#d97706', 0.06),
              border: '1px solid',
              borderColor: alpha('#d97706', 0.2),
            }}
          >
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              The following will be restored to platform defaults:
            </Typography>
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.25 }}>
              {/* <Typography component="li" variant="body2" color="text.secondary">
                Risk alert thresholds
              </Typography>
              <Typography component="li" variant="body2" color="text.secondary">
                Notification &amp; escalation actions
              </Typography> */}
              <Typography component="li" variant="body2" color="text.secondary">
                Risk band boundaries for all metrics
              </Typography>
            </Stack>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Applications inheriting the global rule set will pick up these defaults automatically.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, gap: 1 }}>
          <Button
            onClick={() => setResetDialogOpen(false)}
            disabled={resetting}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleResetConfirm}
            disabled={resetting}
            startIcon={resetting ? <CircularProgress size={16} color="inherit" /> : <RestartAlt fontSize="small" />}
            sx={{ textTransform: 'none', fontWeight: 600, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
          >
            {resetting ? 'Resetting…' : 'Reset to defaults'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
