import mongoose from "mongoose";

const userAnalysisHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    analysisId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Analysis",
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    runAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "user_analysis_history" },
);

export default mongoose.model("UserAnalysisHistory", userAnalysisHistorySchema);
