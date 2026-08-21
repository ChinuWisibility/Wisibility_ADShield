import mongoose from "mongoose";

const reportDefinitionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    reportName: { type: String, required: true, index: true },
    reportType: {
      type: String,
      index: true,
      enum: [
        "SOD_SUMMARY",
        "CERT_STATUS",
        "IDENTITY_RISK",
        "USER_ACCESS",
        "ORPHAN",
      ],
    },
    filters: { type: mongoose.Schema.Types.Mixed },
    columns: [{ type: String }],
    format: { type: String, enum: ["PDF", "XLSX", "CSV"] },
    schedule: { type: String },
    recipients: [{ type: String }],
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "report_definitions" },
);

export default mongoose.model("ReportDefinition", reportDefinitionSchema);
