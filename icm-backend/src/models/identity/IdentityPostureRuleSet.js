import mongoose from 'mongoose';

const identityPostureRuleSetSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true,
      index: true,
    },
    tenantName: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
    version: { type: Number, default: 1 },
    rules: { type: mongoose.Schema.Types.Mixed, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedByName: { type: String, trim: true },
  },
  { timestamps: true, collection: 'identity_posture_rule_sets' },
);

export default mongoose.model('IdentityPostureRuleSet', identityPostureRuleSetSchema);
