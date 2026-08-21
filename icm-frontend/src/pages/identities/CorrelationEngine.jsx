import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, Paper, Grid, Chip, FormControl, InputLabel,
  Select, MenuItem, CircularProgress, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, LinearProgress,
  IconButton, Tooltip, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import {
  SettingsSuggest, PlayArrow, Visibility, Add, Delete, KeyboardArrowUp, KeyboardArrowDown,
} from '@mui/icons-material';
import { correlationAPI, applicationAPI, identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { palette } from '../../theme/palette';
import {
  CorrelationKpiStrip,
  CorrelationFilters,
  CorrelationAppCard,
  CorrelationHealthSidebar,
  getAppCorrelationStats,
} from './correlationDashboardParts';

/** Collect Application ids used as the authoritative source on any Identity Profile (not correlation targets). */
function collectSourceApplicationIdsFromProfiles(profiles) {
  const ids = new Set();
  const list = Array.isArray(profiles) ? profiles : [];
  for (const p of list) {
    const src = p?.sourceApplicationId;
    if (!src) continue;
    const id =
      typeof src === 'object' && src !== null && src._id != null
        ? String(src._id)
        : String(src);
    if (id && id !== 'undefined') ids.add(id);
  }
  return ids;
}

/**
 * Target application account fields for manual correlation: **only** this app’s Application schema
 * (`userMappings[].standardField`). We intentionally do **not** merge `/meta/fields/users` — that API
 * returns paths from a generic dynamic user model shared across apps, so it listed fields (e.g. employee_id,
 * created_at) that never existed on a specific app’s schema.
 */
function targetAttributesFromApplicationSchema(appDoc) {
  const set = new Set();
  (appDoc?.userMappings || []).forEach((m) => {
    const sf = String(m.standardField || '').trim();
    if (sf) set.add(sf);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function normalizeAppType(app) {
  const raw = String(app?.type || app?.integrationType || app?.connectorType || 'custom').trim();
  if (!raw) return 'custom';
  if (/^CONNECTOR_/i.test(raw)) return raw.replace(/^CONNECTOR_/i, '').toLowerCase();
  if (raw === 'ACTIVE_DIRECTORY') return 'directory';
  return raw.toLowerCase();
}

function isAuthoritativeApp(app) {
  return app?.authoritativeSource === true;
}

function rulesFromLastCorrelation(lc) {
  const list = Array.isArray(lc?.rules) ? lc.rules : [];
  if (list.length > 0) {
    return [...list]
      .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      .map((r) => ({
        identityAttribute: String(r.identityAttribute || '').trim(),
        accountAttribute: String(r.accountAttribute || '').trim(),
      }))
      .filter((r) => r.identityAttribute || r.accountAttribute);
  }
  const ia = String(lc?.identityAttribute || '').trim();
  const aa = String(lc?.accountAttribute || '').trim();
  if (ia && aa) return [{ identityAttribute: ia, accountAttribute: aa }];
  return [{ identityAttribute: '', accountAttribute: '' }];
}

export default function CorrelationEngine() {
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [applications, setApplications] = useState([]);

  const [identityFieldOptions, setIdentityFieldOptions] = useState([]);
  const [targetFieldOptions, setTargetFieldOptions] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);

  /**
   * Identity profiles describe the **source** → identity attributes; they are not scoped to the correlation **target** app.
   * Cache: tenant-wide mapped identity attributes (union of all profiles).
   */
  const identityFieldsByTenantRef = useRef(new Map());
  /** Target app account/connector fields, keyed by target application id. */
  const targetFieldsByAppRef = useRef(new Map());

  const [scanHistory, setScanHistory] = useState({});
  const [runningAppId, setRunningAppId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });

  const [correlationModalOpen, setCorrelationModalOpen] = useState(false);
  const [selectedAppForCorrelation, setSelectedAppForCorrelation] = useState(null);
  /** Ordered correlation rules (index 0 = highest priority). */
  const [correlationRules, setCorrelationRules] = useState([{ identityAttribute: '', accountAttribute: '' }]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const previewSeqRef = useRef(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });

  const filteredApplications = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return applications.filter((app) => {
      if (q && !String(app.name || '').toLowerCase().includes(q)) return false;
      const stats = getAppCorrelationStats(app, scanHistory[app._id]);
      if (statusFilter !== 'all' && stats.status !== statusFilter) return false;
      return true;
    });
  }, [applications, scanHistory, searchQuery, statusFilter]);

  const loadCorrelationDropdowns = useCallback(
    async (targetApp) => {
      if (!tenantId || !targetApp?._id) {
        setIdentityFieldOptions([]);
        setTargetFieldOptions([]);
        return;
      }
      const tenantKey = String(tenantId);
      const targetAppId = String(targetApp._id);
      setFieldsLoading(true);
      try {
        let identityOpts = identityFieldsByTenantRef.current.get(tenantKey);
        if (!identityOpts) {
          const mappedRes = await identityProfileAPI.getMappedFields({ tenantId });
          const mapped = mappedRes.data?.data || [];
          identityOpts = mapped.map((m) => ({
            targetKey: m.targetKey,
            label: String(m.label || m.targetKey || '')
              .replace(/\s*\(Required\)\s*$/i, '')
              .trim(),
          }));
          identityFieldsByTenantRef.current.set(tenantKey, identityOpts);
        }
        setIdentityFieldOptions(identityOpts);

        let targetKeys = targetFieldsByAppRef.current.get(targetAppId);
        if (!targetKeys) {
          const appRes = await applicationAPI.getById(targetApp._id);
          const applicationDoc = appRes.data?.data || appRes.data;
          targetKeys = targetAttributesFromApplicationSchema(applicationDoc);
          targetFieldsByAppRef.current.set(targetAppId, targetKeys);
        }
        setTargetFieldOptions(targetKeys);
      } catch (err) {
        console.error('Failed to load correlation field options:', err);
        showToast('Failed to load correlation field options', 'error');
        setIdentityFieldOptions([]);
        setTargetFieldOptions([]);
      } finally {
        setFieldsLoading(false);
      }
    },
    [tenantId],
  );

  const fetchData = async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [appsRes, profilesRes] = await Promise.all([
        applicationAPI.list({ tenantId, limit: 200, page: 1, fields: 'registry' }),
        identityProfileAPI.list({ tenantId }).catch(() => ({ data: { data: [] } })),
      ]);

      const extractArray = (resData) => {
        if (!resData) return [];
        if (Array.isArray(resData)) return resData;
        if (Array.isArray(resData.data)) return resData.data;
        if (Array.isArray(resData.docs)) return resData.docs;

        if (resData.data && typeof resData.data === 'object' && !Array.isArray(resData.data)) {
          if (Array.isArray(resData.data.docs)) return resData.data.docs;
          if (Array.isArray(resData.data.data)) return resData.data.data;
          if (Array.isArray(resData.data.items)) return resData.data.items;

          const hiddenArray = Object.values(resData.data).find((val) => Array.isArray(val));
          if (hiddenArray) return hiddenArray;
        }
        return [];
      };

      const profilePayload = profilesRes?.data;
      const profiles = Array.isArray(profilePayload?.data)
        ? profilePayload.data
        : Array.isArray(profilePayload)
          ? profilePayload
          : [];
      const authSourceAppIds = collectSourceApplicationIdsFromProfiles(profiles);

      const apps = extractArray(appsRes.data).filter((app) => {
        if (!app?._id) return false;
        if (isAuthoritativeApp(app)) return false;
        if (authSourceAppIds.has(String(app._id))) return false;
        return true;
      });
      setApplications(apps);

      const hist = {};
      for (const app of apps) {
        const lc = app.lastManualCorrelation;
        if (lc && app.lastManualCorrelationAt) {
          hist[app._id] = {
            totalProcessed: lc.totalProcessed ?? 0,
            newlyLinked: lc.newlyLinked ?? 0,
            uncorrelatedAccounts: lc.orphansDetected ?? 0,
            identityAttribute: lc.identityAttribute,
            accountAttribute: lc.accountAttribute,
            rules: Array.isArray(lc.rules) ? lc.rules : null,
            timestamp: new Date(app.lastManualCorrelationAt),
          };
        }
      }
      setScanHistory(hist);
    } catch (err) {
      console.error('Fetch Error:', err);
      showToast('Failed to load applications', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [tenantId]);

  useEffect(() => {
    if (!correlationModalOpen || fieldsLoading) return;
    setCorrelationRules((prev) =>
      prev.map((row) => ({
        identityAttribute:
          identityFieldOptions.length > 0 &&
          !identityFieldOptions.some((o) => o.targetKey === row.identityAttribute)
            ? ''
            : row.identityAttribute,
        accountAttribute:
          targetFieldOptions.length > 0 && !targetFieldOptions.includes(row.accountAttribute)
            ? ''
            : row.accountAttribute,
      })),
    );
  }, [identityFieldOptions, targetFieldOptions, correlationModalOpen, fieldsLoading]);

  const handleOpenCorrelationModal = (targetApp) => {
    setSelectedAppForCorrelation(targetApp);
    const hist = scanHistory[targetApp._id];
    const seeded = rulesFromLastCorrelation(
      hist
        ? {
            rules: hist.rules,
            identityAttribute: hist.identityAttribute,
            accountAttribute: hist.accountAttribute,
          }
        : {},
    );
    setCorrelationRules(seeded.length ? seeded : [{ identityAttribute: '', accountAttribute: '' }]);
    setPreviewData(null);
    setPreviewError('');
    setPreviewLoading(false);
    setCorrelationModalOpen(true);

    const tenantKey = String(tenantId);
    const targetAppId = String(targetApp._id);
    const idCached = identityFieldsByTenantRef.current.get(tenantKey);
    const tgtCached = targetFieldsByAppRef.current.get(targetAppId);
    if (idCached && tgtCached) {
      setIdentityFieldOptions(idCached);
      setTargetFieldOptions(tgtCached);
      return;
    }
    loadCorrelationDropdowns(targetApp);
  };

  const executePreview = useCallback(async (applicationId, rules) => {
    if (!applicationId || !Array.isArray(rules) || rules.length === 0) {
      setPreviewData(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    if (rules.some((r) => !r.identityAttribute || !r.accountAttribute)) {
      setPreviewData(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const res = await correlationAPI.previewRun(applicationId, {
        rules: rules.map((r, i) => ({
          identityAttribute: r.identityAttribute,
          accountAttribute: r.accountAttribute,
          priority: i + 1,
        })),
      });
      if (seq !== previewSeqRef.current) return;
      setPreviewData(res.data?.preview || null);
      if (!res.data?.preview) setPreviewError('No preview payload returned.');
    } catch (err) {
      if (seq !== previewSeqRef.current) return;
      const apiMsg =
        err.response?.data?.message ||
        err.response?.data?.error?.message ||
        err.response?.data?.error;
      setPreviewError(apiMsg || err.message || 'Preview failed');
      setPreviewData(null);
    } finally {
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }
  }, []);

  const correlationRulesKey = correlationRules
    .map((r) => `${r.identityAttribute}\t${r.accountAttribute}`)
    .join('|');

  /** Debounced live preview when rules change (no button required). */
  useEffect(() => {
    if (!correlationModalOpen || fieldsLoading || !selectedAppForCorrelation?._id) return;
    if (
      correlationRules.length === 0 ||
      correlationRules.some((r) => !r.identityAttribute || !r.accountAttribute)
    ) {
      setPreviewData(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const appId = selectedAppForCorrelation._id;
    const rulesSnapshot = correlationRules.map((r) => ({ ...r }));
    const t = setTimeout(() => {
      if (!cancelled) void executePreview(appId, rulesSnapshot);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    correlationModalOpen,
    fieldsLoading,
    selectedAppForCorrelation?._id,
    correlationRulesKey,
    executePreview,
  ]);

  const handleRunManualCorrelation = async () => {
    if (
      correlationRules.length === 0 ||
      correlationRules.some((r) => !r.identityAttribute || !r.accountAttribute)
    ) {
      return showToast('Please complete all correlation rules (identity and target field on each row).', 'warning');
    }

    const appRef = selectedAppForCorrelation;
    const rulesPayload = correlationRules.map((r, i) => ({
      identityAttribute: r.identityAttribute,
      accountAttribute: r.accountAttribute,
      priority: i + 1,
    }));
    const primary = rulesPayload[0];

    setRunningAppId(appRef._id);
    setCorrelationModalOpen(false);

    try {
      const res = await correlationAPI.runEngine(appRef._id, { rules: rulesPayload });
      const results = res.data.results;

      setScanHistory((prev) => ({
        ...prev,
        [appRef._id]: {
          totalProcessed: results.totalProcessed,
          newlyLinked: results.newlyLinked,
          uncorrelatedAccounts: results.orphansDetected,
          identityAttribute: primary.identityAttribute,
          accountAttribute: primary.accountAttribute,
          rules: results.rules || rulesPayload,
          timestamp: new Date(),
        },
      }));

      targetFieldsByAppRef.current.delete(String(appRef._id));

      showToast(
        `${appRef.name} correlation complete. Linked: ${results.newlyLinked}. Uncorrelated accounts: ${results.orphansDetected}.`,
        'success',
      );
    } catch (err) {
      showToast(err.response?.data?.message || `Failed to run correlation for ${appRef.name}`, 'error');
    } finally {
      setRunningAppId(null);
      setSelectedAppForCorrelation(null);
    }
  };

  const correlationRulesComplete =
    correlationRules.length > 0 &&
    correlationRules.every((r) => r.identityAttribute && r.accountAttribute);

  const canSubmitCorrelation =
    !fieldsLoading &&
    correlationRulesComplete &&
    identityFieldOptions.length > 0 &&
    targetFieldOptions.length > 0;

  const handlePreviewCorrelation = () => {
    if (!canSubmitCorrelation || !selectedAppForCorrelation) {
      showToast('Please complete all correlation rules (identity and target field on each row).', 'warning');
      return;
    }
    void executePreview(selectedAppForCorrelation._id, correlationRules);
  };

  const addCorrelationRule = () => {
    setCorrelationRules((prev) => [...prev, { identityAttribute: '', accountAttribute: '' }]);
  };

  const removeCorrelationRule = (index) => {
    setCorrelationRules((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const moveCorrelationRule = (index, delta) => {
    setCorrelationRules((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const updateCorrelationRuleRow = (index, patch) => {
    setCorrelationRules((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  return (
    <Box>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1.25, mb: 0.5 }}>
          <SettingsSuggest fontSize="large" color="primary" /> Identity &amp; account correlation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Match directory identities to application accounts. Preview updates automatically when you change mapping fields.
        </Typography>
      </Box>

      {!tenantId ? (
        <Paper sx={{ p: 6, textAlign: 'center', backgroundColor: palette.bg.elevated, border: `1px solid ${palette.border.default}`, borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary', mb: 1 }}>
            No Tenant Associated
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your user account is not associated with any tenant.
          </Typography>
        </Paper>
      ) : loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Stack spacing={1.75}>
          <CorrelationKpiStrip apps={applications} scanHistory={scanHistory} />

          <CorrelationFilters
            search={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
          />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' },
              gap: 1.75,
              alignItems: 'start',
            }}
          >
            <Stack spacing={1}>
              {applications.length === 0 ? (
                <Paper
                  elevation={0}
                  sx={{
                    p: 4,
                    textAlign: 'center',
                    border: `1px solid ${palette.border.default}`,
                    borderRadius: 1.75,
                    bgcolor: palette.bg.secondary,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No applications configured for this tenant.
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.75 }}>
                    Applications used only as the Identity Profile source are not listed here.
                  </Typography>
                </Paper>
              ) : filteredApplications.length === 0 ? (
                <Paper
                  elevation={0}
                  sx={{
                    p: 3,
                    textAlign: 'center',
                    border: `1px solid ${palette.border.default}`,
                    borderRadius: 1.75,
                    bgcolor: palette.bg.secondary,
                  }}
                >
                  <Typography variant="body2" color="text.secondary">
                    No applications match the current filters.
                  </Typography>
                </Paper>
              ) : (
                filteredApplications.map((app) => (
                  <CorrelationAppCard
                    key={app._id}
                    app={app}
                    appTypeLabel={normalizeAppType(app)}
                    history={scanHistory[app._id]}
                    isRunning={runningAppId === app._id}
                    correlateDisabled={runningAppId !== null}
                    onCorrelate={handleOpenCorrelationModal}
                  />
                ))
              )}
            </Stack>

            <Box sx={{ position: { lg: 'sticky' }, top: { lg: 16 } }}>
              <CorrelationHealthSidebar apps={applications} scanHistory={scanHistory} />
            </Box>
          </Box>
        </Stack>
      )}

      <Dialog
        open={correlationModalOpen}
        onClose={() => {
          previewSeqRef.current += 1;
          setCorrelationModalOpen(false);
          setPreviewData(null);
          setPreviewError('');
          setPreviewLoading(false);
        }}
        maxWidth="md"
        fullWidth
        scroll="paper"
      >
        <DialogTitle sx={{ fontWeight: 700 }}>Match identities to accounts</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Define one or more rules in <strong>priority order</strong> (rule 1 first, then fallbacks). For each account,
            the engine uses the first rule where the target field is non-empty and matches an identity; if none match, the
            account is uncorrelated. Values are compared case-insensitively after trim. The preview{' '}
            <strong>refreshes automatically</strong> shortly after you change a field — nothing is written until you start
            correlation.
          </Typography>

          {fieldsLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <>
              {!fieldsLoading && identityFieldOptions.length === 0 && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  No identity attributes are defined yet. Add mappings on an Identity Profile whose{' '}
                  <strong>source application</strong> is your HR / authoritative feed — those targets appear here for
                  correlation to any target app.
                </Alert>
              )}
              {!fieldsLoading && targetFieldOptions.length === 0 && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  No target attributes found yet. Define Schema Management (user mappings), sync accounts, or upload data
                  so fields appear here.
                </Alert>
              )}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {correlationRules.map((row, index) => (
                  <Grid container spacing={1} alignItems="center" key={`corr-rule-${index}`} wrap="nowrap">
                    <Grid item sx={{ width: 88, flexShrink: 0 }}>
                      <Chip size="small" label={`Rule ${index + 1}`} sx={{ fontWeight: 700 }} variant="outlined" />
                    </Grid>
                    <Grid item xs zeroMinWidth>
                      <FormControl fullWidth size="small" disabled={identityFieldOptions.length === 0}>
                        <InputLabel>Identity attribute</InputLabel>
                        <Select
                          value={row.identityAttribute}
                          label="Identity attribute"
                          onChange={(e) =>
                            updateCorrelationRuleRow(index, { identityAttribute: e.target.value })
                          }
                        >
                          {identityFieldOptions.map((opt) => (
                            <MenuItem key={opt.targetKey} value={opt.targetKey}>
                              {opt.label} ({opt.targetKey})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item sx={{ width: 36, textAlign: 'center', flexShrink: 0 }}>
                      <Typography variant="h6" color="text.secondary">
                        →
                      </Typography>
                    </Grid>
                    <Grid item xs zeroMinWidth>
                      <FormControl fullWidth size="small" disabled={targetFieldOptions.length === 0}>
                        <InputLabel>Target attribute</InputLabel>
                        <Select
                          value={row.accountAttribute}
                          label="Target attribute"
                          onChange={(e) =>
                            updateCorrelationRuleRow(index, { accountAttribute: e.target.value })
                          }
                        >
                          {targetFieldOptions.map((f) => (
                            <MenuItem key={f} value={f}>
                              {f}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item sx={{ display: 'flex', flexShrink: 0 }}>
                      <Tooltip title="Move up">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => moveCorrelationRule(index, -1)}
                            disabled={index === 0}
                            aria-label="Move rule up"
                          >
                            <KeyboardArrowUp fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Move down">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => moveCorrelationRule(index, 1)}
                            disabled={index === correlationRules.length - 1}
                            aria-label="Move rule down"
                          >
                            <KeyboardArrowDown fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={correlationRules.length <= 1 ? 'At least one rule is required' : 'Remove rule'}>
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removeCorrelationRule(index)}
                            disabled={correlationRules.length <= 1}
                            aria-label="Remove rule"
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Grid>
                  </Grid>
                ))}
                <Box>
                  <Button
                    size="small"
                    startIcon={<Add />}
                    onClick={addCorrelationRule}
                    disabled={correlationRules.length >= 12}
                    sx={{ textTransform: 'none' }}
                  >
                    Add rule
                  </Button>
                  {correlationRules.length >= 12 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Maximum 12 rules per application.
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            </>
          )}

          {previewLoading && <LinearProgress sx={{ mt: 2 }} />}
          {previewError ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {previewError}
            </Alert>
          ) : null}

          {previewData ? (
            <Box sx={{ mt: 2 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
                Preview (no changes saved)
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Updates automatically after you change a field (short debounce). Use Refresh for an immediate re-run.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Scanned {previewData.totalAccounts?.toLocaleString?.() ?? previewData.totalAccounts} account row(s).
                {Array.isArray(previewData.perRuleIdentityStats) && previewData.perRuleIdentityStats.length > 0 ? (
                  <>
                    {' '}
                    Per-rule identity index:{' '}
                    {previewData.perRuleIdentityStats
                      .map(
                        (s) =>
                          `${s.identityAttribute} (${(s.identitiesWithComparableKey ?? 0).toLocaleString?.() ?? s.identitiesWithComparableKey} values, ${(s.distinctLookupKeys ?? 0).toLocaleString?.() ?? s.distinctLookupKeys} keys)`,
                      )
                      .join('; ')}
                    .
                  </>
                ) : (
                  <>
                    {' '}
                    Identities with a non-empty value for{' '}
                    <strong>{previewData.identityAttribute}</strong>:{' '}
                    {previewData.identitiesWithComparableKey?.toLocaleString?.() ??
                      previewData.identitiesWithComparableKey}{' '}
                    across {previewData.distinctLookupKeys?.toLocaleString?.() ?? previewData.distinctLookupKeys}{' '}
                    distinct lookup key(s).
                  </>
                )}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
                <Chip color="success" label={`Would link: ${previewData.wouldCreateLinks ?? 0}`} size="small" />
                <Chip
                  color="warning"
                  label={`Missing on all rules: ${previewData.wouldFlagOrphansMissingTargetField ?? 0}`}
                  size="small"
                />
                <Chip
                  color="error"
                  variant={previewData.wouldFlagOrphansNoIdentityMatch > 0 ? 'filled' : 'outlined'}
                  label={`No identity match: ${previewData.wouldFlagOrphansNoIdentityMatch ?? 0}`}
                  size="small"
                />
              </Box>
              {previewData.linkedByRulePriority &&
              typeof previewData.linkedByRulePriority === 'object' &&
              Object.keys(previewData.linkedByRulePriority).length > 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  Linked by rule:{' '}
                  {Object.entries(previewData.linkedByRulePriority)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([pri, n]) => `Rule ${pri}: ${n}`)
                    .join(' · ')}
                </Typography>
              ) : null}
              {previewData.ambiguousIdentityMatches > 0 ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {previewData.ambiguousIdentityMatches} account match(es) share a lookup key with{' '}
                  <strong>multiple identities</strong> — the run uses the first identity only (same as production).
                </Alert>
              ) : null}

              {previewData.sampleLinked?.length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
                    Sample linked accounts (up to {previewData.sampleLinked.length})
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 220 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Identity</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Matched rule</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Identity value</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Target value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewData.sampleLinked.map((row) => (
                          <TableRow key={`${row.accountId}-${row.identityId}`}>
                            <TableCell>{row.identityDisplayName}</TableCell>
                            <TableCell sx={{ fontSize: 12 }}>
                              {row.matchedRulePriority != null ? (
                                <>
                                  Rule {row.matchedRulePriority}: {row.matchedIdentityAttribute ?? '—'} →{' '}
                                  {row.matchedAccountAttribute ?? '—'}
                                </>
                              ) : (
                                `${previewData.identityAttribute} → ${previewData.accountAttribute}`
                              )}
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.identityFieldValue}</TableCell>
                            <TableCell>{row.accountDisplayName || row.accountId}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.targetFieldValue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}

              {previewData.sampleMissingTargetField?.length > 0 ? (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
                    Sample accounts with no target value on any rule (all mapped fields empty)
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 160 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Account id</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewData.sampleMissingTargetField.map((row) => (
                          <TableRow key={row.accountId}>
                            <TableCell>{row.accountDisplayName || '—'}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.accountId}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}

              {previewData.sampleNoIdentityMatch?.length > 0 ? (
                <Box sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
                    Sample accounts with no identity on that value
                  </Typography>
                  <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 220 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 600 }}>Account</TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>Last attempted value</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {previewData.sampleNoIdentityMatch.map((row) => (
                          <TableRow key={row.accountId}>
                            <TableCell>{row.accountDisplayName || row.accountId}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{row.targetFieldValue}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              ) : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ p: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button
            onClick={() => {
              setCorrelationModalOpen(false);
              setPreviewData(null);
              setPreviewError('');
              setPreviewLoading(false);
            }}
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handlePreviewCorrelation()}
            variant="outlined"
            startIcon={previewLoading ? <CircularProgress size={16} color="inherit" /> : <Visibility />}
            disabled={fieldsLoading || !canSubmitCorrelation || previewLoading}
          >
            {previewLoading ? 'Refreshing…' : 'Refresh preview'}
          </Button>
          <Button
            onClick={handleRunManualCorrelation}
            variant="contained"
            disabled={fieldsLoading || !canSubmitCorrelation}
          >
            Start correlation
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={6000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={toast.severity} variant="filled">
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
