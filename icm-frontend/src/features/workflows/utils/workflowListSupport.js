const TRIGGER_LABELS = {
  CertificationSignedOff: "Certification revoke",
  UncorrelatedAccountIAMDecision: "IAM orphan review",
  JoinerDetected: "Joiner provision",
};

const TAG_LABELS = {
  IAM_ORPHAN_REVIEW: "IAM orphan",
  CERTIFICATION_REVOKE: "Access revoke",
  DATA_HYGIENE: "Data hygiene",
  JOINER: "Joiner",
  MOVER: "Mover",
  LEAVER: "Leaver",
  LIFECYCLE: "Lifecycle",
  UPDATE: "Update",
  DISABLE: "Disable",
};

export function getWorkflowTypeMeta(workflow) {
  const trigger = workflow?.trigger?.type;
  const tags = workflow?.tags || [];

  if (trigger === "JoinerDetected" || tags.includes("JOINER")) {
    return { label: "Joiner", tone: "blue" };
  }
  if (tags.includes("MOVER") || tags.includes("UPDATE")) {
    return { label: "Mover", tone: "amber" };
  }
  if (tags.includes("LEAVER") || tags.includes("DISABLE")) {
    return { label: "Leaver", tone: "violet" };
  }
  if (trigger === "UncorrelatedAccountIAMDecision" || tags.includes("IAM_ORPHAN_REVIEW")) {
    return { label: "IAM Orphan", tone: "violet" };
  }
  if (trigger === "CertificationSignedOff" || tags.includes("CERTIFICATION_REVOKE")) {
    return { label: "Access Revoke", tone: "blue" };
  }
  if (tags.includes("DATA_HYGIENE")) {
    return { label: "Data Hygiene", tone: "amber" };
  }
  if (trigger && TRIGGER_LABELS[trigger]) {
    return { label: TRIGGER_LABELS[trigger], tone: "slate" };
  }
  return { label: "Custom flow", tone: "slate" };
}

export function formatWorkflowDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatWorkflowDateShort(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function getWorkflowRunStats(workflow) {
  const success = workflow?.successCount || 0;
  const errors = workflow?.errorCount || 0;
  const total = success + errors;
  const rate = total > 0 ? Math.round((success / total) * 100) : null;
  return { success, errors, total, rate };
}

export function getWorkflowNodeCount(workflow) {
  return Array.isArray(workflow?.nodes) ? workflow.nodes.length : 0;
}

export function summarizeWorkflowTags(tags = []) {
  return tags
    .map((t) => TAG_LABELS[t] || t)
    .slice(0, 3)
    .join(" · ");
}

export function filterWorkflows(workflows, { query, status }) {
  const q = String(query || "").trim().toLowerCase();
  return workflows.filter((wf) => {
    if (status === "enabled" && wf.enabled === false) return false;
    if (status === "disabled" && wf.enabled !== false) return false;
    if (!q) return true;
    const hay = [
      wf.name,
      wf.description,
      wf.trigger?.type,
      ...(wf.tags || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function computeWorkflowListStats(workflows) {
  const enabled = workflows.filter((w) => w.enabled !== false).length;
  const runs = workflows.reduce(
    (acc, w) => {
      acc.success += w.successCount || 0;
      acc.errors += w.errorCount || 0;
      return acc;
    },
    { success: 0, errors: 0 },
  );
  return {
    total: workflows.length,
    enabled,
    disabled: workflows.length - enabled,
    ...runs,
    runTotal: runs.success + runs.errors,
  };
}
