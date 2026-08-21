import mongoose from "mongoose";

const analyticsSchema = new mongoose.Schema(
  {
    metricType: { type: String, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    metricData: { type: mongoose.Schema.Types.Mixed },
    calculatedAt: { type: Date, default: Date.now, index: true },
    period: { type: String, enum: ["DAILY", "WEEKLY", "MONTHLY"] },
  },
  { timestamps: true, collection: "analytics" },
);

analyticsSchema.index({ metricType: 1, applicationId: 1 });

export default mongoose.model("Analytics", analyticsSchema);
