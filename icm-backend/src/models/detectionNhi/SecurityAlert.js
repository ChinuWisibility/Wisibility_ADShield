import mongoose from 'mongoose';

const securityAlertSchema = new mongoose.Schema(
  {
    alertType: {
      type: String,
      index: true,
      enum: ['SOD_VIOLATION', 'ORPHAN_ACCOUNT', 'PRIVILEGED_CHANGE', 'NHI_DETECTED', 'LEAVER_ACCESS'],
    },
    severity: { type: String, index: true, enum: ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    entityType: { type: String, index: true },
    entityId: { type: String, index: true },
    description: { type: String },
    status: { type: String, index: true, enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'], default: 'OPEN' },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'security_alerts' }
);

export default mongoose.model('SecurityAlert', securityAlertSchema);

