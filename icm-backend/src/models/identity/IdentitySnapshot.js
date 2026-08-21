import mongoose from 'mongoose';

const identitySnapshotSchema = new mongoose.Schema(
  {
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    snapshotType: { type: String, index: true, enum: ['SCHEDULED', 'ON_CHANGE', 'GDPR_REQUEST', 'AUDIT'] },
    snapshotData: { type: mongoose.Schema.Types.Mixed },
    entitlements: [{ type: mongoose.Schema.Types.Mixed }],
    roles: [{ type: mongoose.Schema.Types.Mixed }],
    violations: [{ type: mongoose.Schema.Types.Mixed }],
    takenAt: { type: Date, index: true },
    retentionExpiresAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'identity_snapshots' }
);

export default mongoose.model('IdentitySnapshot', identitySnapshotSchema);

