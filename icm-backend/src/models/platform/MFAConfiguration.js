import mongoose from 'mongoose';

const mfaConfigurationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    mfaType: { type: String, enum: ['TOTP', 'SMS', 'EMAIL', 'HARDWARE'] },
    secret: { type: String, select: false },
    isEnabled: { type: Boolean, default: false },
    enrolledAt: { type: Date },
    backupCodes: [{ type: String }],
    lastUsedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'mfa_configurations' }
);

export default mongoose.model('MFAConfiguration', mfaConfigurationSchema);

