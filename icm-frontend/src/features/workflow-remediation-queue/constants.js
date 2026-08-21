export const QUEUE_STATUS_META = {
  PENDING: { label: "Pending", className: "status-running", tone: "running" },
  WITH_TICKET: { label: "With Ticket", className: "status-waiting", tone: "waiting" },
  AWAITING_ITSM: { label: "Awaiting ITSM", className: "status-waiting", tone: "waiting" },
  VALIDATION_PENDING: { label: "Validation Pending", className: "status-waiting", tone: "waiting" },
  VALIDATED: { label: "Validated", className: "status-success", tone: "success" },
  FAILED: { label: "Failed", className: "status-failed", tone: "failed" },
};

export const QUEUE_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "PENDING", label: "Pending" },
  { id: "WITH_TICKET", label: "With Ticket" },
  { id: "AWAITING_ITSM", label: "Awaiting ITSM" },
  { id: "VALIDATION_PENDING", label: "Validation Pending" },
  { id: "VALIDATED", label: "Validated" },
  { id: "FAILED", label: "Failed" },
];

export const DASHBOARD_STATUS_KEYS = [
  "PENDING",
  "WITH_TICKET",
  "AWAITING_ITSM",
  "VALIDATION_PENDING",
  "VALIDATED",
];

export const WORKFLOW_REMEDIATION_EVENT_TYPES = [
  {
    slug: "revoke-access",
    eventType: "REVOKE_ACCESS",
    title: "Revoke Access",
    badge: "REVOKE ACCESS",
    description: "Certification revoke access events awaiting workflow remediation",
    accent: "green",
    triggerType: "CertificationSignedOff",
    runsSlug: "access-revoke",
  },
  {
    slug: "missing-manager",
    eventType: "MISSING_MANAGER",
    title: "Missing Manager",
    badge: "MISSING MANAGER",
    description: "Users without an assigned manager",
    accent: "amber",
    triggerType: "MissingManagerDetected",
    runsSlug: "missing-manager",
  },
  {
    slug: "dormant-account",
    eventType: "DORMANT_ACCOUNT",
    title: "Dormant Account",
    badge: "DORMANT ACCOUNT",
    description: "Inactive or dormant user access",
    accent: "teal",
    triggerType: "DormantAccountDetected",
    runsSlug: "dormant-accounts",
  },
  {
    slug: "sod-violation",
    eventType: "SOD_VIOLATION",
    title: "SoD Violation",
    badge: "SOD VIOLATION",
    description: "Segregation of duties violations",
    accent: "red",
    triggerType: "SodViolationDetected",
    runsSlug: "sod-violations",
  },
  {
    slug: "uncorrelated-account",
    eventType: "UNCORRELATED_ACCOUNT",
    title: "Uncorrelated Account",
    badge: "UNCORRELATED ACCOUNT",
    description: "Orphan accounts without an owner identity",
    accent: "purple",
    triggerType: "UncorrelatedAccountIAMDecision",
    runsSlug: "iam-orphan-review",
  },
];

export const COLUMN_CONFIG_BY_EVENT_TYPE = {
  REVOKE_ACCESS: [
    { key: "eventId", label: "Event ID" },
    { key: "campaignName", label: "Certification Campaign" },
    { key: "eventType", label: "Event Type" },
    { key: "applicationName", label: "Application" },
    { key: "subjectCount", label: "Subjects" },
    { key: "queueStatus", label: "Queue Status" },
    { key: "createdAt", label: "Queue Date" },
  ],
  MISSING_MANAGER: [
    { key: "eventId", label: "Event ID" },
    { key: "eventType", label: "Event Type" },
    { key: "applicationName", label: "Application" },
    { key: "subjectCount", label: "Subjects" },
    { key: "selectedWorkflowName", label: "Workflow Name" },
    { key: "queueStatus", label: "Workflow Status" },
    { key: "createdAt", label: "Queue Date" },
  ],
  DORMANT_ACCOUNT: [
    { key: "eventId", label: "Event ID" },
    { key: "eventType", label: "Event Type" },
    { key: "applicationName", label: "Application" },
    { key: "subjectCount", label: "Subjects" },
    { key: "selectedWorkflowName", label: "Workflow Name" },
    { key: "queueStatus", label: "Workflow Status" },
    { key: "createdAt", label: "Queue Date" },
  ],
  SOD_VIOLATION: [
    { key: "eventId", label: "Event ID" },
    { key: "eventType", label: "Event Type" },
    { key: "subjectCount", label: "Subjects" },
    { key: "selectedWorkflowName", label: "Workflow Name" },
    { key: "queueStatus", label: "Workflow Status" },
    { key: "createdAt", label: "Queue Date" },
  ],
  UNCORRELATED_ACCOUNT: [
    { key: "eventId", label: "Event ID" },
    { key: "eventType", label: "Event Type" },
    { key: "applicationName", label: "Application" },
    { key: "subjectCount", label: "Subjects" },
    { key: "selectedWorkflowName", label: "Workflow Name" },
    { key: "queueStatus", label: "Workflow Status" },
    { key: "createdAt", label: "Queue Date" },
  ],
};

export function getEventTypeBySlug(slug) {
  return WORKFLOW_REMEDIATION_EVENT_TYPES.find((t) => t.slug === slug) || null;
}

export function computeQueueStats(events) {
  const stats = {
    total: events.length,
    PENDING: 0,
    WITH_TICKET: 0,
    AWAITING_ITSM: 0,
    VALIDATION_PENDING: 0,
    VALIDATED: 0,
    FAILED: 0,
  };
  for (const e of events) {
    const s = e.queueStatus || "PENDING";
    if (stats[s] != null) stats[s] += 1;
  }
  return stats;
}

export function defaultQueueSourceForSlug(slug) {
  if (slug === "revoke-access") return "CERTIFICATION";
  return "MANUAL";
}

export function computeSummaryStats(summaryRow, eventType, queueSource = "MANUAL") {
  const row = summaryRow?.[eventType]?.[queueSource] || {};
  const stats = { total: 0 };
  for (const key of DASHBOARD_STATUS_KEYS) {
    stats[key] = row[key] || 0;
    stats.total += stats[key];
  }
  stats.FAILED = row.FAILED || 0;
  stats.total += stats.FAILED;
  return stats;
}

export function formatQueueDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}
