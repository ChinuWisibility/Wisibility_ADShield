import mongoose from "mongoose";

const applicationReportingRuleOverrideSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    useCustomRuleSet: { type: Boolean, default: false },
    alertThresholds: { type: mongoose.Schema.Types.Mixed },
    notifications: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "application_reporting_rule_overrides" },
);

applicationReportingRuleOverrideSchema.index(
  { tenantId: 1, applicationId: 1 },
  { unique: true },
);

export default mongoose.model(
  "ApplicationReportingRuleOverride",
  applicationReportingRuleOverrideSchema,
);
