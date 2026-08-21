import mongoose from "mongoose";

const sodRuleSetSchema = new mongoose.Schema(
  {
    ruleSetName: { type: String, index: true },
    systemScope: { type: String, index: true },
    owner: { type: String },
    riskDomain: {
      type: String,
      enum: ["FINANCIAL", "PROCUREMENT", "HR", "IT", "COMPLIANCE"],
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "sod_rule_sets" },
);

export default mongoose.model("SodRuleSet", sodRuleSetSchema);
