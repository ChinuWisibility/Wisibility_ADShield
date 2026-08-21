import WorkflowTicket, {
  TICKET_PROVIDERS,
  TICKET_STATUS,
} from "../../../models/ticket/WorkflowTicket.js";
import TicketCounter from "../../../models/ticket/TicketCounter.js";

async function nextTicketId(tenantId) {
  const key = `ticket:${tenantId || "global"}`;
  const counter = await TicketCounter.findByIdAndUpdate(
    key,
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  );
  return `TKT-${String(counter.seq).padStart(6, "0")}`;
}

const SUBJECT_FIELDS = [
  "identityId",
  "identityName",
  "identityEmail",
  "managerName",
  "managerEmail",
  "applicationId",
  "applicationName",
  "entitlementId",
  "entitlementName",
  "reviewerName",
  "reviewDate",
  "comments",
  "reviewItemId",
];

function pickSubject(input = {}) {
  const out = {};
  for (const key of SUBJECT_FIELDS) {
    if (input[key] != null && input[key] !== "") out[key] = input[key];
  }
  return out;
}

function toTicketOutput(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    ticketId: doc.ticketId,
    provider: doc.provider,
    status: doc.status,
    title: doc.title,
    description: doc.description,
    priority: doc.priority,
    assignedTeam: doc.assignedTeam,
    assignee: doc.assignee,
    externalRef: doc.externalRef || null,
    resolution: doc.resolution || null,
    identityName: doc.identityName,
    identityEmail: doc.identityEmail,
    managerName: doc.managerName,
    managerEmail: doc.managerEmail,
    applicationName: doc.applicationName,
    entitlementName: doc.entitlementName,
    reviewerName: doc.reviewerName,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
    closedAt: doc.closedAt ? new Date(doc.closedAt).toISOString() : null,
  };
}

async function findByTicketId(tenantId, ticketId) {
  if (!ticketId) return null;
  const filter = { ticketId: String(ticketId) };
  if (tenantId) filter.tenantId = String(tenantId);
  return WorkflowTicket.findOne(filter);
}

/**
 * Internal ticket provider — persists tickets in the app database. Implements the
 * provider interface { create, get, update, close } used by ticketService.
 */
export const internalProvider = {
  name: TICKET_PROVIDERS.INTERNAL,

  async create({ tenantId, executionId, ...input } = {}) {
    const ticketId = await nextTicketId(tenantId);
    const doc = await WorkflowTicket.create({
      ticketId,
      tenantId: tenantId ? String(tenantId) : undefined,
      provider: TICKET_PROVIDERS.INTERNAL,
      status: TICKET_STATUS.NEW,
      title: input.title || "Remediation Ticket",
      description: input.description || "",
      priority: input.priority || "MEDIUM",
      assignedTeam: input.assignedTeam || "",
      assignee: input.assignee || "",
      executionId: executionId || undefined,
      metadata: input.metadata || {},
      ...pickSubject(input),
    });
    return toTicketOutput(doc);
  },

  async get({ tenantId, ticketId } = {}) {
    const doc = await findByTicketId(tenantId, ticketId);
    return toTicketOutput(doc);
  },

  async update({ tenantId, ticketId, fields = {} } = {}) {
    const doc = await findByTicketId(tenantId, ticketId);
    if (!doc) return null;
    const allowed = [
      "title",
      "description",
      "priority",
      "assignedTeam",
      "assignee",
      "status",
      "comments",
      "resolution",
    ];
    for (const key of allowed) {
      if (fields[key] != null && fields[key] !== "") doc[key] = fields[key];
    }
    await doc.save();
    return toTicketOutput(doc);
  },

  async close({ tenantId, ticketId, resolution } = {}) {
    const doc = await findByTicketId(tenantId, ticketId);
    if (!doc) return null;
    doc.status = TICKET_STATUS.CLOSED;
    doc.closedAt = new Date();
    if (resolution) doc.resolution = resolution;
    await doc.save();
    return toTicketOutput(doc);
  },
};
