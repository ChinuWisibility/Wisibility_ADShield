import mongoose from 'mongoose';

const accessOutlierSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Identity',
      required: true,
      index: true,
    },
    peerGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PeerGroupAnalysis',
      required: true,
      index: true,
    },
    outlierEntitlements: [{ type: String }],
    outlierScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    recommendedAction: {
      type: String,
      enum: ['REVIEW', 'REVOKE', 'CERTIFY'],
    },
    status: {
      type: String,
      enum: ['OPEN', 'REVIEWED', 'REMEDIATED'],
      default: 'OPEN',
      index: true,
    },
    detectedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'access_outliers' }
);

accessOutlierSchema.index({ identityId: 1, status: 1 });

export default mongoose.model('AccessOutlier', accessOutlierSchema);

