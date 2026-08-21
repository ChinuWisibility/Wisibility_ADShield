import { useEffect, useMemo, useState, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControlLabel,
  Switch,
  MenuItem,
  Stack,
  Alert,
  Autocomplete,
  Chip,
  Typography,
  ToggleButton,
  ToggleButtonGroup,
  Box,
  IconButton,
  Divider,
  Paper,
  Grid
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SecurityIcon from "@mui/icons-material/Security";
import {
  policyConditionLabel,
  RISK_LEVEL_OPTIONS,
  THRESHOLD_CONDITION_TYPES,
  splitPolicyConditions,
  mergePolicyConditions,
} from "../../pages/security/policySignalMeta";

const EMPTY = {
  name: "",
  enabled: true,
  riskLevel: "medium",
  conditions: [],
  conditionMode: "AND",
  description: "",
  recommendation: "",
};

function defaultThresholdRow(type = "INACTIVE_OVER") {
  const spec = THRESHOLD_CONDITION_TYPES[type];
  return {
    id: `${type}-${Date.now()}-${Math.random()}`,
    type,
    value: spec?.defaultValue ?? 1,
  };
}

export default function SecurityPolicyEditorDialog({
  open,
  onClose,
  onSave,
  saving = false,
  initial,
  conditionCatalog = {},
  title = "Security policy",
}) {
  const [form, setForm] = useState(EMPTY);
  const [signalConditions, setSignalConditions] = useState([]);
  const [thresholdRows, setThresholdRows] = useState([]);
  
  // Track errors for both the main banner and specific fields
  const [errors, setErrors] = useState({ banner: "", fields: {} });
  
  // Ref to target the error message for auto-scrolling
  const errorRef = useRef(null);

  const signalOptions = useMemo(() => {
    const signals = conditionCatalog.signals || [];
    return signals.map((c) => ({
      value: c,
      label: policyConditionLabel(c),
    }));
  }, [conditionCatalog.signals]);

  const thresholdTypeOptions = useMemo(() => {
    const fromApi = conditionCatalog.thresholdTypes;
    if (Array.isArray(fromApi) && fromApi.length) return fromApi;
    return Object.entries(THRESHOLD_CONDITION_TYPES).map(([type, spec]) => ({
      type,
      ...spec,
    }));
  }, [conditionCatalog.thresholdTypes]);

  useEffect(() => {
    if (!open) return;
    setErrors({ banner: "", fields: {} }); // Clear errors on open

    const base = initial
      ? {
          name: initial.name || "",
          enabled: initial.enabled !== false,
          riskLevel: initial.riskLevel || "medium",
          conditionMode: initial.conditionMode || "AND",
          description: initial.description || "",
          recommendation: initial.recommendation || initial.description || "",
        }
      : { ...EMPTY };

    const { signals, thresholds } = splitPolicyConditions(initial?.conditions || []);
    setForm({ ...base, conditions: initial?.conditions || [] });
    setSignalConditions(signals);
    setThresholdRows(
      thresholds.map((t, index) => ({
        id: `${t.type}-${index}`,
        type: t.type,
        value: t.value,
      })),
    );
  }, [open, initial]);

  const selectedSignalOptions = useMemo(
    () => signalOptions.filter((o) => signalConditions.includes(o.value)),
    [signalOptions, signalConditions],
  );

  const syncConditions = (signals, thresholds) => {
    const merged = mergePolicyConditions(signals, thresholds);
    setForm((f) => ({ ...f, conditions: merged }));
    
    // Clear condition errors if user starts fixing them
    if (errors.fields.conditions && merged.length > 0) {
      setErrors((prev) => ({ ...prev, banner: "", fields: { ...prev.fields, conditions: false } }));
    }
  };

  const handleSignalsChange = (vals) => {
    const next = vals.map((v) => v.value);
    setSignalConditions(next);
    syncConditions(next, thresholdRows);
  };

  const updateThresholdRow = (id, patch) => {
    setThresholdRows((rows) => {
      const next = rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
      syncConditions(signalConditions, next);
      return next;
    });
    
    // Clear specific threshold error on change
    if (errors.fields[`threshold_${id}`]) {
       setErrors((prev) => ({ ...prev, banner: "", fields: { ...prev.fields, [`threshold_${id}`]: false } }));
    }
  };

  const addThresholdRow = () => {
    const row = defaultThresholdRow();
    setThresholdRows((rows) => {
      const next = [...rows, row];
      syncConditions(signalConditions, next);
      return next;
    });
  };

  const removeThresholdRow = (id) => {
    setThresholdRows((rows) => {
      const next = rows.filter((row) => row.id !== id);
      syncConditions(signalConditions, next);
      return next;
    });
  };

  const handleSubmit = () => {
    const conditions = mergePolicyConditions(signalConditions, thresholdRows);
    let newErrors = { banner: "", fields: {} };
    let hasValidationErrors = false;

    // Validation checks
    if (!form.name.trim()) {
      newErrors.banner = "Policy name is required.";
      newErrors.fields.name = true;
      hasValidationErrors = true;
    } else if (!conditions.length) {
      newErrors.banner = "Add at least one signal or threshold condition.";
      newErrors.fields.conditions = true;
      hasValidationErrors = true;
    } else {
      for (const row of thresholdRows) {
        const spec = THRESHOLD_CONDITION_TYPES[row.type] || thresholdTypeOptions.find((t) => t.type === row.type);
        const value = parseInt(String(row.value), 10);
        if (!spec || !Number.isFinite(value) || value < (spec.min ?? 1) || value > (spec.max ?? 999999)) {
          newErrors.banner = `Invalid value for ${spec?.label || row.type} (Must be between ${spec?.min ?? 1} and ${spec?.max ?? 999999}).`;
          newErrors.fields[`threshold_${row.id}`] = true;
          hasValidationErrors = true;
          break; // Stop at first threshold error
        }
      }
    }

    if (hasValidationErrors) {
      setErrors(newErrors);
      // Wait for React to render the error banner, then scroll to it
      setTimeout(() => {
        errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
      return;
    }

    setErrors({ banner: "", fields: {} });
    onSave({ ...form, conditions });
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              display: "flex",
              p: 1,
              borderRadius: 1,
              bgcolor: "primary.50",
              color: "primary.main",
            }}
          >
            <SecurityIcon fontSize="small" />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Configure rule conditions and remediation workflows
            </Typography>
          </Box>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ p: 0, bgcolor: "grey.50" }}>
        <Stack spacing={0} divider={<Divider />}>
          {/* Section 1: General Info */}
          <Box sx={{ p: 3, bgcolor: "background.paper" }}>
            <Typography variant="subtitle2" fontWeight={600} mb={2} color="text.primary">
              General Configuration
            </Typography>
            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Policy name"
                  fullWidth
                  size="small"
                  value={form.name}
                  error={!!errors.fields.name}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, name: e.target.value }));
                    if (errors.fields.name) setErrors((prev) => ({ ...prev, banner: "", fields: { ...prev.fields, name: false } }));
                  }}
                  disabled={saving}
                  placeholder="e.g., Stale Admin Accounts"
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  select
                  label="Risk level"
                  fullWidth
                  size="small"
                  value={form.riskLevel}
                  onChange={(e) => setForm((f) => ({ ...f, riskLevel: e.target.value }))}
                  disabled={saving}
                >
                  {RISK_LEVEL_OPTIONS.map((o) => (
                    <MenuItem key={o.value} value={o.value}>
                      {o.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={3} display="flex" alignItems="center">
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.enabled}
                      onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                      disabled={saving}
                      color="primary"
                    />
                  }
                  label={
                    <Typography variant="body2" fontWeight={500}>
                      {form.enabled ? "Enabled" : "Disabled"}
                    </Typography>
                  }
                />
              </Grid>
            </Grid>
          </Box>

          {/* Section 2: Conditions Builder */}
          <Box 
            sx={{ 
              p: 3, 
              bgcolor: "background.paper",
              border: errors.fields.conditions ? "2px solid" : "none",
              borderColor: "error.main",
              transition: "border-color 0.2s"
            }}
          >
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Box>
                <Typography 
                  variant="subtitle2" 
                  fontWeight={600} 
                  color={errors.fields.conditions ? "error.main" : "text.primary"}
                >
                  Match Conditions
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Define the criteria that trigger this policy
                </Typography>
              </Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={form.conditionMode}
                onChange={(_, v) => v && setForm((f) => ({ ...f, conditionMode: v }))}
                disabled={saving}
                sx={{ bgcolor: "background.default" }}
              >
                <ToggleButton value="AND" sx={{ px: 2 }}>
                  <Typography variant="caption" fontWeight={600}>
                    ALL (AND)
                  </Typography>
                </ToggleButton>
                <ToggleButton value="OR" sx={{ px: 2 }}>
                  <Typography variant="caption" fontWeight={600}>
                    ANY (OR)
                  </Typography>
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>

            <Stack spacing={2.5}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
                <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ display: "block", mb: 1.5 }}>
                  SIGNALS
                </Typography>
                <Autocomplete
                  multiple
                  options={signalOptions}
                  value={selectedSignalOptions}
                  onChange={(_, vals) => handleSignalsChange(vals)}
                  getOptionLabel={(o) => o.label}
                  isOptionEqualToValue={(a, b) => a.value === b.value}
                  renderTags={(value, getTagProps) =>
                    value.map((option, index) => (
                      <Chip
                        {...getTagProps({ index })}
                        key={option.value}
                        label={option.label}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ bgcolor: "background.paper" }}
                      />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder={selectedSignalOptions.length === 0 ? "Select finding signals…" : ""}
                      size="small"
                      sx={{ bgcolor: "background.paper" }}
                    />
                  )}
                  disabled={saving}
                />
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, bgcolor: "grey.50" }}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1.5}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">
                    THRESHOLDS
                  </Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={addThresholdRow}
                    disabled={saving}
                    sx={{ bgcolor: "background.paper" }}
                  >
                    Add Threshold
                  </Button>
                </Stack>

                {thresholdRows.length === 0 ? (
                  <Box
                    sx={{
                      p: 3,
                      border: "1px dashed",
                      borderColor: "divider",
                      borderRadius: 1,
                      textAlign: "center",
                      bgcolor: "background.paper",
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      No threshold conditions applied. Add metrics such as inactive days, nested depth, or member count.
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={1}>
                    {thresholdRows.map((row) => {
                      const spec =
                        THRESHOLD_CONDITION_TYPES[row.type] ||
                        thresholdTypeOptions.find((t) => t.type === row.type);
                      
                      const hasRowError = errors.fields[`threshold_${row.id}`];

                      return (
                        <Stack
                          key={row.id}
                          direction="row"
                          spacing={2}
                          alignItems="center"
                          sx={{
                            p: 1.5,
                            bgcolor: hasRowError ? "error.50" : "background.paper",
                            border: "1px solid",
                            borderColor: hasRowError ? "error.main" : "divider",
                            borderRadius: 1,
                          }}
                        >
                          <TextField
                            select
                            size="small"
                            label="Metric"
                            value={row.type}
                            onChange={(e) => updateThresholdRow(row.id, { type: e.target.value })}
                            sx={{ flex: 1 }}
                            disabled={saving}
                          >
                            {thresholdTypeOptions.map((t) => (
                              <MenuItem key={t.type} value={t.type}>
                                {t.label}
                              </MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            size="small"
                            label="Greater than"
                            type="number"
                            value={row.value}
                            error={hasRowError}
                            inputProps={{
                              min: spec?.min ?? 1,
                              max: spec?.max ?? 999999,
                            }}
                            onChange={(e) => updateThresholdRow(row.id, { value: e.target.value })}
                            sx={{ width: 120 }}
                            disabled={saving}
                          />
                          <Typography variant="body2" color="text.secondary" sx={{ minWidth: 60 }}>
                            {spec?.unit || "units"}
                          </Typography>
                          <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeThresholdRow(row.id)}
                            disabled={saving}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      );
                    })}
                  </Stack>
                )}
              </Paper>

              {/* Condition Summary / Preview */}
              {(signalConditions.length > 0 || thresholdRows.length > 0) && (
                <Box sx={{ p: 2, bgcolor: "info.50", borderRadius: 1, border: "1px solid", borderColor: "info.100" }}>
                  <Typography variant="caption" fontWeight={700} color="info.main" sx={{ mb: 1, display: "block" }}>
                    RULE SUMMARY
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {mergePolicyConditions(signalConditions, thresholdRows).map((token, idx, arr) => (
                      <Box key={token} display="flex" alignItems="center" gap={1}>
                        <Chip
                          label={policyConditionLabel(token)}
                          size="small"
                          sx={{ bgcolor: "background.paper", fontWeight: 500 }}
                        />
                        {idx < arr.length - 1 && (
                          <Typography variant="caption" fontWeight={700} color="info.main">
                            {form.conditionMode}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Stack>
                </Box>
              )}
            </Stack>
          </Box>

          {/* Section 3: Details */}
          <Box sx={{ p: 3, bgcolor: "background.paper" }}>
            <Typography variant="subtitle2" fontWeight={600} mb={2} color="text.primary">
              Documentation & Remediation
            </Typography>
            <Stack spacing={2.5}>
              <TextField
                label="Policy Description"
                fullWidth
                multiline
                minRows={2}
                size="small"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                disabled={saving}
                placeholder="Briefly explain the purpose of this security policy..."
              />
              <TextField
                label="Remediation Recommendation"
                fullWidth
                multiline
                minRows={2}
                size="small"
                value={form.recommendation}
                onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))}
                disabled={saving}
                placeholder="Provide steps to resolve this finding..."
                helperText="This text is shown directly to users in the Findings Explorer."
              />
            </Stack>
          </Box>
        </Stack>

        {/* Error Banner with ref attached for scrolling */}
        {errors.banner && (
          <Box ref={errorRef} sx={{ px: 3, pb: 3, pt: 2, bgcolor: "background.paper" }}>
            <Alert severity="error" variant="filled">
              {errors.banner}
            </Alert>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Button onClick={onClose} disabled={saving} color="inherit">
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving} disableElevation>
          {saving ? "Saving Policy…" : "Save Policy"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}