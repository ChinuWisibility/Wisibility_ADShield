import mongoose from 'mongoose';

const nhiProfileSchema = new mongoose.Schema(
  {
    identityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', required: true, index: true },
    nhiType: { type: String, index: true, enum: ['SERVICE_ACCOUNT', 'BOT', 'API_KEY', 'SHARED', 'AUTOMATED'] },
    ownerIdentityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Identity', index: true },
    ownerEmail: { type: String },
    serviceDescription: { type: String },
    detectedVia: [{ type: String }],
    confidenceScore: { type: Number },
    lastUsedAt: { type: Date, index: true },
    isActive: { type: Boolean, index: true, default: true },
    reviewStatus: { type: String, index: true, enum: ['PENDING', 'CONFIRMED', 'FALSE_POSITIVE'], default: 'PENDING' },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'nhi_profiles' }
);

export default mongoose.model('NHIProfile', nhiProfileSchema);

