import mongoose from "mongoose";

const roleComplianceMappingSchema = new mongoose.Schema(
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
    frameworkId: {
      type: String,
      enum: ["SOX", "GDPR", "HIPAA", "PCI-DSS"],
      index: true,
    },
    controlId: { type: String, index: true },
    notes: { type: String },
    mappedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    mappedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "role_compliance_mappings" },
);

roleComplianceMappingSchema.index({ roleId: 1, frameworkId: 1 });
roleComplianceMappingSchema.index({ tenantId: 1, roleId: 1 });

export default mongoose.model(
  "RoleComplianceMapping",
  roleComplianceMappingSchema,
);
