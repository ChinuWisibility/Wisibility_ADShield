import mongoose from "mongoose";

/**
 * Precomputed manager-mismatch findings per correlated identity↔account link.
 * Thin search fields + full item for display (dual-read during V2 migration).
 */
const applicationManagerMismatchSchema = new mongoose.Schema(
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
    identityId: { type: String, required: true, index: true },
    accountId: { type: String, default: null },
    mismatchType: { type: String, default: null, index: true },
    /** Full hygiene widget-item payload (kind: managerMismatch). */
    item: { type: mongoose.Schema.Types.Mixed, required: true },
    searchText: { type: String, default: "", index: true },
    searchDisplayName: { type: String, default: "" },
    searchEmail: { type: String, default: "" },
    searchAccount: { type: String, default: "" },
    searchEmployeeId: { type: String, default: "" },
    predicateVersion: { type: Number, required: true, default: 1 },
    observedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true, collection: "application_manager_mismatches" },
);

applicationManagerMismatchSchema.index(
  { applicationId: 1, identityId: 1, accountId: 1 },
  { unique: true },
);
applicationManagerMismatchSchema.index({ applicationId: 1, predicateVersion: 1 });
applicationManagerMismatchSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchDisplayName: 1,
});
applicationManagerMismatchSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchEmail: 1,
});
applicationManagerMismatchSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchAccount: 1,
});
applicationManagerMismatchSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchEmployeeId: 1,
});
applicationManagerMismatchSchema.index({
  tenantId: 1,
  applicationId: 1,
  searchText: 1,
});

export default mongoose.model(
  "ApplicationManagerMismatch",
  applicationManagerMismatchSchema,
);
