import mongoose from "mongoose";

const workflowRemediationEventItemSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    userId: { type: String },
    accountId: { type: String },
    entitlementId: { type: String },
    entitlementName: { type: String },
    applicationId: { type: String },
    applicationName: { type: String },
    identityName: { type: String },
    identityEmail: { type: String },
    status: { type: String, default: "PENDING" },
    remarks: { type: String },
    sourceRef: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    collection: "remediation_workflow_event_items",
  },
);

workflowRemediationEventItemSchema.index({ eventId: 1, status: 1 });

export default mongoose.model(
  "WorkflowRemediationEventItem",
  workflowRemediationEventItemSchema,
);
