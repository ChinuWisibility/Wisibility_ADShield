import RemediationEvent from "../../models/remediation/RemediationEvent.js";
import {
  remediationTenantFilter,
  remediationWithTenant,
} from "../../utils/remediation/remediationTenant.js";

function normalizeTicketStatus(status) {
  return String(status || "OPEN").trim().toUpperCase();
}

function deriveEventState(ticketStatus) {
  switch (normalizeTicketStatus(ticketStatus)) {
    case "IN_PROGRESS":
      return { status: "IN_PROGRESS", workflowState: "TICKET_IN_PROGRESS" };
    case "CLOSED":
      return { status: "COMPLETED", workflowState: "TICKET_CLOSED" };
    case "EXECUTED":
      return { status: "COMPLETED", workflowState: "RECORD_UPDATED" };
    case "OPEN":
    default:
      return { status: "OPEN", workflowState: "TICKET_CREATED" };
  }
}

function buildSourceRef(ticket) {
  const campaignNames = Array.isArray(ticket?.campaignNames)
    ? ticket.campaignNames.filter(Boolean)
    : [];
  if (!campaignNames.length) return ticket?.ticketNumber || "Remediation Ticket";
  if (campaignNames.length === 1) return campaignNames[0];
  if (campaignNames.length === 2) return campaignNames.join(", ");
  return `${campaignNames[0]} +${campaignNames.length - 1} more`;
}

function buildSubject(items = []) {
  const firstItem = items.find(Boolean) || {};
  return {
    identityEmail: firstItem.itemEmail || "",
    identityName: firstItem.itemName || "",
    accountId: firstItem.userId || "",
    applicationId: firstItem.applicationId ? String(firstItem.applicationId) : "",
    applicationName: firstItem.applicationName || "",
  };
}

function buildMetadata(ticket, items = []) {
  const applicationNames = Array.from(
    new Set(items.map((item) => item?.applicationName).filter(Boolean)),
  );

  return {
    campaignNames: Array.isArray(ticket?.campaignNames) ? ticket.campaignNames : [],
    itemCounts: ticket?.itemCounts || {},
    selectedUsersCount: items.length,
    applicationNames,
  };
}

export async function upsertRemediationEventForTicket(
  ctx,
  ticket,
  items = [],
  { reviewUrl } = {},
) {
  const scopedTenantId =
    ctx?.scopedTenantId ||
    ticket?.tenantId ||
    ctx?.tenantId ||
    null;
  if (!scopedTenantId || !ticket?._id) return null;

  const tenantFilter = remediationTenantFilter(scopedTenantId);
  const existing = await RemediationEvent.findOne({
    ...tenantFilter,
    $or: [
      { "ticket.ticketRecordId": String(ticket._id) },
      { "source.sourceId": String(ticket._id) },
    ],
  }).lean();

  const ticketStatus = normalizeTicketStatus(ticket.status);
  const { status, workflowState } = deriveEventState(ticketStatus);
  const now = new Date();

  const payload = {
    eventType: "REVOKE_ACCESS",
    status,
    workflowState,
    title: ticket.title || "Revoke Access Remediation Ticket",
    description:
      ticket.description ||
      `ITSM remediation ticket ${ticket.ticketNumber || ""}`.trim(),
    itsmEmail: ticket.itsmEmail || "",
    notification: {
      templateKey: existing?.notification?.templateKey || "ticket-revoke-access",
      status: ticket.notification?.status || existing?.notification?.status || "PENDING",
      sentAt: ticket.notification?.sentAt || existing?.notification?.sentAt,
      to: ticket.itsmEmail || existing?.notification?.to || "",
      error: ticket.notification?.error || existing?.notification?.error,
    },
    subject: buildSubject(items),
    source: {
      sourceType: "ITSM_REMEDIATION_TICKET",
      sourceId: String(ticket._id),
      sourceRef: buildSourceRef(ticket),
    },
    metadata: buildMetadata(ticket, items),
    ticket: {
      templateKey: existing?.ticket?.templateKey || "ticket-revoke-access",
      ticketRecordId: String(ticket._id),
      ticketId: ticket.ticketNumber || existing?.ticket?.ticketId || "",
      ticketStatus,
      ticketUrl: reviewUrl || existing?.ticket?.ticketUrl || "",
      openedAt: ticket.createdAt || existing?.ticket?.openedAt || now,
      closedAt:
        ticket.closedAt ||
        ticket.executedAt ||
        existing?.ticket?.closedAt ||
        undefined,
      assignedEmail: ticket.itsmEmail || existing?.ticket?.assignedEmail || "",
    },
    lastStatusAt: ticket.lastStatusAt || now,
  };

  const completedAt =
    ticketStatus === "CLOSED" || ticketStatus === "EXECUTED"
      ? ticket.executedAt || ticket.closedAt || now
      : null;

  if (!existing) {
    return RemediationEvent.create(
      remediationWithTenant(scopedTenantId, {
        ...payload,
        ...(completedAt ? { completedAt } : {}),
      }),
    );
  }

  const update = {
    $set: payload,
  };

  if (completedAt) {
    update.$set.completedAt = completedAt;
  } else {
    update.$unset = { completedAt: "" };
  }

  await RemediationEvent.updateOne({ _id: existing._id }, update);
  return RemediationEvent.findById(existing._id).lean();
}
