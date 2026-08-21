/**
 * UI labels for certification entitlement remediation (workflow execution) status.
 * Decision (Approved/Revoked) is separate from workflow progress.
 */

const WORKFLOW_STYLES = {
  none: { bg: "#F8FAFC", text: "#94A3B8", border: "#E2E8F0" },
  waiting: { bg: "#FFF7ED", text: "#C2410C", border: "#FED7AA" },
  running: { bg: "#EFF6FF", text: "#1D4ED8", border: "#BFDBFE" },
  success: { bg: "#ECFDF5", text: "#047857", border: "#A7F3D0" },
  failed: { bg: "#FEF2F2", text: "#B91C1C", border: "#FECACA" },
  skipped: { bg: "#F9FAFB", text: "#6B7280", border: "#E5E7EB" },
};

const REMEDIATION_FIELD_LABELS = {
  REVOKE_IN_PROGRESS: "Revoke in progress",
  PENDING: "Pending",
  RUNNING: "Running",
  WAITING_ITSM: "Waiting on ITSM",
  COMPLETED: "Completed",
  FAILED: "Failed",
  SKIPPED: "Skipped",
  EXECUTED: "Executed",
  NEW: "Queued",
  IN_PROGRESS: "In progress",
  WAITING: "Waiting",
};

function friendlyRemediationField(value) {
  const key = String(value || "").toUpperCase();
  if (!key) return "—";
  return REMEDIATION_FIELD_LABELS[key] || key.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Unified remediation column UI — merges queue task + ReviewItem remediation fields.
 * @returns {{ label: string, subtitle: string, style: object, inFlight: boolean } | null}
 */
export function resolveRemediationStatusUi({
  decision,
  remediationStatus,
  provisioningStatus,
  entitlementStatus,
  execution,
}) {
  const d = String(decision || "").toLowerCase();
  if (d !== "revoked") return null;

  const rem = String(remediationStatus || "").toUpperCase();
  const prov = String(provisioningStatus || "").toUpperCase();
  const ent = String(entitlementStatus || "").toUpperCase();
  const queueStatus = String(execution?.status || "").toUpperCase();

  if (rem === "COMPLETED" && prov === "EXECUTED") {
    return {
      label: "Complete",
      subtitle: "Access revoked in the target application",
      style: WORKFLOW_STYLES.success,
      inFlight: false,
    };
  }
  if (queueStatus === "COMPLETED") {
    return {
      label: "Complete",
      subtitle: "Remediation workflow finished successfully",
      style: WORKFLOW_STYLES.success,
      inFlight: false,
    };
  }
  if (rem === "FAILED" || prov === "FAILED" || queueStatus === "FAILED") {
    return {
      label: "Failed",
      subtitle: "Remediation did not finish — review required",
      style: WORKFLOW_STYLES.failed,
      inFlight: false,
    };
  }
  if (rem === "SKIPPED") {
    return {
      label: "Skipped",
      subtitle: "No remediation workflow was executed",
      style: WORKFLOW_STYLES.skipped,
      inFlight: false,
    };
  }
  if (queueStatus === "NEW") {
    return {
      label: "Queued",
      subtitle: "Waiting for the remediation scheduler to pick up this task",
      style: WORKFLOW_STYLES.waiting,
      inFlight: true,
    };
  }
  if (queueStatus === "IN_PROGRESS") {
    return {
      label: "Running",
      subtitle: execution?.workflowName
        ? `Workflow: ${execution.workflowName}`
        : "Revoke workflow is executing",
      style: WORKFLOW_STYLES.running,
      inFlight: true,
    };
  }
  if (queueStatus === "WAITING") {
    return {
      label: "Waiting",
      subtitle: "Paused for an external step (ITSM or approval)",
      style: WORKFLOW_STYLES.waiting,
      inFlight: true,
    };
  }
  if (rem === "WAITING_ITSM") {
    return {
      label: "Waiting on ITSM",
      subtitle: "Ticket open — revoke pending verification",
      style: WORKFLOW_STYLES.waiting,
      inFlight: true,
    };
  }
  if (rem === "RUNNING") {
    return {
      label: "Running",
      subtitle: "Remediation workflow is in progress",
      style: WORKFLOW_STYLES.running,
      inFlight: true,
    };
  }
  if (rem === "REVOKE_IN_PROGRESS" || ent === "REVOKE_IN_PROGRESS") {
    return {
      label: "Revoke in progress",
      subtitle: "Decision saved — remediation workflow will run shortly",
      style: WORKFLOW_STYLES.waiting,
      inFlight: true,
    };
  }
  if (rem === "PENDING" || prov === "PENDING") {
    return {
      label: "Pending",
      subtitle: "Revoke recorded — remediation has not started yet",
      style: WORKFLOW_STYLES.waiting,
      inFlight: true,
    };
  }

  return {
    label: "In progress",
    subtitle: "Remediation is underway",
    style: WORKFLOW_STYLES.waiting,
    inFlight: true,
  };
}

/** @returns {{ label: string, style: object, inFlight: boolean, subtitle?: string } | null} */
export function resolveWorkflowStatusUi(decision, remediationStatus, provisioningStatus) {
  const ui = resolveRemediationStatusUi({
    decision,
    remediationStatus,
    provisioningStatus,
  });
  if (!ui) return null;
  return {
    label: ui.label,
    style: ui.style,
    inFlight: ui.inFlight,
    subtitle: ui.subtitle,
  };
}

export function isRemediationInFlight(decision, remediationStatus, provisioningStatus, execution = null, entitlementStatus = null) {
  return Boolean(
    resolveRemediationStatusUi({
      decision,
      remediationStatus,
      provisioningStatus,
      entitlementStatus,
      execution,
    })?.inFlight,
  );
}

/** Internal: treat in-flight revoke as a revoke for remediation/workflow logic. */
export function entitlementStatusToDecision(status) {
  const st = String(status || "PENDING").toUpperCase();
  if (st === "APPROVED") return "Approved";
  if (st === "REVOKED" || st === "REVOKE_IN_PROGRESS") return "Revoked";
  return "Pending";
}

/**
 * UI decision chip — distinguishes manager decision recorded vs access fully removed.
 */
export function entitlementStatusToDisplayDecision(status, remediationStatus, provisioningStatus) {
  const st = String(status || "PENDING").toUpperCase();
  const rem = String(remediationStatus || "").toUpperCase();
  const prov = String(provisioningStatus || "").toUpperCase();

  if (st === "APPROVED") return "Approved";
  if (st === "PENDING") return "Pending";
  if (st === "REVOKE_IN_PROGRESS") return "Revoking";

  if (st === "REVOKED") {
    if (rem === "COMPLETED" && prov === "EXECUTED") return "Revoked";
    if (rem === "FAILED" || prov === "FAILED") return "Revoked";
    if (rem === "SKIPPED" || (!rem && !prov)) return "Revoked";
    if (rem === "REVOKE_IN_PROGRESS" || rem === "PENDING" || rem === "RUNNING" || rem === "WAITING_ITSM") {
      return "Revoking";
    }
    if (prov === "PENDING") return "Revoking";
    return "Revoked";
  }

  return "Pending";
}

export function isEntitlementRevokeComplete(status, remediationStatus, provisioningStatus) {
  const display = entitlementStatusToDisplayDecision(status, remediationStatus, provisioningStatus);
  return display === "Revoked";
}

export function isEntitlementStatusPending(status) {
  return String(status || "PENDING").toUpperCase() === "PENDING";
}

/** Map top-level review item status to UI decision label. */
export function reviewItemStatusToDecision(status, fallback = "Pending") {
  const st = String(status || "").toUpperCase();
  if (st === "REVOKED" || st === "REVOKE_IN_PROGRESS") return "Revoked";
  if (st === "APPROVED") return "Approved";
  if (st === "DELEGATED") return "Delegate";
  if (st === "EXCEPTION") return "Exception";
  if (st === "PENDING") return "Pending";
  return fallback;
}

const EXECUTION_STATUS_LABELS = {
  NEW: "Queued",
  IN_PROGRESS: "Running",
  WAITING: "Waiting",
  COMPLETED: "Complete",
  FAILED: "Failed",
  WAITING_ITSM: "Waiting ITSM",
  RUNNING: "Running",
  PENDING: "Queued",
  SKIPPED: "Skipped",
};

/**
 * Detail lines for remediation popover — review item fields + queue task.
 */
export function buildRemediationDetailLines({
  remediationStatus,
  provisioningStatus,
  entitlementStatus,
  execution,
}) {
  const lines = [];

  if (entitlementStatus) {
    lines.push({
      label: "Review decision",
      value: friendlyRemediationField(entitlementStatus),
    });
  }
  if (remediationStatus) {
    lines.push({
      label: "Remediation status",
      value: friendlyRemediationField(remediationStatus),
      emphasize: true,
    });
  }
  if (provisioningStatus) {
    lines.push({
      label: "Provisioning status",
      value: friendlyRemediationField(provisioningStatus),
    });
  }

  const executionLines = buildWorkflowDetailLines(execution);
  return [...lines, ...executionLines];
}

export function formatWorkflowTimestamp(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Prefer live execution record over ReviewItem remediation fields for chip label. */
export function resolveWorkflowLabelFromExecution(execution, workflowUi, remediationUi) {
  if (remediationUi?.label) return remediationUi.label;
  if (!execution) return workflowUi?.label || "—";
  return EXECUTION_STATUS_LABELS[execution.status] || workflowUi?.label || "In progress";
}

/** Resolve chip colors from execution status when available. */
export function resolveWorkflowStyleFromExecution(execution, workflowUi, remediationUi) {
  if (remediationUi?.style) return remediationUi.style;
  if (!execution) return workflowUi?.style || WORKFLOW_STYLES.none;
  const status = String(execution.status || "").toUpperCase();
  if (status === "COMPLETED") return WORKFLOW_STYLES.success;
  if (status === "FAILED") return WORKFLOW_STYLES.failed;
  if (status === "SKIPPED") return WORKFLOW_STYLES.skipped;
  if (status === "WAITING_ITSM" || status === "WAITING") return WORKFLOW_STYLES.waiting;
  if (status === "RUNNING" || status === "IN_PROGRESS" || status === "NEW" || status === "PENDING") {
    return status === "NEW" || status === "PENDING" ? WORKFLOW_STYLES.waiting : WORKFLOW_STYLES.running;
  }
  return workflowUi?.style || WORKFLOW_STYLES.waiting;
}

/**
 * Human-readable lines for the workflow detail popover on the review board.
 * @returns {{ label: string, value: string, emphasize?: boolean, multiline?: boolean }[]}
 */
export function buildWorkflowDetailLines(execution) {
  if (!execution) return [];

  const lines = [
    { label: "Workflow", value: execution.workflowName || "—" },
    {
      label: "Status",
      value: EXECUTION_STATUS_LABELS[execution.status] || execution.status || "—",
      emphasize: true,
    },
  ];

  if (execution.startedAt) {
    lines.push({ label: "Started", value: formatWorkflowTimestamp(execution.startedAt) });
  }
  if (execution.completedAt) {
    lines.push({ label: "Finished", value: formatWorkflowTimestamp(execution.completedAt) });
  } else if (execution.updatedAt && ["RUNNING", "WAITING_ITSM", "PENDING"].includes(execution.status)) {
    lines.push({ label: "Last updated", value: formatWorkflowTimestamp(execution.updatedAt) });
  }
  if (execution.status === "WAITING_ITSM" && execution.nextPollAt) {
    lines.push({ label: "Next re-verify", value: formatWorkflowTimestamp(execution.nextPollAt) });
  }
  if (execution.itsmTicketStatus) {
    lines.push({ label: "ITSM ticket", value: String(execution.itsmTicketStatus).replace(/_/g, " ") });
  }
  if (execution.failureReasonLabel) {
    lines.push({
      label: "Why",
      value: execution.failureReasonLabel,
      emphasize: true,
    });
  }
  if (execution.failureReasonDetail) {
    lines.push({ label: "Detail", value: execution.failureReasonDetail, multiline: true });
  }
  if (execution.currentStepLabel) {
    lines.push({ label: "Current step", value: execution.currentStepLabel });
  }
  const bullets = Array.isArray(execution.stepStatuses) ? execution.stepStatuses : [];
  if (bullets.length > 0) {
    lines.push({ label: "Progress", value: bullets.join("\n"), multiline: true });
  }
  if (execution.executionId) {
    lines.push({ label: "Run ID", value: execution.executionId });
  }

  return lines;
}

export function hasRevokedWorkflowActivity(scopeData = []) {
  for (const item of scopeData) {
    const eds = Array.isArray(item.entitlementDecisions) ? item.entitlementDecisions : [];
    if (eds.length) {
      for (const ed of eds) {
        if (String(ed.status || "").toUpperCase() === "REVOKED" || String(ed.status || "").toUpperCase() === "REVOKE_IN_PROGRESS") return true;
      }
    } else if (["REVOKED", "REVOKE_IN_PROGRESS"].includes(String(item.reviewItemStatus || item.aggregatedDecision || "").toUpperCase())) {
      return true;
    }
  }
  return false;
}

export { WORKFLOW_STYLES };
