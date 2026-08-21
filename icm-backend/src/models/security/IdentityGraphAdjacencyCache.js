import mongoose from "mongoose";

const identityGraphAdjacencyCacheSchema = new mongoose.Schema(
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
    cacheKey: { type: String, required: true, index: true },
    chunkIndex: { type: Number, required: true, default: 0 },
    graphVersion: { type: Number, default: 0 },
    entries: { type: mongoose.Schema.Types.Mixed, default: {} },
    entryCount: { type: Number, default: 0 },
    expiresAt: { type: Date },
  },
  { timestamps: true, collection: "identity_graph_adjacency_cache" },
);

identityGraphAdjacencyCacheSchema.index(
  { tenantId: 1, applicationId: 1, cacheKey: 1, chunkIndex: 1 },
  { unique: true, background: true },
);
identityGraphAdjacencyCacheSchema.index(
  { tenantId: 1, applicationId: 1, graphVersion: 1 },
  { background: true },
);

export default mongoose.model(
  "IdentityGraphAdjacencyCache",
  identityGraphAdjacencyCacheSchema,
);
