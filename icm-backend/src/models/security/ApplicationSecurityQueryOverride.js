import mongoose from "mongoose";

const applicationSecurityQueryOverrideSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    featureKey: { type: String, required: true, index: true },
    ldapFilter: { type: String, default: "" },
    searchBase: { type: String, default: "" },
    searchScope: { type: String, default: "" },
    enabled: { type: Boolean, default: true },
    modified: { type: Boolean, default: false },
    modifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, collection: "application_security_query_overrides" },
);

applicationSecurityQueryOverrideSchema.index(
  { applicationId: 1, featureKey: 1 },
  { unique: true },
);

export default mongoose.model(
  "ApplicationSecurityQueryOverride",
  applicationSecurityQueryOverrideSchema,
);
