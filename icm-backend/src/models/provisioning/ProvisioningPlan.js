import mongoose from 'mongoose';

const provisioningPlanSchema = new mongoose.Schema(
  {
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProvisioningRequest', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    /** Originating LifecycleEvent id (Plan Compiler / JML lineage). */
    lifecycleEventId: { type: String, index: true },
    jmlCorrelationId: { type: String, index: true },
    /** Stable hash of compiled operations for idempotent recompilation. */
    compilationHash: { type: String, index: true },
    operations: [{ type: mongoose.Schema.Types.Mixed }],
    totalOperations: { type: Number },
    completedOperations: { type: Number },
    failedOperations: { type: Number },
    status: { type: String, index: true, enum: ['COMPILED', 'EXECUTING', 'COMPLETED', 'PARTIAL', 'FAILED'], default: 'COMPILED' },
    compiledAt: { type: Date },
    executedAt: { type: Date },
    /** Compiler metadata (version, deferred task materialization, …). */
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'provisioning_plans' }
);

// One plan document per provisioning request (Joiner + Plan Compiler).
provisioningPlanSchema.index(
  { requestId: 1 },
  { unique: true, background: true },
);

export default mongoose.model('ProvisioningPlan', provisioningPlanSchema);

