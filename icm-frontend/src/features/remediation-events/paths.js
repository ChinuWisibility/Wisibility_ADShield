export const REMEDIATION_EVENTS_BASE = "/governance/remediation-events";

export function remediationEventsPath(slug = "", params = {}) {
  const base = slug ? `${REMEDIATION_EVENTS_BASE}/${String(slug).replace(/^\//, "")}` : REMEDIATION_EVENTS_BASE;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `${base}?${query}` : base;
}

export function accessRevokeTaskPath(taskId) {
  if (!taskId) return `${REMEDIATION_EVENTS_BASE}/access-revoke`;
  return `${REMEDIATION_EVENTS_BASE}/access-revoke/${encodeURIComponent(taskId)}`;
}

export const ACCESS_REVOKE_LIST_PATH = `${REMEDIATION_EVENTS_BASE}/access-revoke`;

export function iamOrphanReviewTaskPath(taskId) {
  if (!taskId) return `${REMEDIATION_EVENTS_BASE}/iam-orphan-review`;
  return `${REMEDIATION_EVENTS_BASE}/iam-orphan-review/${encodeURIComponent(taskId)}`;
}

export const IAM_ORPHAN_REVIEW_LIST_PATH = `${REMEDIATION_EVENTS_BASE}/iam-orphan-review`;
