import { AppError } from "../../middleware/errorHandler.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import Application from "../../models/application/Application.js";
import { enrichOrphanRowsForDisplay } from "../../utils/datahygine/orphanAccountDisplayEnrichment.js";
import {
  validateOrphanIamPortalToken,
  decisionSourceFromTokenPayload,
} from "../../services/workflow/orphanIamPortalTokenService.js";
import { recordOrphanIamDecisionAndResume } from "../../services/workflow/orphanIamWorkflowService.js";

function mapTokenError(e, next) {
  if (e?.name === "TokenExpiredError") {
    return next(new AppError("This review link has expired. Request a new notification from your IAM administrator.", 401));
  }
  if (e?.name === "JsonWebTokenError" || e?.message === "Invalid token type" || e?.message === "Missing token") {
    return next(new AppError("Invalid or missing review token.", 401));
  }
  return null;
}

async function loadOrphanForPortal(orphanId) {
  let orphan = await OrphanAccount.findById(orphanId)
    .populate("applicationId", "name tenantId userMappings")
    .lean();
  if (!orphan) return null;
  const [enriched] = await enrichOrphanRowsForDisplay([orphan]);
  orphan = enriched || orphan;
  const app =
    orphan.applicationId && typeof orphan.applicationId === "object"
      ? orphan.applicationId
      : orphan.applicationId
        ? await Application.findById(orphan.applicationId).select("name").lean()
        : null;
  return {
    orphanId: String(orphan._id),
    tenantId: orphan.tenantId ? String(orphan.tenantId) : null,
    accountName: orphan.accountName || null,
    accountId: orphan.accountId || null,
    applicationName: app?.name || null,
    applicationId: app?._id ? String(app._id) : orphan.applicationId ? String(orphan.applicationId) : null,
    riskLevel: orphan.riskLevel || null,
    status: orphan.status || null,
    workflowStatus: orphan.workflowStatus || null,
    currentStepLabel: orphan.currentStepLabel || null,
    detectedAt: orphan.detectedAt ? new Date(orphan.detectedAt).toISOString() : null,
    userEmail: orphan.userEmail || null,
    userDisplayName: orphan.userDisplayName || null,
    userEmployeeId: orphan.userEmployeeId || null,
    userUsername: orphan.userUsername || null,
    correlationKey: orphan.correlationKey || null,
    iamDecision: orphan.iamDecision || null,
    iamDecisionMeta: orphan.iamDecisionMeta || null,
  };
}

export async function getOrphanIamPortal(req, res, next) {
  try {
    const token = req.query.token;
    if (!token) throw new AppError("Review token is required", 401);
    const payload = validateOrphanIamPortalToken(token);
    let orphan = await loadOrphanForPortal(payload.orphanId);
    if (!orphan) throw new AppError("Orphan account not found", 404);

    if (payload.tenantId && orphan.tenantId && String(orphan.tenantId) !== String(payload.tenantId)) {
      throw new AppError("Invalid review token for this account", 403);
    }

    // Heal stuck queue-first runs: decision already saved but wait step never resumed.
    let resumeMeta = null;
    if (orphan.iamDecision && orphan.workflowStatus === "WAITING_IAM") {
      const resume = await recordOrphanIamDecisionAndResume({
        orphanId: payload.orphanId,
        decision: orphan.iamDecision,
        tenantId: payload.tenantId,
        decidedBy: "iam-portal-resume",
        decisionSource: decisionSourceFromTokenPayload(payload),
      });
      if (resume.ok) {
        resumeMeta = {
          resumed: resume.resumed,
          resultStatus: resume.resultStatus || null,
          executionId: resume.executionId || null,
        };
        orphan = (await loadOrphanForPortal(payload.orphanId)) || orphan;
      }
    }

    res.json({
      success: true,
      data: {
        orphan,
        executionId: payload.executionId,
        expiresAt: payload.expiresAt,
        canDecide: orphan.workflowStatus === "WAITING_IAM" && !orphan.iamDecision,
        reviewSource: payload.source || payload.stepLabel || null,
        reviewStepId: payload.stepId || null,
        resume: resumeMeta,
      },
    });
  } catch (e) {
    const handled = mapTokenError(e, next);
    if (handled !== null) return handled;
    next(e);
  }
}

export async function submitOrphanIamPortalDecision(req, res, next) {
  try {
    const token = req.body?.token || req.query.token;
    const { decision } = req.body || {};
    if (!token) throw new AppError("Review token is required", 401);
    if (!decision) throw new AppError("Decision is required", 400);

    const payload = validateOrphanIamPortalToken(token);
    const decisionSource = decisionSourceFromTokenPayload(payload);
    const result = await recordOrphanIamDecisionAndResume({
      orphanId: payload.orphanId,
      decision,
      tenantId: payload.tenantId,
      decidedBy: "iam-portal",
      decisionSource,
    });

    if (!result.ok) {
      throw new AppError(result.error || "Failed to record decision", result.status || 400);
    }

    res.json({
      success: true,
      data: {
        decision,
        resumed: result.resumed,
        executionId: result.executionId,
        resultStatus: result.resultStatus,
        decisionSource: result.decisionSource || decisionSource,
      },
    });
  } catch (e) {
    const handled = mapTokenError(e, next);
    if (handled !== null) return handled;
    next(e);
  }
}
