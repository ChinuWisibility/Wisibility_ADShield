import mongoose from "mongoose";

/**
 * Stores each entity matched by a discovery policy evaluation.
 * Acts as an audit trail — one row per matched entity per evaluation run.
 */
const matchedFieldSchema = new mongoose.Schema(
  {
    fieldName: { type: String },
    matchedValue: { type: String },
    operator: { type: String },
    conditionValue: { type: String },
  },
  { _id: false },
);

const discoveryResultSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      index: true,
    },

    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DiscoveryPolicy",
      required: true,
      index: true,
    },
    policyName: { type: String },

    /** UUID grouping all results from one evaluation run. */
    evaluationRunId: { type: String, required: true, index: true },

    entityType: {
      type: String,
      enum: ["USER", "ENTITLEMENT", "AD_GROUP"],
      required: true,
      index: true,
    },

    /** Reference to the source document in the dynamic app collection. */
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    applicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Application",
      required: true,
      index: true,
    },
    applicationName: { type: String },

    /** Which conditions actually matched — useful for debugging / UI. */
    matchedFields: [matchedFieldSchema],

    // ── Denormalised display data ──
    entityDisplayName: { type: String },
    entityIdentifier: { type: String },
    entityDescription: { type: String },

    /** Admin review workflow: detected → confirmed | dismissed */
    reviewStatus: {
      type: String,
      enum: ["detected", "confirmed", "dismissed"],
      default: "detected",
      index: true,
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },

    detectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "discovery_results" },
);

discoveryResultSchema.index({ tenantId: 1, policyId: 1 });
discoveryResultSchema.index({ tenantId: 1, applicationId: 1 });
discoveryResultSchema.index({ entityType: 1, applicationId: 1 });

export default mongoose.model("DiscoveryResult", discoveryResultSchema);
