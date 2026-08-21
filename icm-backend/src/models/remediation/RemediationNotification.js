import mongoose from "mongoose";

const remediationNotificationSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueue",
      index: true,
    },
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationTicket",
      index: true,
    },
    validationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationValidation",
      index: true,
    },
    notificationType: {
      type: String,
      enum: ["INITIAL", "REMINDER", "VALIDATION_DUE", "VALIDATION_EXPIRED"],
      required: true,
      index: true,
    },
    recipientEmail: { type: String, required: true },
    sentAt: { type: Date, default: Date.now, index: true },
    status: {
      type: String,
      enum: ["SENT", "FAILED", "SKIPPED"],
      default: "SENT",
    },
    templateName: { type: String },
    error: { type: String },
  },
  { timestamps: true, collection: "remediation_notifications" },
);

remediationNotificationSchema.index({ tenantId: 1, queueId: 1, notificationType: 1, sentAt: -1 });

export default mongoose.model("RemediationNotification", remediationNotificationSchema);
