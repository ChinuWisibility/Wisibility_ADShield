import { MarkerType } from "reactflow";
import { v4 as uuidv4 } from "./uuid.js";
import {
  findTriggerNode,
  getPlacementBelowNode,
  WORKFLOW_NODE_H,
  WORKFLOW_NODE_W,
} from "./workflowNodeVisuals.js";
import { getDefaultConfig } from "../config/stepConfigCatalog.js";
import {
  buildEdgeFromConnection,
  canAddStepType,
  isBranchingStep,
  isTerminalStep,
  nextStepLabel,
  validateConnection,
} from "./workflowConstraints.js";
import { isTriggerStepType } from "./workflowStepMeta.js";

const NODE_W = WORKFLOW_NODE_W;
const NODE_H = WORKFLOW_NODE_H;

export function buildEdgeBetween(sourceId, targetId, options = {}) {
  const stroke = options.stroke || "#475569";
  return {
    id: options.id || `e-${sourceId}-${targetId}-${Date.now()}`,
    source: sourceId,
    target: targetId,
    sourceHandle: options.sourceHandle,
    type: "workflowEdge",
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 20, height: 20 },
    style: { stroke, strokeWidth: 2.5 },
    data: options.data || {},
    animated: options.animated ?? false,
  };
}

export function getFirstStepPlacement(triggerNode) {
  return getPlacementBelowNode(triggerNode);
}

function hasDefaultOutgoing(nodeId, edges = []) {
  return edges.some(
    (e) =>
      e.source === nodeId &&
      (e.sourceHandle == null || e.sourceHandle === "") &&
      e.data?.branch !== "true" &&
      e.data?.branch !== "false",
  );
}

/** Node to attach the next palette-added step when auto-connect is enabled. */
export function findAutoConnectSource(nodes = [], edges = []) {
  const trigger = findTriggerNode(nodes);
  if (!trigger) return null;

  if (!hasDefaultOutgoing(trigger.id, edges)) {
    return { node: trigger, sourceHandle: undefined };
  }

  const leaves = nodes.filter((n) => {
    const stepType = n.data?.stepType;
    if (!stepType || isTriggerStepType(stepType)) return false;
    if (isTerminalStep(stepType)) return false;
    if (isBranchingStep(stepType)) return false;
    return !hasDefaultOutgoing(n.id, edges);
  });

  if (!leaves.length) return null;

  leaves.sort((a, b) => (b.position?.y || 0) - (a.position?.y || 0));
  return { node: leaves[0], sourceHandle: undefined };
}

export function resolveAutoConnectPlacement(nodes, edges) {
  const source = findAutoConnectSource(nodes, edges);
  if (!source?.node) return { source: null, position: null };
  return {
    source,
    position: getPlacementBelowNode(source.node),
  };
}

export function createStepNode(item, nodes, position, configOverride) {
  const isStub = Boolean(item.designStub || !item.type);
  const stepType = isStub ? "CatalogStub" : item.type;

  if (!isStub) {
    const check = canAddStepType(nodes, stepType);
    if (!check.allowed) return { error: check.reason };
  }

  const category = item._category || "action";
  const baseLabel = item.label || stepType;
  const label = isStub ? baseLabel : nextStepLabel(stepType, baseLabel, nodes);
  const idPrefix = isStub ? "stub" : stepType.replace(/[^a-zA-Z]/g, "").toLowerCase();
  const newId = `${idPrefix}-${uuidv4().slice(0, 6)}`;

  let config;
  if (isStub) {
    config = {
      catalogLabel: item.label,
      catalogCategory: category,
      description: item.description || "",
      iscStub: true,
    };
  } else if (configOverride) {
    config = configOverride;
  } else {
    config = getDefaultConfig(stepType);
  }

  return {
    node: {
      id: newId,
      type: "workflowStep",
      position: position || { x: 120 + nodes.length * 24, y: 80 + nodes.length * 32 },
      data: {
        label,
        stepType,
        config,
        paletteLabel: isStub ? undefined : item.label,
      },
    },
  };
}

/** Steps that cannot be spliced onto an existing connector (triggers only). */
export function canInsertStepOnEdge(stepType) {
  if (isTriggerStepType(stepType)) {
    return { allowed: false, reason: "Triggers cannot be inserted between existing steps." };
  }
  return { allowed: true };
}

export function disconnectHandle(nodeId, handleType, handleId, edges) {
  if (handleType === "target") {
    return edges.filter((e) => e.target !== nodeId);
  }
  if (handleType === "source") {
    if (handleId === "true" || handleId === "false") {
      return edges.filter((e) => !(e.source === nodeId && e.sourceHandle === handleId));
    }
    return edges.filter(
      (e) => !(e.source === nodeId && (e.sourceHandle == null || e.sourceHandle === "")),
    );
  }
  return edges;
}

export function countDisconnectedEdges(nodeId, handleType, handleId, edges) {
  const before = edges.length;
  const after = disconnectHandle(nodeId, handleType, handleId, edges).length;
  return before - after;
}

export function computeInsertPosition(sourceNode, targetNode, overridePosition) {
  if (overridePosition) return overridePosition;
  const sx = sourceNode.position.x + NODE_W / 2;
  const sy = sourceNode.position.y + NODE_H;
  const tx = targetNode.position.x + NODE_W / 2;
  const ty = targetNode.position.y;
  return {
    x: (sourceNode.position.x + targetNode.position.x) / 2,
    y: (sy + ty) / 2 - NODE_H / 2,
  };
}

export function insertStepOnEdge({ edge, item, nodes, edges, position, configOverride }) {
  const sourceNode = nodes.find((n) => n.id === edge.source);
  const targetNode = nodes.find((n) => n.id === edge.target);
  if (!sourceNode || !targetNode) {
    return { error: "Invalid connection — source or target step missing." };
  }

  const insertPos = computeInsertPosition(sourceNode, targetNode, position);
  const stepType = item.type || (item.designStub ? "CatalogStub" : null);
  const insertCheck = canInsertStepOnEdge(stepType);
  if (!insertCheck.allowed) return { error: insertCheck.reason };

  const created = createStepNode(item, nodes, insertPos, configOverride);
  if (created.error) return { error: created.error };

  const newNode = created.node;
  const branchHandle = edge.sourceHandle || edge.data?.branch || undefined;
  const nodesWithNew = [...nodes, newNode];
  const edgesWithoutOld = edges.filter((e) => e.id !== edge.id);

  const edge1Conn = {
    source: edge.source,
    target: newNode.id,
    sourceHandle: branchHandle,
  };
  const edge1Check = validateConnection(nodesWithNew, edgesWithoutOld, edge1Conn);
  if (!edge1Check.valid) return { error: edge1Check.message };

  const edge1 = buildEdgeFromConnection(edge1Conn, nodesWithNew);
  const terminatesBranch = isTerminalStep(newNode.data?.stepType);

  if (terminatesBranch) {
    const newEdges = edgesWithoutOld.concat([edge1]);
    return {
      nodes: nodesWithNew,
      edges: newEdges,
      newNode,
      disconnectedTargetId: targetNode.id,
    };
  }

  const edge2Conn = { source: newNode.id, target: edge.target };
  const edge2Check = validateConnection(nodesWithNew, edgesWithoutOld, edge2Conn);
  if (!edge2Check.valid) return { error: edge2Check.message };

  const edge2 = buildEdgeFromConnection(edge2Conn, nodesWithNew);
  const newEdges = edgesWithoutOld.concat([edge1, edge2]);

  return { nodes: nodesWithNew, edges: newEdges, newNode };
}

function getNodeHandleCoords(node, handle) {
  const x = node.position.x;
  const y = node.position.y;
  if (handle === "source") {
    return { x: x + NODE_W / 2, y: y + NODE_H };
  }
  if (handle === "source-true") {
    return { x: x + NODE_W * 0.28, y: y + NODE_H };
  }
  if (handle === "source-false") {
    return { x: x + NODE_W * 0.72, y: y + NODE_H };
  }
  return { x: x + NODE_W / 2, y: y };
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function smoothStepPathDistance(px, py, src, tgt) {
  const midY = (src.y + tgt.y) / 2;
  return Math.min(
    distPointToSegment(px, py, src.x, src.y, src.x, midY),
    distPointToSegment(px, py, src.x, midY, tgt.x, midY),
    distPointToSegment(px, py, tgt.x, midY, tgt.x, tgt.y),
  );
}

export function findEdgeNearPoint(point, nodes, edges, thresholdPx = 28) {
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let closest = null;
  let minDist = thresholdPx;

  for (const edge of edges) {
    const source = nodeById[edge.source];
    const target = nodeById[edge.target];
    if (!source || !target) continue;

    const branch = edge.sourceHandle || edge.data?.branch;
    const sourceHandleKey =
      branch === "true" ? "source-true" : branch === "false" ? "source-false" : "source";
    const src = getNodeHandleCoords(source, sourceHandleKey);
    const tgt = getNodeHandleCoords(target, "target");

    const d = smoothStepPathDistance(point.x, point.y, src, tgt);
    if (d < minDist) {
      minDist = d;
      closest = edge;
    }
  }

  return closest;
}
