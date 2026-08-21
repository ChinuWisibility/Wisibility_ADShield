import mongoose from "mongoose";

const userSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    sessionToken: { type: String, required: true, unique: true },
    ipAddress: { type: String },
    userAgent: { type: String },
    expiresAt: { type: Date },
    isRevoked: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "user_sessions" },
);

userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
userSessionSchema.index({ userId: 1, isRevoked: 1 });
userSessionSchema.index({ tenantId: 1, createdAt: -1 });

export default mongoose.model("UserSession", userSessionSchema);
