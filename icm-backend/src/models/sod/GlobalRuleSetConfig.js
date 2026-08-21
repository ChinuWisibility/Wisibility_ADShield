import mongoose from "mongoose";

const globalRuleSetConfigSchema = new mongoose.Schema(
  {
    configName: { type: String, required: true },
    ruleType: { type: String, enum: ["NHI", "PRIVILEGED", "SOD"], index: true },
    rules: [mongoose.Schema.Types.Mixed],
    isGlobal: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, collection: "global_rule_set_configs" },
);

globalRuleSetConfigSchema.index({ configName: 1 });

export default mongoose.model("GlobalRuleSetConfig", globalRuleSetConfigSchema);
