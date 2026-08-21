import mongoose from "mongoose";

const certificationScheduleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    scheduleName: { type: String, required: true, index: true, trim: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    campaignTemplate: { type: mongoose.Schema.Types.Mixed },
    recurrenceRule: { type: String },
    frequency: {
      type: String,
      enum: ["QUARTERLY", "MONTHLY", "SEMI_ANNUAL", "ANNUAL"],
      index: true,
    },
    isActive: { type: Boolean, index: true, default: true },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date, index: true },
    lastCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
    runCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_schedules" },
);

certificationScheduleSchema.index({ isActive: 1, nextRunAt: 1 });
certificationScheduleSchema.index({ tenantId: 1, isActive: 1, nextRunAt: 1 });

export default mongoose.model(
  "CertificationSchedule",
  certificationScheduleSchema,
);
