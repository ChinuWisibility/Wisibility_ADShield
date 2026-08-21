import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Stack,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import { Edit, Refresh } from '@mui/icons-material';
import { adAPI } from '../../services/api';
import AdSuggestionRulesEditor from '../../components/adSuggestions/AdSuggestionRulesEditor';
import { palette } from '../../theme/palette';
import {
  buildSourceAppKey,
  normalizeOnboardingGroup,
  useOnboarding,
} from '../../contexts/OnboardingContext';

function appKeyOf(applicationId, suggestion) {
  return buildSourceAppKey(
    applicationId,
    suggestion?.appName || 'unknown-suggestion',
  );
}

function groupIdentityOf(group, index = 0) {
  return String(group?.dn || group?.name || index).trim();
}

function normalizeTags(rawValue) {
  const seen = new Set();
  return String(rawValue || '')
    .split(',')
    .map((tag) => String(tag || '').trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function suggestionSourceLabel(source) {
  switch (String(source || '').toLowerCase()) {
    case 'custom':
      return 'Custom rule';
    case 'hybrid':
      return 'Auto + custom';
    case 'prefix':
    default:
      return 'Auto-detected';
  }
}

function suggestionSourceColor(source) {
  switch (String(source || '').toLowerCase()) {
    case 'custom':
      return 'secondary';
    case 'hybrid':
      return 'info';
    case 'prefix':
    default:
      return 'default';
  }
}

function formatAnalyzedAge(ageMs) {
  if (ageMs == null || !Number.isFinite(ageMs)) return 'unknown';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day(s) ago`;
}

export default function AppSuggestionPanel({ applicationId }) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [needsAdScan, setNeedsAdScan] = useState(false);
  const [analysisInfo, setAnalysisInfo] = useState(null);
  const autoScanAttemptedRef = useRef(false);
  const [allAppNames, setAllAppNames] = useState([]);
  const [expandedApps, setExpandedApps] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [editingNameByApp, setEditingNameByApp] = useState({});
  const [nameDrafts, setNameDrafts] = useState({});
  const [tagDrafts, setTagDrafts] = useState({});
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalSuggestions, setTotalSuggestions] = useState(0);
  const [groupsByApp, setGroupsByApp] = useState({});
  const {
    onboardingSelections,
    setApplicationSelection,
    clearApplicationSelection,
    resetOnboardingSelections,
  } = useOnboarding();

  const getSelectionForSuggestion = useCallback(
    (sourceAppKey, suggestion) => ({
      sourceApplicationId: applicationId,
      detectedAppName: String(suggestion?.appName || '').trim(),
      customName:
        String(
          onboardingSelections[sourceAppKey]?.customName ||
            suggestion?.appName ||
            '',
        ).trim() || String(suggestion?.appName || '').trim(),
      tags: Array.isArray(onboardingSelections[sourceAppKey]?.tags)
        ? onboardingSelections[sourceAppKey].tags.filter(Boolean)
        : [],
      selectedGroups: Array.isArray(
        onboardingSelections[sourceAppKey]?.selectedGroups,
      )
        ? onboardingSelections[sourceAppKey].selectedGroups
            .map((group) => normalizeOnboardingGroup(group))
            .filter((group) => group.name || group.dn)
        : [],
    }),
    [applicationId, onboardingSelections],
  );

  const loadSuggestionsPage = useCallback(
    async (nextPage = 0, nextRowsPerPage = rowsPerPage) => {
      if (!applicationId) return null;
      const res = await adAPI.getSuggestedApps(applicationId, {
        page: nextPage + 1,
        pageSize: nextRowsPerPage,
      });
      return res.data;
    },
    [applicationId, rowsPerPage],
  );

  const applySuggestionsResponse = useCallback((payload) => {
    const nextSuggestions = Array.isArray(payload?.data) ? payload.data : [];
    const cache = payload?.cache || null;
    const pagination = payload?.pagination || {};
    const names = Array.isArray(payload?.allAppNames) ? payload.allAppNames : [];

    setSuggestions(nextSuggestions);
    setAnalysisInfo(cache);
    setAllAppNames(names);
    setTotalSuggestions(Number(pagination?.total) || nextSuggestions.length);
    setNeedsAdScan(
      cache?.status === 'refresh_required' ||
      cache?.status === 'refreshing' ||
      (cache?.status === 'failed' && nextSuggestions.length === 0),
    );
    setExpandedApps((prev) => {
      const next = { ...prev };
      nextSuggestions.forEach((suggestion, index) => {
        const key = appKeyOf(applicationId, suggestion);
        if (next[key] === undefined) {
          next[key] = index === 0;
        }
      });
      return next;
    });
  }, [applicationId]);

  const loadGroupsForApp = useCallback(
    async (suggestion, { page: groupPage = 0, pageSize = 25 } = {}) => {
      const appKey = appKeyOf(applicationId, suggestion);
      const appName = String(suggestion?.appName || '').trim();
      if (!applicationId || !appName) return;

      setGroupsByApp((prev) => ({
        ...prev,
        [appKey]: {
          ...(prev[appKey] || {}),
          loading: true,
          error: '',
        },
      }));

      try {
        const res = await adAPI.getSuggestedAppGroups(applicationId, appName, {
          page: groupPage + 1,
          pageSize,
        });
        const groups = Array.isArray(res.data?.data?.groups)
          ? res.data.data.groups
          : [];
        const pagination = res.data?.pagination || {};
        setGroupsByApp((prev) => ({
          ...prev,
          [appKey]: {
            groups,
            loading: false,
            error: '',
            page: groupPage,
            rowsPerPage: pageSize,
            total: Number(pagination?.total) || groups.length,
          },
        }));
      } catch (e) {
        setGroupsByApp((prev) => ({
          ...prev,
          [appKey]: {
            ...(prev[appKey] || {}),
            loading: false,
            error:
              e.response?.data?.message ||
              e.message ||
              'Failed to load groups for this suggestion.',
          },
        }));
      }
    },
    [applicationId],
  );

  const fetchAllGroupsForApp = useCallback(
    async (suggestion) => {
      const total = Number(suggestion?.groupCount) || 0;
      if (!total) return [];
      const res = await adAPI.getSuggestedAppGroups(
        applicationId,
        suggestion.appName,
        {
          page: 1,
          pageSize: Math.min(total, 5000),
        },
      );
      return Array.isArray(res.data?.data?.groups) ? res.data.data.groups : [];
    },
    [applicationId],
  );

  useEffect(() => {
    setPage(0);
    setRowsPerPage(10);
    setGroupsByApp({});
    resetOnboardingSelections();
    autoScanAttemptedRef.current = false;
  }, [applicationId, resetOnboardingSelections]);

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestions() {
      if (!applicationId) {
        setLoading(false);
        setRefreshing(false);
        setError('');
        setSuggestions([]);
        setAnalysisInfo(null);
        setAllAppNames([]);
        setExpandedApps({});
        setEditingNameByApp({});
        setNameDrafts({});
        setTagDrafts({});
        setGroupsByApp({});
        setTotalSuggestions(0);
        setNeedsAdScan(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const payload = await loadSuggestionsPage(page, rowsPerPage);
        if (cancelled) return;
        applySuggestionsResponse(payload);
      } catch (e) {
        if (cancelled) return;
        setSuggestions([]);
        setAnalysisInfo(null);
        setAllAppNames([]);
        setExpandedApps({});
        setGroupsByApp({});
        setError(
          e.response?.data?.message ||
            e.message ||
            'Failed to load AD app suggestions.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [
    applicationId,
    page,
    rowsPerPage,
    applySuggestionsResponse,
    loadSuggestionsPage,
  ]);

  useEffect(() => {
    if (!applicationId) return;
    const validKeys = new Set(
      (allAppNames || []).map((appName) =>
        buildSourceAppKey(applicationId, appName),
      ),
    );
    Object.keys(onboardingSelections || {}).forEach((sourceAppKey) => {
      if (!validKeys.has(sourceAppKey)) {
        clearApplicationSelection(sourceAppKey);
      }
    });
  }, [
    applicationId,
    allAppNames,
    onboardingSelections,
    clearApplicationSelection,
  ]);

  useEffect(() => {
    suggestions.forEach((suggestion) => {
      const appKey = appKeyOf(applicationId, suggestion);
      if (!expandedApps[appKey]) return;
      const bucket = groupsByApp[appKey];
      if (bucket?.groups || bucket?.loading) return;
      loadGroupsForApp(suggestion);
    });
  }, [
    suggestions,
    expandedApps,
    groupsByApp,
    applicationId,
    loadGroupsForApp,
  ]);

  const handleRefresh = useCallback(async () => {
    if (!applicationId || refreshing) return;
    setRefreshing(true);
    setError('');
    setNeedsAdScan(true);
    try {
      await adAPI.refreshSuggestions(applicationId);
      const payload = await loadSuggestionsPage(page, rowsPerPage);
      applySuggestionsResponse(payload);
      setGroupsByApp({});
    } catch (e) {
      if (e.response?.status === 409) {
        const payload = await loadSuggestionsPage(page, rowsPerPage);
        applySuggestionsResponse(payload);
        setGroupsByApp({});
      } else {
        setError(
          e.response?.data?.message ||
            e.message ||
            'Failed to analyze Active Directory groups.',
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [
    applicationId,
    refreshing,
    page,
    rowsPerPage,
    loadSuggestionsPage,
    applySuggestionsResponse,
  ]);

  /** First visit or no prior analysis: scan AD automatically (no manual refresh step). */
  useEffect(() => {
    if (!applicationId || loading || refreshing) return;
    if (autoScanAttemptedRef.current) return;
    if (analysisInfo?.status !== 'refresh_required') return;
    if (suggestions.length > 0) return;
    autoScanAttemptedRef.current = true;
    handleRefresh();
  }, [
    applicationId,
    loading,
    refreshing,
    analysisInfo?.status,
    suggestions.length,
    handleRefresh,
  ]);

  /** Poll while a background AD analysis is still running. */
  useEffect(() => {
    if (!applicationId || analysisInfo?.status !== 'refreshing') return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await loadSuggestionsPage(page, rowsPerPage);
        if (cancelled) return;
        applySuggestionsResponse(payload);
      } catch {
        /* keep polling until refresh completes or user leaves */
      }
    };
    poll();
    const timer = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    applicationId,
    analysisInfo?.status,
    page,
    rowsPerPage,
    loadSuggestionsPage,
    applySuggestionsResponse,
  ]);

  const selectedCountByApp = useMemo(
    () =>
      suggestions.reduce((acc, suggestion) => {
        const appKey = appKeyOf(applicationId, suggestion);
        acc[appKey] = getSelectionForSuggestion(appKey, suggestion).selectedGroups
          .length;
        return acc;
      }, {}),
    [applicationId, suggestions, getSelectionForSuggestion],
  );

  const toggleExpanded = (appKey, suggestion) => {
    const nextExpanded = !expandedApps[appKey];
    setExpandedApps((prev) => ({ ...prev, [appKey]: nextExpanded }));
    if (nextExpanded) {
      const bucket = groupsByApp[appKey];
      if (!bucket?.groups && !bucket?.loading) {
        loadGroupsForApp(suggestion);
      }
    }
  };

  const commitCustomName = useCallback(
    (sourceAppKey, suggestion, rawValue) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      const nextName =
        String(rawValue || '').trim() ||
        current.detectedAppName ||
        'Suggested application';
      setApplicationSelection(sourceAppKey, {
        ...current,
        customName: nextName,
      });
      setNameDrafts((prev) => ({ ...prev, [sourceAppKey]: nextName }));
      setEditingNameByApp((prev) => ({ ...prev, [sourceAppKey]: false }));
    },
    [getSelectionForSuggestion, setApplicationSelection],
  );

  const cancelCustomNameEdit = useCallback(
    (sourceAppKey, suggestion) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      setNameDrafts((prev) => ({
        ...prev,
        [sourceAppKey]: current.customName || current.detectedAppName,
      }));
      setEditingNameByApp((prev) => ({ ...prev, [sourceAppKey]: false }));
    },
    [getSelectionForSuggestion],
  );

  const commitTags = useCallback(
    (sourceAppKey, suggestion, rawValue) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      const tags = normalizeTags(rawValue);
      const normalized = tags.join(', ');
      setApplicationSelection(sourceAppKey, {
        ...current,
        tags,
      });
      setTagDrafts((prev) => ({ ...prev, [sourceAppKey]: normalized }));
    },
    [getSelectionForSuggestion, setApplicationSelection],
  );

  const toggleGroup = useCallback(
    (sourceAppKey, suggestion, group, groupIndex) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      const normalizedGroup = normalizeOnboardingGroup(group);
      const groupIdentity = groupIdentityOf(normalizedGroup, groupIndex);
      const exists = current.selectedGroups.some(
        (selectedGroup, index) =>
          groupIdentityOf(selectedGroup, index) === groupIdentity,
      );
      const selectedGroups = exists
        ? current.selectedGroups.filter(
            (selectedGroup, index) =>
              groupIdentityOf(selectedGroup, index) !== groupIdentity,
          )
        : [...current.selectedGroups, normalizedGroup];

      setApplicationSelection(sourceAppKey, {
        ...current,
        selectedGroups,
      });
    },
    [getSelectionForSuggestion, setApplicationSelection],
  );

  const selectAllForApp = useCallback(
    async (sourceAppKey, suggestion) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      const groups = await fetchAllGroupsForApp(suggestion);
      const selectedGroups = groups
        .map((group) => normalizeOnboardingGroup(group))
        .filter((group, index, arr) => {
          const identity = groupIdentityOf(group, index);
          return (
            identity &&
            arr.findIndex(
              (candidate, candidateIndex) =>
                groupIdentityOf(candidate, candidateIndex) === identity,
            ) === index
          );
        });
      setApplicationSelection(sourceAppKey, {
        ...current,
        selectedGroups,
      });
    },
    [getSelectionForSuggestion, setApplicationSelection, fetchAllGroupsForApp],
  );

  const clearAllForApp = useCallback(
    (sourceAppKey, suggestion) => {
      const current = getSelectionForSuggestion(sourceAppKey, suggestion);
      setApplicationSelection(sourceAppKey, {
        ...current,
        selectedGroups: [],
      });
    },
    [getSelectionForSuggestion, setApplicationSelection],
  );

  const statusLine = useMemo(() => {
    if (refreshing || analysisInfo?.status === 'refreshing') {
      return 'Analyzing Active Directory groups and building application suggestions…';
    }
    if (!analysisInfo) {
      return loading ? 'Loading suggestions…' : '';
    }
    if (analysisInfo.status === 'refresh_required') {
      return 'Connecting to Active Directory to analyze groups…';
    }
    if (analysisInfo.status === 'failed' && !suggestions.length) {
      return 'Analysis did not complete. Use Scan Active Directory to try again.';
    }
    const ageLabel = formatAnalyzedAge(analysisInfo.ageMs);
    const groupsAnalyzed = Number(analysisInfo.totalGroups) || 0;
    const suggestionsCount = Number(analysisInfo.totalSuggestions) || 0;
    const staleSuffix = analysisInfo.isStale ? ' · newer directory data may be available' : '';
    return `Last analyzed ${ageLabel} · ${groupsAnalyzed.toLocaleString()} group(s) · ${suggestionsCount.toLocaleString()} suggestion(s)${staleSuffix}`;
  }, [analysisInfo, loading, refreshing, suggestions.length]);

  const showSuggestionsSpinner =
    (loading || refreshing || analysisInfo?.status === 'refreshing') && !suggestions.length;

  if (!applicationId) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        Select an application to load AD group suggestions.
      </Alert>
    );
  }

  const groupsAvailable =
    Boolean(analysisInfo?.totalGroups) &&
    analysisInfo?.status === 'ready' &&
    !needsAdScan;

  return (
    <Stack spacing={2} sx={{ mt: 2 }}>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Directory scan
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {statusLine || 'Scan Active Directory to discover groups and suggestions.'}
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              startIcon={
                refreshing ? <CircularProgress size={14} color="inherit" /> : <Refresh fontSize="small" />
              }
              disabled={refreshing || loading}
              onClick={handleRefresh}
              sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' }, textTransform: 'none', fontWeight: 700 }}
            >
              {refreshing ? 'Scanning AD…' : 'Scan AD'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <AdSuggestionRulesEditor
        applicationId={applicationId}
        groupsAvailable={groupsAvailable}
        onRulesApplied={async () => {
          const payload = await loadSuggestionsPage(0, rowsPerPage);
          applySuggestionsResponse(payload);
          setPage(0);
          setGroupsByApp({});
        }}
      />

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={handleRefresh}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {showSuggestionsSpinner ? (
        <Box sx={{ py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            {statusLine || 'Loading suggestions from Active Directory…'}
          </Typography>
        </Box>
      ) : null}

      {!loading && suggestions.length ? (
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 1 }}>
          Suggested applications
          <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
            Custom rules appear first, then auto-detected clusters.
          </Typography>
        </Typography>
      ) : null}

      {!loading && suggestions.length
        ? suggestions.map((suggestion) => {
            const appKey = appKeyOf(applicationId, suggestion);
            const groupBucket = groupsByApp[appKey] || {};
            const groups = Array.isArray(groupBucket.groups) ? groupBucket.groups : [];
            const groupTotal =
              Number(groupBucket.total) ||
              Number(suggestion?.groupCount) ||
              groups.length;
            const currentSelection = getSelectionForSuggestion(appKey, suggestion);
            const selectedCount = selectedCountByApp[appKey] || 0;
            const tagValue =
              tagDrafts[appKey] !== undefined
                ? tagDrafts[appKey]
                : (currentSelection.tags || []).join(', ');
            const isEditingName = Boolean(editingNameByApp[appKey]);
            const nameValue =
              nameDrafts[appKey] !== undefined
                ? nameDrafts[appKey]
                : currentSelection.customName || currentSelection.detectedAppName;
            const selectedGroupIds = new Set(
              (currentSelection.selectedGroups || []).map((group, index) =>
                groupIdentityOf(group, index),
              ),
            );

            return (
              <Card
                key={appKey}
                variant="outlined"
                sx={{ borderColor: palette.border?.default || 'divider' }}
              >
                <CardContent sx={{ p: 2 }}>
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1.5}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', md: 'center' }}
                  >
                    <Box>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        {isEditingName ? (
                          <TextField
                            autoFocus
                            size="small"
                            value={nameValue}
                            onChange={(e) =>
                              setNameDrafts((prev) => ({
                                ...prev,
                                [appKey]: e.target.value,
                              }))
                            }
                            onBlur={() => commitCustomName(appKey, suggestion, nameValue)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitCustomName(appKey, suggestion, nameValue);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelCustomNameEdit(appKey, suggestion);
                              }
                            }}
                            sx={{ minWidth: { xs: '100%', sm: 240 } }}
                          />
                        ) : (
                          <Typography
                            variant="h6"
                            sx={{ fontWeight: 700, cursor: 'pointer' }}
                            onClick={() => toggleExpanded(appKey, suggestion)}
                          >
                            {currentSelection.customName ||
                              suggestion?.appName ||
                              'Unknown application'}
                          </Typography>
                        )}
                        <Chip
                          size="small"
                          label={suggestionSourceLabel(suggestion?.suggestionSource)}
                          color={suggestionSourceColor(suggestion?.suggestionSource)}
                          variant="outlined"
                          sx={{ fontWeight: 600 }}
                        />
                        <IconButton
                          size="small"
                          aria-label="Edit application name"
                          onClick={() => {
                            setEditingNameByApp((prev) => ({ ...prev, [appKey]: true }));
                            setNameDrafts((prev) => ({
                              ...prev,
                              [appKey]:
                                currentSelection.customName ||
                                currentSelection.detectedAppName ||
                                '',
                            }));
                          }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                      </Stack>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ cursor: 'pointer' }}
                        onClick={() => toggleExpanded(appKey, suggestion)}
                      >
                        Detected as {suggestion?.appName || 'Unknown'} •{' '}
                        {suggestion?.groupCount ?? groupTotal} group(s),{' '}
                        {suggestion?.userCount ?? 0} user(s), {selectedCount} selected
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button
                        size="small"
                        onClick={() => selectAllForApp(appKey, suggestion)}
                        disabled={!suggestion?.groupCount}
                      >
                        Select All
                      </Button>
                      <Button
                        size="small"
                        onClick={() => clearAllForApp(appKey, suggestion)}
                        disabled={!selectedCount}
                      >
                        Clear All
                      </Button>
                      <Button
                        size="small"
                        onClick={() => toggleExpanded(appKey, suggestion)}
                      >
                        {expandedApps[appKey] ? 'Hide Groups' : 'Show Groups'}
                      </Button>
                    </Stack>
                  </Stack>

                  <TextField
                    fullWidth
                    size="small"
                    label="Tags"
                    placeholder="finance, privileged, review"
                    value={tagValue}
                    onChange={(e) =>
                      setTagDrafts((prev) => ({
                        ...prev,
                        [appKey]: e.target.value,
                      }))
                    }
                    onBlur={() => commitTags(appKey, suggestion, tagValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitTags(appKey, suggestion, tagValue);
                      }
                    }}
                    sx={{ mt: 2 }}
                  />

                  <Collapse in={Boolean(expandedApps[appKey])} timeout="auto" unmountOnExit>
                    <Stack spacing={1} sx={{ mt: 2 }}>
                      {groupBucket.loading ? (
                        <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
                          <CircularProgress size={22} />
                        </Box>
                      ) : null}
                      {groupBucket.error ? (
                        <Alert
                          severity="error"
                          action={
                            <Button
                              color="inherit"
                              size="small"
                              onClick={() =>
                                loadGroupsForApp(suggestion, {
                                  page: groupBucket.page || 0,
                                  pageSize: groupBucket.rowsPerPage || 25,
                                })
                              }
                            >
                              Retry
                            </Button>
                          }
                        >
                          {groupBucket.error}
                        </Alert>
                      ) : null}
                      {!groupBucket.loading && groups.length
                        ? groups.map((group, groupIndex) => {
                            const groupKey = groupIdentityOf(group, groupIndex);
                            const checked = selectedGroupIds.has(groupKey);
                            return (
                              <Box key={groupKey}>
                                <Stack
                                  direction="row"
                                  spacing={1.5}
                                  alignItems="flex-start"
                                  sx={{ py: 0.5 }}
                                >
                                  <Checkbox
                                    checked={checked}
                                    onChange={() =>
                                      toggleGroup(appKey, suggestion, group, groupIndex)
                                    }
                                    size="small"
                                    sx={{ mt: -0.5 }}
                                  />
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {group?.name || 'Unnamed group'}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ display: 'block' }}
                                    >
                                      Members: {group?.memberCount ?? 0}
                                    </Typography>
                                    {group?.dn ? (
                                      <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ display: 'block', wordBreak: 'break-word' }}
                                      >
                                        {group.dn}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                </Stack>
                                {groupIndex < groups.length - 1 ? <Divider /> : null}
                              </Box>
                            );
                          })
                        : null}
                      {!groupBucket.loading && !groupBucket.error && !groups.length ? (
                        <Alert severity="info">
                          No groups are available for this suggestion.
                        </Alert>
                      ) : null}
                      {groupTotal > (groupBucket.rowsPerPage || 25) ? (
                        <TablePagination
                          component="div"
                          count={groupTotal}
                          page={groupBucket.page || 0}
                          onPageChange={(_, nextPage) =>
                            loadGroupsForApp(suggestion, {
                              page: nextPage,
                              pageSize: groupBucket.rowsPerPage || 25,
                            })
                          }
                          rowsPerPage={groupBucket.rowsPerPage || 25}
                          onRowsPerPageChange={(event) => {
                            const nextRowsPerPage = Number(event.target.value) || 25;
                            loadGroupsForApp(suggestion, {
                              page: 0,
                              pageSize: nextRowsPerPage,
                            });
                          }}
                          rowsPerPageOptions={[10, 25, 50, 100]}
                        />
                      ) : null}
                    </Stack>
                  </Collapse>
                </CardContent>
              </Card>
            );
          })
        : null}

      {totalSuggestions > 0 ? (
        <Box
          sx={{
            borderTop: `1px solid ${palette.border?.default || 'divider'}`,
            display: 'flex',
            justifyContent: 'flex-end',
            pt: 1,
          }}
        >
          <TablePagination
            component="div"
            count={totalSuggestions}
            page={page}
            onPageChange={(_, nextPage) => setPage(nextPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              const nextRowsPerPage = Number(event.target.value) || 10;
              setRowsPerPage(nextRowsPerPage);
              setPage(0);
            }}
            rowsPerPageOptions={[5, 10, 25, 50]}
          />
        </Box>
      ) : null}
    </Stack>
  );
}
