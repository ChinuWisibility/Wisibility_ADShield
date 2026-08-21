import mongoose from 'mongoose';

const accessRecommendationSchema = new mongoose.Schema(
  {
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Identity',
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    recommendationType: {
      type: String,
      enum: ['GRANT', 'REVOKE', 'REVIEW'],
      required: true,
      index: true,
    },
    entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entitlement' },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      index: true,
    },
    reasoning: { type: String },
    status: {
      type: String,
      enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'],
      default: 'PENDING',
      index: true,
    },
    generatedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'access_recommendations' }
);

accessRecommendationSchema.index({ identityId: 1, status: 1 });
accessRecommendationSchema.index({ applicationId: 1, entitlementId: 1, status: 1 });

export default mongoose.model('AccessRecommendation', accessRecommendationSchema);

