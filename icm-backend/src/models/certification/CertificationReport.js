import mongoose from "mongoose";

const certificationReportSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Campaign",
      required: true,
      index: true,
    },
    reportType: {
      type: String,
      enum: ["SUMMARY", "DETAILED", "SIGN_OFF", "REMEDIATION"],
      index: true,
    },
    format: { type: String, enum: ["PDF", "XLSX", "CSV"] },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    generatedAt: { type: Date, index: true, default: Date.now },
    fileLocation: { type: String },
    stats: { type: mongoose.Schema.Types.Mixed },
    signOffStatus: {
      type: String,
      enum: ["PENDING", "SIGNED", "REJECTED"],
      index: true,
      default: "PENDING",
    },
    signedBy: { type: String },
    signedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "certification_reports" },
);

certificationReportSchema.index({ campaignId: 1, generatedAt: -1 });
certificationReportSchema.index({ tenantId: 1, generatedAt: -1 });

export default mongoose.model("CertificationReport", certificationReportSchema);
