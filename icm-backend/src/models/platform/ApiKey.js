import mongoose from "mongoose";

const apiKeySchema = new mongoose.Schema(
  {
    keyName: { type: String, required: true },
    keyHashEncrypted: { type: String },
    issuedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },
    scopes: [String],
    lastUsedAt: { type: Date, index: true },
    expiresAt: { type: Date },
    isRevoked: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "api_keys" },
);

apiKeySchema.index({ keyName: 1 });
apiKeySchema.index({ tenantId: 1, createdAt: -1 });
apiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("ApiKey", apiKeySchema);
