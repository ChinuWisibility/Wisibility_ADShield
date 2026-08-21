import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import RestartAlt from '@mui/icons-material/RestartAlt';
import Save from '@mui/icons-material/Save';
import { useSnackbar } from 'notistack';
import { orgAdminAPI } from '../../../services/api';
import {
  TRUST_LEVELS,
  TRUST_SCENARIO_KEYS,
  TRUST_SCENARIO_LABELS,
  cloneDefaultUncorrelatedTrustMappingConfig,
  mergeUncorrelatedTrustMappingConfig,
} from '../../../constants/uncorrelatedTrustMappingDefaults';

const ORG_ADMIN_BASE = '/org-admin';

export default function UncorrelatedTrustMapping() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [config, setConfig] = useState(null);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await orgAdminAPI.getUncorrelatedTrustMapping();
      const merged = mergeUncorrelatedTrustMappingConfig(res.data?.data?.config);
      setConfig(merged);
      setSavedSnapshot(JSON.stringify(merged));
    } catch (e) {
      setLoadError(e.response?.data?.message || e.message || 'Failed to load trust mapping');
      const fallback = cloneDefaultUncorrelatedTrustMappingConfig();
      setConfig(fallback);
      setSavedSnapshot(JSON.stringify(fallback));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => (config ? JSON.stringify(config) !== savedSnapshot : false),
    [config, savedSnapshot],
  );

  const useDefault = Boolean(config?.useDefaultTrustMapping);

  const handleToggleDefault = (event) => {
    const enabled = event.target.checked;
    setConfig((prev) => ({
      ...prev,
      useDefaultTrustMapping: enabled,
      mapping: enabled
        ? { ...cloneDefaultUncorrelatedTrustMappingConfig().mapping }
        : { ...prev.mapping },
    }));
  };

  const handleMappingChange = (scenarioKey, value) => {
    setConfig((prev) => ({
      ...prev,
      mapping: {
        ...prev.mapping,
        [scenarioKey]: value,
      },
    }));
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await orgAdminAPI.saveUncorrelatedTrustMapping(config);
      const merged = mergeUncorrelatedTrustMappingConfig(res.data?.data?.config);
      setConfig(merged);
      setSavedSnapshot(JSON.stringify(merged));
      enqueueSnackbar('Uncorrelated Account Trust Mapping saved.', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || e.message || 'Save failed.', {
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const res = await orgAdminAPI.resetUncorrelatedTrustMapping();
      const merged = mergeUncorrelatedTrustMappingConfig(res.data?.data?.config);
      setConfig(merged);
      setSavedSnapshot(JSON.stringify(merged));
      enqueueSnackbar('Reset to default Trust Mapping.', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || e.message || 'Reset failed.', {
        variant: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <Box sx={{ p: 3, display: 'flex', justifyContent: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: '#f8fafc' }}>
      <Box sx={{ px: { xs: 2, sm: 3 }, py: 2.5, maxWidth: 880, mx: 'auto' }}>
        <Button
          startIcon={<ArrowBack fontSize="small" />}
          onClick={() => navigate(`${ORG_ADMIN_BASE}/global-rule-set`)}
          size="small"
          sx={{ mb: 2, color: 'text.secondary', textTransform: 'none' }}
        >
          Global rule set
        </Button>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ sm: 'flex-start' }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            <Typography variant="h5" fontWeight={700} letterSpacing="-0.02em">
              Uncorrelated Account Trust Mapping
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 640 }}>
              Configure how predefined uncorrelated account scenarios are classified as LOW, MEDIUM
              or HIGH Trust. Scenario evaluation stays fixed; only the assigned Trust Level is
              configurable.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexShrink={0}>
            <Button
              variant="outlined"
              startIcon={<RestartAlt />}
              onClick={handleReset}
              disabled={saving}
              sx={{ textTransform: 'none' }}
            >
              Reset
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={saving || !dirty}
              sx={{ textTransform: 'none' }}
            >
              Save
            </Button>
          </Stack>
        </Stack>

        {loadError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {loadError}. Showing local defaults until save succeeds.
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2, bgcolor: '#fff' }}>
          <FormControlLabel
            control={
              <Switch
                checked={useDefault}
                onChange={handleToggleDefault}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="subtitle2" fontWeight={700}>
                  Use Default Trust Mapping
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {useDefault
                    ? 'System defaults are active. Scenario dropdowns are disabled.'
                    : 'Custom Trust Mapping is active. Assign any Trust Level to each scenario.'}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start', mb: 2, ml: 0 }}
          />

          <Stack spacing={2.5} sx={{ mt: 1 }}>
            {TRUST_SCENARIO_KEYS.map((key) => (
              <Box key={key}>
                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                  {TRUST_SCENARIO_LABELS[key]}
                </Typography>
                <FormControl fullWidth size="small" disabled={useDefault}>
                  <InputLabel id={`trust-map-${key}`}>Trust Level</InputLabel>
                  <Select
                    labelId={`trust-map-${key}`}
                    label="Trust Level"
                    value={config.mapping[key]}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                  >
                    {TRUST_LEVELS.map((level) => (
                      <MenuItem key={level} value={level}>
                        {level}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            ))}
          </Stack>

          {useDefault && (
            <Alert severity="info" sx={{ mt: 2.5 }}>
              Default mapping: Inactive → LOW · Active + Privileged → HIGH · Active + No Privileged →
              MEDIUM
            </Alert>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
