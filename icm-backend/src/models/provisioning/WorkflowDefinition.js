import mongoose from "mongoose";

const workflowDefinitionSchema = new mongoose.Schema(
  {
    workflowName: { type: String, required: true },
    workflowType: {
      type: String,
      enum: ["APPROVAL", "PROVISIONING", "CERTIFICATION", "NOTIFICATION"],
      index: true,
    },
    steps: [mongoose.Schema.Types.Mixed],
    onError: {
      type: String,
      enum: ["STOP", "CONTINUE", "ROLLBACK"],
      default: "STOP",
    },
    slaHours: { type: Number },
    version: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: "workflow_definitions" },
);

workflowDefinitionSchema.index({ workflowName: 1 });

export default mongoose.model("WorkflowDefinition", workflowDefinitionSchema);
