import jwt from "jsonwebtoken";
import env from "../../config/env.js";

function jwtSecret() {
  return env.portalSecrets.remediationTicket;
}

function getTicketReviewTtl() {
  const raw = process.env.REMEDIATION_TICKET_JWT_TTL_HOURS;
  if (raw == null || !String(raw).trim()) return "168h";
  const compact = String(raw).trim();
  const n = parseInt(compact, 10);
  if (!Number.isNaN(n) && n > 0) return `${n}h`;
  return compact;
}

export function generateTicketReviewToken(ticketId, itsmEmail, { tenantId, dueDate } = {}) {
  const email = String(itsmEmail || "")
    .trim()
    .toLowerCase();
  if (!email) throw new Error("itsmEmail is required");

  let expiresIn = getTicketReviewTtl();
  if (dueDate) {
    const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
    if (!isNaN(due.getTime())) {
      const bufMs = 7 * 24 * 3600 * 1000;
      const minMs = 48 * 3600 * 1000;
      const ttlMs = Math.max(due.getTime() + bufMs - Date.now(), minMs);
      expiresIn = `${Math.floor(ttlMs / 1000)}s`;
    }
  }

  const payload = {
    typ: "remediation_ticket_reviewer",
    ticketId: String(ticketId).toLowerCase(),
    itsmEmail: email,
    ...(tenantId ? { tenantId: String(tenantId) } : {}),
  };

  return jwt.sign(payload, jwtSecret(), { expiresIn });
}

export function validateTicketReviewToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) throw new Error("Missing token");
  const decoded = jwt.verify(token, jwtSecret(), { algorithms: ["HS256"] });
  if (decoded.typ !== "remediation_ticket_reviewer") {
    throw new Error("Invalid token type");
  }
  return {
    ticketId: String(decoded.ticketId),
    itsmEmail: String(decoded.itsmEmail || "").toLowerCase(),
    tenantId: decoded.tenantId ? String(decoded.tenantId) : null,
  };
}

export function buildTicketReviewUrl(ticketId, token) {
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  return `${base}/remediation/ticket/${ticketId}/review?token=${encodeURIComponent(token)}`;
}
