import mongoose from 'mongoose';

const passwordOtpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ['forgot', 'change'],
      default: 'forgot',
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
  { timestamps: true, collection: 'password_otps' }
);

passwordOtpSchema.index({ email: 1, purpose: 1, expiresAt: 1 });
passwordOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PasswordOtp', passwordOtpSchema);

