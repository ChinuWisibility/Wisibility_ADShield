import mongoose from "mongoose";

const sodRemediationActionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    violationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodViolation",
      index: true,
    },
    remediationType: {
      type: String,
      enum: ["REMOVE_ACCESS", "REASSIGN", "RESTRUCTURE", "ACCEPT"],
    },
    assignedTo: { type: String },
    targetDate: { type: Date },
    actionStatus: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"],
      default: "OPEN",
      index: true,
    },
    completedAt: { type: Date },
  },
  { timestamps: true, collection: "sod_remediation_actions" },
);

// Common query pattern: open actions by tenant
sodRemediationActionSchema.index({ tenantId: 1, actionStatus: 1 });

export default mongoose.model(
  "SodRemediationAction",
  sodRemediationActionSchema,
);
