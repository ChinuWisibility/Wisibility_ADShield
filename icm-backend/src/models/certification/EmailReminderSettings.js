import mongoose from "mongoose";

const emailReminderSettingsSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      // null = global (tenant-level)
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      // Scopes global settings per tenant
    },
    frequency: {
      type: String,
      enum: ["WEEKLY", "MONTHLY", "TWO_DAYS_BEFORE_END"],
    },
    lastReminderRunAt: { type: Date, default: null },
    dayOfWeek: { type: Number, min: 0, max: 6 },
    dayOfMonth: { type: Number, min: 1, max: 31 },
    isActive: { type: Boolean, default: true },
    autoIdentityCertification: {
      enabled: { type: Boolean, default: false },
      defaultDueDays: { type: Number, min: 1, max: 365, default: 7 },
    },
    autoPrivilegedCertification: {
      enabled: { type: Boolean, default: false },
      defaultDueDays: { type: Number, min: 1, max: 365, default: 7 },
      notifyTarget: {
        type: String,
        enum: ["OWNER", "MANAGER", "BOTH"],
        default: "OWNER",
      },
      includeAllAccessItems: { type: Boolean, default: false },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "email_reminder_settings" },
);

emailReminderSettingsSchema.index({ campaignId: 1, tenantId: 1 });
emailReminderSettingsSchema.index(
  { tenantId: 1 },
  { unique: true, partialFilterExpression: { campaignId: null } },
);
emailReminderSettingsSchema.index({ tenantId: 1, isActive: 1 });

export default mongoose.model(
  "EmailReminderSettings",
  emailReminderSettingsSchema,
);
