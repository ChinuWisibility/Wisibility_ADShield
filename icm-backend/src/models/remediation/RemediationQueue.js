import mongoose from "mongoose";

const QUEUE_STATUSES = [
  "PENDING",
  "TICKET_CREATED",
  "VALIDATION_PENDING",
  "VALIDATED",
  "FAILED",
  "EXPIRED",
  "CLOSED",
];

const EVENT_TYPES = [
  "REVOKE_ACCESS",
  "MISSING_MANAGER",
  "ORPHAN_ACCOUNT",
  "DUPLICATE_ACCOUNT",
  "INACTIVE_USER_ACCESS",
  "SOD_VIOLATION",
];

const QUEUE_TYPES = [
  "ACCESS_CERTIFICATION",
  "CORRELATION_ENGINE",
  "IDENTITY_QUALITY",
  "ACCESS_ANALYTICS",
  "SOD_ENGINE",
];

const remediationQueueSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, index: true },
    eventId: { type: String, required: true, index: true },
    eventType: { type: String, enum: EVENT_TYPES, required: true, index: true },
    eventQueueType: { type: String, enum: QUEUE_TYPES, required: true, index: true },
    sourceCollection: { type: String },
    sourceId: { type: String, required: true, index: true },
    certificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign", index: true },
    certificationName: { type: String },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application", index: true },
    applicationName: { type: String },
    totalUsersReviewed: { type: Number, default: 0 },
    revokedUsersCount: { type: Number, default: 0 },
    approvedUsersCount: { type: Number, default: 0 },
    pendingUsersCount: { type: Number, default: 0 },
    subjectCount: { type: Number, default: 0 },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },
    status: {
      type: String,
      enum: QUEUE_STATUSES,
      default: "PENDING",
      index: true,
    },
    ticketCreated: { type: Boolean, default: false },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "RemediationTicket", index: true },
    queuedAt: { type: Date, default: Date.now, index: true },
    queuedBy: { type: String, default: "system" },
    detectionSnapshot: { type: mongoose.Schema.Types.Mixed },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "remediation_queue" },
);

remediationQueueSchema.index({ tenantId: 1, status: 1, queuedAt: -1 });
remediationQueueSchema.index(
  { tenantId: 1, eventType: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $nin: ["CLOSED", "VALIDATED"] },
    },
  },
);

export { QUEUE_STATUSES, EVENT_TYPES, QUEUE_TYPES };
export default mongoose.model("RemediationQueue", remediationQueueSchema);
