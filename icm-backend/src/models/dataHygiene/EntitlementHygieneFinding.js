import mongoose from 'mongoose';

const entitlementHygieneFindingSchema = new mongoose.Schema(
  {
    ruleId: { type: mongoose.Schema.Types.ObjectId, ref: 'EntitlementHygieneRule', index: true },
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entitlement', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    findingType: { type: String, index: true },
    dormantDays: { type: Number },
    status: { type: String, index: true, enum: ['OPEN', 'REVIEWED', 'REMEDIATED', 'ACCEPTED'] },
    remediatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    detectedAt: { type: Date, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'entitlement_hygiene_findings' }
);

export default mongoose.model('EntitlementHygieneFinding', entitlementHygieneFindingSchema);

