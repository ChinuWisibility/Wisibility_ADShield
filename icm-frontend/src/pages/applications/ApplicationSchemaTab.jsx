import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { Add, Delete, Save, UploadFile, FileDownload, TableChart, CheckCircleOutline } from '@mui/icons-material';
import Papa from 'papaparse';
import { applicationAPI } from '../../services/api';
import { palette } from '../../theme/palette';

const DATA_TYPES = ['String', 'Number', 'Boolean', 'Date'];

const TECH_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DEFAULT_PK_CANDIDATES = ['user_id', 'employee_id', 'username', 'email'];

const REQUIRED_DISPLAY = 'display_name';
const REQUIRED_STATUS = 'status';
const REQUIRED_MANAGER_ID = 'manager_id';
const REQUIRED_MANAGER_NAME = 'manager_name';
const OPTIONAL_JOB_TITLE = 'title';

/** Fixed reference field for role / entitlement lists (matches app user model + Map & import backend). */
const ENTITLEMENTS_LIST_STANDARD_FIELD = 'member_of_entitlements';

function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

function hasStandardField(rows, standardField) {
  const k = normKey(standardField);
  return (rows || []).some((r) => normKey(r.standardField) === k);
}

function technicalToDisplayName(fieldName) {
  return String(fieldName || '')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Detect the most likely data type for an array of raw string values from a CSV column.
 */
function detectType(values) {
  const samples = values.filter(Boolean).slice(0, 20);
  if (!samples.length) return 'String';

  const isoDateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
  let numCount = 0, boolCount = 0, dateCount = 0;
  for (const v of samples) {
    const s = String(v).trim();
    if (s === 'true' || s === 'false' || s === 'TRUE' || s === 'FALSE') { boolCount++; continue; }
    if (!Number.isNaN(parseFloat(s)) && isFinite(Number(s))) { numCount++; continue; }
    if (isoDateRe.test(s)) { dateCount++; continue; }
  }
  const n = samples.length;
  if (boolCount / n > 0.7) return 'Boolean';
  if (numCount / n > 0.7) return 'Number';
  if (dateCount / n > 0.7) return 'Date';
  return 'String';
}

function mappingsToRows(userMappings) {
  if (!Array.isArray(userMappings) || userMappings.length === 0) return [];
  return userMappings.map((m, i) => {
    const sf = String(m.standardField || '').trim();
    return {
      localId: `row-${i}-${sf}`,
      displayName: (m.displayName && String(m.displayName).trim()) || sf || '',
      standardField: sf,
      // Manual Setup is strict: show the technical name as the expected CSV header.
      // (Legacy aliases may still exist in DB until the schema is saved again.)
      csvColumn: sf,
      dataType: m.dataType || 'String',
      maxLength: m.maxLength != null && m.maxLength !== '' ? String(m.maxLength) : '',
      isPk: Boolean(m.isPrimaryKey),
    };
  });
}

function buildUserMappingsPayload(rowList) {
  return rowList.map((r) => {
    const sf = r.standardField.trim();
    // Manual Setup: strict CSV upload expects headers to match technical names exactly.
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
    csvColumn: String(r.csvColumn || '').trim(),
    displayName: String(r.displayName || '').trim(),
    dataType: String(r.dataType || 'String').trim() || 'String',
    maxLength: String(r.maxLength || '').trim(),
    isPk: Boolean(r.isPk),
  }));
}

function rowsEquivalent(a, b) {
  return JSON.stringify(normalizeRowsForCompare(a)) === JSON.stringify(normalizeRowsForCompare(b));
}

/**
 * Build a One-step-style schema draft from a Papa-parsed CSV (all headers → attributes).
 * Shared by One-step Import and Map & Import so both persist identical userMappings shapes.
 */
function buildSchemaDraftFromParsedCsv(parsed) {
  const fields = (parsed.meta.fields || [])
    .map((h) => String(h || '').replace(/^\uFEFF/, '').trim())
    .filter(Boolean);
  if (!fields.length) {
    return { fields: [], draft: [], pk: null };
  }

  const colValues = {};
  for (const field of fields) {
    colValues[field] = (parsed.data || []).map((row) => row[field]).filter(Boolean);
  }

  const draft = fields.map((field, idx) => ({
    localId: `csv-${idx}-${field}`,
    displayName: technicalToDisplayName(field),
    standardField: field,
    dataType: detectType(colValues[field]),
    maxLength: '',
    isPk: false,
  }));

  const pkIndex = draft.findIndex((r) =>
    DEFAULT_PK_CANDIDATES.includes(r.standardField.toLowerCase()),
  );
  if (pkIndex !== -1) {
    draft[pkIndex].isPk = true;
  } else if (draft.length > 0) {
    draft[0].isPk = true;
  }

  const pk = draft.find((r) => r.isPk) || null;
  return { fields, draft, pk };
}

export default function ApplicationSchemaTab({ applicationId, app, onSaved }) {
  const importInputRef = useRef(null);
  const oneStepInputRef = useRef(null);
  const mapImportInputRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Detect if the connector is a delimited/CSV file connector.
  // Only delimited-file connectors show all 3 workflow tabs; all others are locked to Map & import.
  const isDelimitedFileConnector = useMemo(() => {
    const ct = String(app?.connectorType || '').toUpperCase();
    return (
      ct === 'CONNECTOR_DELIMITEDFILE' ||
      ct === 'CONNECTOR_DELIMITED_FILE' ||
      ct.includes('DELIMITED') ||
      Boolean(app?.connectionConfig?.file)
    );
  }, [app?.connectorType, app?.connectionConfig?.file]);

  // Detect Active Directory connector — these use syncAdUsers and show AD field names instead of CSV columns.
  const isAdConnector = useMemo(() => {
    const ct = String(app?.connectorType || '').toUpperCase();
    return (
      ct === 'ACTIVE_DIRECTORY' ||
      ct.includes('ACTIVE_DIRECTORY') ||
      Boolean(app?.connectionConfig?.ad) ||
      Boolean(app?.connectionConfig?.ldapUrl)
    );
  }, [app?.connectorType, app?.connectionConfig?.ad, app?.connectionConfig?.ldapUrl]);

  const AD_FIELDS = [
    'sAMAccountName', 'userPrincipalName', 'mail', 'givenName', 'sn',
    'displayName', 'department', 'title', 'manager', 'memberOf',
    'telephoneNumber', 'employeeID', 'employeeNumber', 'userAccountControl',
  ];

  const [workflow, setWorkflow] = useState(() =>
    isDelimitedFileConnector ? 'manual' : 'mapped'
  );
  const [rows, setRows] = useState([]);
  const [schemaBootstrapping, setSchemaBootstrapping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState({ severity: 'info', message: '' });

  // --- Add attribute dialog ---
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    displayName: '',
    standardField: '',
    dataType: 'String',
    maxLength: '',
  });

  // --- One-step import dialog ---
  const [oneStepDialogOpen, setOneStepDialogOpen] = useState(false);
  const [oneStepPreview, setOneStepPreview] = useState([]);
  const [oneStepFileObj, setOneStepFileObj] = useState(null);

  // --- Required field mapping modal ---
  const [mappingDialogOpen, setMappingDialogOpen] = useState(false);
  const [mappingHeaders, setMappingHeaders] = useState([]);
  const [mappingFileObj, setMappingFileObj] = useState(null);
  const [mappingPkTarget, setMappingPkTarget] = useState('');
  const [mappingPkCsv, setMappingPkCsv] = useState('');
  const [mappingDisplayMode, setMappingDisplayMode] = useState('direct'); // direct | first_last
  const [mappingDisplayCsv, setMappingDisplayCsv] = useState('');
  const [mappingFirstCsv, setMappingFirstCsv] = useState('');
  const [mappingLastCsv, setMappingLastCsv] = useState('');
  const [mappingStatusCsv, setMappingStatusCsv] = useState('');
  const [mappingManagerIdCsv, setMappingManagerIdCsv] = useState('');
  const [mappingManagerNameCsv, setMappingManagerNameCsv] = useState('');
  const [mappingDepartmentCsv, setMappingDepartmentCsv] = useState('');
  const [mappingTitleCsv, setMappingTitleCsv] = useState('');
  const [mappingEmailCsv, setMappingEmailCsv] = useState('');
  const [mappingEntitlementsCsv, setMappingEntitlementsCsv] = useState('');
  const [mappingSaveOnly, setMappingSaveOnly] = useState(false);

  // --- Success dialog ---
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [successDialogMessage, setSuccessDialogMessage] = useState('');

  const savedRows = useMemo(() => mappingsToRows(app?.userMappings), [app?.userMappings]);

  const savedImportMappings = useMemo(
    () => (Array.isArray(app?.csvImportMapping?.mappings) ? app.csvImportMapping.mappings : []),
    [app?.csvImportMapping?.mappings],
  );

  const hasLegacyColumnAliases = useMemo(
    () =>
      (app?.userMappings || []).some((m) => {
        const sf = String(m?.standardField || '').trim();
        const csv = String(m?.csvColumn || '').trim();
        if (!sf || !csv) return false;
        return normKey(csv) !== normKey(sf);
      }),
    [app?.userMappings],
  );

  const hasUnsavedSchema = useMemo(() => !rowsEquivalent(rows, savedRows), [rows, savedRows]);

  // Enforce correct default workflow tab based on connector type.
  // Non-delimited connectors (e.g. AD) are locked to Map & import.
  useEffect(() => {
    if (!isDelimitedFileConnector) {
      setWorkflow('mapped');
    }
  }, [isDelimitedFileConnector]);

  useEffect(() => {
    let cancelled = false;
    setToast({ severity: 'info', message: '' });

    if (savedRows.length > 0) {
      setRows(savedRows);
      setSchemaBootstrapping(false);
      return () => { cancelled = true; };
    }

    if (!applicationId) {
      setRows([]);
      setSchemaBootstrapping(false);
      return () => { cancelled = true; };
    }

    // No saved schema — start empty; user can add manually or import from CSV
    setRows([]);
    setSchemaBootstrapping(false);

    return () => { cancelled = true; };
  }, [applicationId, savedRows]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const onestepParam = searchParams.get('onestep');

    if (onestepParam === 'connector' && !schemaBootstrapping && rows.length === 0) {
      setSchemaBootstrapping(true);

      // Pre-fill Wisibility target schema fields
      const targetFields = [
        'user_id', 'employee_id', 'username', 'email', 'display_name',
        'status', 'department', 'title', 'manager_id', 'telephone', 'member_of_entitlements'
      ];
      const draftTarget = targetFields.map((field, idx) => ({
        localId: `conn-${idx}-${field}`,
        displayName: technicalToDisplayName(field),
        standardField: field,
        dataType: 'String',
        maxLength: '',
        isPk: field === 'user_id',
      }));

      // Automatically save these as the App Schema, then open Map & Import modal
      applicationAPI
        .update(applicationId, { userMappings: buildUserMappingsPayload(draftTarget) })
        .then(() => {
          setRows(draftTarget);
          
          const isAd = app?.connectorType === 'ACTIVE_DIRECTORY' || app?.connectionConfig?.ad;
          const adFields = isAd 
            ? ['sAMAccountName', 'userPrincipalName', 'mail', 'givenName', 'sn', 'displayName', 'department', 'title', 'manager', 'memberOf', 'telephoneNumber', 'employeeID', 'employeeNumber', 'userAccountControl']
            : ['cn', 'uid', 'mail', 'sn', 'givenName', 'displayName', 'title', 'telephoneNumber', 'departmentNumber', 'ou', 'memberOf', 'distinguishedName', 'entryDN'];
          
          setMappingHeaders(adFields);
          setMappingPkTarget('user_id');
          setWorkflow('mapped');
          setMappingFileObj(null); // No CSV file
          setMappingSaveOnly(false); // We want to save & sync
          setMappingDialogOpen(true);
          
          // Clear query param
          navigate(location.pathname + '?tab=schema', { replace: true });
        })
        .catch(console.error);
    }
  }, [location.search, schemaBootstrapping, rows.length, navigate, location.pathname, applicationId, app]);

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
    // Authoritative apps: require display_name, status, and manager (id or name). Others: full manual schema as before.
    if (app?.authoritativeSource) {
      if (!hasStandardField(rows, REQUIRED_DISPLAY)) return false;
      if (!hasStandardField(rows, REQUIRED_STATUS)) return false;
      if (!hasStandardField(rows, REQUIRED_MANAGER_ID) && !hasStandardField(rows, REQUIRED_MANAGER_NAME)) {
        return false;
      }
    }
    return true;
  }, [rows, pkCount, saving, app]);

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

    const userMappings = buildUserMappingsPayload(rows);

    setSaving(true);
    setToast({ severity: 'info', message: '' });
    try {
      await applicationAPI.update(applicationId, { userMappings });
      setToast({ severity: 'success', message: 'Application user schema saved.' });
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
    a.download = `${(app?.name || 'application').replace(/[^a-z0-9-_]/gi, '_')}_user_schema_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast({ severity: 'success', message: 'Template CSV downloaded (header row = technical names).' });
  };

  const openMappingModalForFile = async (file, pkTargetStandardField) => {
    try {
      const text = await file.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim(),
      });
      const fields = (parsed.meta.fields || []).map((h) => String(h || '').trim()).filter(Boolean);
      if (!fields.length) {
        setToast({ severity: 'warning', message: 'The CSV has no headers. Please check the file.' });
        return;
      }

      const headerHit = (wanted) => fields.find((h) => normKey(h) === normKey(wanted)) || '';
      const targetPk = pkTargetStandardField || rows.find((r) => r.isPk)?.standardField || DEFAULT_PK_CANDIDATES[0];

      setMappingHeaders(fields);
      setMappingFileObj(file);
      setMappingPkTarget(targetPk);

      // Pre-fill from saved Map & import mapping when available; otherwise best-effort guesses from headers.
      const saved = app?.csvImportMapping || {};
      const savedMode = String(saved.displayNameMode || '').toLowerCase();
      const savedMappings = Array.isArray(saved.mappings) ? saved.mappings : [];
      const byField = new Map(savedMappings.map((m) => [normKey(m.standardField), m]));
      const getSavedCsv = (sf) => String(byField.get(normKey(sf))?.csvColumn || '').trim();

      setMappingPkCsv(getSavedCsv(targetPk) || headerHit(targetPk) || fields[0] || '');
      setMappingStatusCsv(getSavedCsv(REQUIRED_STATUS) || headerHit(REQUIRED_STATUS) || '');
      setMappingManagerIdCsv(getSavedCsv(REQUIRED_MANAGER_ID) || headerHit(REQUIRED_MANAGER_ID) || '');
      setMappingManagerNameCsv(getSavedCsv(REQUIRED_MANAGER_NAME) || headerHit(REQUIRED_MANAGER_NAME) || '');
      setMappingDepartmentCsv(getSavedCsv('department') || headerHit('department') || '');
      setMappingTitleCsv(
        getSavedCsv(OPTIONAL_JOB_TITLE) ||
        getSavedCsv('job_title') ||
        headerHit(OPTIONAL_JOB_TITLE) ||
        headerHit('job_title') ||
        headerHit('jobtitle') ||
        '',
      );
      setMappingEmailCsv(getSavedCsv('email') || headerHit('email') || '');

      setMappingEntitlementsCsv(getSavedCsv(ENTITLEMENTS_LIST_STANDARD_FIELD) || '');

      if (savedMode === 'first_last') {
        setMappingDisplayMode('first_last');
        setMappingFirstCsv(String(saved.displayNameFirstColumn || '').trim() || getSavedCsv(REQUIRED_DISPLAY) || headerHit('first_name') || headerHit('firstname') || '');
        setMappingLastCsv(String(saved.displayNameLastColumn || '').trim() || headerHit('last_name') || headerHit('lastname') || '');
        setMappingDisplayCsv('');
      } else {
        setMappingDisplayMode('direct');
        setMappingDisplayCsv(getSavedCsv(REQUIRED_DISPLAY) || headerHit(REQUIRED_DISPLAY) || '');
        setMappingFirstCsv(headerHit('first_name') || headerHit('firstname') || '');
        setMappingLastCsv(headerHit('last_name') || headerHit('lastname') || '');
      }

      setMappingDialogOpen(true);
    } catch (_e) {
      setToast({ severity: 'error', message: 'Failed to parse CSV for mapping.' });
    }
  };

  // ── Manual Setup: strict import (headers = technical names); no mapping modal ──────────
  const handleManualImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setToast({ severity: 'info', message: '' });
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await applicationAPI.uploadUsersCsvStrict(applicationId, fd);
      const n = res.data?.totalRecords ?? res.data?.data?.totalRecords;
      setSuccessDialogMessage(res.data?.message || `Successfully imported ${n ?? '0'} user(s).`);
      setSuccessDialogOpen(true);
      onSaved?.();
    } catch (err) {
      const d = err.response?.data;
      setToast({ severity: 'error', message: d?.message || err.message || 'Import failed' });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  // ── Map & import: mapping modal + csvImportMapping APIs ──────────
  const handleMappedImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setToast({ severity: 'info', message: '' });
    setMappingSaveOnly(false);

    // Persist full detected CSV schema to userMappings (same payload as One-step Import)
    // before opening the mapping modal so Identity Profile Attribute options are available.
    try {
      const text = await file.text();
      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => String(h || '').replace(/^\uFEFF/, '').trim(),
      });
      const { draft, pk } = buildSchemaDraftFromParsedCsv(parsed);
      if (!draft.length || !pk) {
        setToast({ severity: 'warning', message: 'The CSV has no headers. Please check the file.' });
        if (mapImportInputRef.current) mapImportInputRef.current.value = '';
        return;
      }

      setImporting(true);
      const userMappings = buildUserMappingsPayload(draft);
      await applicationAPI.update(applicationId, { userMappings });
      setRows(draft);
      onSaved?.();

      await openMappingModalForFile(file, pk.standardField);
    } catch (err) {
      const d = err.response?.data;
      setToast({
        severity: 'error',
        message: d?.message || err.message || 'Failed to save schema for Map & import',
      });
    } finally {
      setImporting(false);
      if (mapImportInputRef.current) mapImportInputRef.current.value = '';
    }
  };

  // ── Map AD: open mapping modal directly with AD field names (no CSV file needed) ──────────
  const handleOpenAdMapping = () => {
    setToast({ severity: 'info', message: '' });
    setMappingSaveOnly(false);

    const pkField = rows.find((r) => r.isPk)?.standardField || 'user_id';

    // Pre-fill best-guess AD column selections from saved mapping or sensible defaults
    const saved = app?.csvImportMapping || {};
    const savedMappings = Array.isArray(saved.mappings) ? saved.mappings : [];
    const byField = new Map(savedMappings.map((m) => [normKey(m.standardField), m]));
    const getSavedCsv = (sf) => String(byField.get(normKey(sf))?.csvColumn || '').trim();

    const guess = (sf, ...candidates) => {
      const fromSaved = getSavedCsv(sf);
      if (fromSaved && AD_FIELDS.includes(fromSaved)) return fromSaved;
      for (const c of candidates) {
        if (AD_FIELDS.find((f) => normKey(f) === normKey(c))) return AD_FIELDS.find((f) => normKey(f) === normKey(c));
      }
      return '';
    };

    setMappingHeaders(AD_FIELDS);
    setMappingFileObj(null); // No CSV file — will trigger syncAdUsers on proceed
    setMappingPkTarget(pkField);
    setMappingPkCsv(guess(pkField, 'sAMAccountName') || 'sAMAccountName');
    setMappingDisplayMode('direct');
    setMappingDisplayCsv(guess(REQUIRED_DISPLAY, 'displayName') || 'displayName');
    setMappingFirstCsv(guess('first_name', 'givenName') || 'givenName');
    setMappingLastCsv(guess('last_name', 'sn') || 'sn');
    setMappingStatusCsv(guess(REQUIRED_STATUS, 'userAccountControl') || 'userAccountControl');
    setMappingManagerIdCsv(guess(REQUIRED_MANAGER_ID, 'manager') || '');
    setMappingManagerNameCsv(guess(REQUIRED_MANAGER_NAME, 'manager') || 'manager');
    setMappingDepartmentCsv(guess('department', 'department') || 'department');
    setMappingTitleCsv(guess(OPTIONAL_JOB_TITLE, 'title') || 'title');
    setMappingEmailCsv(guess('email', 'mail') || 'mail');
    setMappingEntitlementsCsv(guess(ENTITLEMENTS_LIST_STANDARD_FIELD, 'memberOf') || 'memberOf');

    setMappingDialogOpen(true);
  };

  // ── Map & import: edit existing mapping (save only; does not re-import) ──────────
  const handleEditSavedMapping = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setToast({ severity: 'info', message: '' });
    setMappingSaveOnly(true);
    const pkFromSaved = savedImportMappings.find((m) => m.isPrimaryKey)?.standardField || rows.find((r) => r.isPk)?.standardField;
    await openMappingModalForFile(file, pkFromSaved);
  };

  // ── One-step import: Create Schema and Import Data ──────
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

      const { draft } = buildSchemaDraftFromParsedCsv(parsed);
      if (!draft.length) {
        setToast({ severity: 'warning', message: 'The CSV has no headers. Please check the file.' });
        return;
      }

      setOneStepPreview(draft);
      setOneStepFileObj(file);
      setOneStepDialogOpen(true);
    } catch (err) {
      setToast({ severity: 'error', message: 'Failed to parse CSV for one-step import.' });
    }
  };

  const handleOneStepProceed = async () => {
    const pk = oneStepPreview.find(r => r.isPk);
    if (!pk) {
      setToast({ severity: 'warning', message: 'Please select a primary key.' });
      return;
    }

    setToast({ severity: 'info', message: '' });
    setImporting(true);
    try {
      // One-step import: save the FULL schema (all columns) to Manual Setup (userMappings),
      // then open the mapping wizard to save csvImportMapping + import via mapped endpoint.
      const userMappings = buildUserMappingsPayload(oneStepPreview);
      await applicationAPI.update(applicationId, { userMappings });
      onSaved?.();
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.message || err.message || 'Failed to save schema';
      setToast({ severity: 'error', message: msg });
      setImporting(false);
      return;
    }

    setImporting(false);
    setToast({ severity: 'success', message: 'Schema saved successfully.' });
      
    // Since one-step import is for CSV, trigger the mapping modal
    if (oneStepFileObj) {
      await openMappingModalForFile(oneStepFileObj, pk.standardField);
    }
    setOneStepDialogOpen(false);
    setOneStepPreview([]);
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
          csvColumn: tech,
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

  const mappingIsAuth = !!app?.authoritativeSource;
  const canProceedMapping = useMemo(() => {
    if (!mappingPkTarget || !mappingPkCsv) return false;
    if (!mappingStatusCsv) return false;
    const displayOk =
      mappingDisplayMode === 'direct'
        ? Boolean(mappingDisplayCsv)
        : Boolean(mappingFirstCsv) && Boolean(mappingLastCsv);
    if (!displayOk) return false;
    const managerOk =
      !mappingIsAuth ||
      Boolean(String(mappingManagerIdCsv || '').trim()) ||
      Boolean(String(mappingManagerNameCsv || '').trim());
    if (!managerOk) return false;
    return true;
  }, [
    mappingPkTarget,
    mappingPkCsv,
    mappingStatusCsv,
    mappingDisplayMode,
    mappingDisplayCsv,
    mappingFirstCsv,
    mappingLastCsv,
    mappingIsAuth,
    mappingManagerIdCsv,
    mappingManagerNameCsv,
    mappingEntitlementsCsv,
  ]);

  const handleMappingProceed = async () => {
    if (!canProceedMapping) {
      setToast({ severity: 'warning', message: 'Complete the required field mappings before importing.' });
      return;
    }
    setImporting(true);
    setToast({ severity: 'info', message: '' });
    try {
      // Persist schema mapping with chosen csvColumn from modal.
      const targetRows = [
        {
          localId: `pk-${mappingPkTarget}`,
          displayName: technicalToDisplayName(mappingPkTarget),
          standardField: mappingPkTarget,
          dataType: 'String',
          maxLength: '',
          isPk: true,
        },
        {
          localId: `req-${REQUIRED_DISPLAY}`,
          displayName: 'Display Name',
          standardField: REQUIRED_DISPLAY,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        },
        {
          localId: `req-${REQUIRED_STATUS}`,
          displayName: 'Status',
          standardField: REQUIRED_STATUS,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        },
      ];

      if (String(mappingManagerIdCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-manager-id',
          displayName: 'Manager ID',
          standardField: REQUIRED_MANAGER_ID,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }
      if (String(mappingManagerNameCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-manager-name',
          displayName: 'Manager Name',
          standardField: REQUIRED_MANAGER_NAME,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }
      if (String(mappingDepartmentCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-department',
          displayName: 'Department',
          standardField: 'department',
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }
      if (String(mappingTitleCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-title',
          displayName: 'Job Title',
          standardField: OPTIONAL_JOB_TITLE,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }
      if (String(mappingEmailCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-email',
          displayName: 'Email',
          standardField: 'email',
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }

      const entTech = ENTITLEMENTS_LIST_STANDARD_FIELD;
      if (String(mappingEntitlementsCsv || '').trim()) {
        targetRows.push({
          localId: 'opt-entitlements',
          displayName: technicalToDisplayName(entTech),
          standardField: entTech,
          dataType: 'String',
          maxLength: '',
          isPk: false,
        });
      }

      const importMappings = buildUserMappingsPayload(targetRows).map((m) => {
        const sf = normKey(m.standardField);
        if (sf === normKey(mappingPkTarget)) return { ...m, csvColumn: mappingPkCsv, isPrimaryKey: true };
        if (sf === normKey(REQUIRED_STATUS)) return { ...m, csvColumn: mappingStatusCsv };
        if (sf === normKey(REQUIRED_MANAGER_ID)) return { ...m, csvColumn: mappingManagerIdCsv.trim() };
        if (sf === normKey(REQUIRED_MANAGER_NAME)) return { ...m, csvColumn: mappingManagerNameCsv.trim() };
        if (sf === normKey('department')) return { ...m, csvColumn: mappingDepartmentCsv.trim() };
        if (sf === normKey(OPTIONAL_JOB_TITLE)) return { ...m, csvColumn: mappingTitleCsv.trim() };
        if (sf === normKey('email')) return { ...m, csvColumn: mappingEmailCsv.trim() };
        if (sf === normKey(entTech)) return { ...m, csvColumn: mappingEntitlementsCsv.trim() };
        if (sf === normKey(REQUIRED_DISPLAY)) {
          if (mappingDisplayMode === 'direct') return { ...m, csvColumn: mappingDisplayCsv };
          return { ...m, csvColumn: mappingFirstCsv };
        }
        return m;
      });

      await applicationAPI.saveCsvImportMapping(applicationId, {
        mappings: importMappings,
        // CSV Map & import: send complete detected headers so backend can ensure userMappings
        // without using the reduced importMappings list. Skip for AD (no CSV file) so we do not
        // overwrite/merge AD attribute names into an empty application schema incorrectly.
        ...(mappingFileObj && mappingHeaders.length
          ? (() => {
              const pkHeader = mappingHeaders.includes(mappingPkCsv)
                ? mappingPkCsv
                : mappingHeaders[0];
              return {
                detectedHeaders: mappingHeaders,
                schemaMappings: buildUserMappingsPayload(
                  mappingHeaders.map((field, idx) => ({
                    localId: `hdr-${idx}-${field}`,
                    displayName: technicalToDisplayName(field),
                    standardField: field,
                    dataType: 'String',
                    maxLength: '',
                    isPk: field === pkHeader,
                  })),
                ),
              };
            })()
          : {}),
        displayNameMode: mappingDisplayMode === 'first_last' ? 'first_last' : 'direct',
        displayNameFirstColumn: mappingFirstCsv,
        displayNameLastColumn: mappingLastCsv,
        entitlementsStandardField: String(mappingEntitlementsCsv || '').trim() ? entTech : '',
      });

      if (mappingSaveOnly) {
        setToast({ severity: 'success', message: 'Mapping updated.' });
        setMappingDialogOpen(false);
        setMappingFileObj(null);
        onSaved?.();
      } else if (mappingFileObj) {
        const fd = new FormData();
        fd.append('file', mappingFileObj);

        const res = await applicationAPI.uploadUsersCsvMapped(applicationId, fd);
        const n = res.data?.totalRecords ?? res.data?.data?.totalRecords;
        setSuccessDialogMessage(res.data?.message || `Successfully imported ${n ?? '0'} user(s).`);
        setSuccessDialogOpen(true);
        setMappingDialogOpen(false);
        setMappingFileObj(null);
        onSaved?.();
      } else {
        // Trigger connector sync using the saved mapping (remote connectors only).
        // Delimited File has no remote pull — require a CSV (Map & import) instead of wiping accounts.
        const isAd = app?.connectorType === 'ACTIVE_DIRECTORY' || app?.connectionConfig?.ad;
        const ct = String(app?.connectorType || '').toUpperCase().replace(/\s+/g, '');
        const isDelimited =
          app?.hrms?.connector === 'delimited_file' ||
          ct === 'CONNECTOR_DELIMITEDFILE' ||
          ct === 'HRMS_DELIMITED_FILE' ||
          (ct.includes('DELIMITED') && ct.includes('FILE'));
        if (isDelimited) {
          setToast({
            severity: 'warning',
            message:
              'Mapping saved. Choose a CSV with “Save Mapping & Import Users”, or use Sync CSV on Current accounts.',
          });
          setMappingDialogOpen(false);
          onSaved?.();
        } else if (isAd) {
          setToast({ severity: 'info', message: 'Mapping saved. Syncing from connector...' });
          await applicationAPI.waitForAdSyncJob(applicationId, {});
          setSuccessDialogMessage('Connector synchronized successfully with mapped schema.');
          setSuccessDialogOpen(true);
          setMappingDialogOpen(false);
          setMappingFileObj(null);
          onSaved?.();
        } else {
          setToast({ severity: 'info', message: 'Mapping saved. Syncing from connector...' });
          await applicationAPI.syncConnector(applicationId, {});
          setSuccessDialogMessage('Connector synchronized successfully with mapped schema.');
          setSuccessDialogOpen(true);
          setMappingDialogOpen(false);
          setMappingFileObj(null);
          onSaved?.();
        }
      }
    } catch (err) {
      const d = err.response?.data;
      const msg = d?.message || err.message || 'Import failed';
      setToast({ severity: 'error', message: msg });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            Application schema (users)
          </Typography>
          <ToggleButtonGroup
            color="primary"
            value={workflow}
            exclusive
            onChange={(e, v) => { if (v) setWorkflow(v); }}
            size="small"
            sx={{ mb: 2, flexWrap: 'wrap' }}
          >
            {isDelimitedFileConnector && (
              <ToggleButton value="manual">Manual Setup</ToggleButton>
            )}
            {isDelimitedFileConnector && (
              <ToggleButton value="onestep">One-step import</ToggleButton>
            )}
            <ToggleButton value="mapped">Map &amp; import</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 720 }}>
            {workflow === 'manual'
              ? 'Define the full user schema (PK, types, optional lengths). CSV headers for Import users must match technical names exactly. Use Map & import when your file uses different column titles.'
              : workflow === 'onestep'
                ? 'Upload a CSV: we detect columns, you pick a primary key, then map required fields and import.'
                : 'Guided import: map CSV columns to PK, display name, status, and manager (if required). Saves the import mapping and ensures the full CSV header schema is stored as userMappings (same metadata One-step Import produces).'}
          </Typography>
        </Box>
        {workflow === 'manual' && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Button variant="outlined" startIcon={<FileDownload />} onClick={handleExportTemplate} disabled={!rows.length || schemaBootstrapping || importing || saving}>
              Export CSV template
            </Button>

            {/* === Import users (data) === */}
            <input
              type="file"
              accept=".csv"
              ref={importInputRef}
              style={{ display: 'none' }}
              onChange={handleManualImportFile}
            />
            <Button
              variant="outlined"
              startIcon={<UploadFile />}
              onClick={() => importInputRef.current?.click()}
              disabled={importing || !rows.length || schemaBootstrapping || saving || hasUnsavedSchema}
            >
              {importing ? 'Importing…' : 'Import users'}
            </Button>

            <Button variant="contained" startIcon={<Save />} onClick={handleSave} disabled={!canSave || schemaBootstrapping || importing}>
              {saving ? 'Saving…' : 'Save schema'}
            </Button>
          </Box>
        )}
        {workflow === 'mapped' && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {/* CSV file input — only used for non-AD connectors */}
            {!isAdConnector && (
              <input
                type="file"
                accept=".csv"
                ref={mapImportInputRef}
                style={{ display: 'none' }}
                onChange={handleMappedImportFile}
              />
            )}
            <Button
              variant="contained"
              startIcon={<UploadFile />}
              onClick={
                isAdConnector
                  ? handleOpenAdMapping
                  : () => mapImportInputRef.current?.click()
              }
              disabled={importing || saving}
            >
              {importing
                ? 'Importing…'
                : isAdConnector
                  ? 'Import users (map AD)'
                  : 'Import users (map CSV)'}
            </Button>
          </Box>
        )}
      </Box>

      {toast.message && (
        <Alert severity={toast.severity} sx={{ mb: 2 }} onClose={() => setToast((t) => ({ ...t, message: '' }))}>
          {toast.message}
        </Alert>
      )}

      {workflow === 'manual' && (
        <>
          {hasLegacyColumnAliases ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Some saved attributes still have a <strong>CSV column name</strong> that differs from the technical name
              (legacy data). Saving the schema now will align every CSV column to its technical name so strict import
              matches your template. If you need different file headers without changing Manual Setup, use{' '}
              <strong>Map & import</strong>—it stores aliases separately.
            </Alert>
          ) : null}
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
                  <TableCell>CSV header (strict)</TableCell>
                  <TableCell width={120}>Type</TableCell>
                  <TableCell width={100}>Length</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 6, textAlign: 'center', color: 'text.secondary' }}>
                      {emptyRowsText}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.localId} hover>
                      <TableCell>
                        <Radio
                          size="small"
                          checked={r.isPk}
                          onChange={() => setPkFor(r.standardField)}
                        />
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
                              prev.map((x) => {
                                if (x.localId !== r.localId) return x;
                                const oldSf = String(x.standardField || '').trim();
                                const next = { ...x, standardField: v };
                                const prevCsv = String(x.csvColumn || '').trim() || oldSf;
                                if (prevCsv === oldSf) next.csvColumn = v;
                                return next;
                              }),
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
                      <TableCell sx={{ maxWidth: 180 }}>
                        <Typography variant="body2" color="text.secondary" noWrap title={r.csvColumn || r.standardField}>
                          {r.csvColumn || r.standardField || '—'}
                        </Typography>
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
        <Box sx={{ p: 4, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
          <TableChart color="primary" sx={{ fontSize: 48, mb: 2, opacity: 0.8 }} />
          <Typography variant="h6" gutterBottom>One-step import</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 400, mx: 'auto' }}>
            Upload a CSV containing your users. We will automatically create the schema attributes from the headers and import the users in one go.
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
            Select CSV & Import
          </Button>
        </Box>
      )}

      {workflow === 'mapped' && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            This table is the saved <strong>Map &amp; import</strong> mapping only (technical field →{' '}
            {isAdConnector ? 'AD field' : 'CSV column'}). Importing a CSV also persists the full detected
            column set as the application schema (<code>userMappings</code>) so Identity Profile mapping
            can list attributes. Use{' '}
            <strong>{isAdConnector ? 'Import users (map AD)' : 'Import users (map CSV)'}</strong>{' '}
            to run the wizard{isAdConnector ? '; it will sync users directly from Active Directory' : ''}.
          </Alert>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            <input
              type="file"
              accept=".csv"
              id="edit-mapped-mapping-input"
              style={{ display: 'none' }}
              onChange={handleEditSavedMapping}
            />
            <Button
              variant="outlined"
              startIcon={<Save />}
              disabled={importing || saving || !savedImportMappings.length}
              onClick={() => document.getElementById('edit-mapped-mapping-input')?.click()}
            >
              Edit saved mapping
            </Button>
          </Box>
          {!savedImportMappings.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
              No import mapping saved yet. Click{' '}
              <strong>{isAdConnector ? 'Import users (map AD)' : 'Import users (map CSV)'}</strong>{' '}
              {isAdConnector ? 'to map your AD fields and sync users.' : 'to choose your file and map columns.'}
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderColor: palette.border?.default }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell width={72}>PK</TableCell>
                    <TableCell>Technical name</TableCell>
                    <TableCell>{isAdConnector ? 'AD Field' : 'CSV Column'}</TableCell>
                    <TableCell>Display label</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {savedImportMappings.map((m, idx) => (
                    <TableRow key={`${m.standardField}-${idx}`} hover>
                      <TableCell>{m.isPrimaryKey ? <Chip size="small" label="PK" color="primary" variant="outlined" /> : '—'}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.standardField}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color={isAdConnector ? 'primary.main' : 'text.secondary'}>{m.csvColumn || m.standardField}</Typography>
                      </TableCell>
                      <TableCell>{m.displayName || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {/* ── "Add attribute" dialog ── */}
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

      {/* ── Import schema (CSV) confirmation dialog ── */}
      <Dialog open={oneStepDialogOpen} onClose={() => !importing && setOneStepDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm schema</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" sx={{ mb: 3 }}>
            We detected <strong>{oneStepPreview.length}</strong> attributes. Please select the primary key column to use for matching and identifying users.
          </Typography>
          <TextField
            select
            fullWidth
            label="Primary Key column"
            value={oneStepPreview.find(r => r.isPk)?.standardField || ''}
            onChange={(e) => {
              const v = e.target.value;
              setOneStepPreview(prev => prev.map(r => ({ ...r, isPk: r.standardField === v })));
            }}
          >
            {oneStepPreview.map(r => (
              <MenuItem key={r.localId} value={r.standardField}>
                {r.displayName} ({r.standardField})
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOneStepDialogOpen(false)} disabled={importing}>Cancel</Button>
          <Button variant="contained" onClick={handleOneStepProceed} disabled={importing}>
            {importing ? 'Importing...' : (oneStepFileObj ? 'Save Schema & Import Users' : 'Save Schema & Sync')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Required field mapping modal ── */}
      <Dialog open={mappingDialogOpen} onClose={() => !importing && setMappingDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{isAdConnector && !mappingFileObj ? 'Map AD fields' : 'Map CSV fields'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {isAdConnector && !mappingFileObj
              ? 'Map each target field to the corresponding Active Directory attribute. Required fields are marked with *'
              : 'Select which CSV column maps to each required field. Required fields are marked with *'}
            .
          </Typography>

          <TableContainer component={Paper} variant="outlined" sx={{ borderColor: palette.border?.default }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'action.hover' }}>
                  <TableCell width={260}>Target field</TableCell>
                  <TableCell>{isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV Column'}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Primary key *
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {mappingPkTarget || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingPkCsv}
                      onChange={(e) => setMappingPkCsv(e.target.value)}
                    >
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Display Name *
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {REQUIRED_DISPLAY}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={mappingDisplayMode === 'direct'}
                              onChange={() => setMappingDisplayMode('direct')}
                            />
                          }
                          label="Map one column"
                        />
                        <FormControlLabel
                          control={
                            <Checkbox
                              size="small"
                              checked={mappingDisplayMode === 'first_last'}
                              onChange={() => setMappingDisplayMode('first_last')}
                            />
                          }
                          label="Build from first + last"
                        />
                      </Box>

                      {mappingDisplayMode === 'direct' ? (
                        <TextField
                          select
                          fullWidth
                          size="small"
                          label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                          value={mappingDisplayCsv}
                          onChange={(e) => setMappingDisplayCsv(e.target.value)}
                        >
                          {mappingHeaders.map((h) => (
                            <MenuItem key={h} value={h}>
                              {h}
                            </MenuItem>
                          ))}
                        </TextField>
                      ) : (
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="First name column"
                            value={mappingFirstCsv}
                            onChange={(e) => setMappingFirstCsv(e.target.value)}
                          >
                            {mappingHeaders.map((h) => (
                              <MenuItem key={h} value={h}>
                                {h}
                              </MenuItem>
                            ))}
                          </TextField>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="Last name column"
                            value={mappingLastCsv}
                            onChange={(e) => setMappingLastCsv(e.target.value)}
                          >
                            {mappingHeaders.map((h) => (
                              <MenuItem key={h} value={h}>
                                {h}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      Status *
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {REQUIRED_STATUS}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingStatusCsv}
                      onChange={(e) => setMappingStatusCsv(e.target.value)}
                    >
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Department (optional)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      department
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingDepartmentCsv}
                      onChange={(e) => setMappingDepartmentCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Email (optional)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      email
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingEmailCsv}
                      onChange={(e) => setMappingEmailCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Job title (optional)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {OPTIONAL_JOB_TITLE}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingTitleCsv}
                      onChange={(e) => setMappingTitleCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Entitlements (optional)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {ENTITLEMENTS_LIST_STANDARD_FIELD}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingEntitlementsCsv}
                      onChange={(e) => setMappingEntitlementsCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Manager ID {mappingIsAuth ? '*' : '(optional)'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {REQUIRED_MANAGER_ID}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingManagerIdCsv}
                      onChange={(e) => setMappingManagerIdCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>

                <TableRow hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      Manager name {mappingIsAuth ? '*' : '(optional)'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {REQUIRED_MANAGER_NAME}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      label={isAdConnector && !mappingFileObj ? 'AD Field' : 'CSV column'}
                      value={mappingManagerNameCsv}
                      onChange={(e) => setMappingManagerNameCsv(e.target.value)}
                    >
                      <MenuItem value="">— None —</MenuItem>
                      {mappingHeaders.map((h) => (
                        <MenuItem key={h} value={h}>
                          {h}
                        </MenuItem>
                      ))}
                    </TextField>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>

          {!canProceedMapping ? (
            <Alert severity="info" sx={{ mt: 2 }}>
              Complete the required mappings (PK, Display Name, Status
              {mappingIsAuth ? ', and at least one of Manager ID or Manager name' : ''}). If you use display-name fallbacks
              or entitlements, fill both fallback columns or fix the entitlements technical name.
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setMappingDialogOpen(false)} disabled={importing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleMappingProceed} disabled={importing || !canProceedMapping}>
            {importing ? 'Importing...' : (mappingSaveOnly ? 'Save mapping' : 'Save Mapping & Import Users')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Success Dialog ── */}
      <Dialog open={successDialogOpen} onClose={() => setSuccessDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center', pb: 1, pt: 3 }}>
          <CheckCircleOutline color="success" sx={{ fontSize: 56, mb: 1 }} />
          <Typography variant="h6">Import Successful</Typography>
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
          <Typography variant="body1">{successDialogMessage}</Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 4 }}>
          <Button variant="contained" size="large" onClick={() => setSuccessDialogOpen(false)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
