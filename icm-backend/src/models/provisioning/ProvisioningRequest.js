import mongoose from 'mongoose';

const provisioningRequestSchema = new mongoose.Schema(
  {
    requestType: { type: String, required: true, index: true, enum: ['GRANT', 'REVOKE', 'MODIFY', 'DEPROVISION', 'JOINER', 'MOVER', 'LEAVER'] },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    justification: { type: String },
    status: { type: String, index: true, enum: ['PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'], default: 'PENDING' },
    priority: { type: String, index: true, enum: ['URGENT', 'HIGH', 'NORMAL', 'LOW'], default: 'NORMAL' },
    sourceType: { type: String, index: true, enum: ['CERTIFICATION', 'LIFECYCLE', 'ROLE_REQUEST', 'MANUAL'] },
    sourceId: { type: String, index: true },
    approvalWorkflowId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovalWorkflow' },
    approvalStatus: { type: String, index: true, enum: ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'], default: 'NOT_REQUIRED' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    submittedAt: { type: Date, index: true, default: Date.now },
    completedAt: { type: Date },
    /** Joiner / lifecycle context: applicationId, ruleId, syncJobId, workflowExecutionId, … */
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'provisioning_requests' }
);

provisioningRequestSchema.index(
  { sourceType: 1, sourceId: 1, status: 1 },
  { background: true },
);

// Prevent duplicate open/completed lifecycle intents for the same source key.
// FAILED/CANCELLED leave the index so retries can recreate.
provisioningRequestSchema.index(
  { sourceType: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceType: 'LIFECYCLE',
      sourceId: { $type: 'string' },
      status: { $in: ['PENDING', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'] },
    },
    background: true,
  },
);

export default mongoose.model('ProvisioningRequest', provisioningRequestSchema);

