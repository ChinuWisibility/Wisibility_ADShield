import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { identityAPI, identityProfileAPI } from '../../services/api';

const PLATFORM_ROLES = [
  { value: 'admin', label: 'Org Admin' },
  { value: 'certAdmin', label: 'Cert Admin' },
  { value: 'sodAdmin', label: 'SoD Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'viewer', label: 'Viewer' },
  { value: 'auditAnalytics', label: 'Audit Analytics' },
];

/**
 * The set of attributes an identity has is defined by the tenant's Identity Profile
 * mappings, not by this dialog. Fields are fetched from the selected profile so the form
 * always matches what a refresh from the authoritative source would produce.
 */
export default function CreateIdentityDialog({ open, tenantId, onClose, onCreated, onError }) {
  const [profiles, setProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileId, setProfileId] = useState('');
  const [schema, setSchema] = useState(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const [values, setValues] = useState({});
  const [referenceSelections, setReferenceSelections] = useState({});
  const [platformRole, setPlatformRole] = useState('viewer');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) {
      setSchema(null);
      setValues({});
      setReferenceSelections({});
      setTouched(false);
      setSchemaError('');
      setPlatformRole('viewer');
      return;
    }
    if (!tenantId) return;

    let cancelled = false;
    setProfilesLoading(true);
    identityProfileAPI
      .list({ tenantId })
      .then((res) => {
        if (cancelled) return;
        const rows = (res.data?.data || []).filter((p) => p.attributeMappings?.length);
        setProfiles(rows);
        // With a single mapped profile there is nothing to choose; skip the extra click.
        if (rows.length === 1) setProfileId(String(rows[0]._id));
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      })
      .finally(() => {
        if (!cancelled) setProfilesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, tenantId]);

  useEffect(() => {
    if (!open || !profileId || !tenantId) {
      setSchema(null);
      return;
    }
    let cancelled = false;
    setSchemaLoading(true);
    setSchemaError('');
    identityProfileAPI
      .getCreateSchema(profileId, { tenantId })
      .then((res) => {
        if (cancelled) return;
        const next = res.data?.data || null;
        setSchema(next);
        setValues({});
        setReferenceSelections({});
        setTouched(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setSchema(null);
        setSchemaError(
          err.response?.data?.message || 'Could not load the attributes for this profile.',
        );
      })
      .finally(() => {
        if (!cancelled) setSchemaLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, profileId, tenantId]);

  const setValue = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const missingRequired = useMemo(() => {
    if (!schema) return [];
    return schema.fields
      .filter((field) => field.required && !String(values[field.key] ?? '').trim())
      .map((field) => field.label);
  }, [schema, values]);

  const submit = async () => {
    setTouched(true);
    if (!schema || missingRequired.length) return;
    setSubmitting(true);
    try {
      const res = await identityAPI.create({
        tenantId,
        identityProfileId: profileId,
        values,
        referenceSelections,
        platformRole,
      });
      onCreated?.(res.data);
    } catch (err) {
      onError?.(err.response?.data?.message || 'Failed to create identity.');
    } finally {
      setSubmitting(false);
    }
  };

  const noProfiles = !profilesLoading && !profiles.length;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Create New Identity</DialogTitle>
      <DialogContent dividers>
        {noProfiles ? (
          <Alert severity="warning">
            This tenant has no identity profile with attribute mappings. Configure one under
            Identity Profiles first — it defines which attributes an identity has.
          </Alert>
        ) : (
          <Stack spacing={2.5} sx={{ pt: 0.5 }}>
            <FormControl fullWidth size="small" disabled={profilesLoading || profiles.length === 1}>
              <InputLabel id="create-identity-profile-label">Identity Profile</InputLabel>
              <Select
                labelId="create-identity-profile-label"
                label="Identity Profile"
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
              >
                {profiles.map((profile) => (
                  <MenuItem key={profile._id} value={String(profile._id)}>
                    {profile.name}
                    {profile.sourceApplicationId?.name
                      ? ` — ${profile.sourceApplicationId.name}`
                      : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth size="small">
              <InputLabel id="create-identity-platform-role-label">ADSecurity role</InputLabel>
              <Select
                labelId="create-identity-platform-role-label"
                label="ADSecurity role"
                value={platformRole}
                onChange={(event) => setPlatformRole(event.target.value)}
              >
                {PLATFORM_ROLES.map((role) => (
                  <MenuItem key={role.value} value={role.value}>
                    {role.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Assigned to the portal login account when an email address is provided. This is not an IGA entitlement role.
            </Typography>

            {!profileId && !profilesLoading && (
              <Typography variant="body2" color="text.secondary">
                Choose a profile to load its attributes.
              </Typography>
            )}

            {schemaError && <Alert severity="error">{schemaError}</Alert>}

            {schemaLoading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularProgress size={26} />
              </Box>
            )}

            {schema && !schemaLoading && (
              <>
                <Typography variant="caption" color="text.secondary">
                  {schema.fields.length} attribute{schema.fields.length === 1 ? '' : 's'} defined by
                  &ldquo;{schema.profileName}&rdquo;
                  {schema.sourceApplication?.name
                    ? ` (source: ${schema.sourceApplication.name})`
                    : ''}
                </Typography>

                <Grid container spacing={2}>
                  {schema.fields.map((field) => (
                    <Grid item xs={12} sm={6} key={field.key}>
                      <ProfileField
                        field={field}
                        profileId={profileId}
                        tenantId={tenantId}
                        value={values[field.key] ?? ''}
                        selectedReference={referenceSelections[field.key] || null}
                        onChange={(value) => setValue(field.key, value)}
                        onReferenceChange={(option) => {
                          setReferenceSelections((prev) => ({
                            ...prev,
                            [field.key]: option
                              ? {
                                identityId: option.identityId,
                                referenceValue: option.referenceValue,
                                displayName: option.displayName,
                                employeeId: option.employeeId,
                              }
                              : null,
                          }));
                          setValue(field.key, option?.referenceValue || '');
                          if (field.reference?.linkedDisplayFieldKey) {
                            setValue(
                              field.reference.linkedDisplayFieldKey,
                              option?.displayName || '',
                            );
                          }
                        }}
                        showError={touched}
                      />
                    </Grid>
                  ))}
                </Grid>

                {touched && missingRequired.length > 0 && (
                  <Alert severity="warning">
                    Required by this profile: {missingRequired.join(', ')}
                  </Alert>
                )}
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit" disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          variant="contained"
          disabled={!schema || schemaLoading || submitting}
        >
          {submitting ? 'Creating…' : 'Create Identity'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ProfileField({
  field,
  profileId,
  tenantId,
  value,
  selectedReference,
  onChange,
  onReferenceChange,
  showError,
}) {
  const invalid = showError && field.required && !String(value ?? '').trim();
  const helperText = invalid ? 'Required' : field.helperText || ' ';

  if (field.type === 'identityReference') {
    return (
      <IdentityReferenceField
        field={field}
        profileId={profileId}
        tenantId={tenantId}
        value={value}
        selectedReference={selectedReference}
        onChange={onReferenceChange}
        invalid={invalid}
        helperText={helperText}
      />
    );
  }

  if (field.type === 'select') {
    return (
      <TextField
        select
        fullWidth
        size="small"
        label={field.label}
        required={field.required}
        value={value}
        error={invalid}
        helperText={helperText}
        onChange={(event) => onChange(event.target.value)}
      >
        {(field.options || []).map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  return (
    <TextField
      fullWidth
      size="small"
      label={field.isCorrelationKey ? `${field.label} (match key)` : field.label}
      required={field.required}
      disabled={field.readOnly}
      type={field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
      value={value}
      error={invalid}
      helperText={helperText}
      onChange={(event) => onChange(event.target.value)}
      InputLabelProps={field.type === 'date' ? { shrink: true } : undefined}
    />
  );
}

function IdentityReferenceField({
  field,
  profileId,
  tenantId,
  value,
  selectedReference,
  onChange,
  invalid,
  helperText,
}) {
  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const selectedOption = useMemo(() => {
    if (!selectedReference?.identityId) return null;
    return (
      options.find((option) => option.identityId === selectedReference.identityId) || {
        identityId: selectedReference.identityId,
        referenceValue: selectedReference.referenceValue || value,
        displayName: selectedReference.displayName || value,
      }
    );
  }, [options, selectedReference, value]);

  useEffect(() => {
    if (!profileId || !tenantId) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      identityProfileAPI
        .getReferenceOptions(
          profileId,
          { tenantId, q: inputValue.trim(), limit: field.reference?.limit || 5 },
          { signal: controller.signal },
        )
        .then((res) => setOptions((res.data?.data || []).slice(0, 5)))
        .catch((error) => {
          if (error?.code !== 'ERR_CANCELED') setOptions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [field.reference?.limit, inputValue, profileId, tenantId]);

  return (
    <Autocomplete
      options={options}
      value={selectedOption}
      inputValue={inputValue}
      loading={loading}
      filterOptions={(rows) => rows}
      isOptionEqualToValue={(option, selected) => option.identityId === selected.identityId}
      // This field stores the manager's reference value, so it must show that value —
      // showing the name here would not match what lands in the attribute.
      getOptionLabel={(option) => option?.referenceValue || ''}
      onInputChange={(event, nextValue, reason) => {
        if (reason === 'input' || reason === 'clear') setInputValue(nextValue);
      }}
      onChange={(event, option) => {
        onChange(option);
        setInputValue(option?.referenceValue || '');
      }}
      noOptionsText={inputValue ? 'No matching identities' : 'No identities available'}
      renderOption={(props, option) => (
        <Box component="li" {...props} key={option.identityId}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {option.referenceValue}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {[option.displayName, option.employeeId ? `Employee ID: ${option.employeeId}` : null]
                .filter(Boolean)
                .join(' · ')}
            </Typography>
          </Box>
        </Box>
      )}
      ListboxProps={{ style: { maxHeight: 220 } }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={field.label}
          required={field.required}
          error={invalid}
          helperText={helperText}
          placeholder={`Search name or ${field.reference?.referenceAttribute || 'ID'}`}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
