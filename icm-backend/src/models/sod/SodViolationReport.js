import mongoose from "mongoose";

const sodViolationReportSchema = new mongoose.Schema(
  {
    reportType: {
      type: String,
      enum: ["SUMMARY", "DETAILED", "EXECUTIVE", "REMEDIATION"],
      index: true,
    },
    generatedBy: { type: String },
    generatedAt: { type: Date, default: Date.now, index: true },
    reportScope: { type: String },
    fileLocation: { type: String },
  },
  { timestamps: true, collection: "sod_violation_reports" },
);

export default mongoose.model("SodViolationReport", sodViolationReportSchema);
