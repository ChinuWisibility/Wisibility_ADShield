import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    displayName: { type: String },
    description: { type: String },
    type: {
      type: String,
      enum: ["it", "business", "birthright", "composite"],
      default: "it",
    },
    status: {
      type: String,
      enum: ["active", "draft", "archived", "under_review"],
      default: "draft",
    },

    // Ownership
    owner: { type: String },
    ownerEmail: { type: String },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Identity" },

    // Access
    entitlements: [
      {
        entitlement: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Entitlement",
        },
        entitlementName: { type: String },
        applicationName: { type: String },
        grantType: {
          type: String,
          enum: ["MANDATORY", "OPTIONAL"],
          default: "MANDATORY",
        },
      },
    ],

    // Hierarchy
    parentRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
    childRoles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],

    // Risk
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
    },
    sodConflicts: { type: Number, default: 0 },

    // Stats
    totalMembers: { type: Number, default: 0 },
    totalEntitlements: { type: Number, default: 0 },

    // Mining
    isMined: { type: Boolean, default: false },
    miningConfidence: { type: Number },
    miningSource: { type: String },

    // Metadata
    isActive: { type: Boolean, default: true },
    isRequestable: { type: Boolean, default: true },
    requiresApproval: { type: Boolean, default: true },
    approvalWorkflow: { type: String },
    maxDuration: { type: Number }, // days, for time-limited assignments
    tags: [String],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "role_engineering" },
);

roleSchema.index({ name: 1 });
roleSchema.index({ tenantId: 1, name: 1 });
roleSchema.index({ status: 1 });
roleSchema.index({ type: 1 });

export default mongoose.model("Role", roleSchema);
