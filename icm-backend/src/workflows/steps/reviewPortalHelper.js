import { issueOrphanIamPortalUrl } from "../../services/workflow/orphanIamPortalTokenService.js";

/**
 * When a workflow trigger carries orphanId, inject a per-step review portal URL into
 * $.config.reviewPortalUrl (and orphanIamPortalUrl for backward compatibility) so
 * Send Email bodies can use {{$.config.reviewPortalUrl}}.
 */
export function withReviewPortalStepContext(stepCtx, context, node) {
  const cfg = node?.config || {};
  if (cfg.includeReviewPortal === false) return stepCtx;
  const orphanId = context?.trigger?.orphanId;
  if (!orphanId) return stepCtx;

  const reviewPortalUrl = issueOrphanIamPortalUrl({
    orphanId: String(orphanId),
    executionId: context.config?.executionId || null,
    tenantId: context.config?.tenantId ?? null,
    stepId: node.id,
    stepLabel: node.label || node.id,
    source: cfg.reviewPortalSource || node.label || node.id,
  });

  return {
    ...stepCtx,
    config: {
      ...stepCtx.config,
      reviewPortalUrl,
      orphanIamPortalUrl: reviewPortalUrl,
    },
  };
}

export function finalizeReviewPortalOutput(output, context, node, emailResult = {}) {
  const cfg = node?.config || {};
  if (cfg.includeReviewPortal === false || !context?.trigger?.orphanId) {
    return output;
  }

  const reviewPortalUrl = issueOrphanIamPortalUrl({
    orphanId: String(context.trigger.orphanId),
    executionId: context.config?.executionId || null,
    tenantId: context.config?.tenantId ?? null,
    stepId: node.id,
    stepLabel: node.label || node.id,
    source: cfg.reviewPortalSource || node.label || node.id,
    emailJobId: emailResult.emailJobId || null,
    emailAuditId: emailResult.id || null,
  });

  return {
    ...output,
    reviewPortalUrl,
    reviewPortalSource: cfg.reviewPortalSource || node.label || node.id,
  };
}
