export const IN_FLIGHT = new Set(["PENDING", "RUNNING", "WAITING_ITSM", "WAITING_VERIFICATION", "WAITING"]);

export const STATUS_META = {
  SUCCESS: { label: "Completed", className: "status-success", tone: "success" },
  COMPLETED: { label: "Completed", className: "status-success", tone: "success" },
  CANCELLED: { label: "Cancelled", className: "status-skipped", tone: "skipped" },
  FAILED: { label: "Failed", className: "status-failed", tone: "failed" },
  RUNNING: { label: "Running", className: "status-running", tone: "running" },
  PENDING: { label: "Queued", className: "status-running", tone: "running" },
  WAITING_ITSM: { label: "In progress", className: "status-waiting", tone: "waiting" },
  WAITING_VERIFICATION: { label: "In progress", className: "status-waiting", tone: "waiting" },
  WAITING: { label: "Awaiting IAM", className: "status-waiting", tone: "waiting" },
  SKIPPED: { label: "Skipped", className: "status-skipped", tone: "skipped" },
};

export const WAIT_REASON_LABEL = {
  PROVISIONING: "Awaiting provisioning",
  ITSM: "Awaiting ITSM ticket closure",
  VERIFICATION: "Awaiting scheduled re-verification",
  IAM_DECISION: "Awaiting IAM decision · reminders scheduled",
};

export const STATUS_FILTERS = [
  { id: "all", label: "All events" },
  { id: "active", label: "In progress" },
  { id: "COMPLETED", label: "Completed" },
  { id: "FAILED", label: "Failed" },
];

export const REMEDIATION_EVENT_TYPES = [
  {
    slug: "iam-orphan-review",
    eventType: "IAM_ORPHAN_REVIEW",
    aliases: ["IAM_ORPHAN_REVIEW"],
    title: "IAM Orphan Review",
    badge: "IAM ORPHAN REVIEW",
    description: "Uncorrelated account IAM decision workflows and reminders",
    accent: "amber",
  },
  {
    slug: "access-revoke",
    eventType: "ACCESS_REVOKE",
    aliases: ["ACCESS_REVOKE", "REVOKE_ACCESS"],
    title: "Access Revoke",
    badge: "ACCESS REVOKE",
    description: "Certification access revoke workflow runs",
    accent: "green",
  },
  {
    slug: "missing-manager",
    eventType: "MISSING_MANAGER",
    aliases: ["MISSING_MANAGER"],
    title: "Missing Manager",
    badge: "MISSING MANAGER",
    description: "Identity quality — users without an assigned manager",
    accent: "amber",
  },
  {
    slug: "orphan-accounts",
    eventType: "ORPHAN_ACCOUNT",
    aliases: ["ORPHAN_ACCOUNT", "ORPHAN_ACCOUNTS"],
    title: "Orphan Accounts",
    badge: "ORPHAN ACCOUNTS",
    description: "Correlation engine — accounts without an owner identity",
    accent: "purple",
  },
  {
    slug: "dormant-accounts",
    eventType: "DORMANT_ACCOUNT",
    aliases: ["DORMANT_ACCOUNT", "INACTIVE_USER_ACCESS", "INACTIVE_USER"],
    title: "Dormant Accounts",
    badge: "DORMANT ACCOUNTS",
    description: "Access analytics — inactive or dormant user access",
    accent: "teal",
  },
  {
    slug: "sod-violations",
    eventType: "SOD_VIOLATION",
    aliases: ["SOD_VIOLATION", "SOD_VIOLATIONS"],
    title: "SoD Violations",
    badge: "SOD VIOLATIONS",
    description: "Segregation of duties policy violation remediation",
    accent: "red",
  },
];

export function getEventTypeBySlug(slug) {
  return REMEDIATION_EVENT_TYPES.find((t) => t.slug === slug) || null;
}

export function matchesEventType(exec, config) {
  if (!config) return false;
  const value = String(exec?.eventType || "ACCESS_REVOKE").toUpperCase();
  return (config.aliases || [config.eventType]).includes(value);
}

export function computeStats(executions) {
  return {
    total: executions.length,
    inProgress: executions.filter((e) => IN_FLIGHT.has(e.status)).length,
    completed: executions.filter((e) => e.status === "COMPLETED").length,
    failed: executions.filter((e) => e.status === "FAILED").length,
  };
}
