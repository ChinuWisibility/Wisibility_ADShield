import mongoose from "mongoose";

const sodPolicyImpactAnalysisSchema = new mongoose.Schema(
  {
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodPolicy",
      index: true,
    },
    analysisType: {
      type: String,
      enum: ["NEW_POLICY", "RULE_CHANGE", "APP_ADDITION"],
    },
    identitiesAffected: { type: Number, default: 0 },
    violationsProjected: { type: Number, default: 0 },
    applicationsInScope: [String],
    highRiskCount: { type: Number, default: 0 },
    analysedAt: { type: Date, default: Date.now, index: true },
    analysedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approved: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "sod_policy_impact_analyses" },
);

export default mongoose.model(
  "SodPolicyImpactAnalysis",
  sodPolicyImpactAnalysisSchema,
);
