/** Required config keys per step type (aligned with frontend stepConfigCatalog). */
export const STEP_REQUIRED_FIELDS = {
  SendEmail: ["to", "subject", "body"],
  CompareStrings: ["left", "right"],
  CompareNumbers: ["left", "operator", "right"],
  Loop: ["maxIterations"],
  VerifyDataType: ["field", "check"],
  RevokeAccess: ["identityId"],
  VerifyAccessRemoved: ["identityId"],
  CreateTicket: ["title", "description"],
  GetTicket: ["ticketId"],
  UpdateTicket: ["ticketId"],
  CloseTicket: ["ticketId"],
  AuditLog: ["action"],
  Scheduler: ["scheduleType", "delayValue", "delayUnit"],
  Switch: ["field"],
  UpdateQueueTask: ["status"],
};

function validateNumericRules(node) {
  const errors = [];
  const cfg = node.config || {};
  const label = node.label || node.type;

  if (node.type === "Loop") {
    const max = Number(cfg.maxIterations);
    if (!Number.isNaN(max) && max < 1) {
      errors.push(`${label}: maxIterations must be at least 1`);
    }
  }

  if (node.type === "CompareNumbers") {
    const right = cfg.right;
    if (right !== "" && right != null && Number.isNaN(Number(right))) {
      errors.push(`${label}: right must be a number`);
    }
  }

  if (node.type === "Scheduler") {
    const delay = Number(cfg.delayValue);
    if (!Number.isNaN(delay) && delay <= 0) {
      errors.push(`${label}: delayValue must be greater than 0`);
    }
    const resumeOn = cfg.resumeWorkflow !== false && cfg.resumeWorkflow !== "false";
    if (resumeOn && !String(cfg.nextStepId || "").trim()) {
      errors.push(`${label}: nextStepId is required when resumeWorkflow is enabled`);
    }
  }

  return errors;
}

export function validateNodeConfigFromCatalog(node) {
  const required = STEP_REQUIRED_FIELDS[node.type];
  const errors = [];
  const cfg = node.config || {};
  const label = node.label || node.type;

  if (required) {
    for (const key of required) {
      const val = cfg[key];
      if (val == null || String(val).trim() === "") {
        errors.push(`${label}: ${key} is required`);
      }
    }
  }

  errors.push(...validateNumericRules(node));
  return errors;
}
