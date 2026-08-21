import mongoose from "mongoose";

const securityPolicySchema = new mongoose.Schema(
  {
    policyKey: { type: String, index: true, sparse: true },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      required: true,
    },
    conditions: { type: [String], default: [] },
    conditionMode: {
      type: String,
      enum: ["AND", "OR"],
      default: "AND",
    },
    description: { type: String, default: "" },
    recommendation: { type: String, default: "" },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      default: null,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
      index: true,
    },
    builtIn: { type: Boolean, default: false },
    clonedFrom: { type: String, default: null },
  },
  { timestamps: true, collection: "security_policies" },
);

securityPolicySchema.index(
  { policyKey: 1, tenantId: 1, applicationId: 1 },
  { unique: true, sparse: true },
);

export default mongoose.model("SecurityPolicy", securityPolicySchema);
