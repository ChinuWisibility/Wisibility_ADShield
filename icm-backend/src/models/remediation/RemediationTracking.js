import mongoose from "mongoose";

const stageStatusSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["PENDING", "SENT", "GRANTED", "VALIDATED", "FAILED", "EXPIRED"],
      default: "PENDING",
    },
    at: { type: Date },
  },
  { _id: false },
);

const remediationTrackingSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RemediationQueue",
      required: true,
      index: true,
    },
    emailStatus: { type: stageStatusSchema, default: () => ({ status: "PENDING" }) },
    managerStatus: { type: stageStatusSchema, default: () => ({ status: "PENDING" }) },
    itsmStatus: { type: stageStatusSchema, default: () => ({ status: "PENDING" }) },
    validationStatus: { type: stageStatusSchema, default: () => ({ status: "PENDING" }) },
    reportingStatus: { type: stageStatusSchema, default: () => ({ status: "PENDING" }) },
  },
  { timestamps: true, collection: "remediation_tracking" },
);

remediationTrackingSchema.index({ tenantId: 1, eventId: 1 }, { unique: true });
remediationTrackingSchema.index({ tenantId: 1, queueId: 1 });

export default mongoose.model("RemediationTracking", remediationTrackingSchema);
