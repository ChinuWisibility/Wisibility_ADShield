import mongoose from "mongoose";

/**
 * One persisted node execution within a workflow run.
 * Supports retry/resume by storing multiple attempts per node (attemptNumber).
 */
const remediationWorkflowNodeExecutionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true, default: null },
    nodeExecutionId: { type: String, required: true, unique: true, index: true },
    executionId: { type: String, index: true, default: null },
    runId: { type: String, required: true, index: true },
    workflowId: { type: String, index: true, default: null },
    attemptNumber: { type: Number, default: 1 },
    nodeId: { type: String, required: true, index: true },
    nodeName: { type: String },
    nodeType: { type: String, index: true },
    status: {
      type: String,
      enum: ["PENDING", "RUNNING", "SUCCESS", "FAILED", "SKIPPED"],
      default: "PENDING",
      index: true,
    },
    branch: { type: String, default: null },
    input: { type: mongoose.Schema.Types.Mixed },
    output: { type: mongoose.Schema.Types.Mixed },
    errorMessage: { type: String },
    stackTrace: { type: String },
    retryCount: { type: Number, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMs: { type: Number },
  },
  { timestamps: true, collection: "remediation_workflow_node_executions" },
);

remediationWorkflowNodeExecutionSchema.index({ executionId: 1, nodeId: 1, attemptNumber: 1 });
remediationWorkflowNodeExecutionSchema.index({ executionId: 1, startedAt: 1 });
remediationWorkflowNodeExecutionSchema.index({ runId: 1, startedAt: 1 });

export default mongoose.model(
  "RemediationWorkflowNodeExecution",
  remediationWorkflowNodeExecutionSchema,
);
