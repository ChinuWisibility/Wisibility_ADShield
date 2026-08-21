import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link as RouterLink, useLocation } from 'react-router-dom';
import {
  Box, Grid, Typography, Card, CardContent, Tabs, Tab, Chip, Button,
  TextField, MenuItem, IconButton, LinearProgress, alpha, Divider,
  FormGroup, Checkbox, Dialog, DialogTitle, DialogContent,
  DialogContentText, DialogActions, Alert, FormControlLabel, Stack
} from '@mui/material';
import {
  ArrowBack, People, VpnKey, AccountTree, Warning,
  Edit, Save, Cancel, DeleteForever, SettingsEthernet, Info, Sync,
  CheckCircle, Block
} from '@mui/icons-material';
import StatusChip from '../../components/StatusChip';
import ApplicationReportingRuleSetSection from '../../components/reports/ApplicationReportingRuleSetSection';
import { palette } from '../../theme/palette';
import { adAPI, applicationAPI, identityProfileAPI } from '../../services/api';
import ADSyncDialog from '../../components/applications/ADSyncDialog';
import ApplicationIconPicker, {
  resolveApplicationIconSrc,
} from '../../components/applications/ApplicationIconPicker';
import {
  getDerivedAdSourceApplicationId,
  isDerivedAdApplication,
  isDelimitedFileConnectorApplication,
  isPrimaryAdConnectorApplication,
  resolveDerivedApplicationDisplay,
  usesAdAutoAccountEntitlementCorrelation,
  usesAdLdapAccountsTable,
} from '../../utils/applicationConnectorUi';
import { sodAPI } from '../../services/sodService';
import { useAuth } from '../../contexts/AuthContext';
import UsersTable from './UsersTable';
import ReconciliationHistoryTable from './ReconciliationHistoryTable';
import DeltaChangesTable from './DeltaChangesTable';
import EntitlementsTable from './EntitlementsTable';
import AppCorrelationConfig from './AppCorrelationConfig';
import ApplicationSchemaTab from './ApplicationSchemaTab';
import ApplicationEntitlementSchemaTab from './ApplicationEntitlementSchemaTab';
import AppSuggestionPanel from '../identities/AppSuggestionPanel';
import {
  buildOnboardingPayload,
  OnboardingProvider,
  useOnboarding,
} from '../../contexts/OnboardingContext';

/** Detail tabs use string keys (see `tabKey`) so Correlation can be omitted without index drift. */

function idStr(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v._id != null) return String(v._id);
  return String(v);
}

function parseAccountStatusFilter(search) {
  const value = new URLSearchParams(search).get('accountStatus');
  return value === 'active' || value === 'inactive' ? value : null;
}

// Constants for dropdowns (Matching Mongoose Enums)
const APP_TYPES = ['web', 'database', 'directory', 'cloud', 'erp', 'custom'];
const STATUSES = ['active', 'inactive', 'decommissioned', 'pending'];
const INTEGRATION_TYPES = ['manual', 'auto', 'api', 'connector'];
const SCHEDULES = ['daily', 'weekly', 'monthly', 'none'];

/** Canonical tenant id string for effects (avoids ObjectId vs string churn from AuthContext). */
function stableTenantKey(user) {
  const raw = user?.tenantId;
  if (raw == null || raw === '') return '';
  const inner = typeof raw === 'object' && raw._id != null ? raw._id : raw;
  return String(inner);
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const tenantKey = useMemo(() => stableTenantKey(user), [user]);

  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const initialTab = new URLSearchParams(location.search).get('tab') || 'overview';
  const [tabKey, setTabKey] = useState(initialTab);
  const accountStatusFilter = useMemo(
    () => parseAccountStatusFilter(location.search),
    [location.search],
  );
  const [identityProfiles, setIdentityProfiles] = useState([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [userStatusCounts, setUserStatusCounts] = useState({ active: 0, inactive: 0, unknown: 0, total: 0 });
  const [statusCountsLoading, setStatusCountsLoading] = useState(false);

  // --- SOD (app-scoped) ---
  const [sodLoading, setSodLoading] = useState(false);
  const [sodPolicies, setSodPolicies] = useState([]);
  const [sodError, setSodError] = useState(null);

  // --- AD SYNC STATE ---
  const [syncing, setSyncing] = useState(false);
  const [usersRefreshKey, setUsersRefreshKey] = useState(0);
  const [adScanDialogOpen, setAdScanDialogOpen] = useState(false);
  const [adSyncProgress, setAdSyncProgress] = useState(null);
  const delimitedCsvInputRef = useRef(null);
  const [syncResult, setSyncResult] = useState(null);
  const [selectedReconRunId, setSelectedReconRunId] = useState('');

  // --- SETTINGS FORM STATE ---
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '', tenantId: '', description: '', type: '', status: '', owner: '', ownerEmail: '',
    integrationType: '', autoUploadSchedule: '', tags: '', authoritativeSource: false,
    iconId: null, color: '',
  });

  // --- Connector sync (AD or universal CONNECTOR_* handlers) ---
  const pollAdSyncJobUntilDone = async (syncTargetId, jobId) => {
    const POLL_MS = 1000;
    // Match waitForAdSyncJob: large forests need hours, not a 10-minute hard stop.
    const maxWaitMs = 2 * 60 * 60 * 1000;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const st = await applicationAPI.getAdSyncJob(syncTargetId, jobId);
      const job = st.data?.data;
      if (!job) throw new Error('AD sync job not found.');
      setAdSyncProgress({
        percent: typeof job.percent === 'number' ? job.percent : 0,
        phase: job.phase || job.status,
        message: job.message || '',
      });
      if (job.status === 'completed') {
        return job;
      }
      if (job.status === 'failed') {
        throw new Error(job.error || job.message || 'AD sync failed.');
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(
      'Timed out waiting for AD sync. The job may still be running in the background — refresh and check job status.',
    );
  };

  const runAdSyncJob = async (syncTargetId, syncScope = 'total') => {
    let start;
    try {
      start = await applicationAPI.syncAdUsers(syncTargetId, { syncScope });
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.jobId) {
        setSyncResult({
          type: 'info',
          message: 'Resuming an AD sync already in progress…',
        });
        return pollAdSyncJobUntilDone(syncTargetId, err.response.data.jobId);
      }
      throw err;
    }

    if (start.status === 202 && start.data?.jobId) {
      setSyncResult({ type: 'info', message: 'AD sync started...' });
      return pollAdSyncJobUntilDone(syncTargetId, start.data.jobId);
    }

    return start.data;
  };

  const handleConnectorSync = async (syncConfig = null) => {
    setSyncing(true);
    setSyncResult(null);
    setAdSyncProgress(null);
    try {
      const isAd = isPrimaryAdConnectorApplication(app);
      const isDerivedAd = isDerivedAdApplication(app);
      const sourceAdId = getDerivedAdSourceApplicationId(app);
      const syncTargetId = isDerivedAd && sourceAdId ? sourceAdId : id;
      const syncScope = syncConfig?.syncScope || 'total';

      if (isAd || isDerivedAd) {
        await runAdSyncJob(syncTargetId, syncScope);

        setSyncResult({
          type: 'success',
          message: isDerivedAd
            ? 'Source AD sync completed; this application’s accounts were refreshed from the directory.'
            : 'AD sync completed successfully.',
        });
      } else {
        const res = await applicationAPI.syncConnector(id, {});
        setSyncResult({
          type: 'success',
          message: res.data?.message || 'Connector sync completed successfully.',
        });
      }
      await fetchApplicationData();
      await loadUserStatusCounts();
      setUsersRefreshKey((k) => k + 1);
    } catch (err) {
      setSyncResult({
        type: 'error',
        message: err.response?.data?.message || err.message || 'Sync failed. Check your connection configuration.',
      });
    } finally {
      setSyncing(false);
      setAdSyncProgress(null);
      setAdScanDialogOpen(false);
    }
  };

  const handleDelimitedCsvSync = async (file) => {
    if (!file || !id) return;
    const hasMappedImport = Array.isArray(app?.csvImportMapping?.mappings)
      && app.csvImportMapping.mappings.length > 0;
    const hasUserSchema = Array.isArray(app?.userMappings) && app.userMappings.length > 0;
    if (!hasMappedImport && !hasUserSchema) {
      setSyncResult({
        type: 'error',
        message:
          'Save a Map & import mapping (or Application schema) before syncing a CSV.',
      });
      return;
    }

    setSyncing(true);
    setSyncResult(null);
    setAdSyncProgress(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = hasMappedImport
        ? await applicationAPI.uploadUsersCsvMapped(id, fd)
        : await applicationAPI.uploadUsersCsvStrict(id, fd);
      const n = res.data?.totalRecords ?? res.data?.data?.totalRecords;
      setSyncResult({
        type: 'success',
        message:
          res.data?.message ||
          `Synced ${n ?? 0} account(s) from CSV.`,
      });
      await fetchApplicationData();
      await loadUserStatusCounts();
      setUsersRefreshKey((k) => k + 1);
    } catch (err) {
      setSyncResult({
        type: 'error',
        message:
          err.response?.data?.message ||
          err.message ||
          'CSV sync failed.',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncButtonClick = () => {
    const isAd = isPrimaryAdConnectorApplication(app);
    const isDerivedAd = isDerivedAdApplication(app);
    if (isAd || isDerivedAd) {
      setAdScanDialogOpen(true);
      return;
    }
    // Delimited File: no remote pull — prompt for a CSV instead of wiping accounts.
    if (isDelimitedFileConnectorApplication(app)) {
      delimitedCsvInputRef.current?.click();
      return;
    }
    handleConnectorSync();
  };

  const handleAdSyncDialogConfirm = (syncConfig) => {
    handleConnectorSync(syncConfig);
  };

  // --- DELETE STATE (scoped impact + selective cleanup) ---
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionImpact, setDeletionImpact] = useState(null);
  const [deletionScopes, setDeletionScopes] = useState({});
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState(null);

  // --- DATA FETCHING ---
  const fetchApplicationData = async () => {
    setLoading(true);
    try {
      const res = await applicationAPI.getById(id);

      if (res.data && res.data.success) {
        const appData = res.data.data;
        setApp(appData);

        // Populate the edit form with the database values
        setEditForm({
          name: appData.name || '',
          tenantId: appData.tenantId?._id || appData.tenantId || '',
          description: appData.description || '',
          type: appData.type || 'web',
          status: appData.status || 'active',
          owner: appData.owner || '',
          ownerEmail: appData.ownerEmail || '',
          integrationType: appData.integrationType || 'manual',
          autoUploadSchedule: appData.autoUploadSchedule || 'none',
          tags: appData.tags ? appData.tags.join(', ') : '',
          authoritativeSource: !!appData.authoritativeSource,
          iconId: appData.iconId || null,
          color: appData.color || '',
        });
      }
    } catch (err) {
      console.error('Failed to fetch application details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplicationData();
  }, [id]);

  const loadUserStatusCounts = useCallback(async (isCancelled) => {
    if (!id) return;
    setStatusCountsLoading(true);
    try {
      const res = await applicationAPI.getUserStatusCounts(id);
      if (isCancelled && isCancelled()) return;
      const payload = res.data?.data || {};
      setUserStatusCounts({
        active: Number(payload.active ?? 0),
        inactive: Number(payload.inactive ?? 0),
        unknown: Number(payload.unknown ?? 0),
        total: Number(payload.total ?? 0),
      });
    } catch (err) {
      console.error('Failed to load user status counts', err);
      if (!isCancelled || !isCancelled()) {
        setUserStatusCounts({ active: 0, inactive: 0, unknown: 0, total: 0 });
      }
    } finally {
      if (!isCancelled || !isCancelled()) setStatusCountsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadUserStatusCounts(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [id, loadUserStatusCounts]);

  const applyAccountStatusFilter = useCallback(
    (status) => {
      const current = parseAccountStatusFilter(location.search);
      const next = current === status ? null : status;
      const params = new URLSearchParams(location.search);
      if (next) params.set('accountStatus', next);
      else params.delete('accountStatus');
      params.set('tab', 'users');
      const qs = params.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true },
      );
      setTabKey('users');
    },
    [location.pathname, location.search, navigate],
  );

  const handleTabChange = useCallback(
    (_, value) => {
      setTabKey(value);
      const params = new URLSearchParams(location.search);
      params.set('tab', value);
      if (value !== 'users') params.delete('accountStatus');
      const qs = params.toString();
      navigate(
        { pathname: location.pathname, search: qs ? `?${qs}` : '' },
        { replace: true },
      );
    },
    [location.pathname, location.search, navigate],
  );

  // Keep tabKey in sync with ?tab= — do not touch profile loading here (tab switches change search).
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const tab = searchParams.get('tab');
    if (tab) {
      setTabKey(tab);
    } else {
      setTabKey('overview');
    }
  }, [id, location.search]);

  /** Tenant-wide profiles — depends only on route app id + stable tenant key, not full `app` ref (avoids refetch loops when Application record reloads). */
  useEffect(() => {
    if (!id || !tenantKey) {
      setIdentityProfiles([]);
      setProfilesLoading(false);
      return undefined;
    }
    let cancelled = false;
    setIdentityProfiles([]);
    setProfilesLoading(true);
    (async () => {
      try {
        const res = await identityProfileAPI.list({ tenantId: tenantKey });
        if (!cancelled) setIdentityProfiles(res.data?.data || []);
      } catch (e) {
        console.error('Failed to load identity profiles:', e);
        if (!cancelled) setIdentityProfiles([]);
      } finally {
        if (!cancelled) setProfilesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, tenantKey]);

  const profileSourceIds = useMemo(() => {
    const s = new Set();
    for (const p of identityProfiles) {
      const x = idStr(p.sourceApplicationId);
      if (x) s.add(x);
    }
    return s;
  }, [identityProfiles]);

  const hasAnyProfile = identityProfiles.length > 0;
  const hideCorrelationAsSource =
    !!app && hasAnyProfile && profileSourceIds.has(String(id));
  const showCorrelationTab = !hideCorrelationAsSource;

  const isAdConnector = useMemo(
    () => isPrimaryAdConnectorApplication(app),
    [app],
  );
  const isDerivedAdApp = useMemo(() => isDerivedAdApplication(app), [app]);
  const isDelimitedFileConnector = useMemo(
    () => isDelimitedFileConnectorApplication(app),
    [app],
  );
  const usesAdLdapAccounts = useMemo(() => usesAdLdapAccountsTable(app), [app]);
  const adAutoCorrelation = useMemo(
    () => usesAdAutoAccountEntitlementCorrelation(app),
    [app],
  );
  const derivedSourceAppId = useMemo(
    () => getDerivedAdSourceApplicationId(app),
    [app],
  );

  useEffect(() => {
    if (tabKey === 'correlation' && !showCorrelationTab) {
      setTabKey('overview');
    }
  }, [tabKey, showCorrelationTab]);

  useEffect(() => {
    if (tabKey === 'adSuggestions' && !app) return;
    if (tabKey === 'adSuggestions' && !(app?.connectorType === 'ACTIVE_DIRECTORY' || app?.connectionConfig?.ad)) {
      setTabKey('overview');
    }
  }, [tabKey, app]);

  useEffect(() => {
    if (tabKey === 'entitlementSchema' && adAutoCorrelation) {
      setTabKey('entitlements');
    }
  }, [tabKey, adAutoCorrelation]);

  // --- UPDATE HANDLERS (FR-137) ---
  const handleEditChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleCancelEdit = () => {
    setEditing(false);
    fetchApplicationData();
  };

  const handleSaveSettings = async () => {
    if (!editForm.name) return alert("Application Name cannot be empty.");

    try {
      const payload = { ...editForm };

      if (isDerivedAdApp) {
        delete payload.integrationType;
        delete payload.autoUploadSchedule;
        delete payload.authoritativeSource;
      }

      if (typeof payload.tags === 'string') {
        payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
      }

      await applicationAPI.update(id, payload);
      setEditing(false);
      fetchApplicationData();
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to update application. Check console for details.');
    }
  };

  const openDeleteDialog = async () => {
    setDeleteDialogOpen(true);
    setImpactLoading(true);
    setImpactError(null);
    setDeletionImpact(null);
    try {
      const res = await applicationAPI.getDeletionImpact(id);
      const data = res.data?.data;
      setDeletionImpact(data);
      const initial = {};
      (data?.allScopeKeys || []).forEach((k) => {
        initial[k] =
          k !== 'identitiesFromSourceApp' && k !== 'identityProfilesDeleteSourced';
      });
      setDeletionScopes(initial);
    } catch (err) {
      setImpactError(err.response?.data?.message || 'Could not load related records.');
    } finally {
      setImpactLoading(false);
    }
  };

  const setScope = (key, value) => {
    setDeletionScopes((prev) => ({ ...prev, [key]: value }));
  };

  const selectAllDeletionScopes = () => {
    if (!deletionImpact?.allScopeKeys) return;
    const next = {};
    deletionImpact.allScopeKeys.forEach((k) => {
      next[k] = true;
    });
    setDeletionScopes(next);
  };

  const clearAllDeletionScopes = () => {
    if (!deletionImpact?.allScopeKeys) return;
    const next = {};
    deletionImpact.allScopeKeys.forEach((k) => {
      next[k] = false;
    });
    setDeletionScopes(next);
  };

  // --- DELETE HANDLER (scoped cleanup + application record) ---
  const handleDeleteApplication = async () => {
    try {
      setDeleting(true);
      await applicationAPI.deleteScoped(id, deletionScopes);
      navigate('/applications');
    } catch (err) {
      console.error('Failed to delete application:', err);
      alert(err.response?.data?.message || 'Error deleting application.');
      setDeleting(false);
    }
  };

  const [sourceAdApp, setSourceAdApp] = useState(null);

  useEffect(() => {
    if (!derivedSourceAppId) {
      setSourceAdApp(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await applicationAPI.getById(derivedSourceAppId);
        if (!cancelled && res.data?.success) {
          setSourceAdApp(res.data.data);
        }
      } catch (err) {
        console.error('Failed to load source AD application for derived app', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [derivedSourceAppId, id]);

  const accountsTablePreferencesForUsers = useMemo(() => {
    if (!app) return null;
    if (isDerivedAdApp && sourceAdApp?.accountsTablePreferences) {
      return sourceAdApp.accountsTablePreferences;
    }
    return app.accountsTablePreferences || null;
  }, [app, isDerivedAdApp, sourceAdApp]);

  const accountsTablePreferencesAppId = useMemo(() => {
    if (isDerivedAdApp && derivedSourceAppId) return derivedSourceAppId;
    return id;
  }, [isDerivedAdApp, derivedSourceAppId, id]);

  const inheritedIntegration = useMemo(() => {
    if (!isDerivedAdApp || !sourceAdApp) return null;
    return {
      integrationType: sourceAdApp.integrationType || 'manual',
      autoUploadSchedule: sourceAdApp.autoUploadSchedule || 'none',
      connectorType: sourceAdApp.connectorType || '',
      authoritativeSource: !!sourceAdApp.authoritativeSource,
    };
  }, [isDerivedAdApp, sourceAdApp]);

  const displayMetadata = useMemo(
    () => resolveDerivedApplicationDisplay(app, sourceAdApp),
    [app, sourceAdApp],
  );

  if (loading && !app) return <Box sx={{ p: 4 }}><LinearProgress /></Box>;
  if (!app) return <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">Application not found</Typography></Box>;

  const loadSodForApp = async () => {
    setSodError(null);
    setSodLoading(true);
    try {
      const res = await sodAPI.getPoliciesByApplication(id);
      const payload = res.data?.data;
      setSodPolicies(payload?.policies || payload?.data?.policies || []);
    } catch (e) {
      setSodError(e.response?.data?.message || 'Failed to load SoD policies for this application.');
      setSodPolicies([]);
    } finally {
      setSodLoading(false);
    }
  };

  const runSodEvaluation = async () => {
    setSodError(null);
    setSodLoading(true);
    try {
      await sodAPI.runEvaluation({});
      await loadSodForApp();
    } catch (e) {
      setSodError(e.response?.data?.message || 'Failed to run evaluation.');
    } finally {
      setSodLoading(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton onClick={() => navigate('/applications')} size="small"><ArrowBack /></IconButton>
        <Typography variant="body2" color="text.secondary">Applications</Typography>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                backgroundColor: app.icon ? '#fff' : alpha(app.color || palette.brand.primary, app.icon ? 1 : 0.15),
                border: '1px solid',
                borderColor: 'divider',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 18,
                overflow: 'hidden',
                p: app.icon ? 0.5 : 0,
              }}
            >
              {app.icon ? (
                <Box
                  component="img"
                  src={resolveApplicationIconSrc(app.icon)}
                  alt=""
                  sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Box sx={{ color: app.color || palette.brand.primary }}>
                  {app.name?.charAt(0)?.toUpperCase()}
                </Box>
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>{app.name}</Typography>
              <Typography variant="body2" color="text.secondary">{app.description}</Typography>
            </Box>
            <Chip label={displayMetadata.type || app.type} size="small" sx={{ backgroundColor: alpha(palette.brand.primary, 0.1), color: palette.brand.primary, fontWeight: 600 }} />
            <StatusChip status={displayMetadata.status || app.status} />
            {app.hrmsDirectoryTarget && (
              <Chip label="HRMS → AD target" size="small" color="secondary" variant="outlined" title="Linked from tenant HRMS integration" />
            )}
            {app.authoritativeSource && (
              <Chip label="Authoritative source" size="small" color="success" variant="outlined" title="Flagged as master / trusted identity feed" />
            )}
          </Box>
        </CardContent>
      </Card>

      <Grid container spacing={2.5} sx={{ mb: 3 }}>
        <Grid item xs={6} sm={3}><StatCardMini icon={<People />} label="Users" value={app.totalUsers || 0} color={palette.brand.primary} /></Grid>
        <Grid item xs={6} sm={3}>
          <StatCardMini
            icon={<CheckCircle />}
            label="Active Users"
            value={statusCountsLoading ? '-' : userStatusCounts.active}
            color={palette.status.success}
            selected={accountStatusFilter === 'active'}
            onClick={() => applyAccountStatusFilter('active')}
          />
        </Grid>
        <Grid item xs={6} sm={3}>
          <StatCardMini
            icon={<Block />}
            label="Inactive Users"
            value={statusCountsLoading ? '…' : userStatusCounts.inactive}
            color={palette.status.warning}
            selected={accountStatusFilter === 'inactive'}
            onClick={() => applyAccountStatusFilter('inactive')}
          />
        </Grid>
        <Grid item xs={6} sm={3}><StatCardMini icon={<VpnKey />} label="Entitlements" value={app.entitlementCount || 0} color={palette.brand.secondary} /></Grid>
        {/* <Grid item xs={6} sm={3}><StatCardMini icon={<AccountTree />} label="Accounts" value={app.accountCount || 0} color={palette.status.info} /></Grid>
        <Grid item xs={6} sm={3}><StatCardMini icon={<Warning />} label="Violations" value={app.violationCount || 0} color={palette.status.error} /></Grid> */}
      </Grid>

      <Card>
        <Tabs
          value={tabKey}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{
            borderBottom: `1px solid ${palette.border.default}`,
            px: 1,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 },
            '& .MuiTabs-scrollButtons': {
              color: palette.text.secondary,
              '&.Mui-disabled': { opacity: 0.3 },
            },
            '& .MuiTabs-scroller': {
              scrollBehavior: 'smooth',
            },
          }}
        >
          <Tab label="Overview" value="overview" />
          <Tab label="Application schema" value="schema" />
          <Tab label="Current accounts" value="users" />
          <Tab label="Reconciliation history" value="reconHistory" />
          <Tab label="Change logs" value="deltaChanges" />
          {!adAutoCorrelation ? (
            <Tab label="Entitlement schema" value="entitlementSchema" />
          ) : null}
          <Tab label="Entitlements" value="entitlements" />
          {isAdConnector && !isDerivedAdApp ? <Tab label="AD suggestions" value="adSuggestions" /> : null}
          {showCorrelationTab ? (
            <Tab label="Correlation" value="correlation" disabled={profilesLoading} />
          ) : null}
          {/* <Tab
            label="SoD"
            value="sod"
            onClick={() => {
              // Lazy load to keep initial render fast
              if (!sodPolicies.length && !sodLoading) loadSodForApp();
            }}
          /> */}
          <Tab label="Settings" value="settings" />
        </Tabs>

        <Box sx={{ p: 0 }}>
          {tabKey === 'overview' && (
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Application Details</Typography>
              <Grid container spacing={2}>
                {[
                  ['Name', app.name], ['Tenant', app.tenantId?.name || '\u2014'], ['Type', displayMetadata.type || app.type], ['Owner', displayMetadata.owner || app.owner || '\u2014'], ['Status', displayMetadata.status || app.status],
                  ['Created', app.createdAt ? new Date(app.createdAt).toLocaleDateString() : '\u2014'],
                  ['Last Upload', app.lastUpload ? new Date(app.lastUpload).toLocaleDateString() : '\u2014'],
                  ['Authoritative source', app.authoritativeSource ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <Grid item xs={12} sm={6} md={4} key={label}>
                    <Typography variant="caption" sx={{ color: palette.text.secondary }}>{label}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{value}</Typography>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          )}

          {tabKey === 'schema' && (
            <ApplicationSchemaTab
              applicationId={id}
              app={app}
              onSaved={async () => {
                await fetchApplicationData();
                await loadUserStatusCounts();
                setUsersRefreshKey((k) => k + 1);
              }}
            />
          )}

          {/* DYNAMIC TABLES */}
          {tabKey === 'users' && (() => {
            const hasUniversalConnector =
              typeof app.connectorType === 'string' && app.connectorType.startsWith('CONNECTOR_');
            const hasSavedUserSchema =
              Array.isArray(app.userMappings) && app.userMappings.length > 0;
            /** Show sync/refresh when AD, derived AD, universal connector, or imported accounts */
            const showConnectorBanner =
              usesAdLdapAccounts || hasUniversalConnector || hasSavedUserSchema;
            const accountsSubtitle = usesAdLdapAccounts
              ? isDerivedAdApp
                ? 'Same LDAP columns and layout as the source AD application. Accounts are members of the onboarded AD groups; refresh runs sync on the source AD connector.'
                : 'Columns are LDAP attribute names returned from your last AD sync (for example sAMAccountName, mail, displayName). Only attributes that have values on loaded accounts are listed.'
              : hasUniversalConnector
                ? isDelimitedFileConnector
                  ? 'Rows come from CSV import; use Sync CSV to upload another file. Columns follow Application schema mappings.'
                  : 'Rows come from the connector; columns follow Application schema mappings for that source.'
                : hasSavedUserSchema
                  ? 'Columns follow your saved Application schema; values reflect the latest import or connector sync.'
                  : 'Sync or import users — columns match saved schema mappings, or are inferred from synced connector fields.';
            const syncButtonLabel = syncing
              ? 'Syncing...'
              : isDerivedAdApp
                ? 'Refresh from AD'
                : isAdConnector
                  ? 'Sync from AD'
                  : isDelimitedFileConnector
                    ? 'Sync CSV'
                    : hasUniversalConnector
                      ? 'Sync connector'
                      : 'Refresh accounts';
            const syncButtonEl = showConnectorBanner ? (
              <>
                {isDelimitedFileConnector ? (
                  <input
                    ref={delimitedCsvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) handleDelimitedCsvSync(file);
                    }}
                  />
                ) : null}
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Sync sx={{ animation: syncing ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } } }} />}
                  onClick={handleSyncButtonClick}
                  disabled={syncing}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                  title={
                    isDelimitedFileConnector
                      ? 'Choose a CSV file to sync accounts for this Delimited File connector'
                      : undefined
                  }
                >
                  {syncButtonLabel}
                </Button>
              </>
            ) : null;
            return (
              <Box>
                <UsersTable
                  applicationId={id}
                  isAdConnector={usesAdLdapAccounts}
                  preferencesApplicationId={accountsTablePreferencesAppId}
                  userMappings={usesAdLdapAccounts ? null : app.userMappings?.length > 0 ? app.userMappings : null}
                  csvImportMapping={usesAdLdapAccounts ? null : app.csvImportMapping?.mappings || null}
                  accountsTablePreferences={accountsTablePreferencesForUsers || null}
                  accountStatusFilter={accountStatusFilter}
                  onClearAccountStatusFilter={() => applyAccountStatusFilter(accountStatusFilter)}
                  refreshKey={usersRefreshKey}
                  key={`users-${accountStatusFilter || 'all'}`}
                  showAccountsBanner={showConnectorBanner}
                  accountsBannerSubtitle={accountsSubtitle}
                  syncAction={syncButtonEl}
                  bannerFooter={
                    (adSyncProgress || syncResult) ? (
                      <Box sx={{ px: 3, pt: 1, pb: 0 }}>
                        {adSyncProgress ? (
                          <Box sx={{ mb: syncResult ? 1 : 0 }}>
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                              {adSyncProgress.message || adSyncProgress.phase || 'Syncing…'}
                              {typeof adSyncProgress.percent === 'number'
                                ? ` (${adSyncProgress.percent}%)`
                                : ''}
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(100, Math.max(0, adSyncProgress.percent || 0))}
                            />
                          </Box>
                        ) : null}
                        {syncResult ? (
                          <Alert severity={syncResult.type} onClose={() => setSyncResult(null)}>
                            {syncResult.message}
                          </Alert>
                        ) : null}
                      </Box>
                    ) : null
                  }
                />
              </Box>
            );
          })()}

          {tabKey === 'reconHistory' && (
            <ReconciliationHistoryTable
              applicationId={id}
              onSelectRun={(runId) => {
                setSelectedReconRunId(runId);
                setTabKey('deltaChanges');
              }}
            />
          )}

          {tabKey === 'deltaChanges' && (
            <DeltaChangesTable applicationId={id} filterRunId={selectedReconRunId} />
          )}

          {tabKey === 'entitlementSchema' && (
            <ApplicationEntitlementSchemaTab applicationId={id} app={app} onSaved={fetchApplicationData} />
          )}
          {tabKey === 'entitlements' && (
            <EntitlementsTable
              key={`ent-${id}-${app.entitlementCount ?? 0}-${app.lastUpload ? new Date(app.lastUpload).getTime() : 0}`}
              applicationId={id}
              entitlementMappings={app.entitlementMappings}
            />
          )}

          {isAdConnector && !isDerivedAdApp ? (
            <OnboardingProvider sourceApplicationId={id}>
              {tabKey === 'adSuggestions' ? (
                <CardContent sx={{ p: 3 }}>
                  <AdSuggestionsTabContent applicationId={id} />
                </CardContent>
              ) : null}
            </OnboardingProvider>
          ) : null}

          {/* --- SOD TAB --- */}
          {/* {tabKey === 'sod' && (
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                <Box sx={{ flex: 1, minWidth: 240 }}>
                  <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    Segregation of Duties (SoD)
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Application-scoped policies and quick actions.
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button
                    variant="outlined"
                    onClick={runSodEvaluation}
                    disabled={sodLoading}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Run evaluation
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => navigate('/governance/sod-policies')}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Open policies
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => navigate('/governance/sod-violations')}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Open violations
                  </Button>
                </Box>
              </Box>

              {sodError ? <Alert severity="error" sx={{ mb: 2 }}>{sodError}</Alert> : null}
              {sodLoading ? <LinearProgress sx={{ mb: 2 }} /> : null}

              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6} md={3}>
                  <StatCardMini
                    icon={<Warning />}
                    label="Policies in scope"
                    value={sodPolicies.length}
                    color={palette.brand.primary}
                  />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                  <StatCardMini
                    icon={<ShieldSoDIcon />}
                    label="SoD module"
                    value="Enabled"
                    color={palette.status.info}
                  />
                </Grid>
              </Grid>

              <Box sx={{ border: `1px solid ${palette.border.default}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ px: 2.5, py: 1.75, borderBottom: `1px solid ${palette.border.default}`, bgcolor: palette.bg.elevated }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    Policies
                  </Typography>
                </Box>
                <Box sx={{ p: 2.5 }}>
                  {!sodPolicies.length ? (
                    <Typography variant="body2" color="text.secondary">
                      No SoD policies are currently scoped to this application.
                    </Typography>
                  ) : (
                    <Grid container spacing={1.5}>
                      {sodPolicies.slice(0, 6).map((p) => (
                        <Grid item xs={12} md={6} key={p._id || p.policyId || p.name}>
                          <Box sx={{ p: 2, borderRadius: 2, border: `1px solid ${palette.border.default}` }}>
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, justifyContent: 'space-between' }}>
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                                  {p.name || p.policyId || 'Policy'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" noWrap>
                                  {p.description || '—'}
                                </Typography>
                              </Box>
                              <Chip
                                size="small"
                                label={(p.severity || p.riskLevel || 'MEDIUM').toString()}
                                sx={{
                                  fontWeight: 800,
                                  bgcolor: alpha(palette.status.warning, 0.12),
                                  color: palette.status.warning,
                                }}
                              />
                            </Box>
                          </Box>
                        </Grid>
                      ))}
                    </Grid>
                  )}
                </Box>
              </Box>
            </CardContent>
          )} */}


          {/* --- CORRELATION TAB --- */}
          {tabKey === 'correlation' && showCorrelationTab && (
            <Box sx={{ p: 0 }}>
              {profilesLoading ? (
                <CardContent sx={{ p: 3 }}>
                  <LinearProgress sx={{ mb: 2 }} />
                  <Typography variant="body2" color="text.secondary">
                    Loading identity profiles…
                  </Typography>
                </CardContent>
              ) : !hasAnyProfile ? (
                <CardContent sx={{ p: 3 }}>
                  <Alert severity="info" sx={{ mb: 2 }}>
                    Create an <strong>identity profile</strong> first (authoritative HR / people source). Correlation compares
                    target applications to that identity data; it is not available until at least one profile exists.
                  </Alert>
                  <Button
                    component={RouterLink}
                    to="/identities/profiles"
                    variant="contained"
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Go to Identity Profiles
                  </Button>
                </CardContent>
              ) : (
                <AppCorrelationConfig
                  applicationId={id}
                  entitlementCount={app.entitlementCount ?? 0}
                  adAutoCorrelation={adAutoCorrelation}
                />
              )}
            </Box>
          )}

          {/* --- SETTINGS TAB --- */}
          {tabKey === 'settings' && (
            <CardContent sx={{ p: 3 }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 2,
                  flexWrap: 'wrap',
                  mb: 4,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  Application Settings
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end', ml: 'auto' }}>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteForever />}
                    onClick={openDeleteDialog}
                    sx={{ textTransform: 'none', fontWeight: 600 }}
                  >
                    Delete Application…
                  </Button>
                  {!editing ? (
                    <Button startIcon={<Edit />} onClick={() => setEditing(true)} sx={{ textTransform: 'none' }} variant="outlined">
                      Edit Configuration
                    </Button>
                  ) : (
                    <>
                      <Button startIcon={<Cancel />} onClick={handleCancelEdit} sx={{ textTransform: 'none' }}>
                        Cancel
                      </Button>
                      <Button variant="contained" startIcon={<Save />} onClick={handleSaveSettings} sx={{ textTransform: 'none' }}>
                        Save Changes
                      </Button>
                    </>
                  )}
                </Box>
              </Box>

              {/* Form Section: General Info */}
              <Typography variant="subtitle2" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700 }}><Info fontSize="small" /> GENERAL INFO</Typography>
              <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6}>
                  <TextField name="name" label="Application Name" value={editForm.name} onChange={handleEditChange} disabled={!editing} fullWidth size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField select name="type" label="Type" value={editForm.type} onChange={handleEditChange} disabled={!editing} fullWidth size="small">
                    {APP_TYPES.map(o => <MenuItem key={o} value={o}>{o.toUpperCase()}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField select name="status" label="Status" value={editForm.status} onChange={handleEditChange} disabled={!editing} fullWidth size="small">
                    {STATUSES.map(o => <MenuItem key={o} value={o}>{o.toUpperCase()}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12}>
                  <TextField name="description" label="Description" value={editForm.description} onChange={handleEditChange} disabled={!editing} fullWidth multiline rows={2} size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField name="owner" label="Business Owner" value={editForm.owner} onChange={handleEditChange} disabled={!editing} fullWidth size="small" />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField name="ownerEmail" label="Owner Email" value={editForm.ownerEmail} onChange={handleEditChange} disabled={!editing} fullWidth size="small" />
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>
                    APPLICATION ICON
                  </Typography>
                  <ApplicationIconPicker
                    tenantId={editForm.tenantId || tenantKey}
                    compact
                    disabled={!editing}
                    value={{
                      iconId: editForm.iconId,
                      color: editForm.color,
                    }}
                    onChange={(next) =>
                      setEditForm((prev) => ({
                        ...prev,
                        iconId: next.iconId,
                        color: next.color || '',
                      }))
                    }
                  />
                </Grid>
              </Grid>

              {/* Form Section: Integration */}
              <Typography variant="subtitle2" color="info.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700 }}><SettingsEthernet fontSize="small" /> INTEGRATION & METADATA</Typography>
              {isDerivedAdApp && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Integration settings are inherited from the source Active Directory application
                  {sourceAdApp ? (
                    <>
                      {' '}
                      <RouterLink to={`/applications/${derivedSourceAppId}?tab=settings`}>
                        {sourceAdApp.name}
                      </RouterLink>
                    </>
                  ) : (
                    ' (loading parent…)'
                  )}
                  . Change connector type, sync schedule, or authoritative source on the parent application only.
                </Alert>
              )}
              <Grid container spacing={3}>
                <Grid item xs={12} sm={4}>
                  <TextField
                    select
                    name="integrationType"
                    label="Integration Type"
                    value={
                      isDerivedAdApp && inheritedIntegration
                        ? inheritedIntegration.integrationType
                        : editForm.integrationType
                    }
                    onChange={handleEditChange}
                    disabled={!editing || isDerivedAdApp}
                    fullWidth
                    size="small"
                  >
                    {INTEGRATION_TYPES.map(o => <MenuItem key={o} value={o}>{o.toUpperCase()}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    select
                    name="autoUploadSchedule"
                    label="Sync Schedule"
                    value={
                      isDerivedAdApp && inheritedIntegration
                        ? inheritedIntegration.autoUploadSchedule
                        : editForm.autoUploadSchedule
                    }
                    onChange={handleEditChange}
                    disabled={!editing || isDerivedAdApp}
                    fullWidth
                    size="small"
                  >
                    {SCHEDULES.map(o => <MenuItem key={o} value={o}>{o.toUpperCase()}</MenuItem>)}
                  </TextField>
                </Grid>
                {isDerivedAdApp && inheritedIntegration?.connectorType ? (
                  <Grid item xs={12} sm={4}>
                    <TextField
                      label="Connector"
                      value={inheritedIntegration.connectorType}
                      disabled
                      fullWidth
                      size="small"
                    />
                  </Grid>
                ) : null}
                <Grid item xs={12} sm={4}>
                  <TextField name="tags" label="Tags (comma separated)" value={editForm.tags} onChange={handleEditChange} disabled={!editing} fullWidth size="small" />
                </Grid>
                <Grid item xs={12}>
                  <FormControlLabel
                    sx={{ alignItems: 'flex-start', ml: 0 }}
                    control={
                      <Checkbox
                        name="authoritativeSource"
                        checked={
                          isDerivedAdApp && inheritedIntegration
                            ? inheritedIntegration.authoritativeSource
                            : !!editForm.authoritativeSource
                        }
                        onChange={handleEditChange}
                        disabled={!editing || isDerivedAdApp}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Authoritative Source
                        </Typography>
                        {/* <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, maxWidth: 560 }}>
                          Master HR / people or trusted identity feed (e.g. Workday, SAP HR, directory). Used for reporting and downstream logic.
                        </Typography> */}
                      </Box>
                    }
                  />
                </Grid>
              </Grid>

              <Divider sx={{ my: 4 }} />
              <Typography variant="subtitle2" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700 }}>
                REPORT RULE SET
              </Typography>
              <ApplicationReportingRuleSetSection
                tenantId={String(app?.tenantId?._id || app?.tenantId || tenantKey || '')}
                applicationId={id}
                showRiskBands={false}
              />

              {/* Delete: impact + selective cleanup (opened from header) */}
              <Dialog
                open={deleteDialogOpen}
                onClose={() => !deleting && setDeleteDialogOpen(false)}
                maxWidth="md"
                fullWidth
              >
                <DialogTitle sx={{ color: 'error.main', fontWeight: 700 }}>
                  Delete application and related data
                </DialogTitle>
                <DialogContent dividers sx={{ maxHeight: '70vh' }}>
                  {impactLoading && <LinearProgress sx={{ mb: 2 }} />}
                  {impactError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{impactError}</Alert>
                  )}
                  {!impactLoading && !impactError && deletionImpact?.isAdConnectorParent && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                        Derived applications (deleted with this Active Directory app)
                      </Typography>
                      <Typography variant="body2" sx={{ mb: 1.5 }}>
                        These applications were created from AD suggestions on <strong>{app.name}</strong>.
                        They are always removed when you delete the parent directory application and cannot be unchecked.
                      </Typography>
                      {deletionImpact.derivedAdApplications?.length > 0 ? (
                        <FormGroup sx={{ mt: 0.5 }}>
                          {deletionImpact.derivedAdApplications.map((child) => (
                            <FormControlLabel
                              key={child._id}
                              sx={{ alignItems: 'flex-start', ml: 0, mb: 0.5 }}
                              control={
                                <Checkbox
                                  size="small"
                                  checked
                                  disabled
                                  sx={{ pt: 0.25 }}
                                />
                              }
                              label={
                                <Box>
                                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {child.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    {[child.type, child.status].filter(Boolean).join(' · ') || 'Derived AD application'}
                                    {child.description ? ` — ${child.description}` : ''}
                                  </Typography>
                                </Box>
                              }
                            />
                          ))}
                        </FormGroup>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No derived applications are linked to this AD app.
                        </Typography>
                      )}
                    </Alert>
                  )}
                  <DialogContentText sx={{ mb: 2 }}>
                    Select which data to remove for <strong>{app.name}</strong>. Each line shows the approximate row count and the MongoDB collection name (or names) used in this environment.
                  </DialogContentText>
                  
                  {deletionImpact?.groups?.map((group) => (
                    <Box key={group.id} sx={{ mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700} color="primary.main" sx={{ mb: 0.5 }}>
                        {group.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                        {group.description}
                      </Typography>
                      <FormGroup>
                        {group.items.map((item) => (
                          <FormControlLabel
                            key={item.scopeKey}
                            control={
                              <Checkbox
                                size="small"
                                checked={!!deletionScopes[item.scopeKey]}
                                onChange={(e) => setScope(item.scopeKey, e.target.checked)}
                                disabled={deleting || impactLoading || !!impactError}
                              />
                            }
                            label={
                              <Box>
                                <Typography variant="body2" component="span">
                                  {item.label}
                                  {item.count !== undefined ? (
                                    <Typography component="span" color="text.secondary" sx={{ ml: 0.5 }}>
                                      ({item.count})
                                    </Typography>
                                  ) : null}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                  Collection: {item.collection}
                                  {item.destructive ? ' · destructive' : ''}
                                </Typography>
                              </Box>
                            }
                          />
                        ))}
                      </FormGroup>
                    </Box>
                  ))}
                  {deletionImpact?.applicationRecord && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={!!deletionScopes.applicationRecord}
                            onChange={(e) => setScope('applicationRecord', e.target.checked)}
                            disabled={deleting || impactLoading || !!impactError}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="body2" fontWeight={600}>
                              {deletionImpact.applicationRecord.label} (applications)
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              Uncheck to only delete selected data and leave the application registry entry (rare).
                            </Typography>
                          </Box>
                        }
                      />
                    </Box>
                  )}
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
                  <Button onClick={selectAllDeletionScopes} disabled={deleting || impactLoading || !!impactError || !deletionImpact} size="small">
                    Select all
                  </Button>
                  <Button onClick={clearAllDeletionScopes} disabled={deleting || impactLoading || !!impactError || !deletionImpact} size="small">
                    Clear all
                  </Button>
                  <Box sx={{ flex: 1 }} />
                  <Button onClick={() => setDeleteDialogOpen(false)} color="inherit" disabled={deleting} sx={{ fontWeight: 600 }}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleDeleteApplication}
                    color="error"
                    variant="contained"
                    disabled={deleting || impactLoading || !!impactError || !deletionImpact}
                    sx={{ fontWeight: 600 }}
                  >
                    {deleting ? 'Deleting…' : 'Delete selected'}
                  </Button>
                </DialogActions>
              </Dialog>

            </CardContent>
          )}
        </Box>
      </Card>

      <ADSyncDialog
        open={adScanDialogOpen}
        onClose={() => !syncing && setAdScanDialogOpen(false)}
        application={app}
        onConfirm={handleAdSyncDialogConfirm}
        confirming={syncing}
      />
    </Box>
  );
}

function StatCardMini({ icon, label, value, color, onClick, selected = false }) {
  const clickable = typeof onClick === 'function';
  return (
    <Card
      onClick={onClick}
      sx={{
        cursor: clickable ? 'pointer' : 'default',
        border: selected
          ? `2px solid ${color}`
          : `1px solid ${alpha(palette.border?.default || '#e2e8f0', 0.9)}`,
        boxShadow: selected ? `0 0 0 3px ${alpha(color, 0.15)}` : undefined,
        transition: 'border-color 0.15s, box-shadow 0.15s',
        '&:hover': clickable
          ? {
              borderColor: color,
              boxShadow: `0 2px 8px ${alpha(color, 0.2)}`,
            }
          : undefined,
      }}
    >
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ p: 1, borderRadius: 1.5, backgroundColor: alpha(color, 0.1), color: color, display: 'flex' }}>
            {icon}
          </Box>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{value}</Typography>
            <Typography variant="caption" sx={{ color: palette.text.secondary }}>{label}</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

function ShieldSoDIcon() {
  return (
    <Box
      component="span"
      sx={{
        width: 20,
        height: 20,
        borderRadius: '6px',
        display: 'inline-block',
        background: `linear-gradient(135deg, ${palette.brand.primary}, ${palette.brand.secondary})`,
      }}
    />
  );
}

function AdSuggestionsTabContent({ applicationId }) {
  const navigate = useNavigate();
  const { onboardingSelections } = useOnboarding();
  const [onboarding, setOnboarding] = useState(false);
  const [onboardingResult, setOnboardingResult] = useState(null);

  const proceedPayload = useMemo(
    () => buildOnboardingPayload(applicationId, onboardingSelections),
    [applicationId, onboardingSelections],
  );

  const selectedGroupCount = proceedPayload.applications.reduce(
    (sum, application) => sum + (application.selectedGroups?.length || 0),
    0,
  );
  const selectedApplicationCount = proceedPayload.applications.length;

  const handleProceedToOnboard = async () => {
    if (!selectedGroupCount || onboarding) return;
    setOnboarding(true);
    setOnboardingResult(null);
    try {
      const res = await adAPI.onboardApplications(proceedPayload);
      const createdApplications = Array.isArray(res.data?.data?.createdApplications)
        ? res.data.data.createdApplications
        : [];
      setOnboardingResult({
        type: 'success',
        message:
          res.data?.message ||
          `Applications onboarded successfully (${createdApplications.length} application(s), ${selectedGroupCount} entitlement group(s)). Open the new application(s) below to view entitlements — they are not added to this source AD connector app.`,
        createdApplications,
      });
    } catch (error) {
      setOnboardingResult({
        type: 'error',
        message:
          error.response?.data?.message ||
          error.message ||
          'Failed to onboard applications from AD suggestions.',
      });
    } finally {
      setOnboarding(false);
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          mb: 2,
        }}
      >
        <Box>
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
            AD app suggestions
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
            Suggested applications are built from your AD security groups. Analysis runs automatically when you open this tab.
          </Typography>
        </Box>
        <Button
          variant="contained"
          disabled={selectedGroupCount === 0 || onboarding}
          sx={{ textTransform: 'none', fontWeight: 600, ml: 'auto' }}
          onClick={handleProceedToOnboard}
        >
          {onboarding
            ? 'Onboarding...'
            : `Proceed to Onboard${selectedApplicationCount ? ` (${selectedApplicationCount})` : ''}`}
        </Button>
      </Box>
      {onboardingResult ? (
        <Alert
          severity={onboardingResult.type}
          sx={{ mb: 2 }}
          onClose={() => setOnboardingResult(null)}
        >
          <Typography variant="body2" sx={{ mb: onboardingResult.createdApplications?.length ? 1 : 0 }}>
            {onboardingResult.message}
          </Typography>
          {Array.isArray(onboardingResult.createdApplications) &&
          onboardingResult.createdApplications.length ? (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {onboardingResult.createdApplications.map((app) => (
                <Button
                  key={app.applicationId}
                  size="small"
                  variant="outlined"
                  sx={{ textTransform: 'none' }}
                  onClick={() =>
                    navigate(`/applications/${app.applicationId}?tab=users`)
                  }
                >
                  Open {app.applicationName}
                </Button>
              ))}
            </Stack>
          ) : null}
        </Alert>
      ) : null}
      <AppSuggestionPanel applicationId={applicationId} />
    </>
  );
}