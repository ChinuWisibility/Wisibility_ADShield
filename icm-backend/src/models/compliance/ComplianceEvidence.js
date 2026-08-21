import mongoose from "mongoose";

const complianceEvidenceSchema = new mongoose.Schema(
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
    evidenceType: {
      type: String,
      index: true,
      enum: ["REPORT", "CERTIFICATION", "SOD_REVIEW", "AUDIT_LOG", "SIGN_OFF"],
    },
    evidenceRef: { type: mongoose.Schema.Types.ObjectId },
    periodStart: { type: Date, index: true },
    periodEnd: { type: Date, index: true },
    collectedAt: { type: Date, index: true },
    collectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    fileLocation: { type: String },
    status: {
      type: String,
      index: true,
      enum: ["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED"],
      default: "DRAFT",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "compliance_evidence" },
);

export default mongoose.model("ComplianceEvidence", complianceEvidenceSchema);
