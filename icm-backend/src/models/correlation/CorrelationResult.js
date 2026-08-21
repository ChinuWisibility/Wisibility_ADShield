import mongoose from 'mongoose';

const correlationResultSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true }, // <-- ADD THIS LINE
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountAggregation', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    matchScore: { type: Number, index: true },
    status: { type: String, index: true, enum: ['MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'MANUAL'] },
    isOrphan: { type: Boolean, index: true, default: false },
    correlatedAt: { type: Date, index: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'correlation_results' }
);

export default mongoose.model('CorrelationResult', correlationResultSchema);