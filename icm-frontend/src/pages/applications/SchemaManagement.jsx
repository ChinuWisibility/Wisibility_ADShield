import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  MenuItem,
  TextField,
  FormControl,
  InputLabel,
  Select,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  Snackbar,
  Stack,
  CircularProgress,
  Radio,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Save,
  UploadFile,
  Delete,
  AutoAwesome,
  SettingsEthernet,
  RestartAlt,
  AddCircleOutline,
} from '@mui/icons-material';
import Papa from 'papaparse';
import { applicationAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';

const SS_APP = 'icm_schema_mgmt_app';
const SS_DATA_TYPE = 'icm_schema_mgmt_dataType';

/** Memoized row — only re-renders when its own props change, not when dialog state changes */
const MappingRow = memo(function MappingRow({
  row, index, dataType, primaryKeyField, isLocked,
  csvHeaders, onMappingChange, onPkChange, onDelete,
}) {
  const opts = [...csvHeaders];
  const col = row.csvColumn ? String(row.csvColumn) : '';
  if (col && !opts.includes(col)) opts.push(col);
  const selectVal = col && opts.includes(col) ? col : '';

  return (
    <TableRow hover>
      {(dataType === 'application_users' || dataType === 'identities' || dataType === 'entitlements') && (
  <TableCell align="center">
    <Tooltip title={isLocked ? 'Primary Key immutable after data sync' : 'Set as Primary Key'} arrow>
      <span>
        <Radio
          checked={primaryKeyField === row.standardField}
          onChange={() => onPkChange(row.standardField)}
          size="small"
          disabled={isLocked}
        />
      </span>
    </Tooltip>
  </TableCell>
)}
      <TableCell sx={{ width: '45%' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: palette.text.primary, fontFamily: 'monospace' }}>
          {row.standardField}
        </Typography>
        {row.displayName && row.displayName !== row.standardField && (
          <Typography variant="caption" color="text.secondary">{row.displayName}</Typography>
        )}
      </TableCell>
      <TableCell align="center" sx={{ color: palette.border?.default }}>→</TableCell>
      <TableCell sx={{ width: '45%' }}>
        <FormControl fullWidth size="small" sx={{ minWidth: 160, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}>
          <InputLabel id={`csv-map-${row.standardField}`} shrink>CSV column</InputLabel>
          <Select
            labelId={`csv-map-${row.standardField}`}
            label="CSV column"
            notched
            value={selectVal}
            onChange={(e) => onMappingChange(index, e.target.value)}
            displayEmpty
          >
            <MenuItem value=""><em>— Unmapped —</em></MenuItem>
            {opts.map((h) => <MenuItem key={h} value={h}>{h}</MenuItem>)}
          </Select>
        </FormControl>
      </TableCell>
      <TableCell align="center">
        <Tooltip title="Remove attribute" arrow>
          <IconButton size="small" onClick={() => onDelete(index)} sx={{ color: 'error.main', opacity: 0.7, '&:hover': { opacity: 1 } }}>
            <Delete fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
});

export default function SchemaManagement() {
  const fileInputRef = useRef(null);
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [applications, setApplications] = useState([]);
  const [selectedApp, setSelectedApp] = useState('');
  const [dataType, setDataType] = useState('application_users');
  const [mappings, setMappings] = useState([]);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [sampleFileName, setSampleFileName] = useState('');

  const [selectedAppData, setSelectedAppData] = useState(null);
  const [primaryKeyField, setPrimaryKeyField] = useState('');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });

  const showToast = useCallback((message, severity) => {
    setToast({ open: true, message, severity });
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setApplications([]);
      setSelectedApp('');
      return;
    }
    applicationAPI.list({ tenantId }).then((res) => {
      const apps = res.data?.data || [];
      setApplications(apps);
      const storedId = sessionStorage.getItem(SS_APP);
      const storedDt = sessionStorage.getItem(SS_DATA_TYPE);
      if (storedId && apps.some((a) => String(a._id || a.id) === String(storedId))) {
        setSelectedApp(storedId);
      } else {
        setSelectedApp('');
      }
      if (storedDt === 'application_users' || storedDt === 'entitlements') {
        setDataType(storedDt);
      }
    });
  }, [tenantId]);

  const loadConfiguration = useCallback(async () => {
    if (!selectedApp) return;
    setLoading(true);
    try {
      const [appRes, fieldsRes] = await Promise.all([
        applicationAPI.getById(selectedApp),
        applicationAPI.getModelFields(dataType),
      ]);

      const appData = appRes.data?.data;
      const fields = fieldsRes.data?.data || [];
      setSelectedAppData(appData);

      const rawSaved =
        dataType === 'application_users' ? appData?.userMappings :
        dataType === 'identities' ? appData?.identityMappings :
        appData?.entitlementMappings;
      const savedMappings = Array.isArray(rawSaved) ? rawSaved : [];

      let pkField = '';
      if (dataType === 'application_users' || dataType === 'entitlements') {
        const pkDef = savedMappings.find((m) => m.isPrimaryKey);
        if (pkDef) pkField = pkDef.standardField;
      }
      setPrimaryKeyField(pkField);

      const initialMappings = fields.map((sysField) => {
        const existing = savedMappings.find(
          (m) => String(m.standardField || '').trim() === String(sysField).trim()
        );
        return {
          standardField: sysField,
          csvColumn: existing && existing.csvColumn != null ? String(existing.csvColumn) : '',
          dataType: 'String',
        };
      });

      setMappings(initialMappings);
      setSampleFileName('');
      setCsvHeaders([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch {
      showToast('Failed to fetch application schema', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedApp, dataType, showToast]);

  useEffect(() => {
    if (!selectedApp) return;
    loadConfiguration();
  }, [selectedApp, dataType, loadConfiguration]);

  const handleSampleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSampleFileName(file.name);
    Papa.parse(file, {
      header: true,
      preview: 1,
      complete: (results) => {
        if (results.meta.fields) {
          setCsvHeaders(results.meta.fields);
          setMappings((prev) =>
            prev.map((m) => {
              const match = results.meta.fields.find(
                (h) => h.toLowerCase().trim() === m.standardField.toLowerCase().trim()
              );
              return { ...m, csvColumn: match || m.csvColumn };
            })
          );
          showToast(`Matched headers from ${file.name}`, 'info');
        }
      },
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCancelFile = () => {
    setSampleFileName('');
    setCsvHeaders([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMappingChange = useCallback((index, value) => {
    setMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], csvColumn: value };
      return next;
    });
  }, []);

  const handleDeleteRow = useCallback((index) => {
    setMappings((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (prev[index]?.standardField === primaryKeyField) setPrimaryKeyField('');
      return next;
    });
  }, [primaryKeyField]);

  const handlePkChange = useCallback((field) => setPrimaryKeyField(field), []);

  // --- Add Attribute Dialog ---
  const [addOpen, setAddOpen] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newTechName, setNewTechName] = useState('');
  const [techNameTouched, setTechNameTouched] = useState(false);

  const handleDisplayNameChange = (val) => {
    setNewDisplayName(val);
    if (!techNameTouched) {
      setNewTechName(val.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    }
  };

  const handleConfirmAdd = () => {
    const key = newTechName.trim();
    if (!key) return;
    if (mappings.some((m) => m.standardField === key)) {
      showToast(`Field "${key}" already exists.`, 'warning');
      return;
    }
    setMappings((prev) => [...prev, { standardField: key, displayName: newDisplayName.trim(), csvColumn: '', dataType: 'String', isCustom: true }]);
    setAddOpen(false);
    setNewDisplayName('');
    setNewTechName('');
    setTechNameTouched(false);
  };

  const handleSaveSchema = async () => {
    const validMappings = mappings.filter((m) => m.csvColumn.trim() !== '').map(m => ({
      ...m,
      isPrimaryKey:
        dataType === 'application_users' || dataType === 'entitlements'
          ? m.standardField === primaryKeyField
          : false
    }));

    if (dataType === 'application_users' && !primaryKeyField) {
      showToast('You must select a Primary Key column to uniquely identify users.', 'error');
      return;
    }
    if (dataType === 'entitlements' && !primaryKeyField) {
      showToast('You must select a Primary Key column to uniquely identify entitlements.', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload =
        dataType === 'application_users'
          ? { userMappings: validMappings }
          : dataType === 'identities'
          ? { identityMappings: validMappings }
          : { entitlementMappings: validMappings };

      await applicationAPI.update(selectedApp, payload);
      showToast('Blueprint saved successfully!', 'success');
      await loadConfiguration();
    } catch {
      showToast('Failed to save blueprint', 'error');
    } finally {
      setSaving(false);
    }
  };

  const pageBg = palette.bg.elevated;
  const cardBorder = palette.border.default;

  const csvSelectOptions = (row) => {
    const opts = [...csvHeaders];
    const col = row.csvColumn ? String(row.csvColumn) : '';
    if (col && !opts.includes(col)) opts.push(col);
    return opts;
  };

  const csvSelectValue = (row) => {
    const col = row.csvColumn ? String(row.csvColumn).trim() : '';
    if (!col) return '';
    const opts = csvSelectOptions(row);
    return opts.includes(col) ? col : '';
  };

  const isLocked = Boolean(
    selectedAppData?.totalAccounts > 0 ||
    selectedAppData?.hrms?.delimitedImportRows?.length > 0 ||
    selectedAppData?.totalUsers > 0
  );

  return (
    <Box sx={{ p: 4, bgcolor: pageBg, minHeight: '100vh' }}>
      <Box sx={{ maxWidth: 1200, margin: '0 auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
              <SettingsEthernet fontSize="large" />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ fontWeight: 800, color: palette.text.primary }}>
                Mapping Studio
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Align CSV columns with system database attributes.
              </Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="outlined"
              startIcon={<RestartAlt />}
              onClick={loadConfiguration}
              disabled={loading || !selectedApp}
              sx={{ borderRadius: 2, textTransform: 'none' }}
            >
              Reset All
            </Button>
            <Tooltip
              title={
                (dataType === 'application_users' || dataType === 'entitlements') && !primaryKeyField
                  ? 'Select a Primary Key field (PK column) before saving'
                  : ''
              }
              arrow
            >
              <span>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  onClick={handleSaveSchema}
                  disabled={
                    saving ||
                    !selectedApp ||
                    loading ||
                    ((dataType === 'application_users' || dataType === 'entitlements') && !primaryKeyField)
                  }
                  sx={{ borderRadius: 2, px: 4, fontWeight: 700, textTransform: 'none' }}
                >
                  {saving ? 'Saving…' : 'Save Blueprint'}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>

        <Stack spacing={3}>
          <Card elevation={0} sx={{ border: `1px solid ${cardBorder}`, borderRadius: 3 }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="overline" sx={{ fontWeight: 700, color: 'primary.main' }}>
                Selection & data source
              </Typography>
              <Box
                sx={{
                  mt: 2,
                  display: 'flex',
                  flexDirection: { xs: 'column', md: 'row' },
                  flexWrap: 'wrap',
                  gap: 2,
                  alignItems: { xs: 'stretch', md: 'flex-end' },
                }}
              >
                <TextField
                  select
                  fullWidth
                  label="Application"
                  size="small"
                  value={selectedApp}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedApp(v);
                    if (v) sessionStorage.setItem(SS_APP, v);
                    else sessionStorage.removeItem(SS_APP);
                  }}
                  disabled={!tenantId}
                  sx={{ flex: { md: '1 1 200px' }, minWidth: { md: 200 } }}
                >
                  {!applications.length ? (
                    <MenuItem value="" disabled>
                      No applications — add one in App Registry
                    </MenuItem>
                  ) : (
                    [
                      <MenuItem key="__placeholder" value="" disabled>
                        <em>Select application</em>
                      </MenuItem>,
                      ...applications.map((app) => (
                        <MenuItem key={app._id} value={app._id}>
                          {app.name}
                        </MenuItem>
                      )),
                    ]
                  )}
                </TextField>
                <TextField
                  select
                  fullWidth
                  label="Data Model"
                  size="small"
                  value={dataType}
                  onChange={(e) => setDataType(e.target.value)}
                  disabled={!selectedApp}
                  sx={{ flex: { md: '1 1 180px' }, minWidth: { md: 180 } }}
                >
                  <MenuItem value="application_users">Application Users</MenuItem>
                  <MenuItem value="entitlements">Entitlements / Roles</MenuItem>
                  <MenuItem value="identities">Identities</MenuItem>
                </TextField>
                <Box sx={{ flex: { md: '1 1 220px' }, minWidth: { md: 200 } }}>
                  <input
                    type="file"
                    accept=".csv"
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                    onChange={handleSampleUpload}
                  />
                  {!sampleFileName ? (
                    <Button
                      fullWidth
                      variant="outlined"
                      startIcon={<UploadFile />}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!selectedApp}
                      sx={{ borderStyle: 'dashed', py: 1.25, textTransform: 'none', height: 40 }}
                    >
                      Upload Sample CSV
                    </Button>
                  ) : (
                    <Box
                      sx={{
                        p: 1.5,
                        pr: 5,
                        bgcolor: 'primary.light',
                        borderRadius: 2,
                        color: 'primary.contrastText',
                        position: 'relative',
                        minHeight: 40,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Typography variant="body2" noWrap sx={{ pr: 1 }}>
                        {sampleFileName}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={handleCancelFile}
                        sx={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', color: 'inherit' }}
                        aria-label="Remove sample file"
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </Box>
                  )}
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Saved blueprint mappings load from the server whenever you select an application. Upload a sample CSV to
                add those column names as pick-list options.
              </Typography>
            </CardContent>
          </Card>

          <TableContainer
            component={Paper}
            elevation={0}
            sx={{
              border: `1px solid ${cardBorder}`,
              borderRadius: 3,
              overflow: 'hidden',
              position: 'relative',
              minHeight: 280,
            }}
          >
            {loading && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'rgba(255,255,255,0.72)',
                  zIndex: 1,
                }}
              >
                <CircularProgress size={40} />
              </Box>
            )}
            <Table>
              <TableHead sx={{ bgcolor: palette.bg.primary }}>
                <TableRow>
                  {(dataType === 'application_users' || dataType === 'identities' || dataType === 'entitlements') && (
  <TableCell width={50} align="center" sx={{ fontWeight: 700, color: palette.text.secondary }}>PK</TableCell>
)}
                  <TableCell sx={{ fontWeight: 700, color: palette.text.secondary }}>SYSTEM FIELD</TableCell>
                  <TableCell align="center" width={56}>
                    <AutoAwesome sx={{ color: palette.text.disabled }} />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700, color: palette.text.secondary }}>CSV SOURCE COLUMN</TableCell>
                  <TableCell width={48}>
                    {selectedApp && (
                      <Tooltip title="Add new attribute" arrow>
                        <IconButton size="small" onClick={() => setAddOpen(true)} sx={{ color: 'primary.main' }}>
                          <AddCircleOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mappings.map((row, index) => (
                  <MappingRow
                    key={row.standardField}
                    row={row}
                    index={index}
                    dataType={dataType}
                    primaryKeyField={primaryKeyField}
                    isLocked={isLocked}
                    csvHeaders={csvHeaders}
                    onMappingChange={handleMappingChange}
                    onPkChange={handlePkChange}
                    onDelete={handleDeleteRow}
                  />
                ))}
              </TableBody>
            </Table>
            {!loading && mappings.length === 0 && (
              <Box sx={{ p: 6, textAlign: 'center' }}>
                <Typography color="text.secondary">
                  {selectedApp ? 'No model fields returned for this data type.' : 'Select an application to view fields.'}
                </Typography>
              </Box>
            )}
          </TableContainer>
        </Stack>

        {/* Add New Attribute Dialog */}
        <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}>Add New Attribute</DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Display Name"
                placeholder="e.g. Department Code"
                value={newDisplayName}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                size="small"
                fullWidth
                autoFocus
              />
              <TextField
                label="Technical Key (snake_case)"
                placeholder="e.g. department_code"
                value={newTechName}
                onChange={(e) => { setNewTechName(e.target.value); setTechNameTouched(true); }}
                size="small"
                fullWidth
                inputProps={{ style: { fontFamily: 'monospace' } }}
                helperText="Auto-derived from display name. Used internally as the field identifier."
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setAddOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
            <Button
              variant="contained"
              onClick={handleConfirmAdd}
              disabled={!newTechName.trim()}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Add Attribute
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar
          open={toast.open}
          autoHideDuration={4000}
          onClose={() => setToast((t) => ({ ...t, open: false }))}
        >
          <Alert severity={toast.severity} variant="filled" onClose={() => setToast((t) => ({ ...t, open: false }))}>
            {toast.message}
          </Alert>
        </Snackbar>
      </Box>
    </Box>
  );
}
