import mongoose from "mongoose";

const riskBandTripleSchema = new mongoose.Schema(
  {
    mediumStartsAtPct: { type: Number, required: true },
    highStartsAtPct: { type: Number, required: true },
    criticalStartsAtPct: { type: Number, required: true },
  },
  { _id: false },
);

const reportingRuleSetSchema = new mongoose.Schema(
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
    alertThresholds: { type: mongoose.Schema.Types.Mixed, required: true },
    notifications: { type: mongoose.Schema.Types.Mixed, required: true },
    riskBands: { type: mongoose.Schema.Types.Mixed, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true, collection: "reporting_rule_sets" },
);

export { riskBandTripleSchema };
export default mongoose.model("ReportingRuleSet", reportingRuleSetSchema);
