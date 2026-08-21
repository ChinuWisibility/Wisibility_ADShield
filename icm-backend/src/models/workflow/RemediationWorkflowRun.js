import mongoose from "mongoose";

/**
 * One persisted execution log of a remediation workflow graph walk.
 * Stores the step-by-step trace so admins (test runs) and ops (live runs)
 * can see exactly which step ran, its branch, output, and any error.
 */
const remediationWorkflowRunSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true, default: null },
    runId: { type: String, required: true, unique: true, index: true },
    workflowId: { type: String, index: true },
    executionId: { type: String, index: true, default: null },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "SKIPPED"],
      index: true,
    },
    mode: { type: String, enum: ["TEST", "LIVE"], default: "TEST", index: true },
    trigger: { type: mongoose.Schema.Types.Mixed },
    steps: { type: [mongoose.Schema.Types.Mixed], default: [] },
    outputs: { type: mongoose.Schema.Types.Mixed },
    sideEffects: { type: mongoose.Schema.Types.Mixed },
    skipReason: { type: String },
    validationErrors: { type: [String], default: undefined },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMs: { type: Number },
  },
  { timestamps: true, collection: "remediation_workflow_runs" },
);

remediationWorkflowRunSchema.index({ tenantId: 1, workflowId: 1, startedAt: -1 });

export default mongoose.model(
  "RemediationWorkflowRun",
  remediationWorkflowRunSchema,
);
