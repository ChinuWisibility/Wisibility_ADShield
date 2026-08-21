export const REMEDIATION_EVENT_CATALOG = [
  {
    slug: "iam-orphan-review",
    eventType: "IAM_ORPHAN_REVIEW",
    aliases: ["IAM_ORPHAN_REVIEW"],
    title: "IAM Orphan Review",
    badge: "QUEUE",
    category: "Uncorrelated accounts",
    description: "Review and remediate accounts that are not linked to an identity.",
    accent: "amber",
    source: "queue",
    action: "IAM_ORPHAN_REVIEW",
  },
  {
    slug: "access-revoke",
    eventType: "ACCESS_REVOKE",
    aliases: ["ACCESS_REVOKE", "REVOKE_ACCESS"],
    title: "Access Revoke",
    badge: "CERTIFICATION",
    category: "Certification decisions",
    description: "Execute and track access removals from certification sign-off.",
    accent: "green",
    source: "queue",
    action: "ACCESS_REVOKE",
  },
];

export const IN_FLIGHT_EXECUTION = new Set([
  "PENDING",
  "RUNNING",
  "WAITING_ITSM",
  "WAITING_VERIFICATION",
  "WAITING",
]);

export const IN_FLIGHT_QUEUE = new Set(["NEW", "IN_PROGRESS", "WAITING"]);

export function getCatalogBySlug(slug) {
  return REMEDIATION_EVENT_CATALOG.find((t) => t.slug === slug) || null;
}

export function matchesExecutionEventType(exec, config) {
  if (!config) return false;
  const value = String(exec?.eventType || "").toUpperCase();
  return (config.aliases || [config.eventType]).includes(value);
}

export function computeExecutionStats(executions = []) {
  return {
    total: executions.length,
    inProgress: executions.filter((e) => IN_FLIGHT_EXECUTION.has(e.status)).length,
    completed: executions.filter((e) => ["COMPLETED", "SUCCESS"].includes(e.status)).length,
    failed: executions.filter((e) => e.status === "FAILED").length,
  };
}

export function computeQueueStats(tasks = []) {
  return {
    total: tasks.length,
    inProgress: tasks.filter((t) => IN_FLIGHT_QUEUE.has(t.status)).length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
    failed: tasks.filter((t) => t.status === "FAILED").length,
  };
}

/** Global Rule Set: remediation action → default workflow mapping (derived from catalog) */
export const REMEDIATION_WORKFLOW_ACTIONS = REMEDIATION_EVENT_CATALOG.map((item) => ({
  value: item.action || item.eventType,
  label: item.title,
  badge: item.badge,
  description: item.description,
  accent: item.accent,
  slug: item.slug,
  source: item.source,
  runtimeNote:
    item.eventType === "ACCESS_REVOKE"
      ? "Triggered when a manager revokes access in certification."
      : "Triggered when an orphan account remediation is started.",
}));

export const REMEDIATION_ACTION_ACCENTS = {
  green: { main: "#16a34a", soft: "#f0fdf4", border: "#bbf7d0", icon: "#dcfce7" },
  amber: { main: "#b45309", soft: "#fffbeb", border: "#fde68a", icon: "#fef3c7" },
};

export function emptyWorkflowMappings() {
  return Object.fromEntries(REMEDIATION_WORKFLOW_ACTIONS.map((a) => [a.value, ""]));
}
