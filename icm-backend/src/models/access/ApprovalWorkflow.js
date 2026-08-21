import mongoose from "mongoose";

const approvalWorkflowSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    workflowName: { type: String, required: true },
    entityType: {
      type: String,
      enum: [
        "ROLE_REQUEST",
        "CERT_EXCEPTION",
        "PROVISIONING",
        "ACCESS_REQUEST",
      ],
      index: true,
    },
    stages: [
      {
        order: { type: Number },
        approverType: { type: String },
        approverRef: { type: String },
        escalateAfterHours: { type: Number },
      },
    ],
    onReject: {
      type: String,
      enum: ["TERMINATE", "ESCALATE", "NOTIFY"],
      default: "TERMINATE",
    },
    onApprove: {
      type: String,
      enum: ["PROVISION", "NOTIFY", "AUDIT"],
      default: "PROVISION",
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "approval_workflows" },
);

approvalWorkflowSchema.index({ workflowName: 1 });
approvalWorkflowSchema.index({ tenantId: 1, workflowName: 1 });

export default mongoose.model("ApprovalWorkflow", approvalWorkflowSchema);
