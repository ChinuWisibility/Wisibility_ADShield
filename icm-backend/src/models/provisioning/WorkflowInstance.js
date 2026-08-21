import mongoose from "mongoose";

const workflowInstanceSchema = new mongoose.Schema(
  {
    workflowId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WorkflowDefinition",
      required: true,
      index: true,
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvisioningRequest",
      index: true,
    },
    status: {
      type: String,
      enum: ["RUNNING", "COMPLETED", "FAILED", "SUSPENDED", "CANCELLED"],
      default: "RUNNING",
      index: true,
    },
    currentStep: { type: Number, default: 0 },
    stepResults: [mongoose.Schema.Types.Mixed],
    startedAt: { type: Date, default: Date.now, index: true },
    completedAt: { type: Date },
    slaExpiresAt: { type: Date, index: true },
    slaBreached: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "workflow_instances" },
);

export default mongoose.model("WorkflowInstance", workflowInstanceSchema);
