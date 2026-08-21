import { useState } from 'react';
import {
  Box, Typography, Paper, Button, Slider, Alert, Stack, FormControlLabel, Checkbox,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Tune, NorthEast, RestartAlt } from '@mui/icons-material';
import { cloneDefaultReportingRuleSet } from '../../constants/reportingRuleSetDefaults';

const T = {
  blueMid: '#2563eb',
  teal: '#0d9488',
  ink: '#0d1e35',
  ink2: '#3d5166',
  ink3: '#7e96ae',
  surface: '#ffffff',
  border: '#dde3ed',
};

const sliderSx = {
  color: T.blueMid,
  py: 0.5,
  '& .MuiSlider-thumb': { width: 16, height: 16 },
  '& .MuiSlider-track': { height: 4 },
  '& .MuiSlider-rail': { height: 4, opacity: 0.35 },
};

function row(label, valueLabel, control) {
  return (
    <Box sx={{ mb: 2.25 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 2, mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: T.ink }}>{label}</Typography>
        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 700, color: T.blueMid, flexShrink: 0 }}>
          {valueLabel}
        </Typography>
      </Box>
      {control}
    </Box>
  );
}

function summaryRow(label, valueLabel) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 2,
        py: 1.25,
        borderBottom: `1px solid ${alpha(T.border, 0.85)}`,
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: T.ink }}>{label}</Typography>
      <Typography sx={{ fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700, color: T.blueMid, flexShrink: 0 }}>
        {valueLabel}
      </Typography>
    </Box>
  );
}

function notifySummaryRow(label, enabled, detail) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 2,
        py: 1.25,
        borderBottom: `1px solid ${alpha(T.border, 0.85)}`,
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Typography sx={{ fontSize: '0.78rem', color: T.ink, flex: 1 }}>{label}</Typography>
      <Typography
        sx={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: enabled ? T.teal : T.ink3,
          flexShrink: 0,
        }}
      >
        {enabled ? (detail || 'On') : 'Off'}
      </Typography>
    </Box>
  );
}

const cardSx = {
  borderRadius: '12px',
  border: `1px solid ${T.border}`,
  overflow: 'hidden',
  boxShadow: '0 2px 12px rgba(13,30,53,0.06)',
  bgcolor: T.surface,
  height: '100%',
};

/**
 * @param {{
 *   alertThresholds: object;
 *   notifications: object;
 *   onChangeAlertThresholds?: (fn: (prev: object) => object) => void;
 *   onChangeNotifications?: (fn: (prev: object) => object) => void;
 *   readOnly?: boolean;
 *   onSave?: () => void;
 *   onReset?: () => void;
 *   saving?: boolean;
 *   showActions?: boolean;
 *   inheritedHint?: React.ReactNode;
 *   sections?: 'both' | 'alerts' | 'notifications';
 * }} props
 */
export default function ReportThresholdsPanel({
  alertThresholds,
  notifications,
  onChangeAlertThresholds,
  onChangeNotifications,
  readOnly = false,
  onSave,
  onReset,
  saving = false,
  showActions = true,
  inheritedHint,
  sections = 'both',
}) {
  const [saveFlash, setSaveFlash] = useState(false);

  const patchAlert = (partial) => {
    if (readOnly || !onChangeAlertThresholds) return;
    onChangeAlertThresholds((prev) => ({ ...prev, ...partial }));
  };

  const patchNotify = (partial) => {
    if (readOnly || !onChangeNotifications) return;
    onChangeNotifications((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = () => {
    if (onSave) {
      onSave();
    } else {
      setSaveFlash(true);
      window.setTimeout(() => setSaveFlash(false), 2000);
    }
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
      return;
    }
    const defaults = cloneDefaultReportingRuleSet();
    onChangeAlertThresholds?.(() => ({ ...defaults.alertThresholds }));
    onChangeNotifications?.(() => ({ ...defaults.notifications }));
  };

  const {
    orphanAccountsMax,
    certCompletionMinPct,
    dormantDays,
    leaverSlaDays,
    privilegedReviewDays,
  } = alertThresholds || {};

  const {
    notifyEmailAppOwner,
    notifyEscalateCiso,
    escalateCisoAfterDays,
    notifyWeeklySummary,
    notifyAutoDisableDormant,
  } = notifications || {};

  const showAlerts = sections === 'both' || sections === 'alerts';
  const showNotifications = sections === 'both' || sections === 'notifications';

  return (
    <Box>
      {inheritedHint && (
        <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
          {inheritedHint}
        </Alert>
      )}

      {saveFlash && (
        <Alert severity="success" sx={{ mb: 2, fontSize: '0.75rem', py: 0.5 }} onClose={() => setSaveFlash(false)}>
          Thresholds saved.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: showAlerts && showNotifications ? '1fr 1fr' : '1fr' },
          gap: 2.5,
          alignItems: 'stretch',
        }}
      >
        {showAlerts && (
          <Paper elevation={0} sx={cardSx}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${T.border}`, bgcolor: alpha(T.blueMid, 0.05) }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Tune sx={{ fontSize: 18, color: T.blueMid }} />
                <Box>
                  <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: T.ink }}>
                    Risk alert thresholds
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: T.ink3, mt: 0.5 }}>
                    Triggers for dashboards and workflow when metrics cross these limits.
                  </Typography>
                </Box>
              </Box>
            </Box>
            <Box sx={{ p: 2.5 }}>
              {readOnly ? (
                <Box>
                  {summaryRow('Orphan accounts — alert above', `${orphanAccountsMax} accounts`)}
                  {summaryRow('Cert completion — warn below', `${certCompletionMinPct}% completion`)}
                  {summaryRow('Dormant account age — flag after', `${dormantDays} days`)}
                  {summaryRow('Leaver deprovisioning SLA', `${leaverSlaDays} days`)}
                  {summaryRow('Privileged account review cycle', `${privilegedReviewDays} days`)}
                </Box>
              ) : (
                <>
                  {row(
                    'Orphan accounts — alert above',
                    `${orphanAccountsMax} accounts`,
                    <Slider sx={sliderSx} value={orphanAccountsMax ?? 10} onChange={(_, v) => patchAlert({ orphanAccountsMax: v })} min={0} max={100} step={1} valueLabelDisplay="auto" />,
                  )}
                  {row(
                    'Cert completion — warn below',
                    `${certCompletionMinPct}% completion`,
                    <Slider sx={sliderSx} value={certCompletionMinPct ?? 85} onChange={(_, v) => patchAlert({ certCompletionMinPct: v })} min={50} max={100} step={1} valueLabelDisplay="auto" />,
                  )}
                  {row(
                    'Dormant account age — flag after',
                    `${dormantDays} days`,
                    <Slider sx={sliderSx} value={dormantDays ?? 90} onChange={(_, v) => patchAlert({ dormantDays: v })} min={30} max={365} step={1} valueLabelDisplay="auto" />,
                  )}
                  {row(
                    'Leaver deprovisioning SLA',
                    `${leaverSlaDays} days`,
                    <Slider sx={sliderSx} value={leaverSlaDays ?? 5} onChange={(_, v) => patchAlert({ leaverSlaDays: v })} min={1} max={30} step={1} valueLabelDisplay="auto" />,
                  )}
                  {row(
                    'Privileged account review cycle',
                    `${privilegedReviewDays} days`,
                    <Slider sx={sliderSx} value={privilegedReviewDays ?? 90} onChange={(_, v) => patchAlert({ privilegedReviewDays: v })} min={30} max={365} step={1} valueLabelDisplay="auto" />,
                  )}
                </>
              )}
              {showActions && !readOnly && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${T.border}` }}>
                  <Button variant="contained" size="medium" onClick={handleSave} disabled={saving} endIcon={<NorthEast sx={{ fontSize: 18 }} />} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2, boxShadow: 'none', bgcolor: T.blueMid, '&:hover': { bgcolor: '#1d4ed8', boxShadow: 'none' } }}>
                    {saving ? 'Saving…' : 'Save thresholds'}
                  </Button>
                  <Button variant="outlined" size="medium" onClick={handleReset} startIcon={<RestartAlt sx={{ fontSize: 18 }} />} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2, borderColor: T.border, color: T.ink2 }}>
                    Reset to defaults
                  </Button>
                </Stack>
              )}
            </Box>
          </Paper>
        )}

        {showNotifications && (
          <Paper elevation={0} sx={cardSx}>
            <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${T.border}`, bgcolor: alpha(T.teal, 0.06) }}>
              <Typography sx={{ fontFamily: '"Libre Baskerville", Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: T.ink }}>
                Notification & escalation
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: T.ink3, mt: 0.5 }}>
                How the platform should respond when thresholds are breached or on a schedule.
              </Typography>
            </Box>
            <Stack spacing={0.5} sx={{ p: 2.5 }}>
              {readOnly ? (
                <Box>
                  {notifySummaryRow('Email alerts to application owner on threshold breach', !!notifyEmailAppOwner)}
                  {notifySummaryRow(
                    'Escalate to CISO if unresolved',
                    !!notifyEscalateCiso,
                    notifyEscalateCiso ? `After ${escalateCisoAfterDays ?? 7} days` : null,
                  )}
                  {notifySummaryRow('Weekly summary report to stakeholders', !!notifyWeeklySummary)}
                  {notifySummaryRow('Auto-disable accounts exceeding dormancy threshold', !!notifyAutoDisableDormant)}
                </Box>
              ) : (
                <>
                  <FormControlLabel
                    control={<Checkbox checked={!!notifyEmailAppOwner} onChange={(e) => patchNotify({ notifyEmailAppOwner: e.target.checked })} sx={{ color: T.blueMid, '&.Mui-checked': { color: T.blueMid } }} />}
                    label={<Typography sx={{ fontSize: '0.78rem', color: T.ink }}>Email alerts to application owner on threshold breach</Typography>}
                  />
                  <FormControlLabel
                    control={<Checkbox checked={!!notifyEscalateCiso} onChange={(e) => patchNotify({ notifyEscalateCiso: e.target.checked })} sx={{ color: T.blueMid, '&.Mui-checked': { color: T.blueMid } }} />}
                    label={<Typography sx={{ fontSize: '0.78rem', color: T.ink }}>Escalate to CISO if unresolved</Typography>}
                  />
                  {notifyEscalateCiso && (
                    <Box sx={{ pl: 4, pr: 1, pb: 1 }}>
                      {row(
                        'Escalate after',
                        `${escalateCisoAfterDays ?? 7} days`,
                        <Slider sx={sliderSx} value={escalateCisoAfterDays ?? 7} onChange={(_, v) => patchNotify({ escalateCisoAfterDays: v })} min={1} max={30} step={1} valueLabelDisplay="auto" />,
                      )}
                    </Box>
                  )}
                  <FormControlLabel
                    control={<Checkbox checked={!!notifyWeeklySummary} onChange={(e) => patchNotify({ notifyWeeklySummary: e.target.checked })} sx={{ color: T.blueMid, '&.Mui-checked': { color: T.blueMid } }} />}
                    label={<Typography sx={{ fontSize: '0.78rem', color: T.ink }}>Weekly summary report to stakeholders</Typography>}
                  />
                  <FormControlLabel
                    control={<Checkbox checked={!!notifyAutoDisableDormant} onChange={(e) => patchNotify({ notifyAutoDisableDormant: e.target.checked })} sx={{ color: T.blueMid, '&.Mui-checked': { color: T.blueMid } }} />}
                    label={<Typography sx={{ fontSize: '0.78rem', color: T.ink }}>Auto-disable accounts exceeding dormancy threshold</Typography>}
                  />
                </>
              )}
            </Stack>
          </Paper>
        )}
      </Box>
    </Box>
  );
}
