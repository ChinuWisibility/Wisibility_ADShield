export const WORKFLOW_REMEDIATION_QUEUE_BASE = "/governance/workflows/remediation-queue";

export function workflowRemediationQueuePath(slug, params = {}) {
  const base = slug
    ? `${WORKFLOW_REMEDIATION_QUEUE_BASE}/${slug}`
    : WORKFLOW_REMEDIATION_QUEUE_BASE;
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") qs.set(k, String(v));
  });
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}
