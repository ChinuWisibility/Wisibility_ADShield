import mongoose from "mongoose";

const remediationTicketSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    ticketNumber: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "CLOSED", "EXECUTED"],
      default: "OPEN",
      index: true,
    },
    itsmEmail: { type: String, required: true },
    title: { type: String },
    description: { type: String },
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    dueDate: { type: Date },
    additionalNotes: { type: String },
    campaignIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Campaign" }],
    campaignNames: [{ type: String }],
    requesterEmail: { type: String },
    requesterId: { type: String },
    requesterName: { type: String },
    notification: {
      status: {
        type: String,
        enum: ["PENDING", "SENT", "FAILED", "SKIPPED"],
        default: "PENDING",
      },
      sentAt: { type: Date },
      error: { type: String },
    },
    itemCounts: {
      total: { type: Number, default: 0 },
      pending: { type: Number, default: 0 },
      approved: { type: Number, default: 0 },
      denied: { type: Number, default: 0 },
      executed: { type: Number, default: 0 },
    },
    closedAt: { type: Date },
    executedAt: { type: Date },
    lastStatusAt: { type: Date },
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueue",
      index: true,
    },
    eventId: { type: String, index: true },
  },
  { timestamps: true, collection: "remediation_tickets" },
);

remediationTicketSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
remediationTicketSchema.index({ tenantId: 1, ticketNumber: 1 });

export default mongoose.model("RemediationTicket", remediationTicketSchema);
