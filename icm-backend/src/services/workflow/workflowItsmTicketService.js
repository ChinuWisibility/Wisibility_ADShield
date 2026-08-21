import env from "../../config/env.js";
import RemediationEvent from "../../models/remediation/RemediationEvent.js";
import { sendRemediationEmail } from "../remediationNotificationService.js";

const REVOKE_ACCESS_TEMPLATE = "remediation-revoke-access";

export function createPseudoTicketId() {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RM-${stamp}-${rand}`;
}

/** Resolve ITSM notification recipient from step assignee or IAM team email. */
export async function resolveItsmAssigneeEmail(assignee, tenantId) {
  const candidate = String(assignee || "").trim();
  if (candidate.includes("@")) return candidate.toLowerCase();
  const { resolveIamTeamEmail } = await import("../system/iamTeamEmailService.js");
  const fromOrg = String((await resolveIamTeamEmail(tenantId)) || "").trim();
  if (fromOrg.includes("@")) return fromOrg.toLowerCase();
  return "";
}

/**
 * Human-readable ITSM status for executions dashboard (not internal workflowState).
 */
export function formatItsmTicketStatusLabel(evt) {
  if (!evt) return null;

  const ticketStatus = String(evt.ticket?.ticketStatus || "").trim().toUpperCase();
  if (ticketStatus) return ticketStatus;

  const eventStatus = String(evt.status || "").trim().toUpperCase();
  if (eventStatus === "OPEN" || eventStatus === "IN_PROGRESS") return eventStatus;
  if (eventStatus === "COMPLETED") return "CLOSED";
  if (eventStatus === "CANCELED") return "CANCELED";
  if (eventStatus === "FAILED") return "FAILED";

  switch (String(evt.workflowState || "")) {
    case "TICKET_CREATED":
    case "NOTIFIED":
    case "DETECTED":
      return "OPEN";
    case "TICKET_IN_PROGRESS":
      return "IN_PROGRESS";
    case "TICKET_CLOSED":
      return "CLOSED";
    default:
      return evt.workflowState || eventStatus || null;
  }
}

function buildNotificationData(event) {
  return {
    eventType: event.eventType,
    title: event.title || "Remediation Action Required",
    description: event.description || "",
    identityName: event.subject?.identityName || "",
    identityEmail: event.subject?.identityEmail || "",
    accountId: event.subject?.accountId || "",
    applicationName: event.subject?.applicationName || "",
    itsmEmail: event.itsmEmail || "",
    ticketId: event.ticket?.ticketId || "",
    ticketStatus: event.ticket?.ticketStatus || "OPEN",
    remediationUrl: `${env.frontendUrl}/governance/remediation`,
    triggeredBy: "certification-workflow",
  };
}

/**
 * Send ITSM queue notification (same template as manual remediation events).
 */
export async function notifyItsmAssigneeForTicket(event) {
  const to = event.itsmEmail || event.ticket?.assignedEmail || "";
  if (!to || !to.includes("@")) {
    return { status: "SKIPPED", error: "No ITSM assignee email configured" };
  }

  try {
    const result = await sendRemediationEmail({
      templateKey: event.notification?.templateKey || REVOKE_ACCESS_TEMPLATE,
      to,
      data: buildNotificationData(event),
    });
    return result;
  } catch (err) {
    return { status: "FAILED", error: err?.message || "Send failed" };
  }
}

/**
 * Patch legacy workflow tickets missing ticket.* fields (best-effort).
 */
export async function ensureWorkflowTicketShape(eventId) {
  const evt = await RemediationEvent.findById(eventId);
  if (!evt) return null;

  let changed = false;
  if (!evt.ticket?.ticketId) {
    evt.ticket = evt.ticket || {};
    evt.ticket.ticketId = createPseudoTicketId();
    changed = true;
  }
  if (!evt.ticket?.ticketStatus) {
    evt.ticket.ticketStatus = "OPEN";
    changed = true;
  }
  if (!evt.ticket?.openedAt) {
    evt.ticket.openedAt = evt.createdAt || new Date();
    changed = true;
  }
  if (changed) {
    evt.lastStatusAt = new Date();
    await evt.save();
  }
  return evt.toObject ? evt.toObject() : evt;
}
