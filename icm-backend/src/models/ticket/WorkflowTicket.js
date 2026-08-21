import mongoose from "mongoose";

export const TICKET_PROVIDERS = {
  INTERNAL: "internal",
  SERVICENOW: "servicenow",
  JIRA: "jira",
  REST: "rest",
  EMAIL: "email",
};

export const TICKET_STATUS = {
  NEW: "NEW",
  IN_PROGRESS: "IN_PROGRESS",
  PENDING: "PENDING",
  CLOSED: "CLOSED",
};

/**
 * First-class remediation ticket, decoupled from any specific ITSM provider.
 * Workflow steps (Create/Get/Update/Close Ticket) operate on this entity via the
 * ticket provider abstraction. The Internal provider stores rows here; external
 * providers (ServiceNow/Jira/REST/Email) keep a reference in `externalRef`.
 */
const workflowTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true, index: true },
    tenantId: { type: String, index: true },
    provider: {
      type: String,
      enum: Object.values(TICKET_PROVIDERS),
      default: TICKET_PROVIDERS.INTERNAL,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(TICKET_STATUS),
      default: TICKET_STATUS.NEW,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String },
    priority: { type: String, default: "MEDIUM" },
    assignedTeam: { type: String },
    assignee: { type: String },

    // Subject context (populated from the workflow trigger via step config).
    identityId: { type: String },
    identityName: { type: String },
    identityEmail: { type: String },
    managerName: { type: String },
    managerEmail: { type: String },
    applicationId: { type: String },
    applicationName: { type: String },
    entitlementId: { type: String },
    entitlementName: { type: String },
    reviewerName: { type: String },
    reviewDate: { type: String },
    comments: { type: String },

    // Reference back to the workflow run that opened the ticket.
    executionId: { type: String, index: true },
    reviewItemId: { type: String },

    // Opaque reference for external providers (ServiceNow sys_id, Jira key, …).
    externalRef: { type: String },

    resolution: { type: String },
    closedAt: { type: Date },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "workflow_tickets",
  },
);

export default mongoose.model("WorkflowTicket", workflowTicketSchema);
