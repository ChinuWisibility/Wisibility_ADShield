import mongoose from "mongoose";

/**
 * Sidecar of app users that are inactive but still have entitlements / access.
 * Built at ingest using {@link isInactiveAppUserWithAccess}; hygiene counts this collection.
 */
const applicationUserInactiveAccessSchema = new mongoose.Schema(
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
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    primaryKeyNormalized: { type: String, default: null },
    searchText: { type: String, default: "" },
    searchDisplayName: { type: String, default: "" },
    searchEmail: { type: String, default: "" },
    searchAccount: { type: String, default: "" },
    searchEmployeeId: { type: String, default: "" },
    /** Bump when isInactiveAppUserWithAccess semantics change to force rebuild. */
    predicateVersion: { type: Number, required: true, default: 1 },
    observedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, collection: "application_user_inactive_access" },
);

applicationUserInactiveAccessSchema.index(
  { applicationId: 1, userId: 1 },
  { unique: true },
);
applicationUserInactiveAccessSchema.index({ applicationId: 1, predicateVersion: 1 });
applicationUserInactiveAccessSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchDisplayName: 1,
});
applicationUserInactiveAccessSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchEmail: 1,
});
applicationUserInactiveAccessSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchAccount: 1,
});
applicationUserInactiveAccessSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchText: 1,
});

export default mongoose.model(
  "ApplicationUserInactiveAccess",
  applicationUserInactiveAccessSchema,
);
