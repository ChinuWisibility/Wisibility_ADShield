import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Paper,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useSnackbar } from 'notistack';
// import ReportThresholdsPanel from './ReportThresholdsPanel';
import IsoReportThresholdRiskBandsSection from '../../pages/reports/IsoReportThresholdRiskBandsSection';
import { useEffectiveReportingRuleSet } from '../../hooks/useReportingRuleSet';
import { flattenThresholdsForExport } from '../../constants/reportingRuleSetDefaults';

/**
 * @param {{
 *   tenantId: string;
 *   applicationId: string;
 *   stats?: object;
 *   privilegedDisplay?: object;
 *   liveReportLoading?: boolean;
 *   showRiskBands?: boolean;
 *   onThresholdsChange?: (flat: object) => void;
 * }} props
 */
export default function ApplicationReportingRuleSetSection({
  tenantId,
  applicationId,
  stats,
  privilegedDisplay,
  liveReportLoading = false,
  showRiskBands = true,
  onThresholdsChange,
}) {
  const { enqueueSnackbar } = useSnackbar();
  const { query, saveMutation, toggleCustom } = useEffectiveReportingRuleSet(tenantId, applicationId);

  const [alertThresholds, setAlertThresholds] = useState(null);
  const [notifications, setNotifications] = useState(null);
  // const [dirty, setDirty] = useState(false);

  const useCustom = !!query.data?.useCustomRuleSet;
  const readOnly = !useCustom;

  useEffect(() => {
    if (!query.data?.config) return;
    setAlertThresholds({ ...query.data.config.alertThresholds });
    setNotifications({ ...query.data.config.notifications });
    // setDirty(false);
  }, [query.data]);

  useEffect(() => {
    if (!onThresholdsChange || !alertThresholds || !notifications) return;
    onThresholdsChange(flattenThresholdsForExport(alertThresholds, notifications));
  }, [alertThresholds, notifications, onThresholdsChange]);

  const handleToggle = async (event) => {
    const next = event.target.checked;
    try {
      await toggleCustom(next);
      enqueueSnackbar(
        next ? 'Custom rule set enabled for this application.' : 'Application now inherits the global rule set.',
        { variant: 'success' },
      );
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || err?.message || 'Could not update rule set mode.', { variant: 'error' });
    }
  };

  /*
  const handleSave = useCallback(async () => {
    if (!useCustom) return;
    try {
      await saveMutation.mutateAsync({
        useCustomRuleSet: true,
        alertThresholds,
        notifications,
      });
      setDirty(false);
      enqueueSnackbar('Application rule set saved.', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.response?.data?.message || err?.message || 'Save failed.', { variant: 'error' });
    }
  }, [useCustom, saveMutation, alertThresholds, notifications, enqueueSnackbar]);
  */

  if (!tenantId || !applicationId) {
    return (
      <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Select an application to configure report rule sets.
        </Typography>
      </Paper>
    );
  }

  if (query.isLoading || !alertThresholds || !notifications) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4 }}>
        <CircularProgress size={24} />
        <Typography variant="body2" color="text.secondary">Loading report rule set…</Typography>
      </Box>
    );
  }

  if (query.isError) {
    return (
      <Alert severity="error">
        {query.error?.response?.data?.message || query.error?.message || 'Could not load report rule set.'}
      </Alert>
    );
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
        <FormControlLabel
          control={
            <Switch
              checked={useCustom}
              onChange={handleToggle}
              disabled={saveMutation.isPending}
            />
          }
          label={
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>
                Use Custom Rule Set for this Application
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {useCustom
                  ? 'This application uses its own threshold configuration.'
                  : 'OFF — inherits all settings from the tenant global rule set.'}
              </Typography>
            </Box>
          }
        />
      </Paper>

      {/* Risk alert thresholds + Notification & escalation — temporarily hidden
      <ReportThresholdsPanel
        alertThresholds={alertThresholds}
        notifications={notifications}
        onChangeAlertThresholds={(fn) => {
          setAlertThresholds(fn);
          setDirty(true);
        }}
        onChangeNotifications={(fn) => {
          setNotifications(fn);
          setDirty(true);
        }}
        readOnly={readOnly}
        showActions={false}
        inheritedHint={inheritedHint}
      />

      {useCustom && dirty && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save application rule set'}
          </Button>
        </Box>
      )}
      */}

      {showRiskBands && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
            Risk bands
          </Typography>
          <IsoReportThresholdRiskBandsSection
            tenantId={tenantId}
            applicationId={applicationId}
            stats={stats}
            privilegedDisplay={privilegedDisplay}
            liveReportLoading={liveReportLoading}
            readOnly={readOnly}
          />
        </Box>
      )}
    </Box>
  );
}
