import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  alpha,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormHelperText,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  ArrowBack,
  Close,
  ContentCopy,
  Delete,
  DragIndicator,
  ExpandLess,
  ExpandMore,
  PlayArrow,
  Save,
} from '@mui/icons-material';
import { palette } from '../../../theme/palette';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { applicationAPI } from '../../../services/api';
import { discoveryAPI } from '../../../services/discoveryService';
import { useAuth } from '../../../contexts/AuthContext';

/* ── Defaults ────────────────────────────────────────────────────── */
const createDefaultCondition = () => ({ operator: 'contains', value: '', caseSensitive: false });
const createDefaultFieldCondition = () => ({ fieldName: '', conditionLogic: 'OR', conditions: [createDefaultCondition()] });
const createDefaultStep = () => ({ stepOrder: 0, fieldLogic: 'OR', fieldConditions: [createDefaultFieldCondition()] });

const OPERATORS = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'endsWith', label: 'Ends With' },
  { value: 'regex', label: 'Regex' },
  { value: 'notContains', label: 'Not Contains' },
  { value: 'notEquals', label: 'Not Equals' },
];

/* ── Logic Chip Toggle ───────────────────────────────────────────── */
function LogicToggle({ value, onChange, label, size = 'small' }) {
  const isAnd = value === 'AND';
  return (
    <Tooltip title={`Switch to ${isAnd ? 'OR' : 'AND'} logic`}>
      <Chip
        label={`${label ? label + ': ' : ''}${isAnd ? 'AND' : 'OR'}`}
        size={size}
        onClick={() => onChange(isAnd ? 'OR' : 'AND')}
        sx={{
          fontWeight: 700,
          cursor: 'pointer',
          bgcolor: isAnd ? alpha('#2196f3', 0.12) : alpha('#ff9800', 0.12),
          color: isAnd ? '#1565c0' : '#e65100',
          border: `1px solid ${isAnd ? '#2196f3' : '#ff9800'}`,
          '&:hover': { bgcolor: isAnd ? alpha('#2196f3', 0.2) : alpha('#ff9800', 0.2) },
        }}
      />
    </Tooltip>
  );
}

/* ── Condition Row ───────────────────────────────────────────────── */
function ConditionRow({ condition, onChange, onRemove, canRemove, valueError }) {
  const emptyValue = !String(condition.value ?? '').trim();
  const showError = Boolean(valueError && emptyValue);
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
      <FormControl size="small" sx={{ minWidth: 140 }} error={showError}>
        <Select
          value={condition.operator}
          onChange={(e) => onChange({ ...condition, operator: e.target.value })}
        >
          {OPERATORS.map((op) => (
            <MenuItem key={op.value} value={op.value}>{op.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        size="small"
        placeholder="Value…"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        error={showError}
        helperText={showError ? 'Condition value is required' : undefined}
        sx={{ flex: 1, minWidth: 140 }}
      />
      {canRemove && (
        <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
          <Close fontSize="small" />
        </IconButton>
      )}
    </Stack>
  );
}

/* ── Field Condition Block ───────────────────────────────────────── */
function FieldConditionBlock({ fieldCondition, onChange, onRemove, canRemove, availableFields, showConditionErrors }) {
  const updateCondition = (condIdx, updated) => {
    const newConds = [...fieldCondition.conditions];
    newConds[condIdx] = updated;
    onChange({ ...fieldCondition, conditions: newConds });
  };
  const removeCondition = (condIdx) => {
    if (fieldCondition.conditions.length <= 1) return;
    onChange({ ...fieldCondition, conditions: fieldCondition.conditions.filter((_, i) => i !== condIdx) });
  };
  const addCondition = () => {
    onChange({ ...fieldCondition, conditions: [...fieldCondition.conditions, createDefaultCondition()] });
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2, mb: 1.5,
        borderColor: showConditionErrors ? 'error.main' : alpha('#2196f3', 0.25),
        bgcolor: (t) => t.palette.mode === 'dark' ? alpha('#2196f3', 0.04) : alpha('#2196f3', 0.02),
        borderRadius: 2,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <Autocomplete
          size="small"
          freeSolo
          value={fieldCondition.fieldName}
          onChange={(_, v) => onChange({ ...fieldCondition, fieldName: v || '' })}
          onInputChange={(_, v) => onChange({ ...fieldCondition, fieldName: v || '' })}
          options={availableFields.map((f) => f.fieldName)}
          renderInput={(params) => <TextField {...params} label="Field Name" placeholder="e.g. username" />}
          sx={{ minWidth: 200, flex: 1 }}
        />
        <LogicToggle
          value={fieldCondition.conditionLogic}
          onChange={(v) => onChange({ ...fieldCondition, conditionLogic: v })}
          label="Conditions"
        />
        {canRemove && (
          <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
            <Delete fontSize="small" />
          </IconButton>
        )}
      </Stack>

      {fieldCondition.conditions.map((cond, condIdx) => (
        <Box key={condIdx}>
          {condIdx > 0 && (
            <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', fontWeight: 700, my: 0.5 }}>
              {fieldCondition.conditionLogic}
            </Typography>
          )}
          <ConditionRow
            condition={cond}
            onChange={(updated) => updateCondition(condIdx, updated)}
            onRemove={() => removeCondition(condIdx)}
            canRemove={fieldCondition.conditions.length > 1}
            valueError={showConditionErrors}
          />
        </Box>
      ))}

      <Button size="small" startIcon={<Add />} onClick={addCondition} sx={{ textTransform: 'none', fontWeight: 600, mt: 0.5 }}>
        Add Condition
      </Button>
    </Paper>
  );
}

/* ── Step Block ──────────────────────────────────────────────────── */
function StepBlock({ step, stepIndex, onChange, onRemove, canRemove, availableFields, showConditionErrors }) {
  const [collapsed, setCollapsed] = useState(false);

  const updateFieldCondition = (fcIdx, updated) => {
    const newFcs = [...step.fieldConditions];
    newFcs[fcIdx] = updated;
    onChange({ ...step, fieldConditions: newFcs });
  };
  const removeFieldCondition = (fcIdx) => {
    if (step.fieldConditions.length <= 1) return;
    onChange({ ...step, fieldConditions: step.fieldConditions.filter((_, i) => i !== fcIdx) });
  };
  const addFieldCondition = () => {
    onChange({ ...step, fieldConditions: [...step.fieldConditions, createDefaultFieldCondition()] });
  };

  const fieldCount = step.fieldConditions?.length || 0;
  const condCount = (step.fieldConditions || []).reduce((sum, fc) => sum + (fc.conditions?.length || 0), 0);

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 2,
        borderColor: (t) => alpha(t.palette.primary.main, 0.3),
        borderRadius: 2,
        overflow: 'visible',
      }}
    >
      <CardContent sx={{ pb: '12px !important' }}>
        {/* Step Header */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: collapsed ? 0 : 2 }}>
          <DragIndicator sx={{ color: 'text.disabled', fontSize: 20 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
            Condition {stepIndex + 1}
          </Typography>
          <Chip size="small" label={`${fieldCount} field${fieldCount !== 1 ? 's' : ''} · ${condCount} condition${condCount !== 1 ? 's' : ''}`} variant="outlined" sx={{ fontWeight: 600, fontSize: '0.7rem' }} />
          <LogicToggle
            value={step.fieldLogic}
            onChange={(v) => onChange({ ...step, fieldLogic: v })}
            label="Fields"
          />
          <IconButton size="small" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? <ExpandMore fontSize="small" /> : <ExpandLess fontSize="small" />}
          </IconButton>
          {canRemove && (
            <IconButton size="small" onClick={onRemove} sx={{ color: 'error.main' }}>
              <Delete fontSize="small" />
            </IconButton>
          )}
        </Stack>

        <Collapse in={!collapsed}>
          {step.fieldConditions.map((fc, fcIdx) => (
            <Box key={fcIdx}>
              {fcIdx > 0 && (
                <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', fontWeight: 800, my: 1, fontSize: '0.85rem' }}>
                  {step.fieldLogic}
                </Typography>
              )}
              <FieldConditionBlock
                fieldCondition={fc}
                onChange={(updated) => updateFieldCondition(fcIdx, updated)}
                onRemove={() => removeFieldCondition(fcIdx)}
                canRemove={step.fieldConditions.length > 1}
                availableFields={availableFields}
                showConditionErrors={showConditionErrors}
              />
            </Box>
          ))}
          <Button size="small" startIcon={<Add />} onClick={addFieldCondition} sx={{ textTransform: 'none', fontWeight: 600, mt: 1 }}>
            Add Field
          </Button>
        </Collapse>
      </CardContent>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function DiscoveryPolicyBuilder() {
  const { id, slug } = useParams();
  const isEdit = Boolean(id) && id !== 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();

  // Derive type from URL slug
  const SLUG_TYPE_MAP = { 'privileged-entitlement': 'ENTITLEMENT', 'privileged-user': 'USER', 'ad-group': 'AD_GROUP' };
  const TYPE_LABELS = { USER: 'Privileged User', ENTITLEMENT: 'Privileged Entitlement', AD_GROUP: 'AD Group Based' };
  const resolvedSlug = slug || location.pathname.split('/').find((s) => SLUG_TYPE_MAP[s]) || 'privileged-user';
  const derivedType = SLUG_TYPE_MAP[resolvedSlug] || 'USER';

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [apps, setApps] = useState([]);
  const [availableFields, setAvailableFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);

  // ── Form state ──
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: derivedType,
    applicationId: '',
    applicationName: '',
    stepLogic: 'OR',
    owner: '',
    tags: [],
    steps: [createDefaultStep()],
  });

  // ── Dry-run test state ──
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState(null);

  const visibleApps = useMemo(() => {
    const selectedId = String(form.applicationId || '');
    return apps.filter((app) => {
      const isAuthoritative = Boolean(
        app?.authoritativeSource ||
        app?.authoritative ||
        app?.isAuthoritative ||
        app?.authoritativeApplication,
      );
      if (!isAuthoritative) return true;
      const appId = String(app?._id || app?.id || '');
      return appId && appId === selectedId;
    });
  }, [apps, form.applicationId]);

  /* ── Load apps ─────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const userTenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;
        const res = await applicationAPI.list({ limit: 500, page: 1, ...(userTenantId ? { tenantId: String(userTenantId) } : {}) });
        const rawApps = res.data?.data || res.data?.applications || [];
        setApps(!userTenantId ? rawApps : rawApps.filter((a) => String(typeof a?.tenantId === 'object' ? a?.tenantId?._id : a?.tenantId) === String(userTenantId)));
      } catch {
        setApps([]);
      }
    })();
  }, [user?.tenantId]);

  /* ── Load policy for edit ──────────────────────────────────────── */
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      setLoading(true);
      try {
        const res = await discoveryAPI.getPolicy(id);
        const p = res.data?.data;
        if (!p) { setError('Policy not found'); setLoading(false); return; }
        setForm({
          name: p.name || '',
          description: p.description || '',
          type: p.type || derivedType,
          applicationId: p.applicationId || '',
          applicationName: p.applicationName || '',
          stepLogic: p.stepLogic || 'OR',
          owner: p.owner || '',
          tags: p.tags || [],
          steps: (p.steps && p.steps.length) ? p.steps : [createDefaultStep()],
        });
      } catch (e) {
        setError(e.response?.data?.message || 'Failed to load policy.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  /* ── Load available fields when app/type changes ───────────────── */
  useEffect(() => {
    if (!form.applicationId || !form.type) { setAvailableFields([]); return; }
    let mounted = true;
    (async () => {
      setFieldsLoading(true);
      try {
        const res = await discoveryAPI.getFields(form.applicationId, form.type);
        if (mounted) setAvailableFields(res.data?.data || []);
      } catch {
        if (mounted) setAvailableFields([]);
      } finally {
        if (mounted) setFieldsLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [form.applicationId, form.type]);

  /* ── Form helpers ──────────────────────────────────────────────── */
  const updateStep = (stepIdx, updated) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) => (i === stepIdx ? updated : s)),
    }));
  };
  const removeStep = (stepIdx) => {
    if (form.steps.length <= 1) return;
    setForm((prev) => ({ ...prev, steps: prev.steps.filter((_, i) => i !== stepIdx) }));
  };
  const addStep = () => {
    setForm((prev) => ({ ...prev, steps: [...prev.steps, createDefaultStep()] }));
  };

  /* ── Save ──────────────────────────────────────────────────────── */
  const clearFieldError = (key) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};
    if (!form.name?.trim()) errors.name = 'Policy name is required.';
    if (!form.applicationId) errors.applicationId = 'Application is required.';

    let hasValidCondition = false;
    let hasEmptyConditionValue = false;
    for (const step of form.steps || []) {
      for (const fc of step.fieldConditions || []) {
        const fieldName = String(fc.fieldName || '').trim();
        for (const c of fc.conditions || []) {
          const value = String(c?.value ?? '').trim();
          if (fieldName && !value) hasEmptyConditionValue = true;
          if (fieldName && value) hasValidCondition = true;
        }
      }
    }
    if (hasEmptyConditionValue) {
      errors.conditions = 'Condition value is required.';
    } else if (!hasValidCondition) {
      errors.conditions = 'At least one condition value is required.';
    }

    setFieldErrors(errors);
    return errors;
  };

  const handleSave = async (overrideStatus) => {
    setError('');
    const errors = validateForm();
    if (Object.keys(errors).length) {
      const first = Object.values(errors)[0];
      setError(first);
      enqueueSnackbar(first, { variant: 'error' });
      return;
    }

    setSaving(true);
    const payload = {
      ...form,
      name: form.name.trim(),
      ...(overrideStatus ? { status: overrideStatus } : {}),
      steps: form.steps.map((s, idx) => ({ ...s, stepOrder: idx })),
    };

    try {
      if (isEdit) {
        await discoveryAPI.updatePolicy(id, payload);
        enqueueSnackbar('Policy updated', { variant: 'success' });
      } else {
        const res = await discoveryAPI.createPolicy(payload);
        const newId = res.data?.data?._id;
        enqueueSnackbar('Policy created', { variant: 'success' });
        if (newId) navigate(`/governance/discovery/policy/${newId}`, { replace: true });
      }
      setFieldErrors({});
    } catch (e) {
      const msg = e.response?.data?.message || 'Failed to save policy.';
      setError(msg);
      enqueueSnackbar(msg, { variant: 'error' });
      const lower = String(msg).toLowerCase();
      if (lower.includes('policy name')) setFieldErrors({ name: msg });
      else if (lower.includes('application')) setFieldErrors({ applicationId: msg });
      else if (lower.includes('condition')) setFieldErrors({ conditions: msg });
    } finally {
      setSaving(false);
    }
  };

  /* ── Test Run (Dry Run) ────────────────────────────────────────── */
  const handleTestRun = async () => {
    if (!isEdit) { enqueueSnackbar('Save the policy first before running a test.', { variant: 'warning' }); return; }
    setTestRunning(true);
    setTestResults(null);
    try {
      const res = await discoveryAPI.evaluatePolicy(id, true);
      setTestResults(res.data?.data || null);
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || 'Test run failed.', { variant: 'error' });
    } finally {
      setTestRunning(false);
    }
  };

  /* ── App selection handler ─────────────────────────────────────── */
  const handleAppChange = (appId) => {
    const app = apps.find((a) => String(a._id) === String(appId));
    clearFieldError('applicationId');
    setForm((prev) => ({
      ...prev,
      applicationId: appId,
      applicationName: app ? (app.applicationName || app.name || app.displayName || '') : '',
    }));
  };

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      {/* ── Header ── */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 3 }}>
        <IconButton onClick={() => navigate(`/governance/discovery/${resolvedSlug}`)}>
          <ArrowBack />
        </IconButton>
        <Box sx={{ flex: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h5" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
              {isEdit ? 'Edit Policy' : 'Create Policy'}
            </Typography>
            <Chip size="small" label={TYPE_LABELS[derivedType] || derivedType} sx={{ fontWeight: 700, bgcolor: alpha(palette.brand.primary, 0.1), color: palette.brand.primary }} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Define multi-field, multi-condition rules to discover privileged access.
          </Typography>
        </Box>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Policy Metadata ── */}
      <Paper sx={{ p: 3, mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 2 }}>Policy Details</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Policy Name"
              required
              value={form.name}
              onChange={(e) => {
                clearFieldError('name');
                setForm((p) => ({ ...p, name: e.target.value }));
              }}
              error={Boolean(fieldErrors.name)}
              helperText={fieldErrors.name || undefined}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth required error={Boolean(fieldErrors.applicationId)}>
              <InputLabel>Application</InputLabel>
              <Select value={form.applicationId} onChange={(e) => handleAppChange(e.target.value)} label="Application">
                {visibleApps.map((app) => (
                  <MenuItem key={app._id} value={app._id}>
                    {app.applicationName || app.name || app.displayName || app._id}
                  </MenuItem>
                ))}
              </Select>
              {fieldErrors.applicationId && (
                <FormHelperText>{fieldErrors.applicationId}</FormHelperText>
              )}
            </FormControl>
          </Grid>
          <Grid item xs={12}>
            <TextField fullWidth multiline rows={2} label="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </Grid>
        </Grid>
      </Paper>

      {/* ── Available Fields Hint ── */}
      {availableFields.length > 0 && (
        <Paper sx={{ p: 2, mb: 2, borderRadius: 2, bgcolor: (t) => alpha(t.palette.info.main, 0.04), border: '1px solid', borderColor: (t) => alpha(t.palette.info.main, 0.15) }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'info.main', display: 'block', mb: 0.5 }}>
            Available Fields ({availableFields.length})
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {availableFields.slice(0, 30).map((f) => (
              <Chip key={f.fieldName} label={f.fieldName} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            ))}
            {availableFields.length > 30 && (
              <Chip label={`+${availableFields.length - 30} more`} size="small" sx={{ fontSize: '0.7rem' }} />
            )}
          </Box>
        </Paper>
      )}
      {fieldsLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <CircularProgress size={14} />
          <Typography variant="caption" color="text.secondary">Loading available fields…</Typography>
        </Box>
      )}

      {/* ── Step Logic ── */}
      <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Evaluation Conditions</Typography>
        <LogicToggle
          value={form.stepLogic}
          onChange={(v) => setForm((p) => ({ ...p, stepLogic: v }))}
          label="Between Conditions"
          size="medium"
        />
      </Stack>
      {fieldErrors.conditions && (
        <Alert severity="error" sx={{ mb: 2 }}>{fieldErrors.conditions}</Alert>
      )}

      {/* ── Steps ── */}
      {form.steps.map((step, stepIdx) => (
        <Box key={stepIdx}>
          {stepIdx > 0 && (
            <Typography
              variant="body2"
              sx={{ textAlign: 'center', fontWeight: 800, color: form.stepLogic === 'AND' ? '#1565c0' : '#e65100', my: 1.5, fontSize: '0.95rem' }}
            >
              {form.stepLogic}
            </Typography>
          )}
          <StepBlock
            step={step}
            stepIndex={stepIdx}
            onChange={(updated) => {
              clearFieldError('conditions');
              updateStep(stepIdx, updated);
            }}
            onRemove={() => removeStep(stepIdx)}
            canRemove={form.steps.length > 1}
            availableFields={availableFields}
            showConditionErrors={Boolean(fieldErrors.conditions)}
          />
        </Box>
      ))}

      <Button
        variant="outlined"
        startIcon={<Add />}
        onClick={addStep}
        fullWidth
        sx={{ textTransform: 'none', fontWeight: 700, mb: 3, borderStyle: 'dashed', py: 1.5 }}
      >
        Add Condition
      </Button>

      {/* ── Test Results ── */}
      {testResults && (
        <Paper sx={{ p: 2, mb: 3, borderRadius: 2, bgcolor: (t) => alpha(t.palette.success.main, 0.04), border: '1px solid', borderColor: 'success.main' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'success.main', mb: 1 }}>
            Test Results: {testResults.matched} / {testResults.total} entities matched
          </Typography>
          {testResults.sampleMatches?.length > 0 && (
            <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
              {testResults.sampleMatches.slice(0, 20).map((m, i) => (
                <Paper key={i} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{m.entityDisplayName}</Typography>
                  <Typography variant="caption" color="text.secondary">{m.entityIdentifier}</Typography>
                  {m.matchedFields?.map((mf, mfi) => (
                    <Chip key={mfi} size="small" label={`${mf.fieldName} ${mf.operator} "${mf.conditionValue}" → "${mf.matchedValue}"`} sx={{ mr: 0.5, mt: 0.5, fontSize: '0.65rem' }} />
                  ))}
                </Paper>
              ))}
              {testResults.sampleMatches.length > 20 && (
                <Typography variant="caption" color="text.secondary">Showing first 20 of {testResults.sampleMatches.length} matches.</Typography>
              )}
            </Box>
          )}
        </Paper>
      )}

      {/* ── Action Buttons ── */}
      <Divider sx={{ mb: 2 }} />
      <Stack direction="row" spacing={2} justifyContent="flex-end" sx={{ flexWrap: 'wrap' }}>
        {isEdit && (
          <Button
            variant="outlined"
            startIcon={testRunning ? <CircularProgress size={16} /> : <PlayArrow />}
            onClick={handleTestRun}
            disabled={saving || testRunning}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            {testRunning ? 'Testing…' : 'Run Test'}
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<Save />}
          onClick={() => handleSave()}
          disabled={saving}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          {saving ? 'Saving…' : 'Save Policy'}
        </Button>
      </Stack>
    </Box>
  );
}
