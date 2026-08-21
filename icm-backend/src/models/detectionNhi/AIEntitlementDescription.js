import mongoose from 'mongoose';

const aiEntitlementDescriptionSchema = new mongoose.Schema(
  {
    entitlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Entitlement', required: true, index: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', index: true },
    description: { type: String },
    provider: { type: String, enum: ['GEMINI', 'OPENAI', 'OPENROUTER'] },
    model: { type: String },
    confidence: { type: Number },
    generatedAt: { type: Date, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewStatus: { type: String, index: true, enum: ['PENDING', 'ACCEPTED', 'EDITED', 'REJECTED'], default: 'PENDING' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'ai_entitlement_descriptions' }
);

export default mongoose.model('AIEntitlementDescription', aiEntitlementDescriptionSchema);

