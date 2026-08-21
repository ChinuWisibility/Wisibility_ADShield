import mongoose from "mongoose";

const complianceControlSchema = new mongoose.Schema(
  {
    controlId: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true },
    severity: { type: String, trim: true, uppercase: true },
    isRequired: { type: Boolean, default: true },
  },
  { _id: false },
);

const complianceFrameworkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    frameworkCode: { type: String, index: true, trim: true, uppercase: true },
    frameworkName: { type: String, required: true, index: true },
    frameworkVersion: { type: String },
    description: { type: String },
    controls: { type: [complianceControlSchema], default: [] },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "compliance_frameworks" },
);

complianceFrameworkSchema.index({ frameworkCode: 1, frameworkVersion: 1 });
complianceFrameworkSchema.index({ tenantId: 1, frameworkCode: 1 });

export default mongoose.model("ComplianceFramework", complianceFrameworkSchema);
