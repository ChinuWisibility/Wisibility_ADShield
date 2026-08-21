import env from "../config/env.js";

/**
 * Returns 410 when legacy remediation stacks are disabled (queue-first greenfield).
 */
export function blockLegacyRemediationApi(req, res, next) {
  if (env.legacyRemediationEnabled) return next();
  return res.status(410).json({
    success: false,
    message:
      "Legacy remediation API is deprecated. Use /api/workflow-task-queue and Global Rule Set configuration.",
  });
}
