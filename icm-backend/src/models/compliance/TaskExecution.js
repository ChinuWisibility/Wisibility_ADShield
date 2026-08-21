import mongoose from "mongoose";

const taskExecutionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    taskName: {
      type: String,
      index: true,
      enum: [
        "SOD_CRON",
        "CERT_REMINDER",
        "CONNECTOR_SYNC",
        "REPORT_GEN",
        "IAM_ORPHAN_REVIEW",
        "IAM_ORPHAN_REMINDER",
        "IAM_ORPHAN_DECISION",
      ],
    },
    taskType: {
      type: String,
      index: true,
      enum: ["CRON", "SCHEDULED", "TRIGGERED"],
    },
    status: {
      type: String,
      index: true,
      enum: ["RUNNING", "COMPLETED", "FAILED", "SKIPPED"],
    },
    startedAt: { type: Date, index: true },
    completedAt: { type: Date },
    durationMs: { type: Number },
    recordsProcessed: { type: Number },
    errorMessage: { type: String },
    lockedBy: { type: String },
    /** IAM orphan workflow correlation (for task panel filtering). */
    orphanId: { type: String, index: true },
    executionId: { type: String, index: true },
    accountName: { type: String },
    applicationName: { type: String },
    /** Human-readable progress line shown in the tasks panel. */
    detail: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "task_executions" },
);

export default mongoose.model("TaskExecution", taskExecutionSchema);
