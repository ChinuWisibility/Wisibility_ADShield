import mongoose from "mongoose";

const campaignAuditLogSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "EMAIL_ENQUEUED",
        "EMAIL_SENT",
        "EMAIL_FAILED",
        "EMAIL_DEDUPE_SKIPPED",
        "EMAIL_RETRY_SCHEDULED",
      ],
      required: true,
      index: true,
    },
    emailType: {
      type: String,
      enum: ["LAUNCH", "REMINDER", "ESCALATION", "EXPIRY"],
      index: true,
    },
    recipientEmail: { type: String, index: true },
    emailJobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailJob",
      index: true,
    },
    actorType: {
      type: String,
      enum: ["SYSTEM", "USER", "WORKER", "SCHEDULER"],
      default: "SYSTEM",
    },
    actorId: { type: String },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "campaign_audit_logs",
  },
);

campaignAuditLogSchema.index({ campaignId: 1, createdAt: -1 });
campaignAuditLogSchema.index({ tenantId: 1, campaignId: 1, createdAt: -1 });

export default mongoose.model("CampaignAuditLog", campaignAuditLogSchema);
