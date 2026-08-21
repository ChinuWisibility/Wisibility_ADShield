import mongoose from "mongoose";

const sodQueueSchema = new mongoose.Schema(
  {
    jobType: {
      type: String,
      enum: ["FULL_EVAL", "DELTA_EVAL", "POLICY_IMPACT"],
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      index: true,
    },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: "SodPolicy" },
    status: {
      type: String,
      enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"],
      default: "QUEUED",
      index: true,
    },
    priority: { type: Number, min: 1, max: 5, default: 3, index: true },
    queuedAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    violationsFound: { type: Number, default: 0 },
    lockedBy: { type: String },
  },
  { timestamps: true, collection: "sod_queues" },
);

export default mongoose.model("SodQueue", sodQueueSchema);
