import mongoose from 'mongoose';

const peerGroupAnalysisSchema = new mongoose.Schema(
  {
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    groupKey: {
      type: String,
      required: true,
      index: true,
    },
    memberCount: { type: Number, default: 0 },
    commonEntitlements: [{ type: String }],
    outlierThreshold: { type: Number, default: 20 },
    analysisDate: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    runId: {
      type: String,
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'peer_group_analyses' }
);

peerGroupAnalysisSchema.index({ applicationId: 1, groupKey: 1, analysisDate: -1 });

export default mongoose.model('PeerGroupAnalysis', peerGroupAnalysisSchema);

