import mongoose from "mongoose";

const accountSchema = new mongoose.Schema(
  {
    nativeIdentity: { type: String, required: true },
    displayName: { type: String },
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
    },
    applicationName: { type: String },
    identity: { type: mongoose.Schema.Types.ObjectId, ref: "Identity" },
    identityName: { type: String },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },

    accountType: {
      type: String,
      enum: ["personal", "service", "shared", "privileged", "admin"],
      default: "personal",
    },
    status: {
      type: String,
      enum: ["active", "disabled", "locked", "expired", "orphan"],
      default: "active",
    },

    isOrphan: { type: Boolean, default: false },
    isPrivileged: { type: Boolean, default: false },
    isCorrelated: { type: Boolean, default: false },

    lastLogin: { type: Date },
    passwordLastSet: { type: Date },
    passwordExpiry: { type: Date },
    accountExpiry: { type: Date },

    entitlements: [{ type: String }],
    groups: [{ type: String }],
    totalEntitlements: { type: Number, default: 0 },

    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "LOW",
    },
    attributes: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "account_aggregations" },
);

accountSchema.index({ application: 1 });
accountSchema.index({ tenantId: 1, application: 1 });
accountSchema.index({ identity: 1 });
accountSchema.index({ isOrphan: 1 });
accountSchema.index({ status: 1 });

export default mongoose.model("Account", accountSchema);
