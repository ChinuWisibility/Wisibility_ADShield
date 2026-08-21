import mongoose from "mongoose";

/**
 * One remediation workflow execution = one revoked entitlement routed through a
 * selected workflow. This is the remediation queue row shown on the dashboard:
 * event details, selected workflow, live status, and the human-readable status
 * bullets derived from the run trace.
 */
const remediationWorkflowExecutionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true, default: null },
    executionId: { type: String, required: true, unique: true, index: true },
    eventType: { type: String, default: "ACCESS_REVOKE", index: true },
    eventName: { type: String },

    workflowId: { type: String, index: true },
    workflowName: { type: String },

    campaignId: { type: String },
    campaignName: { type: String },
    reviewItemId: { type: String, index: true },
    orphanId: { type: String, index: true },
    entitlementName: { type: String },
    applicationId: { type: String },
    applicationName: { type: String },
    identityId: { type: String },
    identityName: { type: String },
    eventOwner: { type: String },

    status: {
      type: String,
      enum: [
        "PENDING",
        "RUNNING",
        "WAITING",
        "WAITING_ITSM",
        "WAITING_VERIFICATION",
        "COMPLETED",
        "FAILED",
        "SKIPPED",
      ],
      default: "PENDING",
      index: true,
    },
    currentStepLabel: { type: String },
    stepStatuses: { type: [String], default: [] },

    /** Why the execution is parked: awaiting provisioning, ITSM ticket, or scheduled re-verify. */
    waitReason: {
      type: String,
      enum: [null, "PROVISIONING", "ITSM", "VERIFICATION", "IAM_DECISION", "JOINER_APPROVAL", "LIFECYCLE_APPROVAL"],
      default: null,
    },
    /** Node to resume from (checkpoint) so re-verify does not replay the trigger. */
    checkpointNodeId: { type: String, default: null },
    /** Next scheduled re-verification time + cadence (ms). */
    nextPollAt: { type: Date, default: null, index: true },
    pollIntervalMs: { type: Number, default: null },
    /** IAM orphan reminder cadence labels, e.g. ["1h","3h","6h","12h"]. */
    reminderPhases: { type: [String], default: undefined },
    reminderPhaseIndex: { type: Number, default: 0 },
    /** Snapshot of reminder email template for the background scheduler. */
    reminderEmailConfig: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Linked provisioning request queued for the connector worker (V2). */
    provisioningRequestId: { type: String, default: null, index: true },
    /** Denormalized ITSM ticket status for the dashboard (e.g. OPEN, IN_PROGRESS, CLOSED). */
    itsmTicketStatus: { type: String, default: null },
    /** Structured failure for dashboard troubleshooting (revoke vs verify vs engine). */
    failureReasonCode: {
      type: String,
      enum: [
        null,
        "REVOKE_FAILED",
        "VERIFY_STILL_PRESENT",
        "WORKFLOW_FAILURE",
        "ENGINE_ERROR",
      ],
      default: null,
    },
    failureReasonLabel: { type: String, default: null },
    failureReasonDetail: { type: String, default: null },
    runId: { type: String, index: true, default: null },
    /** All run traces linked to this execution (resume cycles append). */
    runIds: { type: [String], default: [] },
    currentNodeId: { type: String, default: null },
    currentNodeName: { type: String, default: null },
    durationMs: { type: Number, default: null },
    errorMessage: { type: String, default: null },
    ticketEventId: { type: String, default: null },
    triggerPayload: { type: mongoose.Schema.Types.Mixed },
    error: { type: String },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true, collection: "remediation_workflow_executions" },
);

remediationWorkflowExecutionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
remediationWorkflowExecutionSchema.index({ tenantId: 1, reviewItemId: 1 });

export default mongoose.model(
  "RemediationWorkflowExecution",
  remediationWorkflowExecutionSchema,
);
