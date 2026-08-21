import mongoose from "mongoose";

const roleMiningResultSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    runId: { type: String, index: true },
    suggestedRoleName: { type: String },
    entitlementPattern: [String],
    userCount: { type: Number },
    coveragePercent: { type: Number },
    similarityScore: { type: Number },
    status: {
      type: String,
      enum: ["CANDIDATE", "APPROVED", "REJECTED", "PROMOTED"],
      default: "CANDIDATE",
      index: true,
    },
    promotedRoleId: { type: mongoose.Schema.Types.ObjectId, ref: "Role" },
  },
  { timestamps: true, collection: "role_mining_results" },
);

export default mongoose.model("RoleMiningResult", roleMiningResultSchema);
