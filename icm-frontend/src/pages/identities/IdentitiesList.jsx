import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Box, Grid, Typography, Button, Tabs, Tab, Chip, CircularProgress,
  Dialog, DialogTitle, DialogContent, DialogActions, Select,   MenuItem,
  FormControl, Snackbar, Alert, IconButton, DialogContentText,
  TextField, Paper, InputLabel, InputAdornment, Tooltip, Menu,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  People, CheckCircle, Download, UploadFile, CompareArrows, Delete, PersonAdd,
  WarningAmber, Search as SearchIcon, PersonOff, Clear as ClearIcon, FilterList,
  RefreshRounded, GroupsOutlined,
} from '@mui/icons-material';
import StatCard from '../../components/StatCard';
import DataTable from '../../components/DataTable';
import AccountTableColumnPicker from '../../components/accounts/AccountTableColumnPicker';
import CreateIdentityDialog from './CreateIdentityDialog';
import { palette } from '../../theme/palette';
import { identityAPI, identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import ExcelJS from 'exceljs';
import {
  augmentIdentityRowWithMappedKeys,
  isManagerRelatedTargetKey,
  normalizeDigitLikeDisplayValue,
} from '../../utils/identityMappedValues';
import { canonicalIdentityMappingTargetKey } from '../../utils/canonicalIdentityTargetKey';
import { prefetchIdentityCatalogShell } from './catalog/identityCatalogQueries';
import {
  mergeColumnOrderKeys,
  mergeVisibleColumnKeys,
} from '../../utils/accountTableColumns';

/** Tabs shown on the identities list. LEAVER / PREHIRE are omitted from the UI; those records still appear under ALL (and INACTIVE where applicable). */
// const IDENTITIES_LIST_LIFECYCLE_TABS = ['ALL', 'ACTIVE', 'TERMINATED', 'INACTIVE'];
const IDENTITIES_LIST_LIFECYCLE_TABS = ['ALL'];

const STATUS_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

const filterFieldSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 2,
    bgcolor: palette.bg.secondary,
    '& fieldset': { borderColor: palette.border.default },
    '&:hover fieldset': { borderColor: alpha(palette.brand.primary, 0.4) },
    '&.Mui-focused fieldset': { borderColor: palette.brand.primary },
  },
  '& .MuiInputBase-input': {
    fontSize: '0.8125rem',
    py: 1,
  },
};

const filterLabelSx = {
  display: 'block',
  mb: 0.75,
  fontSize: '0.75rem',
  fontWeight: 600,
  color: palette.text.primary,
  lineHeight: 1.2,
};

const IDENTITY_EXPORT_PAGE_SIZE = 2000;

function identitiesColumnPrefsKey(tenantId) {
  return `identities-list-column-prefs:${tenantId || 'default'}`;
}

function loadIdentitiesColumnPrefs(tenantId) {
  try {
    const raw = localStorage.getItem(identitiesColumnPrefsKey(tenantId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      columnOrder: Array.isArray(parsed.columnOrder) ? parsed.columnOrder : [],
      visibleColumns: Array.isArray(parsed.visibleColumns) ? parsed.visibleColumns : [],
    };
  } catch {
    return null;
  }
}

function saveIdentitiesColumnPrefs(tenantId, prefs) {
  try {
    localStorage.setItem(identitiesColumnPrefsKey(tenantId), JSON.stringify(prefs));
  } catch {
    /* ignore quota / private mode */
  }
}

/** When no profile-mapped columns exist, export these core identity fields. */
const DEFAULT_IDENTITY_EXPORT_FIELDS = [
  { targetKey: 'displayName', label: 'Display name' },
  { targetKey: 'email', label: 'Email' },
  { targetKey: 'firstName', label: 'First name' },
  { targetKey: 'lastName', label: 'Last name' },
  { targetKey: 'employeeId', label: 'Employee ID' },
  { targetKey: 'department', label: 'Department' },
  { targetKey: 'title', label: 'Title' },
  { targetKey: 'lifecycleState', label: 'Lifecycle state' },
];

/** Shared toolbar actions — responsive type so long labels stay readable without awkward wraps. */
const identitiesToolbarBtnSx = {
  textTransform: 'none',
  fontWeight: 600,
  fontSize: { xs: '0.6875rem', sm: '0.75rem', md: '0.8125rem', lg: '0.875rem' },
  px: { xs: 0.75, sm: 1.25, md: 1.5 },
  py: { xs: 0.5, sm: 0.625 },
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  '& .MuiButton-startIcon': {
    mr: { xs: 0.4, sm: 0.75 },
    ml: { xs: -0.25, sm: 0 },
    '& svg': { fontSize: { xs: '1rem', sm: '1.125rem' } },
  },
};

const lifecycleColors = {
  active: palette.status.success,
  leaver: palette.status.warning,
  terminated: palette.status.error,
  inactive: palette.text.disabled,
  prehire: palette.status.info,
};

export default function IdentitiesList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const fileInputRef = useRef(null);

  const [identities, setIdentities] = useState([]);
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [stats, setStats] = useState({ total: 0, active: 0, privileged: 0, inactive: 0 });
  /** After first successful list load for this tenant, stat cards stay static while search/pagination refetches the table. */
  const [statsCardsHydrated, setStatsCardsHydrated] = useState(false);
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [filtersMenuAnchor, setFiltersMenuAnchor] = useState(null);
  const [tablePage, setTablePage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [listTotal, setListTotal] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  /** Server-side list sort (applies across all pages, not only the current page). */
  const [listSortField, setListSortField] = useState('displayName');
  const [listSortDir, setListSortDir] = useState('asc');

  const [importSchemaFields, setImportSchemaFields] = useState([]);
  const [mappedTableFields, setMappedTableFields] = useState([]);
  /** Sorted keys — column set add/remove resets visible columns. */
  const mappedFieldKeysSigRef = useRef('');
  /** Mapping card order — reorder preserves which columns the user hid. */
  const mappedFieldOrderSigRef = useRef('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [csvData, setCsvData] = useState({ headers: [], rows: [] });
  const [fieldMappings, setFieldMappings] = useState({});

  // Toast & Delete State (duration ms — longer for warning/error so multi-line hints stay readable)
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success', duration: 6000 });
  const [deleteModal, setDeleteModal] = useState({ open: false, id: null, name: '' });
  const [deleteAllModal, setDeleteAllModal] = useState(false);

  const [createModal, setCreateModal] = useState(false);

  const [visibleColumns, setVisibleColumns] = useState([]);
  const [columnOrderKeys, setColumnOrderKeys] = useState([]);
  const [refreshingIdentities, setRefreshingIdentities] = useState(false);
  const [exportingIdentities, setExportingIdentities] = useState(false);
  const [listRefreshVersion, setListRefreshVersion] = useState(0);
  const [initializedSortKey, setInitializedSortKey] = useState('');

  const showToast = (message, severity = 'success', durationMs) => {
    const defaults = { success: 6000, info: 12000, warning: 32000, error: 32000 };
    const duration =
      typeof durationMs === 'number' ? durationMs : defaults[severity] ?? 6000;
    setToast({ open: true, message, severity, duration });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setTablePage(0);
      setDebouncedSearch(searchInput.trim());
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!STATUS_FILTER_OPTIONS.some((o) => o.value === lifecycleFilter)) {
      setLifecycleFilter('ALL');
      setTablePage(0);
    }
  }, [lifecycleFilter]);

  useEffect(() => {
    setDepartmentFilter('ALL');
  }, [tenantId]);

  useEffect(() => {
    setStatsCardsHydrated(false);
  }, [tenantId]);

  useEffect(() => {
    mappedFieldKeysSigRef.current = '';
    mappedFieldOrderSigRef.current = '';
    setInitializedSortKey('');
  }, [tenantId]);

  const metadataQuery = useQuery({
    queryKey: ['identities-list-metadata', tenantId],
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const [metaRes, mappedRes] = await Promise.all([
        identityAPI.getMetaFields({ signal }),
        identityProfileAPI.getMappedFields({ tenantId }, { signal }),
      ]);
      return {
        importFields: metaRes.data?.data || [],
        mappedFields: mappedRes.data?.data || [],
      };
    },
  });

  useEffect(() => {
    if (!metadataQuery.data) {
      if (!tenantId) {
        setImportSchemaFields([]);
        setMappedTableFields([]);
        setVisibleColumns([]);
        setColumnOrderKeys([]);
      }
      return;
    }
    const { importFields, mappedFields: mapped } = metadataQuery.data;
    setImportSchemaFields(importFields);
    const orderSig = mapped.map((m) => m.targetKey).join('|');
    const keySetSig = [...mapped.map((m) => m.targetKey)].sort().join('|');
    const keysChanged = keySetSig !== mappedFieldKeysSigRef.current;
    const orderChanged = orderSig !== mappedFieldOrderSigRef.current;
    const defKeys = mapped.map((field) => field.targetKey);
    const prefs = loadIdentitiesColumnPrefs(tenantId);

    if (keysChanged) {
      mappedFieldKeysSigRef.current = keySetSig;
      mappedFieldOrderSigRef.current = orderSig;
      setMappedTableFields(mapped);
      setColumnOrderKeys(mergeColumnOrderKeys(prefs?.columnOrder, defKeys));
      setVisibleColumns(
        mergeVisibleColumnKeys(prefs?.visibleColumns, mapped.map((f) => ({ key: f.targetKey })), {
          showAll: true,
        }),
      );
    } else if (orderChanged) {
      mappedFieldOrderSigRef.current = orderSig;
      setMappedTableFields(mapped);
      setColumnOrderKeys((previous) => mergeColumnOrderKeys(previous, defKeys));
      setVisibleColumns((previous) => {
        const filtered = defKeys.filter((key) => previous.includes(key));
        return filtered.length ? filtered : defKeys;
      });
    } else {
      setMappedTableFields(mapped);
    }
  }, [metadataQuery.data, tenantId]);

  const defaultSortKey = useMemo(() => {
    const fields = metadataQuery.data?.mappedFields || mappedTableFields;
    const keys = fields.map((field) => field.targetKey);
    if (keys.includes('displayName')) return 'displayName';
    if (keys.includes('email')) return 'email';
    return keys[0] || 'displayName';
  }, [metadataQuery.data?.mappedFields, mappedTableFields]);

  const expectedSortInitKey = metadataQuery.isSuccess ? `${tenantId}|${defaultSortKey}` : '';
  useEffect(() => {
    if (!expectedSortInitKey || initializedSortKey === expectedSortInitKey) return;
    setListSortField(defaultSortKey);
    setListSortDir('asc');
    setTablePage(0);
    setInitializedSortKey(expectedSortInitKey);
  }, [defaultSortKey, expectedSortInitKey, initializedSortKey]);

  const mappedFieldsParam = useMemo(
    () =>
      (metadataQuery.data?.mappedFields || [])
        .map((field) => field.targetKey)
        .filter(Boolean)
        .join(','),
    [metadataQuery.data?.mappedFields],
  );

  const departmentsQuery = useQuery({
    queryKey: ['identities-list-departments', tenantId],
    enabled: Boolean(tenantId),
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const res = await identityAPI.getDepartments({ tenantId }, { signal });
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
  });
  const departmentOptions = departmentsQuery.data || [];

  const listParams = useMemo(() => {
    const params = {
      tenantId,
      page: tablePage,
      limit: rowsPerPage,
      sortBy: listSortField,
      sortDir: listSortDir,
    };
    if (lifecycleFilter !== 'ALL') params.lifecycleState = lifecycleFilter;
    if (departmentFilter !== 'ALL') params.department = departmentFilter;
    if (debouncedSearch) params.search = debouncedSearch;
    if (mappedFieldsParam) params.fields = mappedFieldsParam;
    return params;
  }, [
    tenantId,
    tablePage,
    rowsPerPage,
    listSortField,
    listSortDir,
    lifecycleFilter,
    departmentFilter,
    debouncedSearch,
    mappedFieldsParam,
  ]);

  const identitiesQuery = useQuery({
    queryKey: ['identities-list', listParams, listRefreshVersion],
    enabled:
      Boolean(tenantId) &&
      metadataQuery.isSuccess &&
      initializedSortKey === expectedSortInitKey,
    placeholderData: (previousData) => previousData,
    queryFn: ({ signal }) =>
      identityAPI.list(listParams, { timeout: 120000, signal }).then((response) => response.data),
  });
  const loading =
    Boolean(tenantId) &&
    (metadataQuery.isPending || (identitiesQuery.isPending && !identitiesQuery.data));

  useEffect(() => {
    if (!tenantId) {
      setIdentities([]);
      setListTotal(0);
      setStats({ total: 0, active: 0, privileged: 0, inactive: 0 });
      return;
    }
    const payload = identitiesQuery.data;
    if (!payload) return;
    const fetchedRaw =
      payload?.data || payload?.identities || payload?.docs || (Array.isArray(payload) ? payload : []);
    const fetched = Array.isArray(fetchedRaw) ? fetchedRaw : [];
    const seenIds = new Set();
    const tableReadyData = [];
    for (const row of fetched) {
      const augmented = augmentIdentityRowWithMappedKeys(row, mappedTableFields);
      const rowId = String(augmented.id || augmented._id || '');
      if (!rowId || seenIds.has(rowId)) continue;
      seenIds.add(rowId);
      tableReadyData.push(augmented);
    }
    setIdentities(tableReadyData);
    setListTotal(typeof payload?.listTotal === 'number' ? payload.listTotal : fetched.length);
    const serverStats = payload?.stats;
    setStats({
      total: serverStats?.total ?? 0,
      active: serverStats?.active ?? 0,
      privileged: serverStats?.privileged ?? serverStats?.highRisk ?? 0,
      inactive: serverStats?.inactive ?? 0,
    });
    setStatsCardsHydrated(true);
  }, [identitiesQuery.data, mappedTableFields, tenantId]);

  const listErrorAtRef = useRef(0);
  useEffect(() => {
    const errorAt = Math.max(metadataQuery.errorUpdatedAt || 0, identitiesQuery.errorUpdatedAt || 0);
    if (!errorAt || errorAt === listErrorAtRef.current) return;
    listErrorAtRef.current = errorAt;
    console.error('Failed to fetch identities page:', metadataQuery.error || identitiesQuery.error);
    showToast('Failed to load identities', 'error');
  }, [
    metadataQuery.error,
    metadataQuery.errorUpdatedAt,
    identitiesQuery.error,
    identitiesQuery.errorUpdatedAt,
  ]);

  const refreshList = useCallback((opts = {}) => {
    if (typeof opts.listPage === 'number') setTablePage(opts.listPage);
    setListRefreshVersion((version) => version + 1);
  }, []);

  const materializationLockQuery = useQuery({
    queryKey: ['identity-materialization-lock', tenantId],
    enabled: Boolean(tenantId),
    refetchInterval: 5000,
    staleTime: 4000,
    queryFn: ({ signal }) =>
      identityProfileAPI
        .getMaterializationLockStatus({ tenantId }, { signal })
        .then((response) => response.data?.data || { active: false }),
  });
  const materializationLock = materializationLockQuery.data || { active: false };
  const loadMaterializationLockStatus = useCallback(
    () => materializationLockQuery.refetch(),
    [materializationLockQuery],
  );

  // One-shot toast + list reload when returning from profile mappings sync. Do not depend on `fetchData`
  // (it changes every search keystroke and would re-fire the toast while RR state still held the message).
  const handledSyncMessageRef = useRef(null);
  useEffect(() => {
    const msg = location.state?.identitySyncMessage;
    if (!msg || typeof msg !== 'string') return;
    if (handledSyncMessageRef.current === msg) return;
    handledSyncMessageRef.current = msg;
    const copy = msg;
    navigate('.', { replace: true, state: {} });
    showToast(copy, 'success');
    refreshList({ listPage: 0 });
  }, [location.state?.identitySyncMessage, navigate, refreshList]);

  /** Re-run identity refresh for every profile that has mappings (uses live app users when backend has materialized accounts). */
  const handleExportIdentities = useCallback(async () => {
    if (!tenantId) return;
    setExportingIdentities(true);
    try {
      const mapped = mappedTableFields;
      const fieldsForExport =
        mapped.length > 0
          ? mapped.filter((f) =>
            visibleColumns.length === 0 ? true : visibleColumns.includes(f.targetKey),
          )
          : DEFAULT_IDENTITY_EXPORT_FIELDS;

      const usedHeaders = new Set();
      const headerForField = (f) => {
        const base = (f.label || f.targetKey).replace(/\s*\(Required\)\s*$/i, '').trim() || f.targetKey;
        let h = base;
        let n = 0;
        while (usedHeaders.has(h)) {
          n += 1;
          h = `${base} (${n})`;
        }
        usedHeaders.add(h);
        return h;
      };
      const headers = fieldsForExport.map((f) => ({ targetKey: f.targetKey, header: headerForField(f) }));

      const collected = [];
      let page = 0;
      let listTotal = 0;
      for (; ;) {
        const params = {
          tenantId,
          page,
          limit: IDENTITY_EXPORT_PAGE_SIZE,
          sortBy: listSortField,
          sortDir: listSortDir,
        };
        if (lifecycleFilter !== 'ALL') params.lifecycleState = lifecycleFilter;
        if (departmentFilter !== 'ALL') params.department = departmentFilter;
        if (debouncedSearch) params.search = debouncedSearch;
        const identRes = await identityAPI.list(params);
        const payload = identRes.data;
        const batch = payload?.data || payload?.identities || payload?.docs || (Array.isArray(payload) ? payload : []);
        listTotal = typeof payload?.listTotal === 'number' ? payload.listTotal : batch.length;
        collected.push(...batch);
        if (batch.length < IDENTITY_EXPORT_PAGE_SIZE || collected.length >= listTotal) break;
        page += 1;
      }

      if (!collected.length) {
        showToast('No identities to export for the current filters.', 'info');
        return;
      }

      const sheetRows = collected.map((raw) => {
        const aug = augmentIdentityRowWithMappedKeys(raw, mapped);
        const row = {};
        for (const { targetKey, header } of headers) {
          let val = aug[targetKey];
          if ((val === undefined || val === null || val === '') && targetKey === 'displayName') {
            val =
              aug.displayName ||
              [aug.firstName, aug.lastName].filter(Boolean).join(' ') ||
              '';
          }
          if (val === undefined || val === null) val = '';
          else if (typeof val === 'object') val = JSON.stringify(val);
          else val = String(val);
          row[header] = val;
        }
        return row;
      });

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Identities');

      const headerRow = headers.map((h) => h.header);
      ws.addRow(headerRow);
      ws.getRow(1).font = { bold: true };

      for (const row of sheetRows) {
        ws.addRow(headerRow.map((key) => row[key] ?? ''));
      }

      const safeLifecycle = lifecycleFilter === 'ALL' ? 'all' : String(lifecycleFilter).toLowerCase();
      const safeSearch = debouncedSearch
        ? `-${debouncedSearch.replace(/[^\w\-]+/g, '_').slice(0, 40)}`
        : '';
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

      const fileName = `identities-${safeLifecycle}${safeSearch}-${stamp}.xlsx`;
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      showToast(`Exported ${sheetRows.length} row(s) to Excel.`, 'success');
    } catch (err) {
      console.error('Export identities failed:', err);
      showToast(err.response?.data?.message || err.message || 'Export failed', 'error');
    } finally {
      setExportingIdentities(false);
    }
  }, [tenantId, lifecycleFilter, departmentFilter, debouncedSearch, mappedTableFields, visibleColumns, listSortField, listSortDir]);

  const handleIdentityRefreshAll = async () => {
    if (!tenantId) return;
    if (materializationLock.active) {
      const who = materializationLock.ownerDisplayName || 'Another user';
      showToast(`Identity sync is already running (${who}). Wait until it finishes.`, 'warning');
      return;
    }
    setRefreshingIdentities(true);
    const pollIntervalMs = 2500;
    const maxWaitMs = 45 * 60 * 1000;

    const finishSuccess = async (d) => {
      const profilesProcessed = d.profilesProcessed ?? 0;
      const totalUpserted = d.identitiesUpserted ?? 0;
      const totalRows = d.rowsProcessed ?? 0;
      const errors = Array.isArray(d.errors) ? d.errors : [];
      const hintsText = typeof d.hintsText === 'string' && d.hintsText.trim() ? d.hintsText.trim() : '';
      setTablePage(0);
      refreshList({ listPage: 0 });
      await loadMaterializationLockStatus();

      if (errors.length && totalUpserted > 0) {
        const okProfiles = Math.max(0, profilesProcessed - errors.length);
        showToast(
          `Partial refresh: ${okProfiles}/${profilesProcessed} profile(s) OK. ${totalUpserted} upsert(s).\n${errors.slice(0, 5).join('\n')}`,
          'warning',
        );
        return;
      }
      if (errors.length) {
        showToast(
          `Identity refresh failed for one or more profiles.\n${errors.slice(0, 8).join('\n')}`,
          'error',
        );
        return;
      }
      if (totalUpserted === 0 && totalRows > 0) {
        const extra =
          hintsText ||
          'Likely no correlation key matched — check primary-key mapping and source columns.';
        showToast(
          `Refresh read ${totalRows} source row(s) but wrote 0 identities.\n${extra}`,
          'warning',
        );
        return;
      }
      if (totalUpserted === 0) {
        showToast(
          `No identities were upserted (0 source rows or empty sources).\nMap a primary key and ensure HRMS data exists for these profiles.`,
          'warning',
        );
        return;
      }
      showToast(
        `Identity refresh complete: ${totalUpserted} upsert(s) from ${profilesProcessed} profile(s) (${totalRows} source rows). List updated for your current filters.`,
        'success',
      );
    };

    try {
      const refreshRes = await identityProfileAPI.bulkMaterializationRefresh({ tenantId, async: true });
      const status = refreshRes.status;
      const payload = refreshRes.data?.data || {};

      if (status === 202 && payload.jobId) {
        showToast('Identity refresh is running on the server. This page will update when it finishes.', 'info');
        const jobId = payload.jobId;
        const deadline = Date.now() + maxWaitMs;
        let finishedWithinWindow = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, pollIntervalMs));
          const stRes = await identityProfileAPI.getBulkMaterializationJob(jobId, { tenantId });
          const job = stRes.data?.data;
          if (!job) {
            showToast('Refresh job expired or was not found. Refresh the page and try again.', 'warning');
            finishedWithinWindow = true;
            break;
          }
          if (job.status === 'completed') {
            await finishSuccess(job.result || {});
            finishedWithinWindow = true;
            break;
          }
          if (job.status === 'failed') {
            showToast(job.error || 'Identity refresh failed on the server.', 'error');
            await loadMaterializationLockStatus();
            finishedWithinWindow = true;
            break;
          }
        }
        if (!finishedWithinWindow && Date.now() >= deadline) {
          showToast('Identity refresh is still running on the server. Reload this page in a few minutes.', 'warning');
        }
      } else if (status === 200) {
        await finishSuccess(payload);
      } else {
        showToast(refreshRes.data?.message || 'Unexpected response from identity refresh.', 'error');
      }
    } catch (e) {
      if (e.response?.status === 409) {
        const who = e.response?.data?.lock?.ownerDisplayName || 'Another user';
        showToast(`${e.response?.data?.message || 'Locked.'} (${who})`, 'warning');
        await loadMaterializationLockStatus();
      } else {
        showToast(e.response?.data?.message || e.message || 'Identity refresh failed', 'error');
      }
    } finally {
      setRefreshingIdentities(false);
    }
  };

  const handleIdentityCreated = (response) => {
    const created = response?.data;
    // The backend enqueues a JOINER lifecycle event on create; the worker picks it up
    // within its poll interval, so provisioning is not visible the instant this returns.
    const joinerQueued = (response?.lifecycle?.enqueued || []).some(
      (event) => event?.eventType === 'JOINER',
    );
    const name = created?.displayName || 'Identity';
    const onboarding = response?.portalOnboarding;
    let message = joinerQueued
      ? `${name} created — Joiner provisioning is being evaluated.`
      : `${name} created successfully!`;
    let severity = 'success';
    if (onboarding?.created && onboarding.emailStatus === 'sent') {
      message = `${name} created. A portal account (${onboarding.username}) was created and a welcome email was sent.`;
    } else if (onboarding?.created && onboarding.emailStatus === 'failed') {
      message = `${name} created and portal account (${onboarding.username}) was created, but the welcome email could not be sent.`;
      severity = 'warning';
    } else if (onboarding?.error && !onboarding.created) {
      message = `${name} created, but the portal account was not created. ${onboarding.error.message || ''}`.trim();
      severity = 'warning';
    }
    showToast(message, severity);
    setCreateModal(false);
    setTablePage(0);
    refreshList({ listPage: 0 });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      const rows = text.split('\n').filter(row => row.trim() !== '');
      if (rows.length < 2) return showToast("CSV is empty or missing data.", "error");

      const headers = rows[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      const parsedRows = rows.slice(1).map(row => {
        const values = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let rowObj = {};
        headers.forEach((header, idx) => {
          rowObj[header] = values[idx] ? values[idx].replace(/^"|"$/g, '').trim() : '';
        });
        return rowObj;
      });

      setCsvData({ headers, rows: parsedRows });

      const initialMapping = {};
      importSchemaFields.forEach((field) => {
        const match = headers.find(h => h.toLowerCase().includes(field.key.toLowerCase()) || field.key.toLowerCase().includes(h.toLowerCase()));
        if (match) initialMapping[field.key] = match;
      });
      setFieldMappings(initialMapping);
      setMappingOpen(true);
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const executeImport = async () => {
    setUploading(true);
    try {
      const mappedIdentities = csvData.rows.map(row => {
        const mappedUser = {};
        Object.keys(fieldMappings).forEach(dbKey => {
          const csvColumnName = fieldMappings[dbKey];
          if (csvColumnName && row[csvColumnName] !== undefined && row[csvColumnName] !== '') {
            mappedUser[dbKey] = row[csvColumnName];
          }
        });

        if (!mappedUser.lifecycleState) mappedUser.lifecycleState = 'ACTIVE';
        if (!mappedUser.riskLevel) mappedUser.riskLevel = 'LOW';
        return mappedUser;
      }).filter(user => user.displayName || user.email);

      if (mappedIdentities.length === 0) {
        showToast("No valid data found after mapping. Ensure Display Name or Email is mapped.", "warning");
        setUploading(false);
        return;
      }

      const res = await identityAPI.bulkImport({ identities: mappedIdentities, tenantId: tenantId });

      const insertedCount = res.data?.insertedCount ?? 0;
      const errors = res.data?.errors || [];

      if (insertedCount === 0 && errors.length > 0) {
        showToast(`Import failed! DB Error: ${errors[0].error}`, "error");
      } else {
        showToast(`Successfully saved ${insertedCount} identities!`, "success");
      }

      setMappingOpen(false);
      setTablePage(0);
      refreshList({ listPage: 0 });
    } catch (err) {
      console.error("Import Error:", err);
      showToast(err.response?.data?.message || "The backend rejected the import.", "error");
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    try {
      await identityAPI.delete(deleteModal.id);
      showToast(`${deleteModal.name} was successfully deleted.`, 'success');
      refreshList();
    } catch (err) {
      console.error('Delete error', err);
      showToast("Failed to delete identity.", "error");
    } finally {
      setDeleteModal({ open: false, id: null, name: '' });
    }
  };

  const executeDeleteAll = async () => {
    try {
      const res = await identityAPI.deleteAll({ tenantId: tenantId });
      showToast(res.data?.message || "All identities wiped successfully.", "success");
      setTablePage(0);
      refreshList({ listPage: 0 });
    } catch (err) {
      console.error("Delete All Error:", err);
      showToast("Failed to delete all identities.", "error");
    } finally {
      setDeleteAllModal(false);
    }
  };

  const persistColumnLayout = useCallback((nextOrder, nextVisible) => {
    if (!tenantId) return;
    saveIdentitiesColumnPrefs(tenantId, {
      columnOrder: nextOrder,
      visibleColumns: nextVisible,
    });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !columnOrderKeys.length) return;
    persistColumnLayout(columnOrderKeys, visibleColumns);
  }, [tenantId, columnOrderKeys, visibleColumns, persistColumnLayout]);

  const columnPickerDefs = useMemo(
    () => mappedTableFields.map((field) => ({
      key: field.targetKey,
      label: String(field.label || field.targetKey).replace(/\s*\(Required\)\s*$/i, ''),
    })),
    [mappedTableFields],
  );

  const orderedMappedFields = useMemo(() => {
    const byKey = new Map(mappedTableFields.map((f) => [f.targetKey, f]));
    const keys = mergeColumnOrderKeys(
      columnOrderKeys,
      mappedTableFields.map((f) => f.targetKey),
    );
    return keys.map((key) => byKey.get(key)).filter(Boolean);
  }, [mappedTableFields, columnOrderKeys]);

  const renderMappedCell = (targetKey, row, { isPrimaryLink } = {}) => {
    const val = row[targetKey];
    const display = val === '' || val == null ? '—' : normalizeDigitLikeDisplayValue(val);

    const goDetail = () => navigate(`/identities/${row.id}`);
    const warmCatalog = () => {
      if (row?.id) prefetchIdentityCatalogShell(queryClient, row.id);
    };

    const linkName = (
      <Typography
        variant="body2"
        sx={{
          fontWeight: 600,
          color: palette.text.link,
          cursor: 'pointer',
          '&:hover': { textDecoration: 'underline' },
        }}
        onMouseEnter={warmCatalog}
        onFocus={warmCatalog}
        onClick={goDetail}
      >
        {display !== '—' && display ? display : (row.displayName || [row.firstName, row.lastName].filter(Boolean).join(' ') || '(No name)')}
      </Typography>
    );

    if (canonicalIdentityMappingTargetKey(targetKey) === 'displayName') {
      const computedName =
        (val && val !== '—' ? val : '') ||
        row.displayName ||
        [row.firstName, row.lastName].filter(Boolean).join(' ') ||
        '(No Name Provided)';
      return (
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: palette.text.link, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          onMouseEnter={warmCatalog}
          onFocus={warmCatalog}
          onClick={goDetail}
        >
          {computedName}
        </Typography>
      );
    }
    if (targetKey === 'email') {
      return (
        <Typography
          variant="body2"
          sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline', color: palette.text.link } }}
          onMouseEnter={warmCatalog}
          onFocus={warmCatalog}
          onClick={goDetail}
        >
          {row.email != null && row.email !== '' ? normalizeDigitLikeDisplayValue(row.email) : '—'}
        </Typography>
      );
    }
    if (targetKey === 'uid') {
      return (
        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: palette.text.link, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
          onMouseEnter={warmCatalog}
          onFocus={warmCatalog}
          onClick={goDetail}
        >
          {display}
        </Typography>
      );
    }
    if (isManagerRelatedTargetKey(targetKey)) {
      const st = row.managerResolutionStatus;
      const mgr = row.managerId;
      const mgrName =
        mgr && typeof mgr === 'object' && mgr.displayName
          ? mgr.displayName
          : '';
      const mgrId =
        mgr && typeof mgr === 'object' && mgr._id != null
          ? String(mgr._id)
          : mgr
            ? String(mgr)
            : '';

      if (st === 'resolved' && mgrId && /^[a-f0-9]{24}$/i.test(mgrId)) {
        const linkText = display !== '—' ? display : (mgrName || row.managerEmail || '—');
        return (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: palette.text.link,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
            onClick={(e) => {
              e.stopPropagation();
              prefetchIdentityCatalogShell(queryClient, mgrId);
              navigate(`/identities/${mgrId}`);
            }}
          >
            {linkText}
          </Typography>
        );
      }
      if (st === 'root') {
        return (
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            No Manager
          </Typography>
        );
      }
      if (st === 'unresolved' || (st !== 'resolved' && row.managerKeyRaw && String(row.managerKeyRaw).trim())) {
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, maxWidth: 220 }}>
            <WarningAmber sx={{ fontSize: 18, color: 'warning.main', flexShrink: 0 }} />
            <Typography variant="caption" color="warning.dark" sx={{ wordBreak: 'break-word' }}>
              {row.managerKeyRaw || '—'}
            </Typography>
          </Box>
        );
      }
      if (mgrId && /^[a-f0-9]{24}$/i.test(mgrId)) {
        const linkText = display !== '—' ? display : (mgrName || row.managerEmail || '—');
        return (
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: palette.text.link,
              cursor: 'pointer',
              '&:hover': { textDecoration: 'underline' },
            }}
            onClick={(e) => {
              e.stopPropagation();
              prefetchIdentityCatalogShell(queryClient, mgrId);
              navigate(`/identities/${mgrId}`);
            }}
          >
            {linkText}
          </Typography>
        );
      }
      return <Typography variant="body2">{display}</Typography>;
    }
    if (isPrimaryLink) {
      return linkName;
    }
    if (targetKey === 'status') {
      const st = String(row[targetKey] || row.lifecycleState || '').toLowerCase();
      const color = lifecycleColors[st] || palette.text.secondary;
      const chipLabel = display !== '—' ? display : row.lifecycleState || '—';
      return (
        <Chip
          label={chipLabel}
          size="small"
          sx={{ backgroundColor: `${color}1A`, color, fontWeight: 600, fontSize: '0.7rem', height: 22, borderRadius: 1 }}
        />
      );
    }
    return <Typography variant="body2">{display}</Typography>;
  };

  const visibleMappedFields = orderedMappedFields.filter((f) => visibleColumns.includes(f.targetKey));
  const firstVisibleKey = visibleMappedFields[0]?.targetKey;
  const linkableKeys = new Set(['displayName', 'email', 'uid']);

  const activeColumns = visibleMappedFields.map((field) => ({
    field: field.targetKey,
    headerName: field.label.replace(/\s*\(Required\)\s*$/i, '').trim(),
    minWidth: 140,
    renderCell: (row) =>
      renderMappedCell(field.targetKey, row, {
        isPrimaryLink: firstVisibleKey === field.targetKey && !linkableKeys.has(field.targetKey),
      }),
  }));

  activeColumns.push({
    field: 'actions', headerName: 'Actions', minWidth: 100, sortable: false, disableColumnMenu: true,
    renderCell: (row) => (
      <IconButton color="error" size="small" onClick={(e) => {
        e.stopPropagation();
        const computedName = row.displayName || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.email;
        setDeleteModal({ open: true, id: row.id, name: computedName });
      }}>
        <Delete fontSize="small" />
      </IconButton>
    )
  });

  const columnsToolbar =
    mappedTableFields.length > 0 ? (
      <AccountTableColumnPicker
        columnDefs={columnPickerDefs}
        columnOrderKeys={columnOrderKeys.length ? columnOrderKeys : columnPickerDefs.map((d) => d.key)}
        visibleColumns={visibleColumns}
        onColumnOrderChange={setColumnOrderKeys}
        onVisibleColumnsChange={setVisibleColumns}
        helperText="Show/hide columns and use the arrows to set left→right order. Preferences are saved for this tenant."
        buttonSx={{
          ...identitiesToolbarBtnSx,
          color: palette.text.secondary,
          borderColor: palette.border.default,
        }}
      />
    ) : null;

  const activeFilterCount =
    (debouncedSearch ? 1 : 0) +
    (lifecycleFilter !== 'ALL' ? 1 : 0) +
    (departmentFilter !== 'ALL' ? 1 : 0);

  const clearAllFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setLifecycleFilter('ALL');
    setDepartmentFilter('ALL');
    setTablePage(0);
    setFiltersMenuAnchor(null);
  };

  const tableTitle = activeFilterCount > 0
    ? `Identities · ${Number(listTotal || 0).toLocaleString()} match${listTotal === 1 ? '' : 'es'}`
    : 'Identities';

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', md: 'flex-start' },
          gap: 2,
          mb: 2.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: palette.brand.primary,
              background: `linear-gradient(135deg, ${alpha(palette.brand.primary, 0.12)} 0%, ${alpha('#1e3a8a', 0.1)} 100%)`,
              border: `1px solid ${alpha(palette.brand.primary, 0.18)}`,
            }}
          >
            <GroupsOutlined sx={{ fontSize: 24 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 700,
                fontSize: { xs: '1.375rem', sm: '1.625rem' },
                letterSpacing: '-0.02em',
                color: palette.text.primary,
                lineHeight: 1.2,
              }}
            >
              Identities
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: palette.text.secondary, fontSize: '0.8125rem' }}>
              Lifecycle and access across applications
            </Typography>
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1,
            alignItems: 'center',
            justifyContent: { xs: 'flex-start', md: 'flex-end' },
            width: { xs: '100%', md: 'auto' },
            flexShrink: 0,
          }}
        >
          <input type="file" accept=".csv" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileSelect} />

          <Button
            variant="outlined"
            startIcon={<PersonAdd sx={{ fontSize: '1.15rem !important' }} />}
            onClick={() => setCreateModal(true)}
            disabled={!tenantId}
            title="Create a single identity. Joiner lifecycle evaluation starts automatically."
            sx={{
              ...identitiesToolbarBtnSx,
              height: 40,
              borderRadius: 2,
              borderColor: palette.border.default,
              color: palette.text.primary,
              bgcolor: palette.bg.secondary,
              '&:hover': {
                borderColor: alpha(palette.brand.primary, 0.4),
                bgcolor: alpha(palette.brand.primary, 0.04),
              },
            }}
          >
            New identity
          </Button>

          <Button
            variant="contained"
            startIcon={
              refreshingIdentities
                ? <CircularProgress size={16} color="inherit" thickness={5} />
                : <RefreshRounded sx={{ fontSize: '1.15rem !important' }} />
            }
            onClick={handleIdentityRefreshAll}
            disabled={!tenantId || refreshingIdentities || materializationLock.active}
            title="Re-sync identities from application accounts using each identity profile’s mappings (same engine as Identity Profile → Save mappings). Blocked while another user or tab is running identity sync for this tenant."
            sx={{
              ...identitiesToolbarBtnSx,
              height: 40,
              px: { xs: 1.5, sm: 2 },
              borderRadius: 2,
              color: '#fff',
              background: `linear-gradient(135deg, ${palette.brand.primary} 0%, #1e3a8a 100%)`,
              boxShadow: 'none',
              transition: 'background 0.15s ease, box-shadow 0.15s ease',
              '&:hover': {
                background: `linear-gradient(135deg, ${palette.brand.primaryHover} 0%, #172554 100%)`,
                boxShadow: `0 4px 12px ${alpha('#1e3a8a', 0.28)}`,
              },
              '&.Mui-disabled': {
                background: `linear-gradient(135deg, ${alpha(palette.brand.primary, 0.4)} 0%, ${alpha('#1e3a8a', 0.35)} 100%)`,
                color: alpha('#fff', 0.85),
                boxShadow: 'none',
              },
            }}
          >
            {refreshingIdentities ? 'Refreshing…' : 'Identity refresh'}
          </Button>

          <Button
            variant="outlined"
            startIcon={exportingIdentities ? <CircularProgress size={16} color="inherit" thickness={5} /> : <Download />}
            onClick={handleExportIdentities}
            disabled={!tenantId || exportingIdentities}
            sx={{
              ...identitiesToolbarBtnSx,
              height: 40,
              borderRadius: 2,
              borderColor: palette.border.default,
              color: palette.text.primary,
              bgcolor: palette.bg.secondary,
              '&:hover': {
                borderColor: alpha(palette.brand.primary, 0.4),
                bgcolor: alpha(palette.brand.primary, 0.04),
              },
            }}
          >
            {exportingIdentities ? 'Exporting…' : 'Export'}
          </Button>
        </Box>
      </Box>

      {tenantId && materializationLock.active ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Identity sync is in progress for this tenant (started by{' '}
          <strong>{materializationLock.ownerDisplayName || 'another user'}</strong>
          {materializationLock.ownerEmail ? ` — ${materializationLock.ownerEmail}` : ''}). Identity refresh is disabled
          until it completes so data does not run twice in parallel.
        </Alert>
      ) : null}

      <Grid container spacing={1.75} sx={{ mb: 2.5 }}>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="TOTAL"
            value={stats.total}
            icon={<People fontSize="small" />}
            color={palette.brand.primary}
            subtitle="Correlated identities"
            loading={loading && !statsCardsHydrated}
            sx={{
              borderRadius: 2.5,
              boxShadow: 'none',
              border: `1px solid ${palette.border.default}`,
              '&::before': { height: 2.5 },
            }}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="ACTIVE"
            value={stats.active}
            icon={<CheckCircle fontSize="small" />}
            color={palette.status.success}
            subtitle="In ACTIVE lifecycle"
            loading={loading && !statsCardsHydrated}
            sx={{
              borderRadius: 2.5,
              boxShadow: 'none',
              border: `1px solid ${palette.border.default}`,
              '&::before': { height: 2.5 },
            }}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="INACTIVE"
            value={stats.inactive}
            icon={<PersonOff fontSize="small" />}
            color={palette.text.secondary}
            subtitle="Non-ACTIVE states"
            loading={loading && !statsCardsHydrated}
            sx={{
              borderRadius: 2.5,
              boxShadow: 'none',
              border: `1px solid ${palette.border.default}`,
              '&::before': { height: 2.5 },
            }}
          />
        </Grid>
      </Grid>

      {IDENTITIES_LIST_LIFECYCLE_TABS.length > 1 ? (
        <Tabs
          value={lifecycleFilter}
          onChange={(_, v) => {
            setTablePage(0);
            setLifecycleFilter(v);
          }}
          sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 40, fontSize: '0.85rem' } }}
        >
          {IDENTITIES_LIST_LIFECYCLE_TABS.map((state) => (
            <Tab key={state} label={state} value={state} />
          ))}
        </Tabs>
      ) : null}

      {tenantId ? (
        <Paper
          elevation={0}
          sx={{
            p: { xs: 1.5, sm: 2 },
            mb: 2,
            borderRadius: 2.5,
            border: `1px solid ${palette.border.default}`,
            bgcolor: alpha(palette.bg.primary, 0.85),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              alignItems: { xs: 'stretch', md: 'flex-end' },
              gap: { xs: 1.5, md: 1.75 },
            }}
          >
            <Box sx={{ flex: { md: '1 1 42%' }, minWidth: 0 }}>
              <Typography component="label" sx={filterLabelSx}>
                Search Identities
              </Typography>
              <TextField
                size="small"
                fullWidth
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search name, email, employee ID, department, title…"
                sx={filterFieldSx}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon sx={{ fontSize: 18, color: palette.text.secondary }} />
                    </InputAdornment>
                  ),
                  endAdornment: searchInput ? (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        edge="end"
                        aria-label="Clear search"
                        onClick={() => {
                          setSearchInput('');
                          setTablePage(0);
                        }}
                      >
                        <ClearIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </InputAdornment>
                  ) : null,
                }}
              />
            </Box>

            <Box sx={{ flex: { md: '0 1 180px' }, minWidth: { md: 160 } }}>
              <Typography component="label" sx={filterLabelSx}>
                Department
              </Typography>
              <FormControl size="small" fullWidth sx={filterFieldSx}>
                <Select
                  value={departmentFilter}
                  onChange={(e) => {
                    setDepartmentFilter(e.target.value);
                    setTablePage(0);
                  }}
                  displayEmpty
                  MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
                >
                  <MenuItem value="ALL">All Departments</MenuItem>
                  {departmentOptions.map((dept) => (
                    <MenuItem key={dept} value={dept}>
                      {dept}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ flex: { md: '0 1 160px' }, minWidth: { md: 140 } }}>
              <Typography component="label" sx={filterLabelSx}>
                Status
              </Typography>
              <FormControl size="small" fullWidth sx={filterFieldSx}>
                <Select
                  value={lifecycleFilter}
                  onChange={(e) => {
                    setLifecycleFilter(e.target.value);
                    setTablePage(0);
                  }}
                >
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ flexShrink: 0, pt: { xs: 0, md: 0.25 } }}>
              <Button
                variant="outlined"
                startIcon={<FilterList />}
                onClick={(e) => setFiltersMenuAnchor(e.currentTarget)}
                sx={{
                  ...identitiesToolbarBtnSx,
                  height: 40,
                  borderColor: palette.border.default,
                  color: palette.text.primary,
                  bgcolor: palette.bg.secondary,
                  px: 1.75,
                  '&:hover': {
                    borderColor: alpha(palette.brand.primary, 0.4),
                    bgcolor: alpha(palette.brand.primary, 0.04),
                  },
                }}
              >
                Filters
                {activeFilterCount > 0 ? (
                  <Chip
                    size="small"
                    label={activeFilterCount}
                    sx={{
                      ml: 1,
                      height: 20,
                      minWidth: 20,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      bgcolor: alpha(palette.brand.primary, 0.12),
                      color: palette.brand.primary,
                    }}
                  />
                ) : null}
              </Button>
              <Menu
                anchorEl={filtersMenuAnchor}
                open={Boolean(filtersMenuAnchor)}
                onClose={() => setFiltersMenuAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              >
                <MenuItem disabled={activeFilterCount === 0} onClick={clearAllFilters}>
                  Clear all filters
                </MenuItem>
              </Menu>
            </Box>
          </Box>
        </Paper>
      ) : null}

      {tenantId && !loading && stats.total === 0 && mappedTableFields.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
            No identities yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure <strong>Identity Profiles → Mapping</strong>, then click <strong>Identity refresh</strong> above (or <strong>Save mappings</strong> on the profile) to sync from application accounts.
          </Typography>
        </Alert>
      )}

      {!tenantId ? (
        <Paper sx={{ p: 6, textAlign: 'center', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>No Tenant Associated</Typography>
          <Typography variant="body2" color="text.secondary">Your user account is not associated with any tenant.</Typography>
        </Paper>
      ) : (
        <>
          {mappedTableFields.length === 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              No attribute mappings are configured yet. Add mappings under{' '}
              <strong>Identities → Identity Profiles → [profile] → Mappings</strong> to choose which fields appear in this list.
            </Alert>
          )}
          <DataTable
            title={tableTitle}
            columns={activeColumns}
            rows={identities}
            loading={loading}
            toolbarRight={columnsToolbar}
            onRefresh={() => {
              refreshList({ listPage: 0 });
            }}
            defaultSort={defaultSortKey}
            sortField={listSortField}
            sortDir={listSortDir}
            onSortChange={(field, dir) => {
              setTablePage(0);
              setListSortField(field);
              setListSortDir(dir);
            }}
            emptyMessage={
              mappedTableFields.length === 0
                ? 'Add profile mappings to show columns, or create identities after mapping.'
                : activeFilterCount > 0
                  ? 'No identities match the current filters'
                  : 'No identities found'
            }
            serverPagination
            totalCount={listTotal}
            page={tablePage}
            rowsPerPage={rowsPerPage}
            onPageChange={(p) => setTablePage(p)}
            onRowsPerPageChange={(n) => {
              setRowsPerPage(n);
              setTablePage(0);
            }}
            searchable={false}
          />
        </>
      )}

      {/* --- CREATE SINGLE IDENTITY MODAL (fields come from the tenant's identity profile) --- */}
      <CreateIdentityDialog
        open={createModal}
        tenantId={tenantId}
        onClose={() => setCreateModal(false)}
        onCreated={handleIdentityCreated}
        onError={(message) => showToast(message, 'error')}
      />

      {/* --- MAPPING WIZARD DIALOG --- */}
      <Dialog open={mappingOpen} onClose={() => !uploading && setMappingOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700 }}>
          <CompareArrows color="primary" /> Map CSV Columns
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select which column from your CSV file matches the database identity fields. We found <strong>{csvData.rows.length} rows</strong> in your file.
          </Typography>

          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={5}><Typography variant="overline" fontWeight={700}>Identity Model Field (Database)</Typography></Grid>
            <Grid item xs={7}><Typography variant="overline" fontWeight={700}>CSV Column (Your File)</Typography></Grid>
          </Grid>

          {importSchemaFields.map((field) => (
            <Grid container spacing={2} alignItems="center" key={field.key} sx={{ mb: 2 }}>
              <Grid item xs={5}>
                <Typography variant="body2" fontWeight={600}>{field.label}</Typography>
                <Typography variant="caption" color="text.secondary">db: {field.key}</Typography>
              </Grid>
              <Grid item xs={7}>
                <FormControl fullWidth size="small">
                  <Select
                    value={fieldMappings[field.key] || ''}
                    displayEmpty
                    onChange={(e) => setFieldMappings({ ...fieldMappings, [field.key]: e.target.value })}
                  >
                    <MenuItem value=""><em>-- Ignore / Do Not Map --</em></MenuItem>
                    {csvData.headers.map((header) => (
                      <MenuItem key={header} value={header}>{header}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          ))}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setMappingOpen(false)} disabled={uploading} color="inherit">Cancel</Button>
          <Button onClick={executeImport} variant="contained" disabled={uploading}>
            {uploading ? <CircularProgress size={24} color="inherit" /> : 'Execute Import'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- INDIVIDUAL DELETE CONFIRMATION DIALOG --- */}
      <Dialog open={deleteModal.open} onClose={() => setDeleteModal({ open: false, id: null, name: '' })}>
        <DialogTitle sx={{ fontWeight: 700, color: palette.status.error }}>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to permanently delete <strong>{deleteModal.name}</strong>? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteModal({ open: false, id: null, name: '' })} color="inherit">Cancel</Button>
          <Button onClick={confirmDelete} color="error" variant="contained">Delete</Button>
        </DialogActions>
      </Dialog>

      {/* --- DELETE ALL CONFIRMATION DIALOG --- */}
      <Dialog open={deleteAllModal} onClose={() => setDeleteAllModal(false)}>
        <DialogTitle sx={{ fontWeight: 700, color: palette.status.error }}>⚠️ WIPE ALL DATA?</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body1" sx={{ mb: 2 }}>
            You are about to permanently delete <strong>EVERY SINGLE IDENTITY</strong> in your database.
          </Typography>
          <Typography variant="body2" color="error" sx={{ fontWeight: 600 }}>
            This action cannot be undone. Are you absolutely sure?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setDeleteAllModal(false)} color="inherit">Cancel</Button>
          <Button onClick={executeDeleteAll} color="error" variant="contained" sx={{ fontWeight: 700 }}>
            YES, WIPE EVERYTHING
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={toast.duration ?? 6000}
        onClose={() => setToast((t) => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setToast((t) => ({ ...t, open: false }))}
          severity={toast.severity}
          variant={toast.severity === 'success' ? 'filled' : 'standard'}
          sx={{
            maxWidth: 'min(960px, 92vw)',
            minWidth: 260,
            width: '100%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            alignItems: 'flex-start',
            '& .MuiAlert-message': { width: '100%' },
          }}
        >
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}