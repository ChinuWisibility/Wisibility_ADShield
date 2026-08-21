import mongoose from 'mongoose';

const riskTrendSnapshotSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Identity',
      required: true,
      index: true,
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    violationCount: { type: Number, default: 0 },
    exceptionCount: { type: Number, default: 0 },
    privilegedCount: { type: Number, default: 0 },
    snapshotDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'risk_trend_snapshots' }
);

riskTrendSnapshotSchema.index({ identityId: 1, snapshotDate: -1 });

export default mongoose.model('RiskTrendSnapshot', riskTrendSnapshotSchema);

