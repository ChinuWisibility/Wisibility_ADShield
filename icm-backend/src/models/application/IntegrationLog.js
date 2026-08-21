import mongoose from 'mongoose';

const integrationLogSchema = new mongoose.Schema(
  {
    connectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectorConfig', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    operation: { type: String, index: true, enum: ['SYNC', 'TEST', 'DELTA', 'FULL_RECONCILE'] },
    status: { type: String, index: true, enum: ['RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL'] },
    startedAt: { type: Date, index: true },
    completedAt: { type: Date },
    recordsRead: { type: Number },
    recordsCreated: { type: Number },
    recordsUpdated: { type: Number },
    recordsDeleted: { type: Number },
    recordsFailed: { type: Number },
    errorDetails: [{ type: mongoose.Schema.Types.Mixed }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'integration_logs' }
);

export default mongoose.model('IntegrationLog', integrationLogSchema);

