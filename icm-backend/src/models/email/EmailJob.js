import mongoose from "mongoose";

const emailJobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["LAUNCH", "REMINDER", "ESCALATION", "EXPIRY", "WORKFLOW"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SENT", "FAILED"],
      default: "PENDING",
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
    recipientEmail: { type: String, required: true, index: true },
    reminderSubtype: { type: String },
    subject: { type: String, required: true },
    html: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: {
      type: Number,
      default: () => Number(process.env.EMAIL_JOB_MAX_ATTEMPTS || 4),
    },
    nextRunAt: { type: Date, default: Date.now, index: true },
    processingStartedAt: { type: Date },
    sentAt: { type: Date },
    lastError: { type: String },
    providerMessageId: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "email_jobs" },
);

emailJobSchema.index({ status: 1, nextRunAt: 1 });
emailJobSchema.index({
  campaignId: 1,
  recipientEmail: 1,
  type: 1,
  status: 1,
});

export default mongoose.model("EmailJob", emailJobSchema);
