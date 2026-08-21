import mongoose from "mongoose";

const sodRuleConditionSchema = new mongoose.Schema(
  {
    sodRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SodRule",
      index: true,
    },
    leftValue: { type: String },
    operator: {
      type: String,
      enum: ["EQUALS", "CONTAINS", "REGEX", "NOT_EQUALS"],
    },
    rightValue: { type: String },
  },
  { timestamps: true, collection: "sod_rule_conditions" },
);

export default mongoose.model("SodRuleCondition", sodRuleConditionSchema);
