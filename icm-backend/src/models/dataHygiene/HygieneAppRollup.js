import mongoose from "mongoose";

/**
 * Per-app × widget hygiene rollup: dirty tracking + last known count.
 * Unit of work for Data Hygiene V2 recompute.
 */
const hygieneAppRollupSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    widgetId: { type: String, required: true, index: true },
    dirty: { type: Boolean, default: true, index: true },
    /** Bumped on each dirty event for this scope. */
    sourceGeneration: { type: Number, default: 0 },
    /** Set to sourceGeneration when rebuild for that generation succeeds. */
    builtGeneration: { type: Number, default: 0 },
    dirtyReasons: { type: [String], default: [] },
    lastDirtyAt: { type: Date, default: null },
    count: { type: Number, default: 0 },
    predicateVersion: { type: Number, default: 0 },
    builtAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    status: {
      type: String,
      enum: ["neverBuilt", "fresh", "dirty", "processing", "failed"],
      default: "neverBuilt",
      index: true,
    },
  },
  { timestamps: true, collection: "hygiene_app_rollups" },
);

hygieneAppRollupSchema.index(
  { tenantId: 1, applicationId: 1, widgetId: 1 },
  { unique: true },
);
hygieneAppRollupSchema.index({ tenantId: 1, dirty: 1 });
hygieneAppRollupSchema.index({ tenantId: 1, widgetId: 1, dirty: 1 });

export default mongoose.model("HygieneAppRollup", hygieneAppRollupSchema);
