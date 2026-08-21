import mongoose from "mongoose";
import { GRAPH_EDGE_TYPES, GRAPH_NODE_TYPES } from "../../services/graph/graphConstants.js";

const nodeTypeEnum = Object.values(GRAPH_NODE_TYPES);
const edgeTypeEnum = Object.values(GRAPH_EDGE_TYPES);

const identityGraphEdgeSchema = new mongoose.Schema(
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
    sourceNodeId: { type: String, required: true, index: true },
    sourceType: { type: String, enum: nodeTypeEnum, required: true },
    targetNodeId: { type: String, required: true, index: true },
    targetType: { type: String, enum: nodeTypeEnum, required: true },
    relationshipType: {
      type: String,
      enum: edgeTypeEnum,
      required: true,
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: "identity_graph_edges" },
);

identityGraphEdgeSchema.index(
  { tenantId: 1, applicationId: 1, sourceNodeId: 1, relationshipType: 1 },
  { background: true },
);
identityGraphEdgeSchema.index(
  { tenantId: 1, applicationId: 1, targetNodeId: 1, relationshipType: 1 },
  { background: true },
);
identityGraphEdgeSchema.index(
  { tenantId: 1, applicationId: 1, sourceType: 1, targetType: 1 },
  { background: true },
);
identityGraphEdgeSchema.index(
  {
    tenantId: 1,
    applicationId: 1,
    sourceNodeId: 1,
    targetNodeId: 1,
    relationshipType: 1,
  },
  { unique: true, background: true },
);

export default mongoose.model("IdentityGraphEdge", identityGraphEdgeSchema);
