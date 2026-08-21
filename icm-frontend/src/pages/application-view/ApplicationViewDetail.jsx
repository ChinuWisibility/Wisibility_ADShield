import React, {
  useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense,
} from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, CircularProgress, LinearProgress, Snackbar, Alert,
} from '@mui/material';
import {
  DashboardOutlined, PeopleAltOutlined, VpnKeyOutlined, AccountTree,
  GavelOutlined, LinkOutlined, HealthAndSafetyOutlined, VerifiedUserOutlined,
  SecurityOutlined, HistoryOutlined,
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  appViewTabIdFromIndex,
  appViewTabIndexFromQuery,
  APP_VIEW_TAB_IDS,
} from './catalog/applicationViewTabs';
import {
  catalogPageSx,
  CATALOG,
} from '../identities/catalog/catalogTheme';
import CatalogCurvedTabs from '../identities/catalog/CatalogCurvedTabs';
import {
  fetchApplicationViewDetail,
  fetchApplicationViewSummary,
  applicationViewDetailQueryKey,
  applicationViewSummaryQueryKey,
  APP_VIEW_DETAIL_STALE_MS,
  APP_VIEW_INSIGHT_STALE_MS,
  prefetchApplicationViewSod,
  prefetchApplicationViewCorrelation,
  prefetchApplicationViewHygiene,
  prefetchApplicationViewCertifications,
} from './catalog/applicationViewQueries';
import ApplicationViewHeader from './catalog/ApplicationViewHeader';
import OverviewTab from './catalog/OverviewTab';
import UsersTab from './catalog/UsersTab';
import EntitlementsTab from './catalog/EntitlementsTab';

const AccessGraphTab = lazy(() => import('./catalog/AccessGraphTab'));
const SodTab = lazy(() => import('./catalog/SodTab'));
const CorrelationTab = lazy(() => import('./catalog/CorrelationTab'));
const HygieneTab = lazy(() => import('./catalog/HygieneTab'));
const CertificationsTab = lazy(() => import('./catalog/CertificationsTab'));
const RiskComplianceTab = lazy(() => import('./catalog/RiskComplianceTab'));
const ActivityTab = lazy(() => import('./catalog/ActivityTab'));

const TAB_ACCESS_GRAPH = 3;
const TAB_SOD = 4;
const TAB_CORRELATION = 5;
const TAB_HYGIENE = 6;
const TAB_CERTIFICATIONS = 7;
const TAB_RISK_COMPLIANCE = 8;
const TAB_ACTIVITY = 9;

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

export default function ApplicationViewDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = typeof user?.tenantId === 'object' ? user?.tenantId?._id : user?.tenantId;

  const [application, setApplication] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState(() => appViewTabIndexFromQuery(searchParams.get('tab')));
  const [toast, setToast] = useState({ open: false, message: '', severity: 'success' });
  const [mountedHeavyTabs, setMountedHeavyTabs] = useState(() => {
    const initial = appViewTabIndexFromQuery(searchParams.get('tab'));
    return new Set(initial >= TAB_ACCESS_GRAPH ? [initial] : []);
  });

  const loadSeqRef = useRef(0);
  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });

  useLayoutEffect(() => {
    if (!id) return;
    const cached = queryClient.getQueryData(applicationViewDetailQueryKey(id));
    if (cached) {
      setApplication(cached);
      setLoading(false);
    } else {
      setLoading(true);
      setApplication(null);
    }
  }, [id, queryClient]);

  const summaryQuery = useQuery({
    queryKey: applicationViewSummaryQueryKey(id),
    queryFn: () => fetchApplicationViewSummary(id),
    enabled: Boolean(id && application),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });

  const summary = summaryQuery.data;
  const sodBadge = summary?.openSodViolations || 0;
  const hygieneBadge = (Number(summary?.openOrphans) || 0) + (Number(summary?.duplicateAccounts) || 0);

  useEffect(() => {
    setCurrentTab(appViewTabIndexFromQuery(searchParams.get('tab')));
  }, [searchParams, id]);

  useEffect(() => {
    const initial = appViewTabIndexFromQuery(searchParams.get('tab'));
    setMountedHeavyTabs(new Set(initial >= TAB_ACCESS_GRAPH ? [initial] : []));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentTab < TAB_ACCESS_GRAPH) return;
    setMountedHeavyTabs((prev) => {
      if (prev.has(currentTab)) return prev;
      const next = new Set(prev);
      next.add(currentTab);
      return next;
    });
  }, [currentTab]);

  const prefetchHeavyTab = useCallback((tabIndex) => {
    if (!id) return;
    if (tabIndex === TAB_SOD) prefetchApplicationViewSod(queryClient, id);
    if (tabIndex === TAB_CORRELATION) prefetchApplicationViewCorrelation(queryClient, id, tenantId);
    if (tabIndex === TAB_HYGIENE) prefetchApplicationViewHygiene(queryClient, id);
    if (tabIndex === TAB_CERTIFICATIONS) prefetchApplicationViewCertifications(queryClient, id);
  }, [id, queryClient, tenantId]);

  const handleTabChange = (_e, val) => {
    setCurrentTab(val);
    prefetchHeavyTab(val);
    const tabId = appViewTabIdFromIndex(val);
    const next = new URLSearchParams(searchParams);
    if (tabId === APP_VIEW_TAB_IDS.OVERVIEW) next.delete('tab');
    else next.set('tab', tabId);
    setSearchParams(next, { replace: true });
  };

  const fetchApp = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const cached = queryClient.getQueryData(applicationViewDetailQueryKey(id));
    if (cached) {
      setApplication(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const data = await queryClient.fetchQuery({
        queryKey: applicationViewDetailQueryKey(id),
        queryFn: () => fetchApplicationViewDetail(id),
        staleTime: APP_VIEW_DETAIL_STALE_MS,
      });
      if (seq !== loadSeqRef.current) return;
      if (!data) {
        setApplication(null);
        showToast('Application not found', 'error');
        return;
      }
      setApplication(data);
    } catch (err) {
      if (seq !== loadSeqRef.current) return;
      console.error(err);
      showToast('Failed to load application', 'error');
      if (!cached) setApplication(null);
    } finally {
      if (seq === loadSeqRef.current) setLoading(false);
    }
  }, [id, queryClient]);

  useEffect(() => {
    fetchApp();
  }, [fetchApp]);

  useEffect(() => {
    if (!id || !application) return;
    if (currentTab === TAB_SOD) prefetchApplicationViewSod(queryClient, id);
    if (currentTab === TAB_CORRELATION) prefetchApplicationViewCorrelation(queryClient, id, tenantId);
    if (currentTab === TAB_HYGIENE) prefetchApplicationViewHygiene(queryClient, id);
    if (currentTab === TAB_CERTIFICATIONS) prefetchApplicationViewCertifications(queryClient, id);
  }, [id, application, currentTab, queryClient, tenantId]);

  if (loading && !application) {
    return (
      <Box sx={{ width: '100%', minHeight: 320, position: 'relative' }}>
        <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, pt: 10, pb: 6 }}>
          <CircularProgress size={40} />
          <Typography variant="body2" color="text.secondary">Loading application…</Typography>
        </Box>
      </Box>
    );
  }

  if (!application) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="error">Application not found.</Typography>
      </Box>
    );
  }

  const tabId = appViewTabIdFromIndex(currentTab);
  const showAccessGraph = mountedHeavyTabs.has(TAB_ACCESS_GRAPH);
  const showSod = mountedHeavyTabs.has(TAB_SOD);
  const showCorrelation = mountedHeavyTabs.has(TAB_CORRELATION);
  const showHygiene = mountedHeavyTabs.has(TAB_HYGIENE);
  const showCertifications = mountedHeavyTabs.has(TAB_CERTIFICATIONS);
  const showRiskCompliance = mountedHeavyTabs.has(TAB_RISK_COMPLIANCE);
  const showActivity = mountedHeavyTabs.has(TAB_ACTIVITY);
  const userCount = summary?.users ?? application.totalUsers;

  return (
    <Box sx={catalogPageSx}>
      <ApplicationViewHeader
        application={application}
        summary={summary}
        onBack={() => navigate('/application-view')}
      />

      <CatalogCurvedTabs
        value={currentTab}
        onChange={handleTabChange}
        tabs={[
          { id: 'overview', icon: <DashboardOutlined />, label: 'Overview' },
          {
            id: 'users',
            icon: <PeopleAltOutlined />,
            label: userCount != null ? `Users (${Number(userCount).toLocaleString()})` : 'Users',
          },
          {
            id: 'entitlements',
            icon: <VpnKeyOutlined />,
            label: summary?.entitlements != null
              ? `Entitlements (${Number(summary.entitlements).toLocaleString()})`
              : 'Entitlements',
          },
          {
            id: 'accessgraph',
            icon: <AccountTree />,
            label: 'Access Graph',
            onMouseEnter: () => prefetchHeavyTab(TAB_ACCESS_GRAPH),
          },
          {
            id: 'sod',
            icon: <GavelOutlined />,
            label: <TabBadgeLabel label="SoD & Policies" count={sodBadge} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_SOD),
            onFocus: () => prefetchHeavyTab(TAB_SOD),
          },
          {
            id: 'correlation',
            icon: <LinkOutlined />,
            label: 'Correlation',
            onMouseEnter: () => prefetchHeavyTab(TAB_CORRELATION),
            onFocus: () => prefetchHeavyTab(TAB_CORRELATION),
          },
          {
            id: 'hygiene',
            icon: <HealthAndSafetyOutlined />,
            label: <TabBadgeLabel label="Data Hygiene" count={hygieneBadge} />,
            onMouseEnter: () => prefetchHeavyTab(TAB_HYGIENE),
            onFocus: () => prefetchHeavyTab(TAB_HYGIENE),
          },
          {
            id: 'certifications',
            icon: <VerifiedUserOutlined />,
            label: 'Certifications',
            onMouseEnter: () => prefetchHeavyTab(TAB_CERTIFICATIONS),
            onFocus: () => prefetchHeavyTab(TAB_CERTIFICATIONS),
          },
          {
            id: 'risk-compliance',
            icon: <SecurityOutlined />,
            label: 'Risk & Compliance',
          },
          {
            id: 'activity',
            icon: <HistoryOutlined />,
            label: 'Activity & Audit',
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
        {tabId === APP_VIEW_TAB_IDS.OVERVIEW ? (
          <OverviewTab
            application={application}
            summary={summary}
            summaryLoading={summaryQuery.isPending}
            summaryError={summaryQuery.error}
            onRetrySummary={() => summaryQuery.refetch()}
          />
        ) : null}

        <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.USERS ? 'block' : 'none' }}>
          <UsersTab applicationId={id} />
        </Box>

        <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.ENTITLEMENTS ? 'block' : 'none' }}>
          <EntitlementsTab applicationId={id} summary={summary} />
        </Box>

        {showAccessGraph && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.ACCESS_GRAPH ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <AccessGraphTab applicationId={id} application={application} />
            </Suspense>
          </Box>
        )}

        {showSod && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.SOD ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <SodTab applicationId={id} />
            </Suspense>
          </Box>
        )}

        {showCorrelation && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.CORRELATION ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <CorrelationTab applicationId={id} />
            </Suspense>
          </Box>
        )}

        {showHygiene && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.HYGIENE ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <HygieneTab applicationId={id} />
            </Suspense>
          </Box>
        )}

        {showCertifications && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.CERTIFICATIONS ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <CertificationsTab applicationId={id} />
            </Suspense>
          </Box>
        )}

        {showRiskCompliance && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.RISK_COMPLIANCE ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <RiskComplianceTab applicationId={id} application={application} />
            </Suspense>
          </Box>
        )}

        {showActivity && (
          <Box sx={{ display: tabId === APP_VIEW_TAB_IDS.ACTIVITY ? 'block' : 'none' }}>
            <Suspense fallback={<TabFallback />}>
              <ActivityTab applicationId={id} />
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
