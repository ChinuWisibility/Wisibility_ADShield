import mongoose from 'mongoose';

const orphanAccountSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    accountId: { type: String, index: true },
    /**
     * Normalized correlation attribute (e.g. email / job title) for search and display.
     * NOT document identity — multiple OPEN orphans may share the same key.
     * Falls back to `aid:<accountId>` when the account field was empty.
     */
    correlationKey: { type: String, index: true },
    accountName: { type: String },
    lastLoginAt: { type: Date },
    detectedAt: { type: Date, index: true },
    status: { type: String, index: true, enum: ['OPEN', 'UNDER_REVIEW', 'REMEDIATED', 'FALSE_POSITIVE'], default: 'OPEN' },
    remediationAction: { type: String, enum: ['DISABLE', 'DELETE', 'ASSIGN', 'IGNORE'] },
    remediatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    remediatedAt: { type: Date },
    riskLevel: { type: String, index: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    workflowExecutionId: { type: String },
    workflowStatus: {
      type: String,
      index: true,
      enum: ['PENDING', 'IN_PROGRESS', 'WAITING_IAM', 'COMPLETED', 'FAILED'],
    },
    currentStepLabel: { type: String },
    /** Next IAM reminder poll time (background scheduler). */
    nextCheckAt: { type: Date, index: true },
    reminderPhaseIndex: { type: Number, default: 0 },
    iamDecision: { type: String, enum: ['ASSIGN', 'DELETE', 'DISABLE', 'IGNORE'] },
    /** Which email / workflow step the IAM portal decision came from. */
    iamDecisionMeta: {
      stepId: { type: String },
      stepLabel: { type: String },
      source: { type: String },
      emailJobId: { type: String },
      emailAuditId: { type: String },
      executionId: { type: String },
      decidedAt: { type: Date },
      decidedBy: { type: String },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'orphan_accounts' }
);

/** One orphan document per application account (document identity). */
orphanAccountSchema.index(
  { applicationId: 1, accountId: 1 },
  { unique: true, name: 'applicationId_1_accountId_1' },
);
/** Search/display metadata — must NOT be unique (shared keys are valid). */
orphanAccountSchema.index(
  { applicationId: 1, correlationKey: 1 },
  { name: 'applicationId_1_correlationKey_1' },
);
orphanAccountSchema.index({ tenantId: 1, status: 1 });
orphanAccountSchema.index({ tenantId: 1, status: 1, riskLevel: 1 });
/** Widget detail list: tenant + status + app + sort by detectedAt. */
orphanAccountSchema.index({ tenantId: 1, status: 1, applicationId: 1, detectedAt: -1 });

export default mongoose.model('OrphanAccount', orphanAccountSchema);
