import mongoose from "mongoose";

const reportHistorySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    reportDefinitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReportDefinition",
      index: true,
    },
    generatedAt: { type: Date, index: true },
    generatedBy: { type: String },
    fileLocation: { type: String },
    fileSize: { type: Number },
    status: {
      type: String,
      index: true,
      enum: ["RUNNING", "COMPLETED", "FAILED"],
      default: "RUNNING",
    },
    rowCount: { type: Number },
    expiresAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "report_histories" },
);

reportHistorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ReportHistory", reportHistorySchema);
