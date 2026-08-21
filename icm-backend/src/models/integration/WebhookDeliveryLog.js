import mongoose from "mongoose";

const webhookDeliveryLogSchema = new mongoose.Schema(
  {
    webhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebhookConfig",
      index: true,
    },
    eventType: { type: String, index: true },
    payload: { type: mongoose.Schema.Types.Mixed },
    statusCode: { type: Number },
    response: { type: String },
    deliveredAt: { type: Date, default: Date.now, index: true },
    success: { type: Boolean, index: true },
    retryCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "webhook_delivery_logs" },
);

webhookDeliveryLogSchema.index({ webhookId: 1, deliveredAt: -1 });

export default mongoose.model("WebhookDeliveryLog", webhookDeliveryLogSchema);
