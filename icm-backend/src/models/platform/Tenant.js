import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true },
    subscriptionTier: { type: String, enum: ['core', 'premium', 'enterprise'], default: 'core' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'tenants' }
);

tenantSchema.index({ isActive: 1 });

export default mongoose.model('Tenant', tenantSchema);
