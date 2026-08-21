import mongoose from 'mongoose';

const notificationQueueSchema = new mongoose.Schema(
  {
    templateKey: { type: String, index: true },
    channel: { type: String, index: true, enum: ['EMAIL', 'SLACK', 'WEBHOOK', 'IN_APP'] },
    recipientEmail: { type: String, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: { type: String },
    body: { type: String },
    status: { type: String, index: true, enum: ['QUEUED', 'SENDING', 'SENT', 'FAILED'], default: 'QUEUED' },
    retryCount: { type: Number, default: 0 },
    scheduledFor: { type: Date, index: true },
    sentAt: { type: Date },
    errorMessage: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, collection: 'notification_queue' }
);

export default mongoose.model('NotificationQueue', notificationQueueSchema);

