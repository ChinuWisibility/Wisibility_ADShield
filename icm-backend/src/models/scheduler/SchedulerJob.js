import mongoose from "mongoose";

const schedulerJobSchema = new mongoose.Schema(
  {
    jobName: { type: String, unique: true, required: true },
    jobType: {
      type: String,
      enum: [
        "SOD_EVAL",
        "CERT_SCHEDULE",
        "AGGREGATION",
        "PROVISIONING",
        "CLEANUP",
        "REPORT",
      ],
      index: true,
    },
    cronExpression: { type: String, required: true },
    isEnabled: { type: Boolean, default: true, index: true },
    nextRunAt: { type: Date, index: true },
    lastRunAt: { type: Date },
    lastRunStatus: { type: String, enum: ["SUCCESS", "FAILURE", "RUNNING"] },
    lockedBy: { type: String },
    runCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    config: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "scheduler_jobs" },
);

export default mongoose.model("SchedulerJob", schedulerJobSchema);
