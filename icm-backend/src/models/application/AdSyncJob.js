import mongoose from "mongoose";

const stageTimingSchema = new mongoose.Schema(
  {
    stage: { type: String, required: true },
    ms: { type: Number, default: 0 },
    counts: { type: mongoose.Schema.Types.Mixed },
    memoryMb: { type: Number },
    startedAt: { type: String },
    endedAt: { type: String },
    heapBeforeMb: { type: Number },
    heapAfterMb: { type: Number },
    peakHeapMb: { type: Number },
    peakRssMb: { type: Number },
    cpuMs: { type: Number },
  },
  { _id: false },
);

const adSyncJobSchema = new mongoose.Schema(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
      index: true,
    },
    phase: { type: String, default: "queued" },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    message: { type: String, default: "" },
    error: { type: String },
    result: { type: mongoose.Schema.Types.Mixed },
    stageTimings: { type: [stageTimingSchema], default: [] },
    syncConfig: { type: mongoose.Schema.Types.Mixed },
    requestedBy: { type: mongoose.Schema.Types.ObjectId },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

adSyncJobSchema.index({ applicationId: 1, status: 1, createdAt: -1 });

export default mongoose.model("AdSyncJob", adSyncJobSchema);
