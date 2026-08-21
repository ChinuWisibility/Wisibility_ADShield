import mongoose from "mongoose";

/**
 * Durable hygiene work queue (Data Hygiene V2).
 * Idempotent by (tenantId, applicationId, widgetId, sourceGeneration, kind).
 */
const hygieneJobSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["RECOMPUTE_APP_WIDGET", "ASSEMBLE_TENANT_SUMMARY", "BACKFILL_WIDGET"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "DONE", "FAILED", "DEAD"],
      default: "PENDING",
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      default: null,
      index: true,
    },
    widgetId: { type: String, default: null, index: true },
    sourceGeneration: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    maxAttempts: {
      type: Number,
      default: () => Number(process.env.HYGIENE_JOB_MAX_ATTEMPTS || 5),
    },
    nextRunAt: { type: Date, default: Date.now, index: true },
    processingStartedAt: { type: Date },
    leaseExpiresAt: { type: Date },
    completedAt: { type: Date },
    lastError: { type: String },
    lockedBy: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true, collection: "hygiene_jobs" },
);

hygieneJobSchema.index({ status: 1, nextRunAt: 1 });
hygieneJobSchema.index({
  tenantId: 1,
  applicationId: 1,
  widgetId: 1,
  kind: 1,
  sourceGeneration: 1,
});
hygieneJobSchema.index({
  tenantId: 1,
  kind: 1,
  status: 1,
});

export default mongoose.model("HygieneJob", hygieneJobSchema);
