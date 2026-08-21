import mongoose from "mongoose";

const roleHierarchySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    parentRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    childRoleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    inheritanceType: { type: String, enum: ["FULL", "PARTIAL"] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "role_hierarchies" },
);

roleHierarchySchema.index(
  { parentRoleId: 1, childRoleId: 1 },
  { unique: true },
);
roleHierarchySchema.index({ tenantId: 1, parentRoleId: 1 });

export default mongoose.model("RoleHierarchy", roleHierarchySchema);
