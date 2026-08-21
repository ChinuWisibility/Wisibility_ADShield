import { GRAPH_DEFAULTS } from "./graphConstants.js";

/**
 * Iterative BFS — no deep recursion.
 * @param {string} startNodeId
 * @param {(nodeId: string) => Iterable<string>|string[]} getNeighbors
 * @param {object} [options]
 * @returns {{ visited: Set<string>, depthByNode: Map<string, number>, order: string[] }}
 */
export function bfsTraversal(startNodeId, getNeighbors, options = {}) {
  const maxDepth = options.maxDepth ?? GRAPH_DEFAULTS.MAX_TRAVERSAL_DEPTH;
  const maxNodes = options.maxNodes ?? GRAPH_DEFAULTS.MAX_TRAVERSAL_NODES;

  const visited = new Set();
  const depthByNode = new Map();
  const order = [];
  if (!startNodeId) return { visited, depthByNode, order };

  const queue = [{ id: startNodeId, depth: 0 }];
  visited.add(startNodeId);
  depthByNode.set(startNodeId, 0);

  while (queue.length > 0 && visited.size < maxNodes) {
    const { id, depth } = queue.shift();
    order.push(id);
    if (depth >= maxDepth) continue;

    const neighbors = getNeighbors(id);
    for (const next of neighbors) {
      if (!next || visited.has(next)) continue;
      if (visited.size >= maxNodes) break;
      visited.add(next);
      depthByNode.set(next, depth + 1);
      queue.push({ id: next, depth: depth + 1 });
    }
  }

  return { visited, depthByNode, order };
}

/**
 * Iterative DFS for cycle detection on directed graph.
 * @param {string} startNodeId
 * @param {(nodeId: string) => Iterable<string>|string[]} getOutgoing
 * @param {object} [options]
 * @returns {{ hasCycle: boolean, cycles: string[][] }}
 */
export function detectCyclesIterative(startNodeId, getOutgoing, options = {}) {
  const maxNodes = options.maxNodes ?? GRAPH_DEFAULTS.MAX_TRAVERSAL_NODES;
  const cycles = [];

  const visited = new Set();
  const stack = new Set();
  const path = [];

  const dfs = (nodeId) => {
    if (!nodeId || visited.size > maxNodes) return false;
    visited.add(nodeId);
    stack.add(nodeId);
    path.push(nodeId);

    for (const next of getOutgoing(nodeId)) {
      if (!next) continue;
      if (stack.has(next)) {
        const idx = path.indexOf(next);
        cycles.push(path.slice(idx).concat([next]));
        return true;
      }
      if (!visited.has(next) && dfs(next)) return true;
    }

    path.pop();
    stack.delete(nodeId);
    return false;
  };

  const hasCycle = dfs(startNodeId);
  return { hasCycle, cycles };
}

/**
 * Scan all nodes in adjacency for cycles (iterative, bounded).
 * @param {Map<string, string[]>} adjacency - outgoing adjacency list
 */
export function detectCyclesInAdjacency(adjacency, options = {}) {
  const maxNodes = options.maxNodes ?? GRAPH_DEFAULTS.MAX_TRAVERSAL_NODES;
  const globalVisited = new Set();
  const allCycles = [];

  for (const nodeId of adjacency.keys()) {
    if (globalVisited.size >= maxNodes) break;
    if (globalVisited.has(nodeId)) continue;

    const getOutgoing = (id) => adjacency.get(id) || [];
    const { hasCycle, cycles } = detectCyclesIterative(nodeId, getOutgoing, options);
    const visitResult = bfsTraversal(nodeId, getOutgoing, options);
    for (const v of visitResult.visited) globalVisited.add(v);
    if (hasCycle) allCycles.push(...cycles);
  }

  return { hasCycle: allCycles.length > 0, cycles: allCycles };
}

/**
 * Shortest path (unweighted) via BFS.
 * @returns {string[]|null}
 */
export function shortestPath(startNodeId, endNodeId, getNeighbors, options = {}) {
  const maxDepth = options.maxDepth ?? GRAPH_DEFAULTS.MAX_PATH_SEARCH_DEPTH;
  if (!startNodeId || !endNodeId) return null;
  if (startNodeId === endNodeId) return [startNodeId];

  const visited = new Set([startNodeId]);
  const parent = new Map();
  const queue = [{ id: startNodeId, depth: 0 }];

  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    for (const next of getNeighbors(id)) {
      if (!next || visited.has(next)) continue;
      visited.add(next);
      parent.set(next, id);
      if (next === endNodeId) {
        const path = [endNodeId];
        let cur = endNodeId;
        while (parent.has(cur)) {
          cur = parent.get(cur);
          path.unshift(cur);
        }
        return path;
      }
      queue.push({ id: next, depth: depth + 1 });
    }
  }

  return null;
}

/**
 * Expand effective membership (user → groups, transitive group nesting).
 * @param {string} startNodeId
 * @param {(nodeId: string) => string[]} getOutgoing
 */
export function expandEffectiveMembership(startNodeId, getOutgoing, options = {}) {
  return bfsTraversal(startNodeId, getOutgoing, options);
}
