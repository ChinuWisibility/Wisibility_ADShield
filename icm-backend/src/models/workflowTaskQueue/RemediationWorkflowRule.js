import mongoose from "mongoose";
import { WORKFLOW_TASK_ACTIONS } from "../../constants/workflowTaskQueue.js";

const actionMappingSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: Object.values(WORKFLOW_TASK_ACTIONS),
      required: true,
    },
    workflowId: { type: String, required: true },
    workflowName: { type: String, required: true },
    enabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const remediationWorkflowRuleSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, unique: true, index: true },
    actionMappings: { type: [actionMappingSchema], default: [] },
    updatedBy: { type: String },
  },
  {
    timestamps: true,
    collection: "remediation_workflow_rules",
  },
);

export default mongoose.model("RemediationWorkflowRule", remediationWorkflowRuleSchema);
