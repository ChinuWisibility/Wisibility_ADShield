import mongoose from "mongoose";

const remediationQueueItemSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueue",
      required: true,
      index: true,
    },
    identityId: { type: String, index: true },
    identityName: { type: String },
    identityEmail: { type: String },
    accountId: { type: String, index: true },
    entitlementName: { type: String },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application", index: true },
    applicationName: { type: String },
    managerEmail: { type: String },
    reviewItemId: { type: mongoose.Schema.Types.ObjectId, ref: "ReviewItem" },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
    itemKey: { type: String, index: true },
    accessDetails: [{ type: String }],
    currentStatus: {
      type: String,
      enum: ["PENDING", "TICKET_CREATED", "IN_PROGRESS", "COMPLETED"],
      default: "PENDING",
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "remediation_queue_items" },
);

remediationQueueItemSchema.index({ tenantId: 1, queueId: 1 });
remediationQueueItemSchema.index(
  { queueId: 1, identityId: 1, accountId: 1, entitlementName: 1 },
  { sparse: true },
);

export default mongoose.model("RemediationQueueItem", remediationQueueItemSchema);
