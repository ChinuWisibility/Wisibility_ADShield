import mongoose from 'mongoose';

const connectorConfigSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    connectorType: {
      type: String,
      required: true,
      index: true,
      enum: ['ACTIVE_DIRECTORY', 'LDAP', 'REST', 'SCIM', 'JDBC', 'SFTP', 'CSV'],
    },
    connectorVersion: { type: String },
    isEnabled: { type: Boolean, index: true, default: true },
    syncSchedule: { type: String },
    syncType: { type: String, enum: ['FULL', 'DELTA', 'TRIGGERED'] },
    lastSyncAt: { type: Date },
    lastSyncStatus: { type: String, enum: ['SUCCESS', 'FAILED', 'PARTIAL', 'RUNNING'] },
    lastSyncCount: { type: Number },
    errorMessage: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'connector_configs' }
);

connectorConfigSchema.index({ applicationId: 1, connectorType: 1 }, { unique: false });

export default mongoose.model('ConnectorConfig', connectorConfigSchema);

