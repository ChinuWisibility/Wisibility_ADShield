export const WORKFLOW_REMEDIATION_EVENT_TYPES = {
  REVOKE_ACCESS: "REVOKE_ACCESS",
  MISSING_MANAGER: "MISSING_MANAGER",
  DORMANT_ACCOUNT: "DORMANT_ACCOUNT",
  SOD_VIOLATION: "SOD_VIOLATION",
  UNCORRELATED_ACCOUNT: "UNCORRELATED_ACCOUNT",
};

export const WORKFLOW_REMEDIATION_EVENT_SOURCES = {
  CERTIFICATION: "CERTIFICATION",
  MISSING_MANAGER: "MISSING_MANAGER",
  DORMANT_ACCOUNT: "DORMANT_ACCOUNT",
  SOD: "SOD",
  UNCORRELATED_ACCOUNT: "UNCORRELATED_ACCOUNT",
};

export const WORKFLOW_REMEDIATION_QUEUE_STATUS = {
  PENDING: "PENDING",
  WITH_TICKET: "WITH_TICKET",
  AWAITING_ITSM: "AWAITING_ITSM",
  VALIDATION_PENDING: "VALIDATION_PENDING",
  VALIDATED: "VALIDATED",
  FAILED: "FAILED",
};

export const WORKFLOW_REMEDIATION_QUEUE_SOURCES = {
  MANUAL: "MANUAL",
  SCHEDULER: "SCHEDULER",
  CERTIFICATION: "CERTIFICATION",
  API: "API",
};

export const QUEUE_SLUG_BY_EVENT_TYPE = {
  [WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS]: "revoke-access",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER]: "missing-manager",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT]: "dormant-account",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION]: "sod-violation",
  [WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT]: "uncorrelated-account",
};

/** Default queueSource filter when listing events on type-specific queue pages */
export function defaultQueueSourceForEventType(eventType) {
  if (eventType === WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS) {
    return WORKFLOW_REMEDIATION_QUEUE_SOURCES.CERTIFICATION;
  }
  return WORKFLOW_REMEDIATION_QUEUE_SOURCES.MANUAL;
}

const EVENT_TYPE_PREFIX = {
  REVOKE_ACCESS: "RA",
  MISSING_MANAGER: "MM",
  DORMANT_ACCOUNT: "DA",
  SOD_VIOLATION: "SV",
  UNCORRELATED_ACCOUNT: "UA",
};

export function generateWorkflowRemediationEventId(eventType) {
  const prefix = EVENT_TYPE_PREFIX[eventType] || "WR";
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WRE-${prefix}-${stamp}-${rand}`;
}

export const WORKFLOW_REMEDIATION_COLUMN_CONFIG = {
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
    { key: "applicationName", label: "Application" },
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

export const WORKFLOW_REMEDIATION_EVENT_TYPE_META = [
  {
    slug: "revoke-access",
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.REVOKE_ACCESS,
    title: "Revoke Access",
    badge: "REVOKE ACCESS",
    description: "Certification revoke access events awaiting workflow remediation",
    accent: "green",
  },
  {
    slug: "missing-manager",
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.MISSING_MANAGER,
    title: "Missing Manager",
    badge: "MISSING MANAGER",
    description: "Identity quality — users without an assigned manager",
    accent: "amber",
  },
  {
    slug: "dormant-account",
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.DORMANT_ACCOUNT,
    title: "Dormant Account",
    badge: "DORMANT ACCOUNT",
    description: "Inactive or dormant user access requiring remediation",
    accent: "teal",
  },
  {
    slug: "sod-violation",
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.SOD_VIOLATION,
    title: "SoD Violation",
    badge: "SOD VIOLATION",
    description: "Segregation of duties violations awaiting remediation",
    accent: "red",
  },
  {
    slug: "uncorrelated-account",
    eventType: WORKFLOW_REMEDIATION_EVENT_TYPES.UNCORRELATED_ACCOUNT,
    title: "Uncorrelated Account",
    badge: "UNCORRELATED ACCOUNT",
    description: "Orphan accounts without an owner identity",
    accent: "purple",
  },
];

export function getWorkflowRemediationEventTypeBySlug(slug) {
  return WORKFLOW_REMEDIATION_EVENT_TYPE_META.find((c) => c.slug === slug) || null;
}
