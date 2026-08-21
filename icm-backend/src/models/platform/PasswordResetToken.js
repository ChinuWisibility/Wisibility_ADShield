import mongoose from 'mongoose';

const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },
    requestedIp: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    purpose: {
      type: String,
      enum: ['PASSWORD_RESET', 'IDENTITY_ONBOARDING'],
      default: 'PASSWORD_RESET',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true, collection: 'password_reset_tokens' }
);

passwordResetTokenSchema.index({ userId: 1, expiresAt: 1, usedAt: 1 });
passwordResetTokenSchema.index({ userId: 1, purpose: 1, usedAt: 1 });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PASSWORD_TOKEN_PURPOSE = {
  PASSWORD_RESET: 'PASSWORD_RESET',
  IDENTITY_ONBOARDING: 'IDENTITY_ONBOARDING',
};

export default mongoose.model('PasswordResetToken', passwordResetTokenSchema);

