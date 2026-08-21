import mongoose from "mongoose";

const entitlementSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    // Core identification
    entitlementName: { type: String, required: true, index: true },
    name: { type: String }, // legacy alias
    displayName: { type: String },
    description: { type: String },

    // Application linkage
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
    }, // legacy
    applicationName: { type: String },

    // Source mapping
    sourceAttribute: { type: String }, // CSV column name
    sourceValue: { type: String }, // CSV column value
    value: { type: String },
    source: { type: String },

    // Risk & classification
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
      index: true,
    },
    isPrivileged: { type: Boolean, default: false, index: true },
    classification: {
      type: String,
      enum: ["standard", "sensitive", "privileged", "restricted"],
      default: "standard",
    },

    // Ownership
    owner: { type: String },
    ownerEmail: { type: String },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Identity" },

    // Stats
    totalUsers: { type: Number, default: 0 },
    totalViolations: { type: Number, default: 0 },

    // Metadata
    isActive: { type: Boolean, default: true },
    isRequestable: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: true },
    attributes: { type: mongoose.Schema.Types.Mixed },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: "UploadHistory" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "entitlements" },
);

entitlementSchema.index({ applicationId: 1, entitlementName: 1 });
entitlementSchema.index({ tenantId: 1, applicationId: 1 });
entitlementSchema.index({
  entitlementName: "text",
  displayName: "text",
  applicationName: "text",
});

export default mongoose.model("Entitlement", entitlementSchema);
