import { TRIGGER_STEP_TYPES } from "../catalog/loader.js";

export function findStartNode(nodes) {
  return nodes.find((n) => TRIGGER_STEP_TYPES.has(n.type)) || nodes[0];
}

export function pickNextEdge(edges, fromId, branch) {
  const outEdges = edges.filter((e) => e.from === fromId);
  if (!outEdges.length) return null;

  if (branch != null) {
    const match =
      outEdges.find((e) => e.branch === branch) ||
      outEdges.find((e) => e.branch === "true" && branch === "true") ||
      outEdges.find((e) => e.branch === "false" && branch === "false");
    if (match) return match;
  }

  if (outEdges.length === 1) return outEdges[0];
  return outEdges.find((e) => !e.branch) || outEdges[0];
}

export function isTerminalType(type) {
  return type === "EndSuccess" || type === "EndFailure" || type === "EndWaiting";
}

/**
 * Collect all nodes reachable downstream from `fromId` (BFS), excluding already executed ids.
 */
export function collectDownstreamNodes(nodes, edges, fromId, excludeIds = new Set()) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const seen = new Set(excludeIds);
  const queue = [];
  const result = [];

  edges
    .filter((e) => e.from === fromId)
    .forEach((e) => {
      if (!seen.has(e.to)) queue.push(e.to);
    });

  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId[id];
    if (!node) continue;
    result.push(node);
    edges
      .filter((e) => e.from === id)
      .forEach((e) => {
        if (!seen.has(e.to)) queue.push(e.to);
      });
  }

  return result;
}
