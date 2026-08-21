import mongoose from "mongoose";

const sodRiskScoreSchema = new mongoose.Schema(
  {
    violationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodViolation",
      unique: true,
    },
    businessCriticality: { type: Number, min: 0, max: 10 },
    privilegeLevel: { type: Number, min: 0, max: 10 },
    financialImpact: { type: Number, min: 0, max: 10 },
    likelihood: { type: Number, min: 0, max: 10 },
    totalRiskScore: { type: Number, min: 0, max: 100, index: true },
    calculatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "sod_risk_scores" },
);

export default mongoose.model("SodRiskScore", sodRiskScoreSchema);
