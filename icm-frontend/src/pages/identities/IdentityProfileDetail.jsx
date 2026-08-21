import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  Tabs,
  Tab,
  CircularProgress,
  Alert,
  Paper,
  FormControl,
  InputLabel,
  Select,
  Skeleton,
} from '@mui/material';
import { ArrowBack, Save } from '@mui/icons-material';
import { useSnackbar } from 'notistack';
import { identityProfileAPI, applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';
import IdentityProfileMappingTab from './IdentityProfileMappingTab';

/**
 * Keep tab content mounted when switching tabs so local state (e.g. unsaved mapping rows on Mapping)
 * is not destroyed when the user visits Settings to configure manager correlation.
 */
function TabPanel({ children, value, index, ...other }) {
  const active = value === index;
  return (
    <div
      role="tabpanel"
      id={`identity-profile-tabpanel-${index}`}
      aria-hidden={!active}
      style={{ display: active ? 'block' : 'none' }}
      {...other}
    >
      <Box sx={{ py: 3 }}>{children}</Box>
    </div>
  );
}

export default function IdentityProfileDetail() {
  const { profileId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const tabParam = searchParams.get('tab');
  const tabIndex = tabParam === 'settings' ? 1 : 0;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [profileRecord, setProfileRecord] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', hrmsSourceId: '' });
  const [sourceApplications, setSourceApplications] = useState([]);
  /** Manager correlation: chosen in Settings; required before Save mappings on the Mapping tab. */
  const [correlation, setCorrelation] = useState({ managerAttribute: '', referenceAttribute: '' });
  /** Target keys currently shown on the Mapping tab (including unsaved rows) so Settings dropdowns stay in sync. */
  const [liveMappingTargetKeys, setLiveMappingTargetKeys] = useState([]);

  /** Manager correlation preview — sample values from one source record */
  const [correlationPreview, setCorrelationPreview] = useState(null);
  const [correlationPreviewLoading, setCorrelationPreviewLoading] = useState(false);
  const correlationPreviewDebounceRef = useRef(null);

  const loadSources = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await applicationAPI.list({ tenantId, limit: 500, page: 1 });
      const list = res.data?.data || res.data?.applications || [];
      setSourceApplications(Array.isArray(list) ? list : []);
    } catch {
      setSourceApplications([]);
    }
  }, [tenantId]);

  const load = useCallback(async () => {
    if (!profileId || !tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await identityProfileAPI.getById(profileId);
      const d = res.data?.data;
      if (!d) {
        setError('Profile not found');
        return;
      }
      setProfileName(d.name || '');
      setProfileRecord(d);
      setForm({
        name: d.name || '',
        description: d.description || '',
        hrmsSourceId:
          d.sourceApplicationId?._id ||
          d.sourceApplicationId ||
          d.hrmsSourceId?._id ||
          d.hrmsSourceId ||
          '',
      });
      setCorrelation({
        managerAttribute: d.managerCorrelation?.managerAttribute || '',
        referenceAttribute: d.managerCorrelation?.referenceAttribute || '',
      });
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }, [profileId, tenantId]);

  useEffect(() => {
    load();
    loadSources();
  }, [load, loadSources]);

  const handleTabChange = (_, next) => {
    setSearchParams(next === 1 ? { tab: 'settings' } : { tab: 'mapping' });
  };

  /** Same mapping rows the Mapping tab preview uses (saved draft or published mappings). */
  const effectiveAttributeMappings = useMemo(() => {
    const draft = profileRecord?.mappingDraft;
    if (draft?.isDraft === true && Array.isArray(draft.mappingDraftData) && draft.mappingDraftData.length > 0) {
      return draft.mappingDraftData;
    }
    return profileRecord?.attributeMappings || [];
  }, [profileRecord?.attributeMappings, profileRecord?.mappingDraft]);

  /** Fetch sample values via the same preview API as Mapping → Preview button. */
  const fetchCorrelationPreview = useCallback(async ({ managerAttribute, referenceAttribute }) => {
    if (!profileRecord?._id) return;
    if (!managerAttribute || !referenceAttribute || managerAttribute === referenceAttribute) {
      setCorrelationPreview(null);
      return;
    }
    if (!effectiveAttributeMappings.length) {
      setCorrelationPreview({
        managerValue: null,
        referenceValue: null,
        hint: 'Add attribute mappings on the Mapping tab first (save or save as draft), then sample values appear here.',
      });
      return;
    }
    const hasManager = effectiveAttributeMappings.some((m) => String(m.targetKey || '').trim() === managerAttribute);
    const hasReference = effectiveAttributeMappings.some((m) => String(m.targetKey || '').trim() === referenceAttribute);
    if (!hasManager || !hasReference) {
      setCorrelationPreview({
        managerValue: null,
        referenceValue: null,
        hint: 'Both selected fields must be mapped on the Mapping tab before preview can run.',
      });
      return;
    }
    setCorrelationPreviewLoading(true);
    try {
      const res = await identityProfileAPI.previewMappings(profileRecord._id, {
        attributeMappings: effectiveAttributeMappings,
        previewRowIndex: 0,
        mappingSourceMode: profileRecord.mappingSourceMode ?? 'application_account_schema',
      });
      const data = res.data?.data || {};
      if (data.hint) {
        setCorrelationPreview({ managerValue: null, referenceValue: null, hint: data.hint });
        return;
      }
      const rows = data.rows || [];
      const mgrRow = rows.find((r) => String(r.targetKey || '').trim() === managerAttribute);
      const refRow = rows.find((r) => String(r.targetKey || '').trim() === referenceAttribute);
      const pick = (row) => {
        const v = row?.resolved ?? row?.rawSample;
        if (v === null || v === undefined || v === '') return null;
        return String(v);
      };
      const managerValue = pick(mgrRow);
      const referenceValue = pick(refRow);
      setCorrelationPreview({
        managerValue,
        referenceValue,
        hint:
          !managerValue && !referenceValue
            ? 'Sample row loaded but both fields are empty. Use Preview on the Mapping tab and try another record.'
            : null,
      });
    } catch (e) {
      setCorrelationPreview({
        managerValue: null,
        referenceValue: null,
        hint: e.response?.data?.message || 'Preview failed',
      });
    } finally {
      setCorrelationPreviewLoading(false);
    }
  }, [profileRecord, effectiveAttributeMappings]);

  /** Auto-trigger preview when both correlation fields are set */
  useEffect(() => {
    const { managerAttribute, referenceAttribute } = correlation;
    if (!managerAttribute || !referenceAttribute || managerAttribute === referenceAttribute) {
      setCorrelationPreview(null);
      return;
    }
    if (correlationPreviewDebounceRef.current) clearTimeout(correlationPreviewDebounceRef.current);
    correlationPreviewDebounceRef.current = setTimeout(() => {
      fetchCorrelationPreview({ managerAttribute, referenceAttribute });
    }, 500);
    return () => { if (correlationPreviewDebounceRef.current) clearTimeout(correlationPreviewDebounceRef.current); };
  }, [correlation.managerAttribute, correlation.referenceAttribute, fetchCorrelationPreview, effectiveAttributeMappings]);

  const mappingTargetOptions = useMemo(() => {
    const byKey = new Map();
    for (const m of profileRecord?.attributeMappings || []) {
      const value = String(m.targetKey || '').trim();
      if (!value) continue;
      const label = String(m.targetLabel || '').trim() || value;
      byKey.set(value, {
        value,
        label: label !== value ? `${label} (${value})` : value,
      });
    }
    for (const k of liveMappingTargetKeys) {
      const value = String(k || '').trim();
      if (!value || byKey.has(value)) continue;
      byKey.set(value, { value, label: `${value}` });
    }
    return [...byKey.values()].sort((a, b) => a.value.localeCompare(b.value));
  }, [profileRecord, liveMappingTargetKeys]);

  const correlationPreviewLabels = useMemo(() => {
    const findLabel = (key) => mappingTargetOptions.find((o) => o.value === key)?.label || key;
    return {
      manager: findLabel(correlation.managerAttribute),
      reference: findLabel(correlation.referenceAttribute),
    };
  }, [correlation.managerAttribute, correlation.referenceAttribute, mappingTargetOptions]);

  const handleSaveSettings = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (!form.hrmsSourceId) {
      setError('Source is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await identityProfileAPI.update(profileId, {
        tenantId,
        name,
        description: form.description.trim(),
        hrmsSourceId: form.hrmsSourceId,
        managerCorrelation: {
          managerAttribute: correlation.managerAttribute || '',
          referenceAttribute: correlation.referenceAttribute || '',
        },
      });
      setProfileName(name);
      if (res.data?.data) setProfileRecord(res.data.data);
      enqueueSnackbar('Settings saved', { variant: 'success' });
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!tenantId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">No tenant associated with your account.</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !profileName) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button startIcon={<ArrowBack />} onClick={() => navigate('/identities/profiles')}>
          Back to Identity Profiles
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>

      <Paper variant="outlined" sx={{ borderRadius: 2, width: '100%' }}>
        <Tabs
          value={tabIndex}
          onChange={handleTabChange}
          sx={{
            px: 2,
            borderBottom: `1px solid ${palette.border.default}`,
            '& .MuiTab-root': { fontWeight: 600, textTransform: 'none' },
          }}
        >
          <Tab label="Mapping" />
          <Tab label="Settings" />
        </Tabs>

        <Box sx={{ px: 3, pb: 3 }}>
          <TabPanel value={tabIndex} index={0}>
            {profileRecord && (
              <IdentityProfileMappingTab
                profileId={profileId}
                tenantId={tenantId}
                profile={profileRecord}
                sourceApplications={sourceApplications}
                onSaved={load}
                onLiveMappingTargetsChange={setLiveMappingTargetKeys}
              />
            )}
          </TabPanel>

          <TabPanel value={tabIndex} index={1}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
              <Button
                variant="text"
                startIcon={<ArrowBack />}
                onClick={() => navigate('/identities/profiles')}
                sx={{ textTransform: 'none', fontWeight: 600, color: 'text.secondary' }}
              >
                Identity Profiles
              </Button>
              <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', borderLeft: '2px solid', borderColor: 'divider', pl: 2 }}>
                {profileName || 'Loading...'}
              </Typography>
            </Box>
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 720 }}>
              <TextField
                label="Name"
                required
                fullWidth
                size="small"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <FormControl fullWidth size="small" required>
                <InputLabel id="ip-settings-source">Source</InputLabel>
                <Select
                  labelId="ip-settings-source"
                  label="Source"
                  value={form.hrmsSourceId || ''}
                  onChange={(e) => setForm((p) => ({ ...p, hrmsSourceId: e.target.value }))}
                >
                  <MenuItem value="" disabled>
                    Select application
                  </MenuItem>
                  {sourceApplications.map((app) => (
                    <MenuItem key={app._id} value={app._id}>
                      {app.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                  Manager correlation
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Select which mapped attribute holds the manager reference and which holds the unique reference used to
                  match people. Both must be set before you can save mappings on the Mapping tab.
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 2,
                    alignItems: 'flex-start',
                  }}
                >
                  <FormControl fullWidth size="small" disabled={mappingTargetOptions.length === 0}>
                    <InputLabel id="ip-mgr-key">Manager key field</InputLabel>
                    <Select
                      labelId="ip-mgr-key"
                      label="Manager key field"
                      value={correlation.managerAttribute || ''}
                      onChange={(e) =>
                        setCorrelation((c) => ({ ...c, managerAttribute: e.target.value }))
                      }
                    >
                      <MenuItem value="">
                        <em>Select field</em>
                      </MenuItem>
                      {mappingTargetOptions.map((o) => (
                        <MenuItem key={o.value} value={o.value}>
                          {o.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small" disabled={mappingTargetOptions.length === 0}>
                    <InputLabel id="ip-ref-field">Reference field</InputLabel>
                    <Select
                      labelId="ip-ref-field"
                      label="Reference field"
                      value={correlation.referenceAttribute || ''}
                      onChange={(e) =>
                        setCorrelation((c) => ({ ...c, referenceAttribute: e.target.value }))
                      }
                    >
                      <MenuItem value="">
                        <em>Select field</em>
                      </MenuItem>
                      {mappingTargetOptions.map((o) => (
                        <MenuItem key={`ref-${o.value}`} value={o.value}>
                          {o.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>
                {mappingTargetOptions.length === 0 && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    Add at least one attribute on the <strong>Mapping</strong> tab first; then choose manager and
                    reference fields here and save.
                  </Alert>
                )}

                {/* ---- Manager Correlation Preview (sample from one source record) ---- */}
                {(correlation.managerAttribute && correlation.referenceAttribute && correlation.managerAttribute !== correlation.referenceAttribute) && (
                  <Box sx={{ mt: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        Correlation Preview
                      </Typography>
                      {correlationPreviewLoading && <CircularProgress size={14} />}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      Sample values from one source record — verify both fields look like the identifiers you expect.
                    </Typography>

                    {correlationPreview?.hint && (
                      <Alert severity="info" sx={{ mb: 1.5 }}>
                        {correlationPreview.hint}
                      </Alert>
                    )}

                    {correlationPreviewLoading ? (
                      <Skeleton height={72} sx={{ borderRadius: 1.5 }} />
                    ) : correlationPreview && !correlationPreview.hint ? (
                      <Paper
                        variant="outlined"
                        sx={{
                          borderRadius: 1.5,
                          overflow: 'hidden',
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                        }}
                      >
                        <Box sx={{ p: 2, borderRight: '1px solid', borderColor: 'divider' }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mb: 0.75, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                          >
                            {correlationPreviewLabels.manager}
                          </Typography>
                          <Typography
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              wordBreak: 'break-all',
                              color: correlationPreview.managerValue ? 'text.primary' : 'text.disabled',
                            }}
                          >
                            {correlationPreview.managerValue ?? '—'}
                          </Typography>
                        </Box>
                        <Box sx={{ p: 2 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block', mb: 0.75, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}
                          >
                            {correlationPreviewLabels.reference}
                          </Typography>
                          <Typography
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.9rem',
                              wordBreak: 'break-all',
                              color: correlationPreview.referenceValue ? 'text.primary' : 'text.disabled',
                            }}
                          >
                            {correlationPreview.referenceValue ?? '—'}
                          </Typography>
                        </Box>
                      </Paper>
                    ) : null}
                  </Box>
                )}
              </Box>

              <TextField
                label="Description"
                fullWidth
                multiline
                minRows={4}
                size="small"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              />
              <Box>
                <Button
                  variant="contained"
                  startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <Save />}
                  onClick={handleSaveSettings}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </Box>
            </Box>
          </TabPanel>

        </Box>
      </Paper>
    </Box>
  );
}
