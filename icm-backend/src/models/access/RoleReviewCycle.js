import mongoose from "mongoose";

const roleReviewCycleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    roleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role", index: true },
    reviewType: {
      type: String,
      enum: ["PERIODIC", "TRIGGERED", "AD_HOC"],
      index: true,
    },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"],
      default: "PENDING",
      index: true,
    },
    scheduledDate: { type: Date, index: true },
    completedDate: { type: Date },
    outcome: { type: String, enum: ["APPROVED", "MODIFIED", "DEPRECATED"] },
    notes: { type: String },
  },
  { timestamps: true, collection: "role_review_cycles" },
);

export default mongoose.model("RoleReviewCycle", roleReviewCycleSchema);
