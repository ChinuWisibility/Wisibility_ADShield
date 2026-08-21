import jwt from "jsonwebtoken";
import env from "../../config/env.js";

function jwtSecret() {
  return env.portalSecrets.orphanIamPortal;
}

function getPortalTtl() {
  const days = process.env.ORPHAN_IAM_PORTAL_JWT_TTL_DAYS;
  if (days != null && String(days).trim()) {
    const n = parseInt(String(days).trim(), 10);
    if (!Number.isNaN(n) && n > 0) return `${n}d`;
  }
  return "14d";
}

export function generateOrphanIamPortalToken({
  orphanId,
  executionId,
  tenantId,
  stepId,
  stepLabel,
  source,
  emailJobId,
  emailAuditId,
} = {}) {
  if (!orphanId) throw new Error("orphanId is required");
  const payload = {
    typ: "orphan_iam_reviewer",
    orphanId: String(orphanId),
    ...(executionId ? { executionId: String(executionId) } : {}),
    ...(tenantId ? { tenantId: String(tenantId) } : {}),
    ...(stepId ? { stepId: String(stepId) } : {}),
    ...(stepLabel ? { stepLabel: String(stepLabel) } : {}),
    ...(source ? { source: String(source) } : {}),
    ...(emailJobId ? { emailJobId: String(emailJobId) } : {}),
    ...(emailAuditId ? { emailAuditId: String(emailAuditId) } : {}),
  };
  return jwt.sign(payload, jwtSecret(), { expiresIn: getPortalTtl() });
}

export function validateOrphanIamPortalToken(rawToken) {
  const token = String(rawToken ?? "").trim();
  if (!token) throw new Error("Missing token");
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
  if (decoded.typ !== "orphan_iam_reviewer") {
    throw new Error("Invalid token type");
  }
  return {
    orphanId: String(decoded.orphanId),
    executionId: decoded.executionId ? String(decoded.executionId) : null,
    tenantId: decoded.tenantId ? String(decoded.tenantId) : null,
    stepId: decoded.stepId ? String(decoded.stepId) : null,
    stepLabel: decoded.stepLabel ? String(decoded.stepLabel) : null,
    source: decoded.source ? String(decoded.source) : null,
    emailJobId: decoded.emailJobId ? String(decoded.emailJobId) : null,
    emailAuditId: decoded.emailAuditId ? String(decoded.emailAuditId) : null,
    expiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null,
  };
}

export function buildOrphanIamPortalUrl(token) {
  const base = env.frontendUrl || process.env.FRONTEND_URL || "http://localhost:3000";
  return `${base}/orphan-iam-review?token=${encodeURIComponent(token)}`;
}

/** Tokenized review portal URL — one link per email step (stepId + source identify the notification). */
export function issueOrphanIamPortalUrl({
  orphanId,
  executionId,
  tenantId,
  stepId,
  stepLabel,
  source,
  emailJobId,
  emailAuditId,
} = {}) {
  const token = generateOrphanIamPortalToken({
    orphanId,
    executionId,
    tenantId,
    stepId,
    stepLabel,
    source,
    emailJobId,
    emailAuditId,
  });
  return buildOrphanIamPortalUrl(token);
}

export function decisionSourceFromTokenPayload(payload = {}) {
  return {
    stepId: payload.stepId || null,
    stepLabel: payload.stepLabel || null,
    source: payload.source || null,
    emailJobId: payload.emailJobId || null,
    emailAuditId: payload.emailAuditId || null,
    executionId: payload.executionId || null,
  };
}
