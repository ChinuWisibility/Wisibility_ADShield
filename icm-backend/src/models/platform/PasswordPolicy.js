import mongoose from "mongoose";

const passwordPolicySchema = new mongoose.Schema(
  {
    policyName: { type: String, required: true },
    minLength: { type: Number, default: 8 },
    requireUppercase: { type: Boolean, default: true },
    requireNumbers: { type: Boolean, default: true },
    requireSpecialChars: { type: Boolean, default: true },
    maxAgeDays: { type: Number, default: 90 },
    historyCount: { type: Number, default: 5 },
    lockoutAttempts: { type: Number, default: 5 },
    lockoutDurationMinutes: { type: Number, default: 30 },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "password_policies" },
);

passwordPolicySchema.index({ policyName: 1 });

export default mongoose.model("PasswordPolicy", passwordPolicySchema);
