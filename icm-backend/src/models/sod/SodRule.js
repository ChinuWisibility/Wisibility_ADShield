import mongoose from "mongoose";

const sodRuleSchema = new mongoose.Schema(
  {
    ruleSetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodRuleSet",
      index: true,
    },
    ruleName: { type: String, index: true },
    ruleType: {
      type: String,
      enum: ["ENTITLEMENT_PAIR", "FUNCTION_PAIR", "ROLE_PAIR"],
      index: true,
    },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      index: true,
    },
    riskRating: { type: Number, min: 0, max: 10 },
    isActive: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },
    owner: { type: String },
  },
  { timestamps: true, collection: "sod_rules" },
);

sodRuleSchema.index({ ruleSetId: 1, isActive: 1 });

export default mongoose.model("SodRule", sodRuleSchema);
