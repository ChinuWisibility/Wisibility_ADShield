import mongoose from "mongoose";

const governancePolicySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    policyName: { type: String, required: true, index: true },
    policyType: {
      type: String,
      index: true,
      enum: ["ACCESS", "DATA", "SECURITY", "IDENTITY"],
    },
    description: { type: String },
    controls: [{ type: mongoose.Schema.Types.Mixed }],
    owner: { type: String },
    reviewFrequencyDays: { type: Number },
    lastReviewedAt: { type: Date },
    nextReviewDate: { type: Date, index: true },
    isActive: { type: Boolean, index: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "governance_policies" },
);

export default mongoose.model("GovernancePolicy", governancePolicySchema);
