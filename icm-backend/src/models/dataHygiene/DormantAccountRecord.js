import mongoose from 'mongoose';

const dormantAccountRecordSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'AccountAggregation', index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    lastLoginAt: { type: Date, index: true },
    dormantSinceDays: { type: Number, index: true },
    status: { type: String, index: true, enum: ['FLAGGED', 'UNDER_REVIEW', 'DISABLED', 'CLEARED'] },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    riskScore: { type: Number, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'dormant_account_records' }
);

export default mongoose.model('DormantAccountRecord', dormantAccountRecordSchema);

