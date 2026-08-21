import mongoose from 'mongoose';

const correlationRuleSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true }, // <-- ADD THIS LINE
    ruleName: { type: String, required: true, index: true, trim: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    identityAttribute: { type: String },
    accountAttribute: { type: String },
    matchType: { type: String, enum: ['EXACT', 'CONTAINS', 'REGEX'] },
    confidenceWeight: { type: Number },
    priority: { type: Number, index: true },
    isEnabled: { type: Boolean, index: true, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'correlation_rules' }
);

export default mongoose.model('CorrelationRule', correlationRuleSchema);