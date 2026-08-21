import mongoose from "mongoose";

const identityGraphMetadataSchema = new mongoose.Schema(
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
    graphVersion: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
    nodeCounts: {
      users: { type: Number, default: 0 },
      groups: { type: Number, default: 0 },
    },
    edgeCountsByType: {
      MEMBER_OF: { type: Number, default: 0 },
      NESTED_MEMBER_OF: { type: Number, default: 0 },
      PRIVILEGED_ACCESS: { type: Number, default: 0 },
    },
    privilegedGroupCount: { type: Number, default: 0 },
    lastIncrementalUpdateAt: { type: Date },
    lastMaterializedAt: { type: Date },
    lastScanAnalyzedAt: { type: Date },
    updateSource: { type: String, default: "unknown" },
    timings: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** Iteration #1 — last applyEdgeDiff counters (observation only). */
    incrementalStats: { type: mongoose.Schema.Types.Mixed, default: undefined },
    invalidationRegions: [{ type: String }],
  },
  { timestamps: true, collection: "identity_graph_metadata" },
);

identityGraphMetadataSchema.index(
  { tenantId: 1, applicationId: 1 },
  { unique: true, background: true },
);

export default mongoose.model("IdentityGraphMetadata", identityGraphMetadataSchema);
