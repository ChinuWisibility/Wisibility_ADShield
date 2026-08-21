/**
 * Shared react-query keys + fetchers for expensive identity catalog payloads.
 * Used by mindmap/posture/sod/cert/hygiene panels and catalog prefetch.
 */

import { identityAPI } from '../../../services/api';

export const IDENTITY_GRAPH_STALE_MS = 5 * 60_000;
export const IDENTITY_POSTURE_STALE_MS = 5 * 60_000;
export const IDENTITY_DETAIL_STALE_MS = 60_000;
export const IDENTITY_INSIGHT_STALE_MS = 5 * 60_000;

export const identityDetailQueryKey = (id) => ['identity', String(id)];
export const identityAccountsQueryKey = (id) => ['identity-accounts', String(id)];
export const identityGraphQueryKey = (id) => ['identity-graph', String(id)];
export const identityPostureQueryKey = (id) => ['identity-posture', String(id)];
export const identitySodQueryKey = (id) => ['identity-sod', String(id)];
export const identityCertificationsQueryKey = (id) => ['identity-certifications', String(id)];
export const identityHygieneQueryKey = (id) => ['identity-hygiene', String(id)];
export const identityPrivilegesQueryKey = (id) => ['identity-privileges', String(id)];

export async function fetchIdentityDetail(id) {
  const res = await identityAPI.getById(id);
  return res.data?.data ?? null;
}

export async function fetchIdentityAccounts(id) {
  const res = await identityAPI.getAccounts(id);
  return res.data?.data || [];
}

export async function fetchIdentityGraph(id) {
  const res = await identityAPI.getGraph(id);
  const treeData = res.data?.data;
  if (!treeData) {
    throw new Error('No graph data returned from server.');
  }
  return treeData;
}

export async function fetchIdentityPosture(id) {
  const res = await identityAPI.getPosture(id);
  return res.data?.data || null;
}

export async function fetchIdentitySod(id) {
  const res = await identityAPI.getSod(id);
  return res.data?.data || null;
}

export async function fetchIdentityCertifications(id) {
  const res = await identityAPI.getCertifications(id);
  return res.data?.data || null;
}

export async function fetchIdentityHygiene(id) {
  const res = await identityAPI.getHygiene(id);
  return res.data?.data || null;
}

export async function fetchIdentityPrivileges(id) {
  const res = await identityAPI.getPrivileges(id);
  return res.data?.data || null;
}

export function prefetchIdentityGraph(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identityGraphQueryKey(id),
    queryFn: () => fetchIdentityGraph(id),
    staleTime: IDENTITY_GRAPH_STALE_MS,
  });
}

export function prefetchIdentityPosture(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identityPostureQueryKey(id),
    queryFn: () => fetchIdentityPosture(id),
    staleTime: IDENTITY_POSTURE_STALE_MS,
  });
}

export function prefetchIdentitySod(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identitySodQueryKey(id),
    queryFn: () => fetchIdentitySod(id),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
}

export function prefetchIdentityCertifications(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identityCertificationsQueryKey(id),
    queryFn: () => fetchIdentityCertifications(id),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
}

export function prefetchIdentityHygiene(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identityHygieneQueryKey(id),
    queryFn: () => fetchIdentityHygiene(id),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
}

export function prefetchIdentityPrivileges(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return queryClient.prefetchQuery({
    queryKey: identityPrivilegesQueryKey(id),
    queryFn: () => fetchIdentityPrivileges(id),
    staleTime: IDENTITY_INSIGHT_STALE_MS,
  });
}

export function prefetchIdentityCatalogShell(queryClient, id) {
  if (!id || !queryClient) return undefined;
  return Promise.all([
    queryClient.prefetchQuery({
      queryKey: identityDetailQueryKey(id),
      queryFn: () => fetchIdentityDetail(id),
      staleTime: IDENTITY_DETAIL_STALE_MS,
    }),
    queryClient.prefetchQuery({
      queryKey: identityAccountsQueryKey(id),
      queryFn: () => fetchIdentityAccounts(id),
      staleTime: IDENTITY_DETAIL_STALE_MS,
    }),
  ]);
}
