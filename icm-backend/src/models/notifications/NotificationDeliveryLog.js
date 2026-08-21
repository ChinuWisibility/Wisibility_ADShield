import mongoose from "mongoose";

const notificationDeliveryLogSchema = new mongoose.Schema(
  {
    queueId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NotificationQueue",
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: ["SENT", "BOUNCED", "OPENED", "CLICKED", "FAILED"],
      index: true,
    },
    providerMessageId: { type: String },
    deliveredAt: { type: Date, default: Date.now, index: true },
    openedAt: { type: Date },
    clickedAt: { type: Date },
  },
  { timestamps: true, collection: "notification_delivery_logs" },
);

export default mongoose.model(
  "NotificationDeliveryLog",
  notificationDeliveryLogSchema,
);
