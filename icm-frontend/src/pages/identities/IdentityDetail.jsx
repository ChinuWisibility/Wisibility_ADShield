import React, {
  useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, lazy, Suspense,
} from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, CircularProgress, LinearProgress, Snackbar, Alert,
} from '@mui/material';
import {
  Person, Apps, AccountTree, FingerprintOutlined, CompareArrows,
  GavelOutlined, AssignmentTurnedInOutlined, HealthAndSafetyOutlined,
  AdminPanelSettingsOutlined,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { identityProfileAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import {
  catalogTabIdFromIndex,
  catalogTabIndexFromQuery,
  CATALOG_TAB_IDS,
} from './catalog/identityCatalogTabs';
import {
  resolveIdentityBannerTitle,
  resolveManagerLinkLabel,
  resolveManagerProfileId,
} from './catalog/identityDetailHelpers';
import {
  catalogPageSx,
  CATALOG,
} from './catalog/catalogTheme';
import CatalogCurvedTabs from './catalog/CatalogCurvedTabs';
import {
  fetchIdentityAccounts,
  fetchIdentityDetail,
  fetchIdentitySod,
  fetchIdentityCertifications,
  fetchIdentityHygiene,
  fetchIdentityPrivileges,
  identityAccountsQueryKey,
  identityDetailQueryKey,
  identityPostureQueryKey,
  identitySodQueryKey,
  identityCertificationsQueryKey,
  identityHygieneQueryKey,
  identityPrivilegesQueryKey,
  IDENTITY_DETAIL_STALE_MS,
  IDENTITY_INSIGHT_STALE_MS,
  prefetchIdentityGraph,
  prefetchIdentityPosture,
  prefetchIdentitySod,
  prefetchIdentityCertifications,
  prefetchIdentityHygiene,
  prefetchIdentityPrivileges,
} from './catalog/identityCatalogQueries';
import IdentityCatalogHeader from './catalog/IdentityCatalogHeader';
import OverviewHrTab from './catalog/OverviewHrTab';
import AccountsTab from './catalog/AccountsTab';

const MindmapTab = lazy(() => import('./catalog/MindmapTab'));
const PostureTab = lazy(() => import('./catalog/PostureTab'));
const PeerComparisonTab = lazy(() => import('./catalog/PeerComparisonTab'));
const SodTab = lazy(() => import('./catalog/SodTab'));
const CertificationsTab = lazy(() => import('./catalog/CertificationsTab'));
const HygieneTab = lazy(() => import('./catalog/HygieneTab'));
const PrivilegesTab = lazy(() => import('./catalog/PrivilegesTab'));

const TAB_MINDMAP = 2;
const TAB_POSTURE = 3;
const TAB_PEERS = 4;
const TAB_SOD = 5;
const TAB_CERTIFICATIONS = 6;
const TAB_HYGIENE = 7;
const TAB_PRIVILEGES = 8;

function TabFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
      <CircularProgress size={32} />
    </Box>
  );
}

function TabBadgeLabel({ label, count }) {
  if (!count) return label;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        lineHeight: 1.2,
      }}
    >
      <Box component="span">{label}</Box>
      <Box
        component="span"
        sx={{
          minWidth: 18,
          height: 18,
          px: 0.6,
          borderRadius: 999,
          bgcolor: 'error.main',
          color: '#fff',
          fontSize: '0.65rem',
          fontWeight: 700,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        {count > 99 ? '99+' : count}
      </Box>
    </Box>
  );
}

export default function IdentityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [identity, setIdentity] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState(() => catalogTabIndexFromQuery(searchParams.get('tab')));
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const [mappedProfileFields, setMappedProfileFields] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [mountedHeavyTabs, setMountedHeavyTabs] = useState(() => {
    const initial = catalogTabIndexFromQuery(searchParams.get('tab'));
    return new Set(initial >= TAB_MINDMAP ? [initial] : []);
  });

  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });
  const loadSeqRef = useRef(0);

  // Paint cached shell before fetch so revisits / list prefetch don't flash a blank loader
  useLayoutEffect(() => {
    if (!id) return;
    const cachedIdentity = queryClient.getQueryData(identityDetailQueryKey(id));
    const cachedAccounts = queryClient.getQueryData(identityAccountsQueryKey(id));
    if (cachedIdentity) {
      setIdentity(cachedIdentity);
      setLoading(false);
      if (Array.isArray(cachedAccounts)) {
        setAccounts(cachedAccounts);
        setAccountsLoading(false);
      } else {
        setAccountsLoading(true);
      }
    } else {
      setLoading(true);
      setIdentity(null);
      setAccounts([]);
      setAccountsLoading(true);
    }
  }, [id, queryClient]);

  const sodBadgeQuery = useQuery({
    queryKey: identitySodQueryKey(id),
    queryFn: () => fetchIdentitySod(id),
    enabled: Boolean(id && identity),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
  const certBadgeQuery = useQuery({
    queryKey: identityCertificationsQueryKey(id),
    queryFn: () => fetchIdentityCertifications(id),
    enabled: Boolean(id && identity),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
  const hygieneBadgeQuery = useQuery({
    queryKey: identityHygieneQueryKey(id),
    queryFn: () => fetchIdentityHygiene(id),
    enabled: Boolean(id && identity && mountedHeavyTabs.has(TAB_HYGIENE)),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
  const privilegesBadgeQuery = useQuery({
    queryKey: identityPrivilegesQueryKey(id),
    queryFn: () => fetchIdentityPrivileges(id),
    enabled: Boolean(id && identity && mountedHeavyTabs.has(TAB_PRIVILEGES)),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });

  const sodBadgeCount = sodBadgeQuery.data?.summary?.openCount || 0;
  const certBadgeCount = certBadgeQuery.data?.summary?.pending || 0;
  const hygieneBadgeCount = hygieneBadgeQuery.data?.summary?.totalFindings || 0;
  const privilegesBadgeCount = privilegesBadgeQuery.data?.summary?.privilegedEntitlements || 0;

  useEffect(() => {
    setCurrentTab(catalogTabIndexFromQuery(searchParams.get('tab')));
  }, [searchParams, id]);

  useEffect(() => {
    const initial = catalogTabIndexFromQuery(searchParams.get('tab'));
    setMountedHeavyTabs(new Set(initial >= TAB_MINDMAP ? [initial] : []));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset keep-alive when identity changes

  useEffect(() => {
    if (currentTab < TAB_MINDMAP) return;
    setMountedHeavyTabs((prev) => {
      if (prev.has(currentTab)) return prev;
      const next = new Set(prev);
      next.add(currentTab);
      return next;
    });
  }, [currentTab]);

  const prefetchHeavyTab = useCallback((tabIndex) => {
    if (!id) return;
    if (tabIndex === TAB_MINDMAP) prefetchIdentityGraph(queryClient, id);
    if (tabIndex === TAB_POSTURE) prefetchIdentityPosture(queryClient, id);
    if (tabIndex === TAB_SOD) prefetchIdentitySod(queryClient, id);
    if (tabIndex === TAB_CERTIFICATIONS) prefetchIdentityCertifications(queryClient, id);
    if (tabIndex === TAB_HYGIENE) prefetchIdentityHygiene(queryClient, id);
    if (tabIndex === TAB_PRIVILEGES) prefetchIdentityPrivileges(queryClient, id);
  }, [id, queryClient]);

  const handleTabChange = (_e, val) => {
    setCurrentTab(val);
    prefetchHeavyTab(val);
    const tabId = catalogTabIdFromIndex(val);
    const next = new URLSearchParams(searchParams);
    if (tabId === CATALOG_TAB_IDS.OVERVIEW) {
      next.delete('tab');
    } else {
      next.set('tab', tabId);
    }
    setSearchParams(next, { replace: true });
  };

  const fetchIdentityData = useCallback(
    async (options = {}) => {
      const { showFullPageLoader = false } = options;
      const seq = ++loadSeqRef.current;
      const cachedIdentity = queryClient.getQueryData(identityDetailQueryKey(id));
      const cachedAccounts = queryClient.getQueryData(identityAccountsQueryKey(id));
      const hasCachedShell = Boolean(cachedIdentity);

      if (showFullPageLoader) {
        // Seed from cache first so prefetched / revisited identities don't blank → flicker
        if (hasCachedShell) {
          setIdentity(cachedIdentity);
          setLoading(false);
          if (Array.isArray(cachedAccounts)) {
            setAccounts(cachedAccounts);
          }
        } else {
          setLoading(true);
          setIdentity(null);
          setAccounts([]);
          setMappedProfileFields([]);
        }
      }

      try {
        if (!Array.isArray(cachedAccounts)) {
          setAccountsLoading(true);
        }

        const [identityResult, accountsResult, fieldsResult] = await Promise.allSettled([
          queryClient.fetchQuery({
            queryKey: identityDetailQueryKey(id),
            queryFn: () => fetchIdentityDetail(id),
            staleTime: IDENTITY_DETAIL_STALE_MS,
          }),
          queryClient.fetchQuery({
            queryKey: identityAccountsQueryKey(id),
            queryFn: () => fetchIdentityAccounts(id),
            staleTime: IDENTITY_DETAIL_STALE_MS,
          }),
          tenantId
            ? identityProfileAPI.getMappedFields({ tenantId })
            : Promise.resolve({ data: { data: [] } }),
        ]);

        if (seq !== loadSeqRef.current) return;

        if (identityResult.status !== 'fulfilled' || !identityResult.value) {
          setIdentity(null);
          if (identityResult.status === 'rejected') {
            console.error('Failed to fetch user details', identityResult.reason);
            showToast('Failed to load identity data', 'error');
          }
          return;
        }

        setIdentity(identityResult.value);

        if (accountsResult.status === 'fulfilled') {
          setAccounts(accountsResult.value || []);
        } else {
          console.error('Secondary identity load failed', accountsResult.reason);
          showToast('Identity loaded; accounts could not be refreshed.', 'warning');
          if (!Array.isArray(cachedAccounts)) {
            setAccounts([]);
          }
        }

        if (fieldsResult.status === 'fulfilled') {
          setMappedProfileFields(fieldsResult.value?.data?.data || []);
        } else {
          setMappedProfileFields([]);
        }
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        console.error('Failed to fetch user details', err);
        showToast('Failed to load identity data', 'error');
        if (showFullPageLoader && !hasCachedShell) {
          setIdentity(null);
        }
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
          setAccountsLoading(false);
        }
      }
    },
    [id, tenantId, queryClient],
  );

  useEffect(() => {
    fetchIdentityData({ showFullPageLoader: true });
  }, [fetchIdentityData]);

  useEffect(() => {
    if (!id || !identity) return;
    if (currentTab === TAB_MINDMAP) prefetchIdentityGraph(queryClient, id);
    if (currentTab === TAB_POSTURE) prefetchIdentityPosture(queryClient, id);
    if (currentTab === TAB_SOD) prefetchIdentitySod(queryClient, id);
    if (currentTab === TAB_CERTIFICATIONS) prefetchIdentityCertifications(queryClient, id);
    if (currentTab === TAB_HYGIENE) prefetchIdentityHygiene(queryClient, id);
    if (currentTab === TAB_PRIVILEGES) prefetchIdentityPrivileges(queryClient, id);
  }, [id, identity, currentTab, queryClient]);

  const managerProfileId = useMemo(
    () => (identity ? resolveManagerProfileId(identity) : null),
    [identity],
  );
  const bannerTitle = useMemo(() => (identity ? resolveIdentityBannerTitle(identity) : ''), [identity]);
  const managerLinkLabel = useMemo(() => (identity ? resolveManagerLinkLabel(identity) : ''), [identity]);

  const beginManagerNavigation = useCallback(() => {
    const nextId = managerProfileId;
    if (!nextId) return;
    const cachedIdentity = queryClient.getQueryData(identityDetailQueryKey(nextId));
    const cachedAccounts = queryClient.getQueryData(identityAccountsQueryKey(nextId));
    if (cachedIdentity) {
      setIdentity(cachedIdentity);
      setLoading(false);
      if (Array.isArray(cachedAccounts)) setAccounts(cachedAccounts);
    } else {
      setLoading(true);
      setIdentity(null);
      setAccounts([]);
    }
  }, [managerProfileId, queryClient]);

  const handleAccountsRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: identityAccountsQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: identityDetailQueryKey(id) });
    return fetchIdentityData();
  }, [fetchIdentityData, id, queryClient]);

  const handlePhotoUpdated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: identityDetailQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: identityPostureQueryKey(id) });
    queryClient.fetchQuery({
      queryKey: identityDetailQueryKey(id),
      queryFn: () => fetchIdentityDetail(id),
      staleTime: 0,
    }).then((data) => {
      if (data) setIdentity(data);
    }).catch(() => {});
  }, [id, queryClient]);

  if (loading && !identity) {
    return (
      <Box sx={{ width: '100%', minHeight: 320, position: 'relative' }}>
        <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            pt: 10,
            pb: 6,
            px: 2,
          }}
        >
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary" align="center">
            Loading identity…
          </Typography>
          <Typography variant="caption" color="text.disabled" align="center" sx={{ maxWidth: 360 }}>
            Resolving linked application accounts may take a few seconds.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!identity) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Identity not found.</Typography>
      </Box>
    );
  }

  const tabId = catalogTabIdFromIndex(currentTab);
  const showMindmap = mountedHeavyTabs.has(TAB_MINDMAP);
  const showPosture = mountedHeavyTabs.has(TAB_POSTURE);
  const showPeers = mountedHeavyTabs.has(TAB_PEERS);
  const showSod = mountedHeavyTabs.has(TAB_SOD);
  const showCertifications = mountedHeavyTabs.has(TAB_CERTIFICATIONS);
  const showHygiene = mountedHeavyTabs.has(TAB_HYGIENE);
  const showPrivileges = mountedHeavyTabs.has(TAB_PRIVILEGES);

  return (
    <Box sx={catalogPageSx}>
      {identity && accountsLoading && !accounts.length ? (
        <LinearProgress
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 5,
            width: '100%',
            borderRadius: 1,
            mb: 1,
          }}
        />
      ) : null}

      <IdentityCatalogHeader
        identity={identity}
        accounts={accounts}
        bannerTitle={bannerTitle}
        managerLinkLabel={managerLinkLabel}
        managerProfileId={managerProfileId}
        onBack={() => navigate('/identities')}
        onManagerNavigate={beginManagerNavigation}
        onPhotoUpdated={handlePhotoUpdated}
      />

      <CatalogCurvedTabs
        value={currentTab}
        onChange={handleTabChange}
        tabs={[
          { id: 'overview', icon: <Person />, label: 'Overview' },
          { id: 'accounts', icon: <Apps />, label: `Accounts (${accounts.length})` },
          {
            id: 'mindmap',
            icon: <AccountTree />,
            label: 'Mind Map',
            onMouseEnter: () => prefetchHeavyTab(TAB_MINDMAP),
            onFocus: () => prefetchHeavyTab(TAB_MINDMAP),
          },
          {
            id: 'posture',
            icon: <FingerprintOutlined />,
            label: 'Identity Posture',
            onMouseEnter: () => prefetchHeavyTab(TAB_POSTURE),
            onFocus: () => prefetchHeavyTab(TAB_POSTURE),
          },
          { id: 'peers', icon: <CompareArrows />, label: 'Peer Comparison' },
          {
            id: 'sod',
            icon: <GavelOutlined />,
            label: <TabBadgeLabel label="SoD" count={sodBadgeCount} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_SOD),
            onFocus: () => prefetchHeavyTab(TAB_SOD),
          },
          {
            id: 'certifications',
            icon: <AssignmentTurnedInOutlined />,
            label: <TabBadgeLabel label="Certifications" count={certBadgeCount} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_CERTIFICATIONS),
            onFocus: () => prefetchHeavyTab(TAB_CERTIFICATIONS),
          },
          {
            id: 'hygiene',
            icon: <HealthAndSafetyOutlined />,
            label: <TabBadgeLabel label="Data Hygiene" count={hygieneBadgeCount} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_HYGIENE),
            onFocus: () => prefetchHeavyTab(TAB_HYGIENE),
          },
          {
            id: 'privileges',
            icon: <AdminPanelSettingsOutlined />,
            label: <TabBadgeLabel label="Privileged Entitlements" count={privilegesBadgeCount} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_PRIVILEGES),
            onFocus: () => prefetchHeavyTab(TAB_PRIVILEGES),
          },
        ]}
      />

      <Box
        sx={{
          bgcolor: CATALOG.surface,
          border: `1px solid ${CATALOG.border}`,
          borderRadius: '0 0 12px 12px',
          mt: '-1px',
          position: 'relative',
          zIndex: 1,
          px: { xs: 1.5, md: 2 },
          pt: 2.5,
          pb: 2,
        }}
      >
      <Box sx={{ display: tabId === CATALOG_TAB_IDS.OVERVIEW ? 'block' : 'none' }}>
        <OverviewHrTab
          identity={identity}
          accounts={accounts}
          mappedProfileFields={mappedProfileFields}
          managerProfileId={managerProfileId}
          onManagerNavigate={beginManagerNavigation}
        />
      </Box>

      <Box sx={{ display: tabId === CATALOG_TAB_IDS.ACCOUNTS ? 'block' : 'none' }}>
        <AccountsTab
          identityId={id}
          accounts={accounts}
          tenantId={tenantId}
          onRefresh={handleAccountsRefresh}
          showToast={showToast}
        />
      </Box>

      {showMindmap && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.MINDMAP ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <MindmapTab
              identityId={id}
              identityLabel={bannerTitle}
              hasUploadedPhoto={Boolean(identity?.profilePhotoId || identity?.profilePhotoUrl)}
            />
          </Suspense>
        </Box>
      )}

      {showPosture && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.POSTURE ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <PostureTab identityId={id} />
          </Suspense>
        </Box>
      )}

      {showPeers && tabId === CATALOG_TAB_IDS.PEERS && (
        <Suspense fallback={<TabFallback />}>
          <PeerComparisonTab identity={identity} />
        </Suspense>
      )}

      {showSod && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.SOD ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <SodTab identityId={id} />
          </Suspense>
        </Box>
      )}

      {showCertifications && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.CERTIFICATIONS ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <CertificationsTab identityId={id} />
          </Suspense>
        </Box>
      )}

      {showHygiene && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.HYGIENE ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <HygieneTab identityId={id} />
          </Suspense>
        </Box>
      )}

      {showPrivileges && (
        <Box sx={{ display: tabId === CATALOG_TAB_IDS.PRIVILEGES ? 'block' : 'none' }}>
          <Suspense fallback={<TabFallback />}>
            <PrivilegesTab identityId={id} />
          </Suspense>
        </Box>
      )}
      </Box>

      <Snackbar
        open={toast.open}
        autoHideDuration={6000}
        onClose={() => setToast({ ...toast, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setToast({ ...toast, open: false })} severity={toast.severity} variant="filled" sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
