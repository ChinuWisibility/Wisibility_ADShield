import mongoose from "mongoose";

const emailDeliveryLogSchema = new mongoose.Schema(
  {
    emailJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailJob",
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    recipientEmail: { type: String, index: true },
    emailType: {
      type: String,
      enum: ["LAUNCH", "REMINDER", "ESCALATION", "EXPIRY", "WORKFLOW", "OTHER"],
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: ["SENT", "DELIVERED", "BOUNCED", "FAILED"],
      index: true,
    },
    providerMessageId: { type: String },
    provider: { type: String },
    errorMessage: { type: String },
    deliveredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "email_delivery_logs" },
);

emailDeliveryLogSchema.index({ campaignId: 1, recipientEmail: 1, deliveredAt: -1 });
emailDeliveryLogSchema.index({ tenantId: 1, campaignId: 1, deliveredAt: -1 });

export default mongoose.model("EmailDeliveryLog", emailDeliveryLogSchema);
