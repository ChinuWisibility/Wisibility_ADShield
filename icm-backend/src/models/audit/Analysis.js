import mongoose from "mongoose";

const analysisSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    score: { type: Number, min: 0, max: 100 },
    issues: [mongoose.Schema.Types.Mixed],
    recommendations: [mongoose.Schema.Types.Mixed],
    analysisProvider: {
      type: String,
      enum: ["GEMINI", "OPENAI", "OPENROUTER"],
    },
    analysisDate: { type: Date, default: Date.now, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "analyses" },
);

export default mongoose.model("Analysis", analysisSchema);
