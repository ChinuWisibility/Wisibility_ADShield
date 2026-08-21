import mongoose from "mongoose";
import {
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_TASK_STATUS,
} from "../../constants/workflowTaskQueue.js";

const stepLogSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    status: { type: String, default: "PENDING" },
    at: { type: Date, default: Date.now },
    detail: { type: String },
  },
  { _id: false },
);

const workflowTaskQueueSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    taskName: { type: String, required: true, index: true },
    action: {
      type: String,
      enum: Object.values(WORKFLOW_TASK_ACTIONS),
      required: true,
      index: true,
    },
    tenantId: { type: String, required: true, index: true },
    username: { type: String, index: true },
    identityName: { type: String },
    identityEmail: { type: String },
    applicationId: { type: String },
    applicationName: { type: String },
    entitlementName: { type: String },
    workflowId: { type: String, required: true },
    workflowName: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(WORKFLOW_TASK_STATUS),
      default: WORKFLOW_TASK_STATUS.NEW,
      index: true,
    },
    dateOfEntry: { type: Date, default: Date.now, index: true },
    createdBy: { type: String, default: "Certification Engine" },
    reviewEventId: { type: String, index: true },
    orphanId: { type: String, index: true },
    campaignId: { type: String, index: true },
    campaignName: { type: String },
    retryCount: { type: Number, default: 0 },
    executionId: { type: String },
    runId: { type: String },
    executionStartedAt: { type: Date },
    completedAt: { type: Date },
    failureReason: { type: String },
    stepLog: { type: [stepLogSchema], default: [] },
    context: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "workflow_task_queue",
  },
);

workflowTaskQueueSchema.index({ tenantId: 1, status: 1, action: 1 });
workflowTaskQueueSchema.index({ tenantId: 1, reviewEventId: 1, entitlementName: 1, status: 1 });
workflowTaskQueueSchema.index({ tenantId: 1, orphanId: 1, action: 1, status: 1 });

export default mongoose.model("WorkflowTaskQueue", workflowTaskQueueSchema);
