import mongoose from 'mongoose';

const entitlementHygieneRuleSchema = new mongoose.Schema(
  {
    ruleName: { type: String, required: true, index: true },
    ruleType: { type: String, index: true, enum: ['DORMANT', 'UNUSED', 'OVER_PRIVILEGED'] },
    thresholdDays: { type: Number },
    riskLevel: { type: String, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    action: { type: String, enum: ['ALERT', 'FLAG', 'AUTO_REVOKE'] },
    isEnabled: { type: Boolean, index: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'entitlement_hygiene_rules' }
);

export default mongoose.model('EntitlementHygieneRule', entitlementHygieneRuleSchema);

