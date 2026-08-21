import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  TextField,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Radio,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { Add, Delete, Save, UploadFile, FileDownload, TableChart, CheckCircleOutline } from '@mui/icons-material';
import Papa from 'papaparse';
import { applicationAPI } from '../../services/api';
import { palette } from '../../theme/palette';

const DATA_TYPES = ['String', 'Number', 'Boolean', 'Date'];

const TECH_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
/** Preferred PK column names when auto-detecting from CSV headers (same idea as user_id for users). */
const DEFAULT_ENTITLEMENT_PK_CANDIDATES = ['entitlement_id', 'id', 'name'];

function technicalToDisplayName(fieldName) {
  return String(fieldName || '')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function detectType(values) {
  const samples = values.filter(Boolean).slice(0, 20);
  if (!samples.length) return 'String';

  const isoDateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
  let numCount = 0;
  let boolCount = 0;
  let dateCount = 0;
  for (const v of samples) {
    const s = String(v).trim();
    if (s === 'true' || s === 'false' || s === 'TRUE' || s === 'FALSE') {
      boolCount++;
      continue;
    }
    if (!Number.isNaN(parseFloat(s)) && isFinite(Number(s))) {
      numCount++;
      continue;
    }
    if (isoDateRe.test(s)) {
      dateCount++;
      continue;
    }
  }
  const n = samples.length;
  if (boolCount / n > 0.7) return 'Boolean';
  if (numCount / n > 0.7) return 'Number';
  if (dateCount / n > 0.7) return 'Date';
  return 'String';
}

function mappingsToRows(entitlementMappings) {
  if (!Array.isArray(entitlementMappings) || entitlementMappings.length === 0) return [];
  return entitlementMappings.map((m, i) => ({
    localId: `ent-row-${i}-${m.standardField}`,
    displayName: (m.displayName && String(m.displayName).trim()) || m.standardField || '',
    standardField: String(m.standardField || '').trim(),
    dataType: m.dataType || 'String',
    maxLength: m.maxLength != null && m.maxLength !== '' ? String(m.maxLength) : '',
    isPk: Boolean(m.isPrimaryKey),
  }));
}

/** Legacy saves may omit isPrimaryKey; pick entitlement_id (or first column) so the UI matches the user schema tab. */
function hydrateSavedEntitlementRows(entitlementMappings) {
  const raw = mappingsToRows(entitlementMappings);
  if (raw.length === 0) return raw;
  if (raw.some((r) => r.isPk)) return raw;
  const idx = raw.findIndex((r) =>
    DEFAULT_ENTITLEMENT_PK_CANDIDATES.includes(r.standardField.toLowerCase()),
  );
  const pick = idx >= 0 ? idx : 0;
  return raw.map((r, j) => ({ ...r, isPk: j === pick }));
}

function buildEntitlementMappingsPayload(rowList) {
  return rowList.map((r) => {
    const sf = r.standardField.trim();
    const base = {
      csvColumn: sf,
      standardField: sf,
      dataType: r.dataType || 'String',
      isSensitive: false,
      isPrimaryKey: r.isPk,
    };
    const dn = r.displayName.trim();
    if (dn) base.displayName = dn;
    if (r.maxLength.trim()) {
      const n = Number.parseInt(r.maxLength, 10);
      if (!Number.isNaN(n) && n >= 0) base.maxLength = n;
    }
    return base;
  });
}

function normalizeRowsForCompare(rowList) {
  return rowList.map((r) => ({
    standardField: String(r.standardField || '').trim(),
    displayName: String(r.displayName || '').trim(),
    dataType: String(r.dataType || 'String').trim() || 'String',
    maxLength: String(r.maxLength || '').trim(),
    isPk: Boolean(r.isPk),
  }));
}

function rowsEquivalent(a, b) {
  return JSON.stringify(normalizeRowsForCompare(a)) === JSON.stringify(normalizeRowsForCompare(b));
}

export default function ApplicationEntitlementSchemaTab({ applicationId, app, onSaved }) {
  const importInputRef = useRef(null);
  const oneStepInputRef = useRef(null);

  const [workflow, setWorkflow] = useState('manual');
  const [rows, setRows] = useState([]);
  const [schemaBootstrapping, setSchemaBootstrapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState({ severity: 'info', message: '' });

  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    displayName: '',
    standardField: '',
    dataType: 'String',
    maxLength: '',
  });

  const [oneStepDialogOpen, setOneStepDialogOpen] = useState(false);
  const [oneStepPreview, setOneStepPreview] = useState([]);
  const [oneStepFileObj, setOneStepFileObj] = useState(null);

  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [successDialogMessage, setSuccessDialogMessage] = useState('');

  const savedRows = useMemo(
    () => hydrateSavedEntitlementRows(app?.entitlementMappings),
    [app?.entitlementMappings],
  );

  const hasUnsavedSchema = useMemo(() => !rowsEquivalent(rows, savedRows), [rows, savedRows]);

  useEffect(() => {
    setToast({ severity: 'info', message: '' });

    if (savedRows.length > 0) {
      setRows(savedRows);
      setSchemaBootstrapping(false);
      return undefined;
    }

    if (!applicationId) {
      setRows([]);
      setSchemaBootstrapping(false);
      return undefined;
    }

    setRows([]);
    setSchemaBootstrapping(false);
    return undefined;
  }, [applicationId, savedRows]);

  const legacyAliasWarning = useMemo(() => {
    const list = app?.entitlementMappings || [];
    return list.some(
      (m) =>
        String(m.csvColumn || '').trim() &&
        String(m.standardField || '').trim() &&
        String(m.csvColumn).trim() !== String(m.standardField).trim(),
    );
  }, [app?.entitlementMappings]);

  const pkCount = useMemo(() => rows.filter((r) => r.isPk).length, [rows]);

  const canSave = useMemo(() => {
    if (rows.length === 0 || saving) return false;
    if (pkCount !== 1) return false;
    for (const r of rows) {
      if (!r.standardField || !TECH_NAME_RE.test(r.standardField)) return false;
      if (!r.displayName.trim()) return false;
    }
    const keys = new Set(rows.map((r) => r.standardField.toLowerCase()));
    if (keys.size !== rows.length) return false;
    return true;
  }, [rows, pkCount, saving]);

  const schemaStatusText = useMemo(() => {
    if (schemaBootstrapping) return 'Loading default schema attributes...';
    if (pkCount === 0 && rows.length > 0) return 'Select a primary key (required).';
    if (pkCount > 1) return 'Only one primary key allowed.';
    if (hasUnsavedSchema && rows.length > 0) return 'Schema has unsaved changes.';
    if (rows.length === 0) return 'No attributes yet. Import a CSV to auto-detect schema, or add attributes manually.';
    return 'Schema is saved and ready for import.';
  }, [schemaBootstrapping, pkCount, hasUnsavedSchema, rows.length]);

  const emptyRowsText = schemaBootstrapping
    ? 'Loading schema attributes...'
    : 'No attributes yet. Import a CSV to auto-detect schema, or click "+ Add attribute".';

  const setPkFor = useCallback((standardField) => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        isPk: r.standardField === standardField,
      })),
    );
  }, []);

  const handleRemove = (localId) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.localId !== localId);
      if (next.length && !next.some((r) => r.isPk)) {
        next[0] = { ...next[0], isPk: true };
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!canSave) return;
    const pk = rows.find((r) => r.isPk);
    if (!pk) return;

    const entitlementMappings = buildEntitlementMappingsPayload(rows);

    setSaving(true);
    setToast({ severity: 'info', message: '' });
    try {
      await applicationAPI.update(applicationId, { entitlementMappings });
      setToast({ severity: 'success', message: 'Entitlement schema saved.' });
      onSaved?.();
    } catch (e) {
      setToast({
        severity: 'error',
        message: e.response?.data?.message || e.message || 'Failed to save schema',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleExportTemplate = () => {
    if (!rows.length) {
      setToast({ severity: 'warning', message: 'Add attributes and save the schema before exporting.' });
      return;
    }
    const headers = rows.map((r) => r.standardField.trim());
    const line = headers.map((h) => (/,|"|\n|\r/.test(h) ? `"${String(h).replace(/"/g, '""')}"` : h)).join(',');
    const blob = new Blob([`${line}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(app?.name || 'application').replace(/[^a-z0-9-_]/gi, '_')}_entitlement_schema_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast({ severity: 'success', message: 'Template CSV downloaded (header row = technical names).' });
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!rows.length) {
      setToast({
        severity: 'warning',
        message: 'Save a schema with at least one attribute before importing entitlements.',
      });
      if (importInputRef.current) importInputRef.current.value = '';
      return;
    }

    setImporting(true);
    setToast({ severity: 'info', message: '' });
    try {
      const text = await file.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim(),
      });
      const fields = parsed.meta.fields || [];
      const expected = new Set(rows.map((r) => r.standardField.trim()));
      const actual = new Set(fields.map((f) => String(f).trim()).filter(Boolean));

      const missing = [...expected].filter((k) => !actual.has(k)).sort();
      const extra = [...actual].filter((k) => !expected.has(k)).sort();

      if (missing.length || extra.length) {
        setToast({
          severity: 'warning',
          message: `CSV headers must match saved technical names exactly. Missing: ${missing.join(', ') || '—'}. Extra: ${extra.join(', ') || '—'}. Fix the file or update the schema.`,
        });
        return;
      }

      if (hasUnsavedSchema || !Array.isArray(app?.entitlementMappings) || app.entitlementMappings.length === 0) {
        if (!canSave) {
          setToast({
            severity: 'warning',
            message: 'Complete schema fields and select exactly one primary key before importing entitlements.',
          });
          return;
        }
        const entitlementMappings = buildEntitlementMappingsPayload(rows);
        await applicationAPI.update(applicationId, { entitlementMappings });
      }

      const fd = new FormData();
      fd.append('file', file);
      const res = await applicationAPI.uploadEntitlementsCsvStrict(applicationId, fd);
      const n = res.data?.totalRecords ?? res.data?.data?.totalRecords;
      setSuccessDialogMessage(res.data?.message || `Successfully imported ${n ?? '0'} entitlement row(s).`);
      setSuccessDialogOpen(true);
      onSaved?.();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.message || err.message || 'Import failed';
      const detail =
        Array.isArray(d?.missing) || Array.isArray(d?.extra)
          ? ` Missing: ${(d.missing || []).join(', ') || '—'}. Extra: ${(d.extra || []).join(', ') || '—'}.`
          : '';
      setToast({ severity: 'error', message: `${msg}${detail}` });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleOneStepFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (oneStepInputRef.current) oneStepInputRef.current.value = '';

    try {
      const text = await file.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim(),
      });

      const fields = (parsed.meta.fields || []).filter(Boolean);
      if (!fields.length) {
        setToast({ severity: 'warning', message: 'The CSV has no headers. Please check the file.' });
        return;
      }

      const colValues = {};
      for (const field of fields) {
        colValues[field] = (parsed.data || []).map((row) => row[field]).filter(Boolean);
      }

      const draft = fields.map((field, idx) => ({
        localId: `ent-csv-${idx}-${field}`,
        displayName: technicalToDisplayName(field),
        standardField: field,
        dataType: detectType(colValues[field]),
        maxLength: '',
        isPk: false,
      }));

      const pkIndex = draft.findIndex((r) =>
        DEFAULT_ENTITLEMENT_PK_CANDIDATES.includes(r.standardField.toLowerCase()),
      );
      if (pkIndex !== -1) {
        draft[pkIndex].isPk = true;
      } else if (draft.length > 0) {
        draft[0].isPk = true;
      }

      setOneStepPreview(draft);
      setOneStepFileObj(file);
      setOneStepDialogOpen(true);
    } catch (err) {
      setToast({ severity: 'error', message: 'Failed to parse CSV for one-step import.' });
    }
  };

  const handleOneStepProceed = async () => {
    if (!oneStepFileObj) return;
    const pk = oneStepPreview.find((r) => r.isPk);
    if (!pk) {
      setToast({ severity: 'warning', message: 'Please select a primary key.' });
      return;
    }

    setImporting(true);
    setToast({ severity: 'info', message: '' });
    try {
      const validDraft = oneStepPreview.filter((r) => r.standardField && TECH_NAME_RE.test(r.standardField));
      const entitlementMappings = buildEntitlementMappingsPayload(validDraft);
      await applicationAPI.update(applicationId, { entitlementMappings });
      setRows(validDraft);

      const fd = new FormData();
      fd.append('file', oneStepFileObj);
      const res = await applicationAPI.uploadEntitlementsCsvStrict(applicationId, fd);
      const n = res.data?.totalRecords ?? res.data?.data?.totalRecords;

      setSuccessDialogMessage(
        res.data?.message || `Schema generated and successfully imported ${n ?? '0'} entitlement row(s).`,
      );
      setSuccessDialogOpen(true);

      setOneStepDialogOpen(false);
      setOneStepFileObj(null);
      onSaved?.();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.message || err.message || 'Import failed';
      setToast({ severity: 'error', message: msg });
    } finally {
      setImporting(false);
    }
  };

  const confirmAdd = () => {
    const displayName = addForm.displayName.trim();
    let tech = addForm.standardField.trim();
    if (!displayName) return;
    if (!tech) {
      tech = displayName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    }
    if (!TECH_NAME_RE.test(tech)) {
      setToast({
        severity: 'warning',
        message: 'Technical name must start with a letter or underscore and contain only letters, numbers, and underscores.',
      });
      return;
    }
    if (rows.some((r) => r.standardField.toLowerCase() === tech.toLowerCase())) {
      setToast({ severity: 'warning', message: 'That technical name already exists.' });
      return;
    }
    const localId = `new-${Date.now()}`;
    setRows((prev) => {
      const next = [
        ...prev,
        {
          localId,
          displayName,
          standardField: tech,
          dataType: addForm.dataType || 'String',
          maxLength: addForm.maxLength.trim(),
          isPk: prev.length === 0,
        },
      ];
      return next;
    });
    setAddForm({ displayName: '', standardField: '', dataType: 'String', maxLength: '' });
    setAddOpen(false);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            Entitlement schema
          </Typography>
          <ToggleButtonGroup
            color="primary"
            value={workflow}
            exclusive
            onChange={(e, v) => {
              if (v) setWorkflow(v);
            }}
            size="small"
            sx={{ mb: 2 }}
          >
            <ToggleButton value="manual">Manual Setup</ToggleButton>
            <ToggleButton value="onestep">Import Schema</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
            {workflow === 'manual'
              ? 'Define attributes manually or verify them here. Technical names are used as CSV headers. Export a template and import data once defined. Exactly one primary key is required.'
              : 'Quickly upload a CSV with headers. We will auto-detect the schema and import entitlements in one seamless step.'}
          </Typography>
        </Box>
        {workflow === 'manual' && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<FileDownload />}
              onClick={handleExportTemplate}
              disabled={!rows.length || schemaBootstrapping || importing || saving}
            >
              Export CSV template
            </Button>

            <input
              type="file"
              accept=".csv"
              ref={importInputRef}
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <Button
              variant="outlined"
              startIcon={<UploadFile />}
              onClick={() => importInputRef.current?.click()}
              disabled={importing || !rows.length || schemaBootstrapping || saving}
            >
              {importing ? 'Importing…' : 'Import entitlements'}
            </Button>

            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
              disabled={!canSave || schemaBootstrapping || importing}
            >
              {saving ? 'Saving…' : 'Save schema'}
            </Button>
          </Box>
        )}
      </Box>

      {legacyAliasWarning && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          This application has legacy column aliases (CSV column differs from technical name). Saving from this tab will set{' '}
          <strong>csvColumn = technical name</strong> for all attributes.
        </Alert>
      )}

      {toast.message && (
        <Alert severity={toast.severity} sx={{ mb: 2 }} onClose={() => setToast((t) => ({ ...t, message: '' }))}>
          {toast.message}
        </Alert>
      )}

      {workflow === 'manual' && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2" color={hasUnsavedSchema && rows.length ? 'warning.main' : 'text.secondary'}>
              {schemaStatusText}
            </Typography>
            <Button variant="outlined" size="small" startIcon={<Add />} onClick={() => setAddOpen(true)}>
              Add attribute
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined" sx={{ borderColor: palette.border?.default }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell width={56}>PK</TableCell>
                  <TableCell>Display name</TableCell>
                  <TableCell>Technical name</TableCell>
                  <TableCell width={120}>Type</TableCell>
                  <TableCell width={100}>Length</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                      {emptyRowsText}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.localId} hover>
                      <TableCell>
                        <Radio size="small" checked={r.isPk} onChange={() => setPkFor(r.standardField)} />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={r.displayName}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              prev.map((x) => (x.localId === r.localId ? { ...x, displayName: v } : x)),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          value={r.standardField}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              prev.map((x) => (x.localId === r.localId ? { ...x, standardField: v } : x)),
                            );
                          }}
                          disabled={saving}
                          error={Boolean(r.standardField) && !TECH_NAME_RE.test(r.standardField)}
                          helperText={
                            r.standardField && !TECH_NAME_RE.test(r.standardField)
                              ? 'Use letters, numbers, underscore; start with letter or _'
                              : ''
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          select
                          size="small"
                          fullWidth
                          value={r.dataType}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              prev.map((x) => (x.localId === r.localId ? { ...x, dataType: v } : x)),
                            );
                          }}
                        >
                          {DATA_TYPES.map((dt) => (
                            <MenuItem key={dt} value={dt}>
                              {dt}
                            </MenuItem>
                          ))}
                        </TextField>
                      </TableCell>
                      <TableCell>
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="—"
                          value={r.maxLength}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '');
                            setRows((prev) =>
                              prev.map((x) => (x.localId === r.localId ? { ...x, maxLength: v } : x)),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <IconButton size="small" color="error" onClick={() => handleRemove(r.localId)} aria-label="Remove">
                          <Delete fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {workflow === 'onestep' && (
        <Box
          sx={{
            p: 4,
            textAlign: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
            bgcolor: 'background.paper',
          }}
        >
          <TableChart color="primary" sx={{ fontSize: 48, mb: 2, opacity: 0.8 }} />
          <Typography variant="h6" gutterBottom>
            Upload and Import
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Upload a CSV containing your entitlements. We will automatically create the schema attributes from the headers and import the rows in one go.
          </Typography>
          <input
            type="file"
            accept=".csv"
            ref={oneStepInputRef}
            style={{ display: 'none' }}
            onChange={handleOneStepFile}
          />
          <Button
            variant="contained"
            size="large"
            startIcon={<UploadFile />}
            onClick={() => oneStepInputRef.current?.click()}
            disabled={importing || schemaBootstrapping || saving}
          >
            Select CSV File & Import
          </Button>
        </Box>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add attribute</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Display name"
            fullWidth
            required
            value={addForm.displayName}
            onChange={(e) => setAddForm((f) => ({ ...f, displayName: e.target.value }))}
          />
          <TextField
            label="Technical name"
            fullWidth
            placeholder="Auto from display name if empty"
            value={addForm.standardField}
            onChange={(e) => setAddForm((f) => ({ ...f, standardField: e.target.value }))}
          />
          <TextField
            select
            label="Type"
            fullWidth
            value={addForm.dataType}
            onChange={(e) => setAddForm((f) => ({ ...f, dataType: e.target.value }))}
          >
            {DATA_TYPES.map((dt) => (
              <MenuItem key={dt} value={dt}>
                {dt}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Max length (optional)"
            fullWidth
            value={addForm.maxLength}
            onChange={(e) => setAddForm((f) => ({ ...f, maxLength: e.target.value.replace(/\D/g, '') }))}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={confirmAdd}>
            Add
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={oneStepDialogOpen} onClose={() => !importing && setOneStepDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm import schema</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 3 }}>
            We detected <strong>{oneStepPreview.length}</strong> columns in your CSV. Please select the primary key column used to identify each entitlement row.
          </Typography>
          <TextField
            select
            fullWidth
            label="Primary Key column"
            value={oneStepPreview.find((r) => r.isPk)?.standardField || ''}
            onChange={(e) => {
              const v = e.target.value;
              setOneStepPreview((prev) => prev.map((r) => ({ ...r, isPk: r.standardField === v })));
            }}
          >
            {oneStepPreview.map((r) => (
              <MenuItem key={r.localId} value={r.standardField}>
                {r.displayName} ({r.standardField})
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOneStepDialogOpen(false)} disabled={importing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleOneStepProceed} disabled={importing}>
            {importing ? 'Importing...' : 'Save Schema & Import Entitlements'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={successDialogOpen} onClose={() => setSuccessDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center', pb: 1, pt: 3 }}>
          <CheckCircleOutline color="success" sx={{ fontSize: 56, mb: 1 }} />
          <Typography variant="h6">Import Successful</Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
          <Typography variant="body1">{successDialogMessage}</Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 4 }}>
          <Button variant="contained" size="large" onClick={() => setSuccessDialogOpen(false)}>
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
