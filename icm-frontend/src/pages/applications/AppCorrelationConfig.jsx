import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Box, Card, CardContent, Typography, Grid, TextField, MenuItem, Button, 
  CircularProgress, Alert, Chip, List, ListItem, ListItemAvatar, 
  Avatar, ListItemText, Divider, InputAdornment, Dialog, DialogTitle, 
  DialogContent, IconButton, DialogActions, Tooltip, Tabs, Tab,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination,
  LinearProgress,
} from '@mui/material';
import { 
  PlayArrow, Refresh, Search, Person, VpnKey, Close, ArrowForward, AutoFixHigh, AccountTree, SupervisorAccount, CheckCircle, WarningAmber
} from '@mui/icons-material';
import { applicationAPI, identityAPI, identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import AccountStatusCell from '../../components/accounts/AccountStatusCell';
import {
  accountDialogTitleFromUser,
  buildAccountDetailFieldRows,
  formatAccountDetailFieldValue,
  isAccountStatusColumnKey,
  isMemberOfEntitlementsColumnKey,
  memberOfDetailLines,
} from '../../utils/accountTableColumns';

/** Technical names from saved Application / Entitlement schema (same order as schema tabs). */
function standardFieldsFromMappings(mappings) {
  if (!Array.isArray(mappings)) return [];
  const seen = new Set();
  const out = [];
  for (const m of mappings) {
    const k = String(m.standardField || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function nonempty(v) {
  return v != null && String(v).trim() !== '';
}

/**
 * Resolve a schema field on an app user doc (top-level, then rawData by standardField and csv columns).
 * Matches backend correlation field resolution.
 * @param {string[]} [extraKeys] csvColumn(s) from mappings for this standardField
 */
function fieldValueFromMappedUser(user, standardField, extraKeys = []) {
  if (!user || !standardField) return undefined;
  const k0 = String(standardField).trim();
  if (!k0) return undefined;
  const extras = (Array.isArray(extraKeys) ? extraKeys : [extraKeys])
    .map((k) => String(k || '').trim())
    .filter((k) => k && k !== k0);
  const order = [k0, ...extras];
  const rd = user.rawData && typeof user.rawData === 'object' ? user.rawData : null;
  for (const key of order) {
    if (nonempty(user[key])) return user[key];
  }
  for (const key of order) {
    if (rd && nonempty(rd[key])) return rd[key];
  }
  return undefined;
}

/** Server-side page size for “Assigned Users” entitlement modal. */
const ASSIGNED_USERS_PAGE_SIZE = 10;

/** Debounce delay (ms) for assigned-users modal search. */
const ASSIGNED_USERS_SEARCH_DEBOUNCE_MS = 300;

/** Server-side page size for manager-group cards on the correlation tab. */
const MANAGER_GROUPS_PAGE_ROWS = 24;
/** Server-side page size for direct reports modal under one manager group. */
const MANAGER_REPORTS_PAGE_SIZE = 25;
const MANAGER_GROUPS_SEARCH_DEBOUNCE_MS = 300;
const MANAGER_REPORTS_SEARCH_DEBOUNCE_MS = 300;

export default function AppCorrelationConfig({
  applicationId,
  entitlementCount = 0,
  adAutoCorrelation = false,
}) {
  const { user } = useAuth();
  /** Stable primitive — avoids re-running heavy load when AuthContext replaces `user` with the same tenant. */
  const tenantKey = useMemo(() => {
    const raw = user?.tenantId;
    if (raw == null || raw === '') return '';
    const inner = typeof raw === 'object' && raw._id != null ? raw._id : raw;
    return String(inner);
  }, [user?.tenantId]);
  const [innerTab, setInnerTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  
  // --- Data States ---
  /** Facet counts + paginated manager groups from server (no bulk user download). */
  const [managerFacetData, setManagerFacetData] = useState(null);
  const [mgrGroupRows, setMgrGroupRows] = useState([]);
  const [mgrGroupsTotal, setMgrGroupsTotal] = useState(0);
  const [mgrGroupsPage, setMgrGroupsPage] = useState(0);
  const [mgrGroupsRowsPerPage, setMgrGroupsRowsPerPage] = useState(MANAGER_GROUPS_PAGE_ROWS);
  const [mgrGroupsSearchInput, setMgrGroupsSearchInput] = useState('');
  const [debouncedMgrGroupsSearch, setDebouncedMgrGroupsSearch] = useState('');
  const prevDebouncedMgrSearchRef = useRef(undefined);
  const [managerReportsSearchInput, setManagerReportsSearchInput] = useState('');
  const [debouncedManagerReportsSearch, setDebouncedManagerReportsSearch] = useState('');
  const prevDebouncedManagerReportsRef = useRef(undefined);

  const [userFields, setUserFields] = useState([]);
  const [entitlementFields, setEntitlementFields] = useState([]);
  const [selectedUserField, setSelectedUserField] = useState('member_of_entitlements');
  const [selectedEntitlementField, setSelectedEntitlementField] = useState('entitlement_name');
  const [matrixData, setMatrixData] = useState([]);
  const [matrixTotal, setMatrixTotal] = useState(0);
  const [matrixPage, setMatrixPage] = useState(0);
  const [matrixRowsPerPage, setMatrixRowsPerPage] = useState(24);
  const [executing, setExecuting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCard, setSelectedCard] = useState(null);
  const [assignedUsersSearchInput, setAssignedUsersSearchInput] = useState('');
  const [debouncedAssignedUsersSearch, setDebouncedAssignedUsersSearch] = useState('');
  const prevDebouncedAssignedSearchRef = useRef(undefined);
  /** Application user schema primary key (`userMappings` row marked isPrimaryKey). */
  const [applicationUserPkField, setApplicationUserPkField] = useState('');
  /** Full userMappings from Application (schema order + csv columns for rawData). */
  const [applicationUserMappings, setApplicationUserMappings] = useState([]);

  /** Global identity attribute options: target keys from Identity Profile mappings (tenant + this app), else schema fallback. */
  const [identityFieldOptions, setIdentityFieldOptions] = useState([]);
  const [managerAppAttr, setManagerAppAttr] = useState('manager_id'); 
  const [managerIdentityAttr, setManagerIdentityAttr] = useState('employeeId'); 
  const [executingManager, setExecutingManager] = useState(false);
  /** Server-reported progress while async manager correlation job runs. */
  const [managerJobProgress, setManagerJobProgress] = useState(null);

  // --- Data Fetchers ---
  const fetchMatrixData = useCallback(async () => {
    if (!applicationId) return;
    try {
      const res = await applicationAPI.getAppEntitlementCorrelations(applicationId, {
        page: matrixPage,
        limit: matrixRowsPerPage,
      });
      setMatrixData(res.data?.data || []);
      setMatrixTotal(Number(res.data?.total ?? 0));
    } catch (err) {
      console.error('Failed to fetch matrix', err);
    }
  }, [applicationId, matrixPage, matrixRowsPerPage]);

  const fetchManagerCorrelationPage = useCallback(async () => {
    if (!applicationId || !managerAppAttr) return;
    try {
      const [facRes, grpRes] = await Promise.all([
        applicationAPI.getManagerCorrelationFacets(applicationId, { managerAttr: managerAppAttr }),
        applicationAPI.getManagerCorrelationGroups(applicationId, {
          managerAttr: managerAppAttr,
          page: mgrGroupsPage,
          limit: mgrGroupsRowsPerPage,
          ...(debouncedMgrGroupsSearch ? { search: debouncedMgrGroupsSearch } : {}),
        }),
      ]);
      setManagerFacetData(facRes.data?.data ?? null);
      setMgrGroupRows(grpRes.data?.data || []);
      setMgrGroupsTotal(Number(grpRes.data?.total ?? 0));
    } catch (err) {
      console.error('Failed to fetch manager correlation view', err);
    }
  }, [
    applicationId,
    managerAppAttr,
    mgrGroupsPage,
    mgrGroupsRowsPerPage,
    debouncedMgrGroupsSearch,
  ]);

  useEffect(() => {
    const loadConfigData = async () => {
      setLoading(true);
      try {
        const appRes = await applicationAPI.getById(applicationId).catch(() => ({ data: {} }));

        const appPayload = appRes.data?.data ?? appRes.data;
        const uFields = standardFieldsFromMappings(appPayload?.userMappings);
        const eFields = standardFieldsFromMappings(appPayload?.entitlementMappings);
        const um = Array.isArray(appPayload?.userMappings) ? appPayload.userMappings : [];
        setApplicationUserMappings(um);
        const pkUser = um.find((m) => m.isPrimaryKey);
        setApplicationUserPkField(String(pkUser?.standardField || '').trim());

        // Identity Profile → target keys from attributeMappings (labels from Mappings tab).
        // Prefer profiles whose source application is this app; if none, use tenant-wide union (same API as Identity & account correlation).
        let identityOpts = [];
        if (tenantKey && applicationId) {
          const scoped = await identityProfileAPI
            .getMappedFields({ tenantId: tenantKey, applicationId })
            .catch(() => ({ data: { data: [] } }));
          let mapped = scoped.data?.data || [];
          if (mapped.length === 0) {
            const all = await identityProfileAPI
              .getMappedFields({ tenantId: tenantKey })
              .catch(() => ({ data: { data: [] } }));
            mapped = all.data?.data || [];
          }
          identityOpts = mapped
            .map((m) => ({
              targetKey: String(m.targetKey || '').trim(),
              label: String(m.label || m.targetKey || '').trim(),
            }))
            .filter((o) => o.targetKey);
        }
        if (identityOpts.length === 0) {
          const idRes = await identityAPI.getMetaFields().catch(() => ({ data: { data: [] } }));
          let raw = idRes.data?.data || [];
          if (raw.length > 0 && typeof raw[0] === 'object') {
            raw = raw.map(
              (f) => f.key || f.name || f.field || f.db || Object.values(f)[0],
            );
          }
          if (raw.length === 0) {
            raw = [
              'employeeId',
              'email',
              'displayName',
              'firstName',
              'lastName',
              'department',
              'title',
              'manager',
              'lifecycleState',
              'identityType',
            ];
          }
          identityOpts = raw.map((k) => ({ targetKey: k, label: k }));
        }
        
        setUserFields(uFields.length ? uFields : []);
        setEntitlementFields(eFields.length ? eFields : []);
        setSelectedUserField((prev) => {
          const next = uFields.length
            ? uFields.includes(prev)
              ? prev
              : uFields.includes('member_of_entitlements')
                ? 'member_of_entitlements'
                : uFields[0]
            : '';
          return next;
        });
        setSelectedEntitlementField((prev) => {
          const next = eFields.length
            ? eFields.includes(prev)
              ? prev
              : eFields.includes('entitlement_name')
                ? 'entitlement_name'
                : eFields[0]
            : '';
          return next;
        });
        setIdentityFieldOptions(identityOpts);
        setManagerIdentityAttr((prev) =>
          identityOpts.some((o) => o.targetKey === prev)
            ? prev
            : identityOpts[0]?.targetKey || 'employeeId',
        );
      } catch (err) {
        setMessage({ type: 'error', text: 'Failed to load configuration data.' });
      } finally {
        setLoading(false);
      }
    };
    if (applicationId) loadConfigData();
  }, [applicationId, tenantKey]);

  useEffect(() => {
    fetchMatrixData();
  }, [fetchMatrixData]);

  useEffect(() => {
    if (innerTab !== 1 || !applicationId || !managerAppAttr) return;
    fetchManagerCorrelationPage();
  }, [innerTab, applicationId, managerAppAttr, fetchManagerCorrelationPage]);

  useEffect(() => {
    setMgrGroupsPage(0);
  }, [managerAppAttr]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedMgrGroupsSearch(mgrGroupsSearchInput.trim());
    }, MANAGER_GROUPS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [mgrGroupsSearchInput]);

  useEffect(() => {
    const prev = prevDebouncedMgrSearchRef.current;
    if (prev === undefined) {
      prevDebouncedMgrSearchRef.current = debouncedMgrGroupsSearch;
      return;
    }
    if (prev === debouncedMgrGroupsSearch) return;
    prevDebouncedMgrSearchRef.current = debouncedMgrGroupsSearch;
    setMgrGroupsPage(0);
  }, [debouncedMgrGroupsSearch]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedManagerReportsSearch(managerReportsSearchInput.trim());
    }, MANAGER_REPORTS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [managerReportsSearchInput]);

  useEffect(() => {
    if (!selectedCard?.managerKeyNorm) return;
    const prev = prevDebouncedManagerReportsRef.current;
    if (prev === undefined) {
      prevDebouncedManagerReportsRef.current = debouncedManagerReportsSearch;
      return;
    }
    if (prev === debouncedManagerReportsSearch) return;
    prevDebouncedManagerReportsRef.current = debouncedManagerReportsSearch;
    setSelectedCard((p) =>
      p?.managerKeyNorm ? { ...p, usersPage: 0, users: [], loadingUsers: true } : p,
    );
  }, [debouncedManagerReportsSearch, selectedCard?.managerKeyNorm]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedAssignedUsersSearch(assignedUsersSearchInput.trim());
    }, ASSIGNED_USERS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [assignedUsersSearchInput]);

  /** When assigned-users search text changes, reset to page 0 and refetch. */
  useEffect(() => {
    if (!selectedCard?.entitlementId) return;
    const prev = prevDebouncedAssignedSearchRef.current;
    if (prev === undefined) {
      prevDebouncedAssignedSearchRef.current = debouncedAssignedUsersSearch;
      return;
    }
    if (prev === debouncedAssignedUsersSearch) return;
    prevDebouncedAssignedSearchRef.current = debouncedAssignedUsersSearch;
    setSelectedCard((p) =>
      p?.entitlementId ? { ...p, usersPage: 0, users: [], loadingUsers: true } : p,
    );
  }, [debouncedAssignedUsersSearch, selectedCard?.entitlementId]);

  const closeUserListModal = useCallback(() => {
    setSelectedCard(null);
    setAssignedUsersSearchInput('');
    setDebouncedAssignedUsersSearch('');
    prevDebouncedAssignedSearchRef.current = undefined;
    setManagerReportsSearchInput('');
    setDebouncedManagerReportsSearch('');
    prevDebouncedManagerReportsRef.current = undefined;
  }, []);

  /** Load assigned users for entitlement modal: paginated (ASSIGNED_USERS_PAGE_SIZE per request). */
  useEffect(() => {
    if (!applicationId) return;
    const entId = selectedCard?.entitlementId;
    if (!entId) return;
    const page = Number.isFinite(selectedCard?.usersPage) ? selectedCard.usersPage : 0;
    let cancelled = false;
    (async () => {
      try {
        const res = await applicationAPI.getCorrelationEntitlementUsers(applicationId, {
          entitlementId: entId,
          page,
          limit: ASSIGNED_USERS_PAGE_SIZE,
          ...(debouncedAssignedUsersSearch ? { search: debouncedAssignedUsersSearch } : {}),
        });
        if (cancelled) return;
        const rows = res.data?.data || [];
        const users = rows.map((r) => r.userData).filter(Boolean);
        const total = Number(res.data?.total ?? 0);
        setSelectedCard((prev) => {
          if (!prev || String(prev.entitlementId) !== String(entId)) return prev;
          return { ...prev, users, usersTotal: total, loadingUsers: false };
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setSelectedCard((prev) =>
            prev && String(prev.entitlementId) === String(entId)
              ? { ...prev, users: [], usersTotal: 0, loadingUsers: false }
              : prev,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicationId, selectedCard?.entitlementId, selectedCard?.usersPage, debouncedAssignedUsersSearch]);

  useEffect(() => {
    if (!applicationId) return;
    const mk = selectedCard?.managerKeyNorm;
    const ma = selectedCard?.managerAttrForQuery;
    if (!mk || !ma) return;
    const page =
      selectedCard?.usersPage != null && Number.isFinite(selectedCard.usersPage)
        ? selectedCard.usersPage
        : 0;
    let cancelled = false;
    (async () => {
      try {
        const res = await applicationAPI.getManagerCorrelationGroupUsers(applicationId, {
          managerAttr: ma,
          managerKeyNorm: mk,
          page,
          limit: MANAGER_REPORTS_PAGE_SIZE,
          ...(debouncedManagerReportsSearch ? { search: debouncedManagerReportsSearch } : {}),
        });
        if (cancelled) return;
        const users = res.data?.data || [];
        const total = Number(res.data?.total ?? 0);
        setSelectedCard((prev) => {
          if (!prev || String(prev.managerKeyNorm) !== String(mk)) return prev;
          return { ...prev, users, usersTotal: total, loadingUsers: false };
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setSelectedCard((prev) =>
            prev && String(prev.managerKeyNorm) === String(mk)
              ? { ...prev, users: [], usersTotal: 0, loadingUsers: false }
              : prev,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applicationId,
    selectedCard?.managerKeyNorm,
    selectedCard?.managerAttrForQuery,
    selectedCard?.usersPage,
    debouncedManagerReportsSearch,
  ]);

  // --- HANDLERS ---
  const handleRunAccountCorrelation = async () => {
    if (!adAutoCorrelation && (!selectedUserField || !selectedEntitlementField)) {
      return setMessage({ type: 'warning', text: 'Please select both fields.' });
    }
    setExecuting(true);
    setMessage(null);
    try {
      const payload = adAutoCorrelation
        ? {}
        : { userField: selectedUserField, entitlementField: selectedEntitlementField };
      const res = await applicationAPI.executeAppEntitlementCorrelation(applicationId, payload);
      const extra = res.data?.durationMs != null ? ` (${Number(res.data.durationMs).toLocaleString()} ms)` : '';
      setMessage({
        type: 'success',
        text: (res.data?.message || 'Correlation executed successfully.') + extra,
      });
      setMatrixPage(0);
      try {
        const refresh = await applicationAPI.getAppEntitlementCorrelations(applicationId, {
          page: 0,
          limit: matrixRowsPerPage,
        });
        setMatrixData(refresh.data?.data || []);
        setMatrixTotal(Number(refresh.data?.total ?? 0));
      } catch (e) {
        console.error(e);
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to execute correlation.' });
    } finally { setExecuting(false); }
  };

  const handleSaveManagerCorrelation = async () => {
    if (!managerAppAttr || !managerIdentityAttr) return setMessage({ type: 'warning', text: 'Please select both attributes.' });
    setExecutingManager(true);
    setManagerJobProgress({ percent: 0, message: 'Starting…' });
    setMessage(null);
    const POLL_MS = 1200;
    const maxWaitMs = 600000;
    try {
      const payload = { managerAppAttr, managerIdentityAttr };
      const res = await applicationAPI.executeManagerCorrelation(applicationId, payload);

      if (res.status === 202 && res.data?.jobId) {
        const jobId = res.data.jobId;
        const deadline = Date.now() + maxWaitMs;
        while (Date.now() < deadline) {
          const st = await applicationAPI.getManagerCorrelationJob(applicationId, jobId);
          const job = st.data?.data;
          if (!job) throw new Error('Job not found.');
          setManagerJobProgress({
            percent: typeof job.percent === 'number' ? job.percent : 0,
            message: job.message || '',
          });
          if (job.status === 'completed') {
            const r = job.result || {};
            const extra = r.durationMs != null ? ` (${Number(r.durationMs).toLocaleString()} ms)` : '';
            const accHint =
              r.accountLoginFieldUsed != null && String(r.accountLoginFieldUsed).trim() !== ''
                ? ` Used identity↔account login field “${String(r.accountLoginFieldUsed)}” (${Number(r.correlatedAccountReferenceIndexSize ?? 0)} keys).`
                : '';
            setMessage({
              type: 'success',
              text: (job.message || 'Manager correlation completed.') + extra + accHint,
            });
            await fetchManagerCorrelationPage();
            return;
          }
          if (job.status === 'failed') {
            throw new Error(job.error || 'Manager correlation failed.');
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        throw new Error('Timed out waiting for manager correlation.');
      }

      const stats = res.data || {};
      const extra = stats.durationMs != null ? ` (${Number(stats.durationMs).toLocaleString()} ms)` : '';
      const accHint =
        stats.accountLoginFieldUsed != null && String(stats.accountLoginFieldUsed).trim() !== ''
          ? ` Used identity↔account login field “${String(stats.accountLoginFieldUsed)}” (${Number(stats.correlatedAccountReferenceIndexSize ?? 0)} keys).`
          : '';
      setMessage({
        type: 'success',
        text: (stats.message || 'Manager correlation completed.') + extra + accHint,
      });
      await fetchManagerCorrelationPage();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error.response?.data?.message || error.message || 'Failed to execute manager correlation.',
      });
    } finally {
      setExecutingManager(false);
      setManagerJobProgress(null);
    }
  };

  // ============================================================================
  // 🧠 DATA GROUPERS
  // ============================================================================
  
  /** One row per entitlement from API (userCount precomputed; users loaded on demand). */
  const entitlementCards = useMemo(() => {
    const rows = matrixData.map((row) => {
      const entName =
        row.entitlementData?.entitlement_name ||
        row.entitlementData?.entitlement_id ||
        'Unknown Entitlement';
      return {
        key: String(row.entitlementId ?? entName),
        entName,
        entitlementId: row.entitlementId,
        userCount: Number(row.userCount) || 0,
        entitlement: row.entitlementData,
      };
    });
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase().trim();
    return rows.filter((r) => r.entName.toLowerCase().includes(q));
  }, [matrixData, searchQuery]);

  const matrixPageSummary = useMemo(() => {
    const linksOnPage = matrixData.reduce((sum, r) => sum + (Number(r.userCount) || 0), 0);
    return { entitlementsOnPage: matrixData.length, linksOnPage };
  }, [matrixData]);

  const pkCsvAlternateKeys = useMemo(
    () =>
      (applicationUserMappings || [])
        .filter((m) => String(m.standardField || '').trim() === applicationUserPkField)
        .map((m) => String(m.csvColumn || '').trim())
        .filter((c) => c && c !== applicationUserPkField),
    [applicationUserMappings, applicationUserPkField],
  );

  const csvAlternatesForStandardField = (standardField) => {
    const sf = String(standardField || '').trim();
    if (!sf) return [];
    return (applicationUserMappings || [])
      .filter((m) => String(m.standardField || '').trim() === sf)
      .map((m) => String(m.csvColumn || '').trim())
      .filter((c) => c && c !== sf);
  };

  /** Unique standardField list in schema order. */
  const schemaUserStandardFields = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of applicationUserMappings || []) {
      const sf = String(m.standardField || '').trim();
      if (!sf || seen.has(sf)) continue;
      seen.add(sf);
      out.push(sf);
    }
    return out;
  }, [applicationUserMappings]);

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={30} /></Box>;

  return (
    <Box>
      <Box sx={{ borderBottom: 1, borderColor: 'divider', backgroundColor: '#f8fafc' }}>
        <Tabs value={innerTab} onChange={(e, val) => { setInnerTab(val); setMessage(null); setSearchQuery(''); }} sx={{ px: 3 }}>
          <Tab icon={<AccountTree fontSize="small" />} iconPosition="start" label="Account / Entitlement Correlation" sx={{ textTransform: 'none', fontWeight: 600 }} />
          <Tab icon={<SupervisorAccount fontSize="small" />} iconPosition="start" label="Manager Correlation" sx={{ textTransform: 'none', fontWeight: 600 }} />
        </Tabs>
      </Box>

      <CardContent sx={{ p: 3 }}>
        {message && <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>{message.text}</Alert>}

        {/* TAB 0: ACCOUNT / ENTITLEMENT CORRELATION */}
        {innerTab === 0 && (
          <Box>
            {Number(entitlementCount) < 1 ? (
              <Alert severity="warning" sx={{ mb: 3 }}>
                Import <strong>entitlements</strong> for this application first (use the <strong>Entitlements</strong> tab on this
                application, upload or sync data), then return here for account / entitlement correlation.
              </Alert>
            ) : null}

            <Box
              sx={
                Number(entitlementCount) < 1
                  ? { opacity: 0.5, pointerEvents: 'none' }
                  : undefined
              }
            >
              {!adAutoCorrelation ? (
              <Box sx={{ mb: 4 }}>
                    <Typography variant="h6">Run Account Correlation</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 900 }}>
                      Choose one attribute from your <strong>Application schema</strong> (users) and one from your{' '}
                      <strong>Entitlement schema</strong>. Manual correlation is for CSV and other non-connector imports.
                    </Typography>

                    {userFields.length === 0 || entitlementFields.length === 0 ? (
                      <Alert severity="warning" sx={{ mb: 2 }}>
                        Define and save both <strong>Application schema</strong> and <strong>Entitlement schema</strong> on
                        this application so attribute dropdowns can list your technical field names.
                      </Alert>
                    ) : null}

                    <Card variant="outlined" sx={{ p: 2, backgroundColor: '#f8fafc' }}>
                      <Grid container spacing={2} alignItems="center">
                        <Grid item xs={12} md={4}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="User attribute (Application schema)"
                            value={selectedUserField}
                            onChange={(e) => setSelectedUserField(e.target.value)}
                            disabled={!userFields.length}
                          >
                            {userFields.map((f) => (
                              <MenuItem key={f} value={f}>
                                {f}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>

                        <Grid item xs={12} md={1} sx={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <AutoFixHigh fontSize="small" color="primary" sx={{ mb: 0.5 }} />
                          <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main', lineHeight: 1 }}>SMART<br/>MATCH</Typography>
                        </Grid>

                        <Grid item xs={12} md={4}>
                          <TextField
                            select
                            fullWidth
                            size="small"
                            label="Entitlement attribute (Entitlement schema)"
                            value={selectedEntitlementField}
                            onChange={(e) => setSelectedEntitlementField(e.target.value)}
                            disabled={!entitlementFields.length}
                          >
                            {entitlementFields.map((f) => (
                              <MenuItem key={f} value={f}>
                                {f}
                              </MenuItem>
                            ))}
                          </TextField>
                        </Grid>

                        <Grid item xs={12} md={3}>
                          <Button
                            fullWidth
                            variant="contained"
                            color="primary"
                            startIcon={executing ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                            onClick={handleRunAccountCorrelation}
                            disabled={
                              executing ||
                              !selectedUserField ||
                              !selectedEntitlementField ||
                              !userFields.length ||
                              !entitlementFields.length ||
                              Number(entitlementCount) < 1
                            }
                            sx={{ textTransform: 'none', height: 40 }}
                          >
                            {executing ? 'Running...' : 'Run Engine'}
                          </Button>
                        </Grid>
                      </Grid>
                    </Card>
              </Box>
              ) : null}

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ flex: 1, mr: 2, minWidth: 200 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Correlation Results</Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {matrixTotal > 0
                    ? `Entitlements: ${matrixTotal.toLocaleString()} total · ${matrixPageSummary.entitlementsOnPage} on this page · ${matrixPageSummary.linksOnPage.toLocaleString()} correlation link(s) on this page`
                    : 'No correlation data loaded yet.'}
                </Typography>
                <TextField fullWidth size="small" placeholder="Search accounts or entitlements..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><Search color="action" /></InputAdornment> }} />
              </Box>
              {adAutoCorrelation ? (
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  startIcon={executing ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
                  onClick={handleRunAccountCorrelation}
                  disabled={executing || Number(entitlementCount) < 1}
                  sx={{ textTransform: 'none', height: 40, flexShrink: 0 }}
                >
                  {executing ? 'Rebuilding…' : 'Rebuild from AD membership'}
                </Button>
              ) : (
                <Button size="small" startIcon={<Refresh />} onClick={fetchMatrixData} sx={{ textTransform: 'none', height: 40, flexShrink: 0 }}>Refresh</Button>
              )}
            </Box>

            {entitlementCards.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
                <Typography color="text.secondary">
                  {adAutoCorrelation
                    ? 'No correlation data yet. Sync from Active Directory or use Rebuild from AD membership.'
                    : 'No correlation data found. Run the engine or clear your search query.'}
                </Typography>
              </Box>
            ) : (
              <Grid container spacing={3}>
                {entitlementCards.map((data) => {
                  const { entName, userCount, entitlementId } = data;
                  return (
                    <Grid item xs={12} sm={6} lg={4} key={data.key}>
                      <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 6px 16px rgba(0,0,0,0.08)' } }}>
                        <CardContent sx={{ flexGrow: 1, p: 3 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                            <Avatar sx={{ bgcolor: 'primary.light', color: 'primary.dark', width: 48, height: 48 }}><VpnKey /></Avatar>
                            <Chip icon={<Person />} label={`${userCount} Users`} color={userCount > 0 ? "success" : "default"} size="small" sx={{ fontWeight: 600, backgroundColor: userCount > 0 ? '#e6f4ea' : '#f1f5f9', color: userCount > 0 ? '#1e4620' : 'text.secondary' }} />
                          </Box>
                          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1, fontSize: '1.1rem', lineHeight: 1.2 }}>{entName}</Typography>
                        </CardContent>
                        <Divider />
                        <Box sx={{ p: 1.5, backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'flex-end' }}>
                          <Button
                            size="small"
                            endIcon={<ArrowForward />}
                            onClick={() => {
                              setAssignedUsersSearchInput('');
                              setDebouncedAssignedUsersSearch('');
                              prevDebouncedAssignedSearchRef.current = undefined;
                              setSelectedCard({
                                title: entName,
                                countLabel: 'Assigned Users',
                                entitlementId,
                                expectedCount: userCount,
                                users: [],
                                usersPage: 0,
                                usersTotal: null,
                                loadingUsers: true,
                              });
                            }}
                            disabled={userCount === 0 || !entitlementId}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                          >
                            View Assigned Users
                          </Button>
                        </Box>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            )}

              {matrixTotal > 0 && (
                <TablePagination
                  component="div"
                  count={matrixTotal}
                  page={matrixPage}
                  onPageChange={(_, p) => setMatrixPage(p)}
                  rowsPerPage={matrixRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setMatrixRowsPerPage(parseInt(e.target.value, 10));
                    setMatrixPage(0);
                  }}
                  rowsPerPageOptions={[12, 24, 48, 96]}
                  sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 1 }}
                />
              )}
            </Box>
          </Box>
        )}

        {/* TAB 1: MANAGER CORRELATION (SAILPOINT STYLE) */}
        {innerTab === 1 && (
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>Manager Correlation Configuration</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 4, maxWidth: 800 }}>
              Specify the application attribute that holds the manager reference (e.g. GitHub login), and the identity attribute used for matching.
            </Typography>

            <Card variant="outlined" sx={{ mb: 5 }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ backgroundColor: '#f1f5f9' }}>
                    <TableCell sx={{ fontWeight: 'bold', width: '50%' }}>Application Attribute</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: '50%' }}>Global Identity Attribute</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell sx={{ p: 2 }}>
                      <TextField select fullWidth size="small" value={managerAppAttr} onChange={(e) => setManagerAppAttr(e.target.value)}>
                        {userFields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                      </TextField>
                    </TableCell>
                    <TableCell sx={{ p: 2 }}>
                      <TextField select fullWidth size="small" value={managerIdentityAttr} onChange={(e) => setManagerIdentityAttr(e.target.value)}>
                        {identityFieldOptions.map((o) => (
                          <MenuItem key={o.targetKey} value={o.targetKey}>
                            {o.label}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Box sx={{ p: 2, borderTop: '1px solid #e0e0e0', backgroundColor: '#f8fafc', display: 'flex', gap: 2 }}>
                <Button variant="contained" color="primary" onClick={handleSaveManagerCorrelation} disabled={executingManager} startIcon={executingManager ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />} sx={{ textTransform: 'none' }}>
                  {executingManager ? 'Running Correlation...' : 'Save & Run Correlation'}
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  onClick={() => {
                    setManagerAppAttr('manager_id');
                    setManagerIdentityAttr(
                      identityFieldOptions.some((o) => o.targetKey === 'employeeId')
                        ? 'employeeId'
                        : identityFieldOptions[0]?.targetKey || 'employeeId',
                    );
                  }}
                  sx={{ textTransform: 'none' }}
                  disabled={executingManager}
                >
                  Reset
                </Button>
              </Box>
              {executingManager && managerJobProgress ? (
                <Box sx={{ px: 2, pb: 2, pt: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                    {managerJobProgress.message || 'Running…'}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(100, Math.max(0, managerJobProgress.percent ?? 0))}
                  />
                </Box>
              ) : null}
            </Card>

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 2, flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 240 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Correlation Results</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Paginated manager groups from the server (same pattern as entitlement correlation — no bulk download).
                </Typography>
                {managerFacetData ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                    <Chip size="small" variant="outlined" label={`Accounts ${Number(managerFacetData.totalAccounts ?? 0).toLocaleString()}`} />
                    <Chip size="small" variant="outlined" label={`With "${managerAppAttr}" ${Number(managerFacetData.withManagerValue ?? 0).toLocaleString()}`} />
                    <Chip size="small" variant="outlined" color="success" label={`Matched ${Number(managerFacetData.correlated ?? 0).toLocaleString()}`} />
                    <Chip size="small" variant="outlined" color="warning" label={`Unresolved ${Number(managerFacetData.unresolvedWithManagerValue ?? 0).toLocaleString()}`} />
                    <Chip size="small" variant="outlined" label={`Distinct refs ${Number(managerFacetData.distinctManagerGroups ?? 0).toLocaleString()}`} />
                  </Box>
                ) : null}
                <TextField
                  fullWidth
                  size="small"
                  placeholder="Filter manager reference values…"
                  value={mgrGroupsSearchInput}
                  onChange={(e) => setMgrGroupsSearchInput(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search color="action" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
              <Button size="small" startIcon={<Refresh />} onClick={fetchManagerCorrelationPage} sx={{ textTransform: 'none' }}>
                Refresh
              </Button>
            </Box>

            {mgrGroupRows.length === 0 ? (
              <Box sx={{ p: 4, textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: 2 }}>
                <Typography color="text.secondary">No manager groups on this page. Adjust search, run the engine, or import users.</Typography>
              </Box>
            ) : (
              <Grid container spacing={3}>
                {mgrGroupRows.map((row) => {
                  const resolved = !!row.isResolved;
                  const displayTitle = row.resolvedManagerName || 'Unknown Manager';
                  const rawVal = row.managerRawDisplay ?? '';
                  const userCount = Number(row.userCount) || 0;
                  return (
                    <Grid item xs={12} sm={6} lg={4} key={row.managerKeyNorm}>
                      <Card
                        variant="outlined"
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          borderColor: resolved ? '#4caf50' : '#ff9800',
                          borderLeft: `4px solid ${resolved ? '#4caf50' : '#ff9800'}`,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                        }}
                      >
                        <CardContent sx={{ flexGrow: 1, p: 2.5 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                            <Avatar sx={{ bgcolor: resolved ? '#e8f5e9' : '#fff3e0', color: resolved ? '#2e7d32' : '#e65100', width: 40, height: 40 }}>
                              <SupervisorAccount />
                            </Avatar>
                            {resolved ? (
                              <Chip icon={<CheckCircle />} label="Identity Resolved" color="success" size="small" variant="outlined" sx={{ fontWeight: 600, border: 'none', backgroundColor: '#e8f5e9' }} />
                            ) : (
                              <Chip icon={<WarningAmber />} label="Unresolved String" color="warning" size="small" variant="outlined" sx={{ fontWeight: 600, border: 'none', backgroundColor: '#fff3e0' }} />
                            )}
                          </Box>

                          <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                            {displayTitle}
                          </Typography>

                          {/* <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                            Raw App Value:
                          </Typography>
                          <Tooltip title={rawVal} placement="top">
                            <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: 'text.secondary' }}>
                              {rawVal || '—'}
                            </Typography>
                          </Tooltip> */}
                        </CardContent>
                        <Divider />
                        <Box sx={{ p: 1.5, backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
                            {userCount} Direct {userCount === 1 ? 'Report' : 'Reports'}
                          </Typography>
                          <Button
                            size="small"
                            endIcon={<ArrowForward />}
                            onClick={() =>
                              setSelectedCard({
                                title: `Team of ${row.resolvedManagerName || rawVal || 'manager'}`,
                                countLabel: 'Direct Reports',
                                managerKeyNorm: row.managerKeyNorm,
                                managerAttrForQuery: managerAppAttr,
                                users: [],
                                usersPage: 0,
                                usersTotal: null,
                                loadingUsers: true,
                              })
                            }
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                          >
                            View Subordinates
                          </Button>
                        </Box>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>
            )}

            {mgrGroupsTotal > 0 ? (
              <TablePagination
                component="div"
                count={mgrGroupsTotal}
                page={mgrGroupsPage}
                onPageChange={(_, p) => setMgrGroupsPage(p)}
                rowsPerPage={mgrGroupsRowsPerPage}
                onRowsPerPageChange={(e) => {
                  setMgrGroupsRowsPerPage(parseInt(e.target.value, 10));
                  setMgrGroupsPage(0);
                }}
                rowsPerPageOptions={[12, 24, 48, 96]}
                sx={{ borderTop: '1px solid', borderColor: 'divider', mt: 1 }}
              />
            ) : null}
          </Box>
        )}

        {/* =========================================================================
            NEW: DYNAMIC DATA MODAL (Shows ALL fields, not just username)
        ========================================================================= */}
        <Dialog open={!!selectedCard} onClose={closeUserListModal} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 2 } }}>
          <DialogTitle sx={{ m: 0, p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-all' }}>{selectedCard?.title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {selectedCard?.countLabel} (
                {selectedCard?.entitlementId
                  ? selectedCard.usersTotal != null
                    ? selectedCard.usersTotal
                    : selectedCard?.loadingUsers
                      ? '…'
                      : selectedCard.expectedCount ?? 0
                  : selectedCard?.managerKeyNorm
                    ? selectedCard.usersTotal != null
                      ? selectedCard.usersTotal
                      : selectedCard?.loadingUsers
                        ? '…'
                        : 0
                    : selectedCard?.users?.length ?? 0}
                )
              </Typography>
            </Box>
            <IconButton onClick={closeUserListModal}><Close /></IconButton>
          </DialogTitle>
          <Divider />
          {selectedCard?.entitlementId ? (
            <Box sx={{ px: 3, py: 2, backgroundColor: '#f1f5f9' }}>
              <TextField
                fullWidth
                size="small"
                placeholder={
                  adAutoCorrelation
                    ? 'Search LDAP values (sAMAccountName, mail, displayName, department, …)'
                    : 'Search by account ID, name, email, department, or any application user field…'
                }
                value={assignedUsersSearchInput}
                onChange={(e) => setAssignedUsersSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search color="action" />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
          ) : null}
          {selectedCard?.managerKeyNorm ? (
            <Box sx={{ px: 3, py: 2, backgroundColor: '#f1f5f9' }}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search within these direct reports (email, username, employee id…)"
                value={managerReportsSearchInput}
                onChange={(e) => setManagerReportsSearchInput(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search color="action" />
                    </InputAdornment>
                  ),
                }}
              />
            </Box>
          ) : null}
          {selectedCard?.entitlementId || selectedCard?.managerKeyNorm ? <Divider /> : null}

          <DialogContent sx={{ p: 3, backgroundColor: '#f1f5f9', maxHeight: 600 }}>
            {selectedCard?.loadingUsers &&
            (!selectedCard?.users || selectedCard.users.length === 0) &&
            (selectedCard?.entitlementId || selectedCard?.managerKeyNorm) ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
              </Box>
            ) : null}
            {!selectedCard?.loadingUsers || (selectedCard?.users && selectedCard.users.length > 0)
              ? selectedCard?.users?.map((user, idx) => {
              const titleLine = adAutoCorrelation
                ? accountDialogTitleFromUser(user)
                : (() => {
                    const pkRaw = applicationUserPkField
                      ? fieldValueFromMappedUser(user, applicationUserPkField, pkCsvAlternateKeys)
                      : undefined;
                    const pkVal = pkRaw != null ? String(pkRaw).trim() : '';
                    return pkVal || '\u2014';
                  })();
              const titleInitial = titleLine && titleLine !== '\u2014'
                ? titleLine.charAt(0).toUpperCase()
                : 'U';
              const detailFields = adAutoCorrelation
                ? buildAccountDetailFieldRows(user, {
                    isAdConnector: true,
                    usersSample: selectedCard.users || [],
                  })
                : schemaUserStandardFields.map((sf) => {
                    const alts = csvAlternatesForStandardField(sf);
                    return {
                      key: sf,
                      label: sf.replace(/_/g, ' '),
                      value: fieldValueFromMappedUser(user, sf, alts),
                    };
                  });
              return (
              <Card key={`${selectedCard?.usersPage ?? 0}-${user._id || idx}`} variant="outlined" sx={{ mb: 3, boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                <Box sx={{ p: 2, backgroundColor: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.main', fontWeight: 700 }}>
                    {titleInitial}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
                      {titleLine}
                    </Typography>
                    {adAutoCorrelation ? (
                      <Typography variant="caption" color="text.secondary">
                        Active Directory account attributes from sync
                      </Typography>
                    ) : null}
                  </Box>
                </Box>

                <Box sx={{ p: 2, backgroundColor: '#fdfdfd' }}>
                  <Grid container spacing={2}>
                    {detailFields.map(({ key, label, value }) => {
                      const memberOfLines = isMemberOfEntitlementsColumnKey(key)
                        ? memberOfDetailLines(value)
                        : null;
                      const display = formatAccountDetailFieldValue(key, value);
                      return (
                        <Grid item xs={12} sm={6} md={4} key={key}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ textTransform: 'uppercase', fontSize: '0.65rem', fontWeight: 700, display: 'block' }}
                          >
                            {label}
                          </Typography>
                          {isAccountStatusColumnKey(key) && value != null && value !== '' ? (
                            <AccountStatusCell value={value} />
                          ) : memberOfLines ? (
                            <Box sx={{ mt: 0.5, maxHeight: 200, overflow: 'auto' }}>
                              {memberOfLines.map((line, lineIdx) => (
                                <Typography
                                  key={`${lineIdx}-${line}`}
                                  variant="body2"
                                  component="div"
                                  sx={{ fontWeight: 500, lineHeight: 1.55, wordBreak: 'break-word' }}
                                >
                                  {line}
                                </Typography>
                              ))}
                            </Box>
                          ) : (
                            <Tooltip title={display} placement="top">
                              <Typography
                                variant="body2"
                                sx={{
                                  fontWeight: 500,
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  display: '-webkit-box',
                                  WebkitLineClamp: memberOfLines ? undefined : 4,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: memberOfLines ? 'visible' : 'hidden',
                                }}
                              >
                                {display}
                              </Typography>
                            </Tooltip>
                          )}
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>
              </Card>
            );
            })
            : null}
            {selectedCard?.entitlementId != null &&
            (selectedCard.usersTotal ?? 0) > ASSIGNED_USERS_PAGE_SIZE ? (
              <TablePagination
                component="div"
                count={selectedCard.usersTotal ?? 0}
                page={selectedCard.usersPage ?? 0}
                onPageChange={(_, p) => {
                  setSelectedCard((prev) =>
                    prev?.entitlementId
                      ? { ...prev, usersPage: p, users: [], loadingUsers: true }
                      : prev,
                  );
                }}
                rowsPerPage={ASSIGNED_USERS_PAGE_SIZE}
                rowsPerPageOptions={[ASSIGNED_USERS_PAGE_SIZE]}
                onRowsPerPageChange={() => {}}
                sx={{
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  mt: 1,
                  '& .MuiTablePagination-selectLabel': { display: 'none' },
                  '& .MuiTablePagination-select': { display: 'none' },
                  '& .MuiTablePagination-displayedRows': { marginLeft: 'auto' },
                }}
              />
            ) : null}
            {selectedCard?.managerKeyNorm != null &&
            (selectedCard.usersTotal ?? 0) > MANAGER_REPORTS_PAGE_SIZE ? (
              <TablePagination
                component="div"
                count={selectedCard.usersTotal ?? 0}
                page={selectedCard.usersPage ?? 0}
                onPageChange={(_, p) => {
                  setSelectedCard((prev) =>
                    prev?.managerKeyNorm
                      ? { ...prev, usersPage: p, users: [], loadingUsers: true }
                      : prev,
                  );
                }}
                rowsPerPage={MANAGER_REPORTS_PAGE_SIZE}
                rowsPerPageOptions={[MANAGER_REPORTS_PAGE_SIZE]}
                onRowsPerPageChange={() => {}}
                sx={{
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  mt: 1,
                  '& .MuiTablePagination-selectLabel': { display: 'none' },
                  '& .MuiTablePagination-select': { display: 'none' },
                  '& .MuiTablePagination-displayedRows': { marginLeft: 'auto' },
                }}
              />
            ) : null}
          </DialogContent>
          <Divider />
          <DialogActions sx={{ p: 2, backgroundColor: '#f8fafc' }}>
            <Button onClick={closeUserListModal} variant="outlined" size="small" sx={{ textTransform: 'none', fontWeight: 600 }}>Close</Button>
          </DialogActions>
        </Dialog>

      </CardContent>
    </Box>
  );
}