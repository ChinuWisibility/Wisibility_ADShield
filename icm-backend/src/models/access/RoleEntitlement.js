import mongoose from "mongoose";

const roleEntitlementSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entitlement",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    grantType: { type: String, enum: ["MANDATORY", "OPTIONAL", "CONDITIONAL"] },
    conditions: { type: mongoose.Schema.Types.Mixed },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    addedAt: { type: Date },
    isActive: { type: Boolean, index: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "role_entitlements" },
);

roleEntitlementSchema.index(
  { roleId: 1, entitlementId: 1, applicationId: 1 },
  { unique: true },
);
roleEntitlementSchema.index({ tenantId: 1, roleId: 1 });

export default mongoose.model("RoleEntitlement", roleEntitlementSchema);
