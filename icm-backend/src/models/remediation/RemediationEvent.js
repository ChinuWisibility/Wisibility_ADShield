import mongoose from "mongoose";

const remediationEventSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    eventType: {
      type: String,
      enum: [
        "REVOKE_ACCESS",
        "MISSING_MANAGER",
        "DUPLICATE_ACCOUNT",
        "ORPHAN_ACCOUNT",
        "REVOKE_PRIVILEGED_ACCESS",
        "INACTIVE_USER_ACCESS",
      ],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELED"],
      default: "OPEN",
      index: true,
    },
    workflowState: {
      type: String,
      enum: [
        "DETECTED",
        "NOTIFIED",
        "TICKET_CREATED",
        "TICKET_IN_PROGRESS",
        "TICKET_CLOSED",
        "RECORD_UPDATED",
        "NOTIFICATION_FAILED",
      ],
      default: "DETECTED",
      index: true,
    },
    title: { type: String },
    description: { type: String },
    itsmEmail: { type: String },
    notification: {
      templateKey: { type: String },
      status: {
        type: String,
        enum: ["PENDING", "SENT", "FAILED", "SKIPPED"],
        default: "PENDING",
      },
      sentAt: { type: Date },
      to: { type: String },
      error: { type: String },
    },
    ticket: {
      templateKey: { type: String },
      ticketRecordId: { type: String, index: true },
      ticketId: { type: String },
      ticketStatus: { type: String },
      ticketUrl: { type: String },
      openedAt: { type: Date },
      closedAt: { type: Date },
      assignedEmail: { type: String },
    },
    subject: {
      identityId: { type: String },
      identityEmail: { type: String },
      identityName: { type: String },
      accountId: { type: String },
      accountLinkId: { type: String },
      applicationId: { type: String },
      applicationName: { type: String },
    },
    source: {
      sourceType: { type: String },
      sourceId: { type: String },
      sourceRef: { type: String },
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    completedAt: { type: Date },
    lastStatusAt: { type: Date },
  },
  { timestamps: true, collection: "remediation_events" },
);

remediationEventSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
remediationEventSchema.index({ tenantId: 1, eventType: 1, createdAt: -1 });

export default mongoose.model("RemediationEvent", remediationEventSchema);
