import { applicationAPI, correlationAPI, auditAPI, activityAPI, dataHygieneAPI } from '../../../services/api';
import { sodAPI } from '../../../services/sodService';

const MANAGER_ATTR_DEFAULT = 'manager_id';

export const APP_VIEW_DETAIL_STALE_MS = 60_000;
export const APP_VIEW_INSIGHT_STALE_MS = 90_000;

export function applicationViewDetailQueryKey(id) {
  return ['application-view', 'detail', String(id || '')];
}

export function applicationViewSummaryQueryKey(id) {
  return ['application-view', 'summary', String(id || '')];
}

export function applicationViewUsersQueryKey(id, params = {}) {
  return ['application-view', 'users', String(id || ''), params];
}

export function applicationViewEntitlementsQueryKey(id, params = {}) {
  return ['application-view', 'entitlements', String(id || ''), params];
}

export function applicationViewSodQueryKey(id) {
  return ['application-view', 'sod', String(id || '')];
}

export function applicationViewHygieneQueryKey(id) {
  return ['application-view', 'hygiene', String(id || '')];
}

export function applicationViewHygieneWidgetItemsQueryKey(id, widgetId, params = {}) {
  return ['application-view', 'hygiene-items', String(id || ''), String(widgetId || ''), params];
}

export function applicationViewCorrelationQueryKey(id, tenantId) {
  return ['application-view', 'correlation', String(id || ''), String(tenantId || '')];
}

export function applicationViewCorrelatedAccountsQueryKey(id, tenantId, params = {}) {
  return ['application-view', 'correlated-accounts', String(id || ''), String(tenantId || ''), params];
}

export function applicationViewDuplicatesQueryKey(id, params = {}) {
  return ['application-view', 'duplicates', String(id || ''), params];
}

export function applicationViewOrphanQueueQueryKey(id) {
  return ['application-view', 'orphan-queue', String(id || '')];
}

export function applicationViewManagerCorrelationQueryKey(id) {
  return ['application-view', 'manager-correlation', String(id || '')];
}

export function applicationViewEntitlementUsersQueryKey(id, entitlementId, params = {}) {
  return ['application-view', 'entitlement-users', String(id || ''), String(entitlementId || ''), params];
}

export function applicationViewRiskProfileQueryKey(id) {
  return ['application-view', 'risk-profile', String(id || '')];
}

export function applicationViewCertificationsQueryKey(id) {
  return ['application-view', 'certifications', String(id || '')];
}

export function applicationViewActivityQueryKey(id) {
  return ['application-view', 'activity', String(id || '')];
}

export async function fetchApplicationViewDetail(id) {
  const res = await applicationAPI.getById(id);
  return res?.data?.data || res?.data || null;
}

export async function fetchApplicationViewSummary(id) {
  const res = await applicationAPI.getViewSummary(id);
  return res?.data?.data || res?.data || null;
}

export async function fetchApplicationViewUsers(id, params = {}) {
  const res = await applicationAPI.getUsers(id, params);
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    page: res?.data?.page ?? 0,
    limit: res?.data?.limit ?? params.limit ?? 25,
    totalPages: res?.data?.totalPages ?? 0,
  };
}

export async function fetchApplicationViewEntitlements(id, params = {}) {
  const res = await applicationAPI.getEntitlements(id, params);
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    page: res?.data?.page ?? 0,
    limit: res?.data?.limit ?? params.limit ?? 25,
    totalPages: res?.data?.totalPages ?? 0,
  };
}

export async function fetchApplicationViewSod(id) {
  try {
    const res = await applicationAPI.getSod(id);
    return res?.data?.data || res?.data || null;
  } catch {
    // Fallback: compose from certification helpers
    const polRes = await sodAPI.getPoliciesByApplication(id);
    const policies = polRes?.data?.data?.policies || polRes?.data?.policies || [];
    const policyIds = policies.map((p) => p._id).filter(Boolean);
    let violations = [];
    if (policyIds.length) {
      const vRes = await sodAPI.getViolationsForCertification(policyIds);
      violations = vRes?.data?.data || vRes?.data || [];
    }
    const open = violations.filter((v) => v.status === 'open');
    return {
      policies: policies.map((p) => ({
        ...p,
        deepLink: `/governance/sod-policies/${p._id}`,
      })),
      violations,
      summary: {
        policyCount: policies.length,
        openCount: open.length,
        criticalHigh: open.filter((v) =>
          ['CRITICAL', 'HIGH'].includes(String(v.severity || '').toUpperCase()),
        ).length,
        exceptionCount: violations.filter((v) => v.status === 'exception_granted').length,
        totalCount: violations.length,
      },
      deepLink: '/governance/sod-violations',
    };
  }
}

export async function fetchApplicationViewCorrelation(id, tenantId) {
  const [corrRes, orphansIso] = await Promise.allSettled([
    applicationAPI.getAppEntitlementCorrelations(id, { page: 0, limit: 50 }),
    correlationAPI.getOrphansIsoSummary(id).catch(() => null),
  ]);

  const entitlements =
    corrRes.status === 'fulfilled'
      ? corrRes.value?.data?.data || []
      : [];
  const corrTotal =
    corrRes.status === 'fulfilled' ? corrRes.value?.data?.total ?? entitlements.length : 0;

  const orphanSummary =
    orphansIso.status === 'fulfilled'
      ? orphansIso.value?.data?.data || orphansIso.value?.data || null
      : null;

  return {
    entitlementCorrelations: entitlements,
    entitlementCorrelationTotal: corrTotal,
    orphanSummary,
    deepLink: `/identities/accounts/correlated?applicationId=${id}`,
  };
}

export async function fetchApplicationViewCorrelatedAccounts(id, tenantId, params = {}) {
  if (!tenantId) {
    return { data: [], total: 0, page: 0, limit: params.limit ?? 25 };
  }
  const page = Number(params.page) || 0;
  const limit = Math.min(100, Math.max(1, Number(params.limit) || 25));
  const res = await correlationAPI.getCorrelatedAccounts({
    applicationId: id,
    tenantId,
    page,
    limit,
    ...(params.q ? { q: params.q } : {}),
  });
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    page: res?.data?.page ?? page,
    limit: res?.data?.limit ?? limit,
    deepLink: `/identities/accounts/correlated?applicationId=${id}`,
  };
}

export async function fetchApplicationViewDuplicates(id, params = {}) {
  const res = await applicationAPI.listUserDuplicates(id, params);
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    page: res?.data?.page ?? 0,
    limit: res?.data?.limit ?? params.limit ?? 50,
    deepLink: '/identities/accounts/duplicates',
  };
}

export async function fetchApplicationViewOrphanQueue(id) {
  const res = await correlationAPI.getOrphansIsoFull(id, {});
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    deepLink: `/identities/accounts/uncorrelated?applicationId=${id}`,
  };
}

export async function fetchApplicationViewHygiene(id) {
  const [summaryRes, orphanRes] = await Promise.allSettled([
    dataHygieneAPI.getSummary({}),
    correlationAPI.getOrphansIsoSummary(id).catch(() => null),
  ]);

  const summary =
    summaryRes.status === 'fulfilled'
      ? summaryRes.value?.data?.data || summaryRes.value?.data || null
      : null;
  const tiles = summary?.applicationTiles || [];
  const tile = tiles.find((t) => String(t.applicationId) === String(id)) || null;
  const rows = tile?.rows || [];
  const totalFindings = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);

  const orphanSummary =
    orphanRes.status === 'fulfilled'
      ? orphanRes.value?.data?.data || orphanRes.value?.data || null
      : null;

  return {
    tile,
    rows,
    summary: {
      totalFindings,
      title: tile?.title || 'Application hygiene',
      openOrphans: orphanSummary?.totals?.open
        ?? orphanSummary?.open
        ?? orphanSummary?.totalOpen
        ?? null,
    },
    orphanSummary,
    deepLink: `/datahygine/application/${id}`,
  };
}

export async function fetchApplicationViewHygieneWidgetItems(applicationId, widgetId, params = {}) {
  const page = Number(params.page) || 0;
  const limit = Number(params.limit) || 25;
  const res = await dataHygieneAPI.getWidgetItems({
    widget: widgetId,
    applicationId,
    page: page + 1,
    limit,
    ...(params.search ? { q: params.search } : {}),
  });
  const payload = res?.data?.data || res?.data || {};
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    total: Number(payload.total) || 0,
    page,
    limit,
    applicationLabel: payload.applicationLabel || null,
    deepLink: `/datahygine/${encodeURIComponent(widgetId)}?applicationId=${encodeURIComponent(applicationId)}&dashboardView=application`,
  };
}

export async function fetchApplicationViewEntitlementUsers(id, entitlementId, params = {}) {
  const res = await applicationAPI.getCorrelationEntitlementUsers(id, {
    entitlementId,
    page: params.page ?? 0,
    limit: params.limit ?? 50,
    ...(params.search ? { search: params.search } : {}),
  });
  return {
    data: res?.data?.data || [],
    total: res?.data?.total ?? 0,
    page: res?.data?.page ?? 0,
    limit: res?.data?.limit ?? params.limit ?? 50,
  };
}

export async function fetchApplicationViewManagerCorrelation(id) {
  const [facetsRes, groupsRes] = await Promise.allSettled([
    applicationAPI.getManagerCorrelationFacets(id, { managerAttr: MANAGER_ATTR_DEFAULT }),
    applicationAPI.getManagerCorrelationGroups(id, { managerAttr: MANAGER_ATTR_DEFAULT, page: 0, limit: 25 }),
  ]);

  const facets =
    facetsRes.status === 'fulfilled'
      ? facetsRes.value?.data?.data || null
      : null;
  const groupsBody =
    groupsRes.status === 'fulfilled'
      ? groupsRes.value?.data || null
      : null;

  return {
    configured: facetsRes.status === 'fulfilled',
    facets,
    groups: groupsBody?.data || [],
    groupsTotal: groupsBody?.total ?? 0,
    managerAttr: MANAGER_ATTR_DEFAULT,
  };
}

export async function fetchApplicationViewCertifications(id) {
  const res = await applicationAPI.getCertifications(id);
  return res?.data?.data || null;
}

function actorLabel(row) {
  const u = row?.userId;
  if (u && typeof u === 'object') {
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
    return name || u.email || row.userEmail || 'System';
  }
  return row?.userEmail || 'System';
}

export async function fetchApplicationViewActivity(id) {
  const [auditRes, activityRes] = await Promise.allSettled([
    auditAPI.getByEntity('Application', id).catch(() => null),
    activityAPI.getEntityActivity(id, { limit: 100 }).catch(() => null),
  ]);

  const auditRows = auditRes.status === 'fulfilled' ? (auditRes.value?.data?.data || []) : [];
  const activityRows = activityRes.status === 'fulfilled'
    ? (activityRes.value?.data?.data?.items || [])
    : [];

  const merged = [
    ...auditRows.map((row) => ({
      id: `audit-${row._id}`,
      source: 'Audit',
      title: row.action || 'Action',
      actor: actorLabel(row),
      timestamp: row.createdAt,
    })),
    ...activityRows.map((row) => ({
      id: `activity-${row._id}`,
      source: 'Activity',
      title: row.description || row.type || 'Activity',
      actor: actorLabel(row),
      timestamp: row.createdAt,
    })),
  ].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

  return { items: merged };
}

export async function fetchApplicationViewRiskProfile(id) {
  const res = await applicationAPI.getRiskProfiles({ applicationId: id, limit: 1 });
  const payload = res?.data?.data;
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.items)
      ? payload.items
      : [];
  return items[0] || null;
}

export function prefetchApplicationViewShell(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: applicationViewDetailQueryKey(id),
    queryFn: () => fetchApplicationViewDetail(id),
    staleTime: APP_VIEW_DETAIL_STALE_MS,
  });
  queryClient.prefetchQuery({
    queryKey: applicationViewSummaryQueryKey(id),
    queryFn: () => fetchApplicationViewSummary(id),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
}

export function prefetchApplicationViewSod(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: applicationViewSodQueryKey(id),
    queryFn: () => fetchApplicationViewSod(id),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
}

export function prefetchApplicationViewHygiene(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: applicationViewHygieneQueryKey(id),
    queryFn: () => fetchApplicationViewHygiene(id),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
}

export function prefetchApplicationViewCorrelation(queryClient, id, tenantId) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: applicationViewCorrelationQueryKey(id, tenantId),
    queryFn: () => fetchApplicationViewCorrelation(id, tenantId),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
}

export function prefetchApplicationViewCertifications(queryClient, id) {
  if (!id || !queryClient) return;
  queryClient.prefetchQuery({
    queryKey: applicationViewCertificationsQueryKey(id),
    queryFn: () => fetchApplicationViewCertifications(id),
    staleTime: APP_VIEW_INSIGHT_STALE_MS,
  });
}
