import mongoose from "mongoose";

/**
 * Graph-native remediation workflow definition (ISC-style triggers/actions/operators).
 * Distinct from the legacy provisioning WorkflowDefinition (linear steps[]).
 * Built in the workflow builder and selected at certification revoke time.
 */
const remediationWorkflowDefinitionSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true, default: null },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    version: { type: Number, default: 1 },
    enabled: { type: Boolean, default: true, index: true },
    trigger: {
      type: { type: String, default: "CertificationSignedOff" },
      filter: { type: mongoose.Schema.Types.Mixed },
    },
    nodes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    edges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    tags: { type: [String], default: ["CERTIFICATION_REVOKE"] },
    successCount: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    createdBy: { type: String },
  },
  { timestamps: true, collection: "remediation_workflow_definitions" },
);

remediationWorkflowDefinitionSchema.index({ tenantId: 1, enabled: 1, updatedAt: -1 });
remediationWorkflowDefinitionSchema.index({ tenantId: 1, "trigger.type": 1, enabled: 1 });

export default mongoose.model(
  "RemediationWorkflowDefinition",
  remediationWorkflowDefinitionSchema,
);
