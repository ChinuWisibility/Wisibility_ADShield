import mongoose from "mongoose";

const webhookConfigSchema = new mongoose.Schema(
  {
    webhookName: { type: String, required: true },
    endpointUrl: { type: String, required: true },
    events: [String],
    authType: { type: String, enum: ["HMAC", "BEARER", "BASIC"] },
    secretEncrypted: { type: String },
    isActive: { type: Boolean, default: true, index: true },
    lastTriggeredAt: { type: Date },
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "webhook_configs" },
);

webhookConfigSchema.index({ webhookName: 1 });

export default mongoose.model("WebhookConfig", webhookConfigSchema);
