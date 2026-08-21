import mongoose from "mongoose";

const complianceMappingSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    frameworkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ComplianceFramework",
      index: true,
    },
    controlId: { type: String, index: true },
    entityType: {
      type: String,
      index: true,
      enum: ["ROLE", "SOD_POLICY", "CERTIFICATION", "APPLICATION"],
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    mappingNotes: { type: String },
    evidenceRequired: { type: Boolean, default: false },
    lastEvidenceDate: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "compliance_mappings" },
);

export default mongoose.model("ComplianceMapping", complianceMappingSchema);
