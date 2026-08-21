import mongoose from 'mongoose';

const sodEntitlementSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    entitlementName: {
      type: String,
      required: true,
      index: true,
    },
    sourceAttribute: {
      type: String,
      required: true,
    },
    sourceValue: {
      type: String,
      required: true,
    },
    isPrivileged: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      required: true,
      index: true,
    },
    description: { type: String },
    owner: { type: String },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'sod_entitlements' }
);

sodEntitlementSchema.index({ tenantId: 1, applicationId: 1 });
sodEntitlementSchema.index({ applicationId: 1, entitlementName: 1 });

export default mongoose.model('SodEntitlement', sodEntitlementSchema);

