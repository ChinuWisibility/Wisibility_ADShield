import mongoose from 'mongoose';

const provisioningTaskSchema = new mongoose.Schema(
  {
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProvisioningPlan', required: true, index: true },
    requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProvisioningRequest', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectorConfig' },
    operationType: {
      type: String,
      index: true,
      // ADD_ACCOUNT = CREATE; UPDATE_ACCOUNT = attribute update; DISABLE = DISABLE_ACCOUNT
      enum: [
        'ADD_ACCOUNT',
        'UPDATE_ACCOUNT',
        'REMOVE_ACCOUNT',
        'ADD_ENTITLEMENT',
        'REMOVE_ENTITLEMENT',
        'DISABLE',
        'ENABLE',
      ],
    },
    /**
     * Stable plan-item identity (P3 operations[].itemKey).
     * Required for multi-entitlement / multi-item plans.
     * Legacy one-item writers use: legacy:${operationType}:${applicationId}
     */
    planItemId: { type: String, index: true },
    lifecycleEventId: { type: String, index: true },
    /** Prerequisite planItemIds that must be COMPLETED before this task is claimable. */
    dependsOnPlanItemIds: { type: [String], default: undefined },
    sequence: { type: Number, default: 0 },
    targetAttributes: { type: mongoose.Schema.Types.Mixed },
    jmlCorrelationId: { type: String, index: true },
    status: { type: String, index: true, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'SKIPPED'], default: 'PENDING' },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 },
    nextAttemptAt: { type: Date, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    errorMessage: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'provisioning_tasks' }
);

provisioningTaskSchema.index(
  { requestId: 1, applicationId: 1, operationType: 1, status: 1 },
  { background: true },
);

provisioningTaskSchema.index(
  { planId: 1, status: 1 },
  { background: true },
);

provisioningTaskSchema.index(
  { requestId: 1, status: 1 },
  { background: true },
);

provisioningTaskSchema.index(
  { status: 1, nextAttemptAt: 1, sequence: 1, createdAt: 1 },
  { background: true },
);

// One logical work item per request + plan item (FAILED included — retries update same doc).
provisioningTaskSchema.index(
  { requestId: 1, planItemId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      requestId: { $exists: true },
      planItemId: { $type: 'string' },
    },
    background: true,
  },
);

// Legacy uniqueness retained temporarily for writers that still omit planItemId
// (cert revoke / older Joiner until backfilled). Drop after full cutover.
provisioningTaskSchema.index(
  { requestId: 1, applicationId: 1, operationType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      requestId: { $exists: true },
      planItemId: { $exists: false },
      status: { $in: ['PENDING', 'RUNNING', 'RETRYING', 'COMPLETED'] },
    },
    background: true,
    name: 'legacy_request_app_op_unique',
  },
);

export default mongoose.model('ProvisioningTask', provisioningTaskSchema);
