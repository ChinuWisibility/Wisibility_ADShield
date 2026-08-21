import mongoose from "mongoose";

const notificationTemplateSchema = new mongoose.Schema(
  {
    templateKey: { type: String, required: true, unique: true },
    subject: { type: String },
    bodyHtml: { type: String },
    bodyText: { type: String },
    variables: [String],
    channel: { type: String, enum: ["EMAIL", "SLACK", "TEAMS", "WEBHOOK"] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "notification_templates" },
);

export default mongoose.model(
  "NotificationTemplate",
  notificationTemplateSchema,
);
