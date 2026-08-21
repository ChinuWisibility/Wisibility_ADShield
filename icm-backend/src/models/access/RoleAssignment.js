import mongoose from "mongoose";

const roleAssignmentSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
      required: true,
      index: true,
    },
    assignmentType: { type: String, enum: ["DIRECT", "RULE_BASED", "REQUEST"] },
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    grantedAt: { type: Date, default: Date.now, index: true },
    validTo: { type: Date, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: "RoleRequest" },
    isActive: { type: Boolean, default: true, index: true },
    revokedAt: { type: Date },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "role_assignments" },
);

roleAssignmentSchema.index({ identityId: 1, roleId: 1 });
roleAssignmentSchema.index({ tenantId: 1, identityId: 1 });

export default mongoose.model("RoleAssignment", roleAssignmentSchema);
