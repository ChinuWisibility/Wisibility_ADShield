import IdentityGraphEdge from "../../models/security/IdentityGraphEdge.js";
import { GRAPH_DEFAULTS, GRAPH_EDGE_TYPES } from "./graphConstants.js";

/**
 * LRU-ish TTL cache for adjacency neighborhoods (memory-bounded).
 */
export class GraphNeighborhoodCache {
  /**
   * @param {object} [options]
   * @param {number} [options.maxNodes]
   * @param {number} [options.ttlMs]
   */
  constructor(options = {}) {
    this.maxNodes = options.maxNodes ?? GRAPH_DEFAULTS.CACHE_MAX_NODES;
    this.ttlMs = options.ttlMs ?? GRAPH_DEFAULTS.CACHE_TTL_MS;
    /** @type {Map<string, { outgoing: string[], incoming: string[], expires: number }>} */
    this.store = new Map();
  }

  _key(scopeKey, nodeId) {
    return `${scopeKey}::${nodeId}`;
  }

  get(scopeKey, nodeId) {
    const k = this._key(scopeKey, nodeId);
    const hit = this.store.get(k);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.store.delete(k);
      return null;
    }
    return hit;
  }

  set(scopeKey, nodeId, value) {
    if (this.store.size >= this.maxNodes) {
      const first = this.store.keys().next().value;
      if (first) this.store.delete(first);
    }
    this.store.set(this._key(scopeKey, nodeId), {
      ...value,
      expires: Date.now() + this.ttlMs,
    });
  }
}

const globalCache = new GraphNeighborhoodCache();

/**
 * Scope key for tenant + application graph partition.
 */
export function graphScopeKey(tenantId, applicationId) {
  return `${tenantId}:${applicationId}`;
}

/**
 * Batch-load outgoing target node ids from IdentityGraphEdge (indexed).
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.tenantId
 * @param {import('mongoose').Types.ObjectId|string} params.applicationId
 * @param {string[]} params.sourceNodeIds
 * @param {string[]} [params.relationshipTypes]
 */
export async function loadOutgoingNeighborsBatch({
  tenantId,
  applicationId,
  sourceNodeIds,
  relationshipTypes,
}) {
  const ids = [...new Set((sourceNodeIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const query = {
    tenantId,
    applicationId,
    sourceNodeId: { $in: ids },
  };
  if (relationshipTypes?.length) {
    query.relationshipType = { $in: relationshipTypes };
  }

  const adj = new Map();
  for (const id of ids) adj.set(id, []);

  const cursor = IdentityGraphEdge.find(query)
    .select("sourceNodeId targetNodeId relationshipType")
    .lean()
    .cursor();

  for await (const edge of cursor) {
    const list = adj.get(edge.sourceNodeId) || [];
    list.push(edge.targetNodeId);
    adj.set(edge.sourceNodeId, list);
  }

  return adj;
}

/**
 * Batch-load incoming source node ids (reverse adjacency).
 */
export async function loadIncomingNeighborsBatch({
  tenantId,
  applicationId,
  targetNodeIds,
  relationshipTypes,
}) {
  const ids = [...new Set((targetNodeIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const query = {
    tenantId,
    applicationId,
    targetNodeId: { $in: ids },
  };
  if (relationshipTypes?.length) {
    query.relationshipType = { $in: relationshipTypes };
  }

  const adj = new Map();
  for (const id of ids) adj.set(id, []);

  const cursor = IdentityGraphEdge.find(query)
    .select("sourceNodeId targetNodeId relationshipType")
    .lean()
    .cursor();

  for await (const edge of cursor) {
    const list = adj.get(edge.targetNodeId) || [];
    list.push(edge.sourceNodeId);
    adj.set(edge.targetNodeId, list);
  }

  return adj;
}

/**
 * Cached outgoing neighbor getter factory.
 */
export function createCachedOutgoingGetter({
  tenantId,
  applicationId,
  relationshipTypes,
  cache = globalCache,
}) {
  const scope = graphScopeKey(tenantId, applicationId);
  const types = relationshipTypes || [
    GRAPH_EDGE_TYPES.MEMBER_OF,
    GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
    GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS,
  ];

  /** @type {Map<string, string[]>} */
  const pendingBatch = new Map();

  return async function getOutgoing(nodeId) {
    const cached = cache.get(scope, nodeId);
    if (cached) return cached.outgoing;

    const batch = await loadOutgoingNeighborsBatch({
      tenantId,
      applicationId,
      sourceNodeIds: [nodeId],
      relationshipTypes: types,
    });
    const outgoing = batch.get(nodeId) || [];
    cache.set(scope, nodeId, { outgoing, incoming: [] });
    return outgoing;
  };
}

/**
 * Build outgoing adjacency for a bounded node set (chunked DB reads).
 * @param {string[]} seedNodeIds
 */
export async function buildAdjacencyFromEdges({
  tenantId,
  applicationId,
  seedNodeIds,
  relationshipTypes,
  maxDepth = 4,
  maxNodes = GRAPH_DEFAULTS.MAX_TRAVERSAL_NODES,
}) {
  const types = relationshipTypes || [
    GRAPH_EDGE_TYPES.MEMBER_OF,
    GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
  ];

  const adjacency = new Map();
  let frontier = [...new Set(seedNodeIds.filter(Boolean))];
  const seen = new Set(frontier);

  for (let depth = 0; depth < maxDepth && seen.size < maxNodes; depth++) {
    if (!frontier.length) break;
    const chunkSize = 200;
    const nextFrontier = [];

    for (let i = 0; i < frontier.length; i += chunkSize) {
      const chunk = frontier.slice(i, i + chunkSize);
      const batch = await loadOutgoingNeighborsBatch({
        tenantId,
        applicationId,
        sourceNodeIds: chunk,
        relationshipTypes: types,
      });

      for (const [src, targets] of batch.entries()) {
        adjacency.set(src, targets);
        for (const t of targets) {
          if (!seen.has(t) && seen.size < maxNodes) {
            seen.add(t);
            nextFrontier.push(t);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return adjacency;
}

export { globalCache as graphNeighborhoodCache };
