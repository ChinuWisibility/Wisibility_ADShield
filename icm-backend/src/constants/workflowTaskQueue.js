export const WORKFLOW_TASK_ACTIONS = {
  ACCESS_REVOKE: "ACCESS_REVOKE",
  IAM_ORPHAN_REVIEW: "IAM_ORPHAN_REVIEW",
  JOINER: "JOINER",
};

export const WORKFLOW_TASK_STATUS = {
  NEW: "NEW",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING: "WAITING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

export const OPEN_TASK_STATUSES = [
  WORKFLOW_TASK_STATUS.NEW,
  WORKFLOW_TASK_STATUS.IN_PROGRESS,
  WORKFLOW_TASK_STATUS.WAITING,
];

export function buildRevokeAccessTaskName(username) {
  const safe = String(username || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._@-]/g, "_")
    .replace(/^@+/, "")
    || "unknown";
  return `REVOKE_ACCESS_${safe}`;
}

export function buildIamOrphanReviewTaskName(accountName) {
  const safe = String(accountName || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._@-]/g, "_")
    .replace(/^@+/, "")
    || "unknown";
  return `IAM_ORPHAN_REVIEW_${safe}`;
}
