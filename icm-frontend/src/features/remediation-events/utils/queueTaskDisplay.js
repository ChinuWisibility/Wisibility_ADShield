import { isManualPickup } from "./pipelinePickupUtils";

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function isObjectId(value) {
  return OBJECT_ID_RE.test(String(value || "").trim());
}

/** Parse REVOKE_ACCESS_<username> technical task name. */
export function parseRevokeAccessTaskName(taskName) {
  const raw = String(taskName || "").trim();
  const match = raw.match(/^REVOKE_ACCESS_(.+)$/i);
  return match ? match[1] : raw;
}

function humanizeToken(value) {
  return String(value || "")
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    || "";
}

/**
 * Best-effort display username for revoke tasks (never show raw Mongo ids when avoidable).
 */
export function resolveRevokeTaskUsername(task) {
  const candidates = [
    task?.context?.displayUsername,
    task?.context?.displayIdentityName,
    task?.username,
    task?.context?.nativeIdentity,
    task?.identityName,
  ];

  for (const c of candidates) {
    const s = String(c || "").trim();
    if (!s || isObjectId(s)) continue;
    if (s.includes("@")) return s.split("@")[0] || s;
    return s;
  }

  const email = String(task?.identityEmail || "").trim();
  if (email.includes("@")) {
    const local = email.split("@")[0];
    if (local && !isObjectId(local)) return local;
  }

  const fromName = humanizeToken(parseRevokeAccessTaskName(task?.taskName));
  if (fromName && !isObjectId(fromName)) return fromName;

  return "Unknown user";
}

/** Primary card title: "Revoke access · <username>" */
export function formatRevokeAccessTaskTitle(task) {
  const user = resolveRevokeTaskUsername(task);
  return `Revoke access · ${user}`;
}

/** Secondary line: application + entitlement */
export function formatRevokeAccessTaskContext(task) {
  const parts = [];
  if (task?.applicationName) parts.push(task.applicationName);
  if (task?.entitlementName) parts.push(task.entitlementName);
  return parts.length ? parts.join(" · ") : "Certification access revoke";
}

/** Technical queue name for audit / detail panel */
/** Parse IAM_ORPHAN_REVIEW_<account> technical task name. */
export function parseIamOrphanReviewTaskName(taskName) {
  const match = String(taskName || "").match(/^IAM_ORPHAN_REVIEW_(.+)$/i);
  return match ? match[1].replace(/_/g, " ") : String(taskName || "").trim();
}

export function resolveIamOrphanAccountName(task) {
  const candidates = [
    task?.identityName,
    task?.context?.accountName,
    task?.context?.displayAccountName,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s && !isObjectId(s)) return s;
  }
  const fromName = humanizeToken(parseIamOrphanReviewTaskName(task?.taskName));
  return fromName || "Unknown account";
}

export function formatIamOrphanReviewTaskTitle(task) {
  const account = resolveIamOrphanAccountName(task);
  return `IAM orphan review · ${account}`;
}

export function formatIamOrphanReviewTaskContext(task) {
  const parts = [];
  if (task?.applicationName) parts.push(task.applicationName);
  if (task?.context?.riskLevel) parts.push(`${task.context.riskLevel} risk`);
  return parts.length ? parts.join(" · ") : "Uncorrelated account";
}

export function formatIamOrphanReviewTechnicalName(task) {
  const account = resolveIamOrphanAccountName(task);
  if (account === "Unknown account") {
    return task?.taskName || "IAM_ORPHAN_REVIEW_unknown";
  }
  const safe = account.replace(/[^a-zA-Z0-9._@-]/g, "_").replace(/^@+/, "");
  return `IAM_ORPHAN_REVIEW_${safe || "unknown"}`;
}

export function formatRevokeAccessTechnicalName(task) {
  const user = resolveRevokeTaskUsername(task);
  if (user === "Unknown user") {
    return task?.taskName || "REVOKE_ACCESS_unknown";
  }
  const safe = user
    .replace(/[^a-zA-Z0-9._@-]/g, "_")
    .replace(/^@+/, "");
  return `REVOKE_ACCESS_${safe || "unknown"}`;
}

export const QUEUE_STATUS_META = {
  NEW: {
    label: "Queued",
    hint: "Waiting for remediation scheduler",
    className: "status-new",
  },
  IN_PROGRESS: {
    label: "Running",
    hint: "Workflow is executing",
    className: "status-running",
  },
  WAITING: {
    label: "Waiting",
    hint: "Workflow paused — monitoring ITSM ticket until closed",
    className: "status-waiting",
  },
  COMPLETED: {
    label: "Completed",
    hint: "Access revoke finished",
    className: "status-success",
  },
  FAILED: {
    label: "Failed",
    hint: "Remediation did not complete",
    className: "status-failed",
  },
  CANCELLED: {
    label: "Cancelled",
    hint: "Cancelled — access was not revoked",
    className: "status-cancelled",
  },
};

export function getQueueStatusMeta(status, variant = "access-revoke", task = null) {
  const base = QUEUE_STATUS_META[status] || QUEUE_STATUS_META.NEW;
  const manual = task && isManualPickup(task);
  const scheduler = task?.schedulerContext;

  if (variant !== "iam-orphan-review") {
    if (manual && status === "IN_PROGRESS") {
      return { ...base, hint: "Manual launch started workflow" };
    }
    if (manual && status === "WAITING") {
      return { ...base, hint: "Manual launch — workflow paused awaiting external step" };
    }
    if (status === "NEW" && scheduler?.pendingPickup) {
      return { ...base, hint: "Queued — scheduler ran but did not pick up this task" };
    }
    return base;
  }

  const iamHints = {
    NEW: scheduler?.pendingPickup
      ? "Queued — scheduler ran but did not pick up this task"
      : "Queued — scheduler will pick up",
    IN_PROGRESS: manual ? "Manual launch started workflow" : "Scheduler started workflow",
    WAITING: manual
      ? "Manual launch — awaiting IAM decision · reminders on schedule"
      : "Awaiting IAM decision · reminders on schedule",
    COMPLETED: "IAM decision recorded",
    FAILED: "Workflow did not complete",
  };
  return { ...base, hint: iamHints[status] || base.hint };
}

export function formatQueueDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
