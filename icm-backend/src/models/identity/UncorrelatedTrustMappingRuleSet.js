import mongoose from "mongoose";

const uncorrelatedTrustMappingRuleSetSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true,
      index: true,
    },
    tenantName: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    /** { useDefaultTrustMapping: boolean, mapping: { INACTIVE_ACCOUNT, ACTIVE_WITH_PRIVILEGED, ACTIVE_WITHOUT_PRIVILEGED } } */
    config: { type: mongoose.Schema.Types.Mixed, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true, collection: "uncorrelated_trust_mapping_rule_sets" },
);

export default mongoose.model(
  "UncorrelatedTrustMappingRuleSet",
  uncorrelatedTrustMappingRuleSetSchema,
);
