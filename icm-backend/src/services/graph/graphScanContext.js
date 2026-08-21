import IdentityGraphEdge from "../../models/security/IdentityGraphEdge.js";
import { GRAPH_EDGE_TYPES } from "./graphConstants.js";
import { bfsTraversal, shortestPath } from "./graphTraversalEngine.js";
import { buildReverseAdjacency } from "./graphAdjacencyCacheService.js";

/**
 * One-shot in-memory graph for a scan (avoids per-user Mongo round trips).
 */
export async function buildScanGraphContext(tenantId, applicationId) {
  const membershipAdj = new Map();
  const nestedGroupAdj = new Map();
  const privilegeGroupIds = new Set();
  const memberOfTargets = new Set();

  const cursor = IdentityGraphEdge.find({
    tenantId,
    applicationId,
    relationshipType: {
      $in: [
        GRAPH_EDGE_TYPES.MEMBER_OF,
        GRAPH_EDGE_TYPES.NESTED_MEMBER_OF,
        GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS,
      ],
    },
  })
    .select("sourceNodeId targetNodeId relationshipType")
    .lean()
    .cursor();

  for await (const edge of cursor) {
    if (edge.relationshipType === GRAPH_EDGE_TYPES.PRIVILEGED_ACCESS) {
      privilegeGroupIds.add(edge.targetNodeId);
    }
    if (edge.relationshipType === GRAPH_EDGE_TYPES.MEMBER_OF) {
      memberOfTargets.add(edge.targetNodeId);
    }
    if (edge.relationshipType === GRAPH_EDGE_TYPES.NESTED_MEMBER_OF) {
      const nestedList = nestedGroupAdj.get(edge.sourceNodeId) || [];
      nestedList.push(edge.targetNodeId);
      nestedGroupAdj.set(edge.sourceNodeId, nestedList);
    }
    const list = membershipAdj.get(edge.sourceNodeId) || [];
    list.push(edge.targetNodeId);
    membershipAdj.set(edge.sourceNodeId, list);
  }

  const incomingByTarget = buildReverseAdjacency(membershipAdj);
  const getNeighbors = (nodeId) => membershipAdj.get(nodeId) || [];

  return {
    membershipAdj,
    nestedGroupAdj,
    incomingByTarget,
    memberOfTargets,
    privilegeGroupIds,
    getNeighbors,
    reachability(userNodeId, maxDepth = 16) {
      return bfsTraversal(userNodeId, getNeighbors, { maxDepth });
    },
    privilegedGroupsReachable(userNodeId, maxDepth = 16) {
      if (!privilegeGroupIds.size) return [];
      const { visited } = bfsTraversal(userNodeId, getNeighbors, { maxDepth });
      const hits = [];
      for (const n of visited) {
        if (privilegeGroupIds.has(n)) hits.push(n);
      }
      return hits;
    },
    shortestPathToPrivileged(userNodeId, targetGroupId, maxDepth = 12) {
      return shortestPath(userNodeId, targetGroupId, getNeighbors, { maxDepth });
    },
  };
}

/**
 * Batch incoming neighbor lookup (chunked $in for large group sets).
 */
export async function loadIncomingNeighborsChunked({
  tenantId,
  applicationId,
  targetNodeIds,
  relationshipTypes,
  chunkSize = 5000,
}) {
  const ids = [...new Set((targetNodeIds || []).filter(Boolean))];
  const result = new Map();
  for (const id of ids) result.set(id, []);

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const query = {
      tenantId,
      applicationId,
      targetNodeId: { $in: chunk },
    };
    if (relationshipTypes?.length) {
      query.relationshipType = { $in: relationshipTypes };
    }
    const cursor = IdentityGraphEdge.find(query)
      .select("sourceNodeId targetNodeId")
      .lean()
      .cursor();
    for await (const edge of cursor) {
      const list = result.get(edge.targetNodeId) || [];
      list.push(edge.sourceNodeId);
      result.set(edge.targetNodeId, list);
    }
  }

  return result;
}
