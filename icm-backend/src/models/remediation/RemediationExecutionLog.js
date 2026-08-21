import mongoose from "mongoose";

const remediationExecutionLogSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicket",
      required: true,
      index: true,
    },
    ticketItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicketItem",
      index: true,
    },
    ticketNumber: { type: String, index: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
    campaignName: { type: String },
    userId: { type: String },
    itemEmail: { type: String },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    applicationName: { type: String },
    entitlementName: { type: String },
    decision: { type: String, enum: ["GRANT_ACCESS", "PENDING"] },
    status: {
      type: String,
      enum: ["PENDING", "EXECUTED", "FAILED", "SKIPPED"],
      default: "PENDING",
      index: true,
    },
    beforeState: { type: mongoose.Schema.Types.Mixed },
    afterState: { type: mongoose.Schema.Types.Mixed },
    executedBy: { type: String },
    executedAt: { type: Date, default: Date.now, index: true },
    error: { type: String },
    connectorRef: { type: String },
  },
  { timestamps: true, collection: "remediation_execution_logs" },
);

remediationExecutionLogSchema.index({ tenantId: 1, ticketId: 1, executedAt: -1 });

export default mongoose.model(
  "RemediationExecutionLog",
  remediationExecutionLogSchema,
);
