import mongoose from 'mongoose';

const sodUserEntitlementSchema = new mongoose.Schema(
  {
    tenantId: { type: String, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
    }, // native user ID from source
    userDisplayName: { type: String },
    entitlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SodEntitlement',
      required: true,
      index: true,
    },
    entitlementValue: { type: String },
    isPrivileged: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    grantedVia: {
      type: String,
      enum: ['DIRECT', 'ROLE', 'GROUP'],
    },
    grantedAt: { type: Date },
    lastVerifiedAt: { type: Date },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, collection: 'sod_user_entitlements' }
);

sodUserEntitlementSchema.index({ tenantId: 1, applicationId: 1, userId: 1 });
sodUserEntitlementSchema.index({ applicationId: 1, userId: 1 });

export default mongoose.model('SodUserEntitlement', sodUserEntitlementSchema);

