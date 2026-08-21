import mongoose from "mongoose";

const campaignReminderLogSchema = new mongoose.Schema(
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
    recipientEmail: { type: String },
    reminderType: {
      type: String,
      enum: ["STANDARD", "ESCALATION", "EXPIRY"],
    },
    // Only populated once a send actually completes (SENT/FAILED). A freshly
    // created reservation (deliveryStatus: "PENDING") leaves this unset so it
    // stays invisible to "last reminder sent" readers.
    sentAt: {
      type: Date,
      index: true,
    },
    // PENDING = an atomic reservation held while an email is queued/sending.
    // It is upgraded to SENT on successful delivery, or FAILED on terminal failure.
    deliveryStatus: {
      type: String,
      enum: ["PENDING", "SENT", "FAILED", "BOUNCED"],
    },
    // Frequency-window bucket the reservation belongs to (e.g. "W:2026-08-17").
    windowKey: { type: String },
    // Idempotency key = `${campaignId}|${recipientEmail}|${reminderType}|${windowKey}`.
    // Unique (sparse) so at most one active reservation/send exists per window.
    dedupeKey: { type: String },
  },
  { timestamps: true, collection: "campaign_reminder_logs" },
);

campaignReminderLogSchema.index({ campaignId: 1, sentAt: -1 });
// Supports per-reviewer last-sent lookup: findOne({ campaignId, recipientEmail, deliveryStatus: 'SENT' }).sort({ sentAt: -1 })
campaignReminderLogSchema.index({
  campaignId: 1,
  recipientEmail: 1,
  deliveryStatus: 1,
  sentAt: -1,
});
campaignReminderLogSchema.index({ tenantId: 1, sentAt: -1 });
// Atomic race guard: one reservation/send per campaign+reviewer+type+window.
// Sparse so legacy rows (and freed reservations with dedupeKey unset) are ignored.
campaignReminderLogSchema.index(
  { dedupeKey: 1 },
  { unique: true, sparse: true },
);

export default mongoose.model("CampaignReminderLog", campaignReminderLogSchema);
