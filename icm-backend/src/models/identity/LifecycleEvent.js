import mongoose from "mongoose";

/**
 * Durable lifecycle event queue + audit trail.
 * eventStatus drives worker claim: DETECTED|PENDING → IN_PROGRESS → COMPLETED|FAILED
 */

export const LIFECYCLE_ATTRIBUTE_EVENT_TYPES = [
  "IDENTITY_CREATED",
  "IDENTITY_UPDATED",
  "DEPARTMENT_CHANGED",
  "LOCATION_CHANGED",
  "TITLE_CHANGED",
  "MANAGER_CHANGED",
  "ROLE_CHANGED",
  "TERMINATION_SCHEDULED",
  "TERMINATION_EFFECTIVE",
];

export const LIFECYCLE_PRIMARY_EVENT_TYPES = [
  "JOINER",
  "MOVER",
  "LEAVER",
  "REHIRE",
  "CONTRACTOR_EXTEND",
];

export const LIFECYCLE_EVENT_TYPES = [
  ...LIFECYCLE_ATTRIBUTE_EVENT_TYPES,
  ...LIFECYCLE_PRIMARY_EVENT_TYPES,
];

export const LIFECYCLE_PRIORITY = Object.freeze({
  LEAVER: 100,
  TERMINATION_EFFECTIVE: 100,
  TERMINATION_SCHEDULED: 90,
  REHIRE: 70,
  MOVER: 50,
  JOINER: 30,
  IDENTITY_CREATED: 30,
  IDENTITY_UPDATED: 10,
  DEPARTMENT_CHANGED: 10,
  LOCATION_CHANGED: 10,
  TITLE_CHANGED: 10,
  MANAGER_CHANGED: 10,
  ROLE_CHANGED: 10,
  CONTRACTOR_EXTEND: 40,
});

const lifecycleEventSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    identityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Identity",
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: LIFECYCLE_EVENT_TYPES,
      index: true,
      required: true,
    },
    /** High-level JML class when eventType is attribute-level, else mirrors eventType */
    lifecycleType: {
      type: String,
      enum: ["JOINER", "MOVER", "LEAVER", "REHIRE", "NONE", null],
      default: null,
      index: true,
    },
    eventStatus: {
      type: String,
      enum: ["DETECTED", "PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "DEFERRED", "CANCELLED"],
      index: true,
      default: "DETECTED",
    },
    /** Actionable primary event vs attribute detail event */
    isPrimary: { type: Boolean, default: false, index: true },
    priority: { type: Number, default: 10, index: true },
    detectedAt: { type: Date, index: true, default: Date.now },
    effectiveDate: { type: Date, index: true },
    triggeredBy: {
      type: String,
      enum: ["SYSTEM", "MANUAL", "CONNECTOR", "HRMS", "IDENTITY_REFRESH"],
      default: "SYSTEM",
    },
    previousState: { type: mongoose.Schema.Types.Mixed },
    newState: { type: mongoose.Schema.Types.Mixed },
    changeSet: { type: mongoose.Schema.Types.Mixed },
    /**
     * Unique per tenant+sync+identity+eventType (+ optional change hash).
     * Completed events do not block later syncs with a different syncJobId.
     */
    idempotencyKey: { type: String, index: true },
    jmlCorrelationId: { type: String, index: true },
    syncJobId: { type: String, index: true },
    sourceApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    provisioningRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvisioningRequest",
    },
    workflowExecutionId: { type: String, index: true },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 5 },
    nextAttemptAt: { type: Date, index: true, default: Date.now },
    claimedAt: { type: Date },
    claimedBy: { type: String },
    completedAt: { type: Date },
    error: { type: String },
    processingLog: { type: [String], default: undefined },
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "lifecycle_events" },
);

lifecycleEventSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
lifecycleEventSchema.index({
  eventStatus: 1,
  isPrimary: 1,
  nextAttemptAt: 1,
  priority: -1,
});
lifecycleEventSchema.index({ eventStatus: 1, claimedAt: 1 });
lifecycleEventSchema.index({ tenantId: 1, identityId: 1, eventType: 1, eventStatus: 1 });
lifecycleEventSchema.index({ jmlCorrelationId: 1, createdAt: -1 });
lifecycleEventSchema.index({
  eventType: 1,
  eventStatus: 1,
  effectiveDate: 1,
});

export default mongoose.model("LifecycleEvent", lifecycleEventSchema);
