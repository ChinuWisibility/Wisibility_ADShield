import mongoose from "mongoose";

const remediationTicketItemSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicket",
      required: true,
      index: true,
    },
    reviewItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReviewItem",
      index: true,
    },
    queueItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueueItem",
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      index: true,
    },
    campaignName: { type: String },
    userId: { type: String },
    itemName: { type: String },
    itemEmail: { type: String },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    applicationName: { type: String },
    entitlementName: { type: String },
    accessDetails: [{ type: String }],
    manager: { type: String },
    reviewerEmail: { type: String },
    reviewerName: { type: String },
    reviewedAt: { type: Date },
    remediationRequired: { type: Boolean, default: false },
    itemKey: { type: String, required: true, index: true },
    status: {
      type: String,
      enum: [
        "PENDING",
        "TICKET_CREATED",
        "IN_PROGRESS",
        "APPROVED",
        "DENIED",
        "PENDING_DECISION",
        "CLOSED",
        "EXECUTED",
      ],
      default: "TICKET_CREATED",
      index: true,
    },
    decision: {
      type: String,
      enum: ["GRANT_ACCESS", "PENDING"],
    },
    tentativeDate: { type: Date },
    comment: { type: String },
    respondedAt: { type: Date },
    respondedBy: { type: String },
    executedAt: { type: Date },
    executionStatus: {
      type: String,
      enum: ["PENDING", "EXECUTED", "FAILED", "SKIPPED"],
      default: "PENDING",
    },
    executionError: { type: String },
    beforeState: { type: mongoose.Schema.Types.Mixed },
    afterState: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "remediation_ticket_items" },
);

remediationTicketItemSchema.index(
  { ticketId: 1, itemKey: 1 },
  { unique: true },
);
remediationTicketItemSchema.index({ tenantId: 1, ticketId: 1, status: 1 });

export default mongoose.model("RemediationTicketItem", remediationTicketItemSchema);
