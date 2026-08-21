import mongoose from "mongoose";
import {
  WORKFLOW_REMEDIATION_EVENT_TYPES,
  WORKFLOW_REMEDIATION_EVENT_SOURCES,
  WORKFLOW_REMEDIATION_QUEUE_STATUS,
  WORKFLOW_REMEDIATION_QUEUE_SOURCES,
} from "../../constants/workflowRemediation.js";

const auditEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    actor: { type: String, default: "system" },
    detail: { type: mongoose.Schema.Types.Mixed },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const workflowRemediationEventSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, unique: true, index: true },
    eventType: {
      type: String,
      enum: Object.values(WORKFLOW_REMEDIATION_EVENT_TYPES),
      required: true,
      index: true,
    },
    sourceType: {
      type: String,
      enum: Object.values(WORKFLOW_REMEDIATION_EVENT_SOURCES),
      required: true,
    },
    sourceRef: { type: String, index: true },
    applicationId: { type: String, index: true },
    applicationName: { type: String },
    campaignId: { type: String, index: true },
    campaignName: { type: String },
    subjectCount: { type: Number, default: 0 },
    queueStatus: {
      type: String,
      enum: Object.values(WORKFLOW_REMEDIATION_QUEUE_STATUS),
      default: WORKFLOW_REMEDIATION_QUEUE_STATUS.PENDING,
      index: true,
    },
    workflowId: { type: String },
    workflowName: { type: String },
    selectedWorkflowId: { type: String, index: true },
    selectedWorkflowName: { type: String },
    targetId: { type: String, index: true },
    queuedBy: { type: String },
    queuedAt: { type: Date },
    ticketId: { type: String },
    ticketNumber: { type: String },
    createdBy: { type: String, default: "system" },
    queueSource: {
      type: String,
      enum: Object.values(WORKFLOW_REMEDIATION_QUEUE_SOURCES),
      default: WORKFLOW_REMEDIATION_QUEUE_SOURCES.API,
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    auditHistory: { type: [auditEntrySchema], default: [] },
  },
  {
    timestamps: true,
    collection: "remediation_workflow_events",
  },
);

workflowRemediationEventSchema.index({ tenantId: 1, eventType: 1, queueStatus: 1 });
workflowRemediationEventSchema.index({ tenantId: 1, eventType: 1, queueSource: 1 });
workflowRemediationEventSchema.index({ tenantId: 1, campaignId: 1 });

export default mongoose.model("WorkflowRemediationEvent", workflowRemediationEventSchema);
