import { MarkerType } from "reactflow";
import { countTriggerNodes, isTriggerStepType } from "./workflowStepMeta.js";

/** @deprecated use isTriggerStepType — one trigger per workflow */
export const SINGLETON_STEP_TYPES = new Set(["CertificationSignedOff"]);

/** Operators with Yes / No (or custom) branch outputs — actions use a single outgoing connector */
export const BRANCHING_STEP_TYPES = new Set([
  "CompareStrings",
  "CompareNumbers",
  "VerifyDataType",
  "SchedulerCheck",
  "IamDecisionTaken",
  "CheckJoinerDecision",
]);

export const TERMINAL_STEP_TYPES = new Set(["EndSuccess", "EndFailure", "EndWaiting"]);

export function countStepsByType(nodes, stepType) {
  return nodes.filter((n) => n.data?.stepType === stepType).length;
}

export function canAddStepType(nodes, stepType) {
  if (isTriggerStepType(stepType)) {
    if (countTriggerNodes(nodes) >= 1) {
      return {
        allowed: false,
        reason: "Only one trigger is allowed per workflow.",
      };
    }
  }
  return { allowed: true };
}

export function nextStepLabel(stepType, baseLabel, nodes) {
  const same = nodes.filter((n) => n.data?.stepType === stepType);
  if (same.length === 0) return baseLabel;
  return `${baseLabel} (${same.length + 1})`;
}

export function isBranchingStep(stepType) {
  return BRANCHING_STEP_TYPES.has(stepType);
}

export function isTerminalStep(stepType) {
  return TERMINAL_STEP_TYPES.has(stepType);
}

/**
 * ISC-style connection rules
 */
export function validateConnection(nodes, edges, connection) {
  const source = nodes.find((n) => n.id === connection.source);
  const target = nodes.find((n) => n.id === connection.target);
  if (!source || !target) return { valid: false, message: "Invalid connection." };

  if (isTriggerStepType(target.data?.stepType)) {
    return { valid: false, message: "Cannot connect into a trigger step." };
  }
  if (isTerminalStep(source.data?.stepType)) {
    return { valid: false, message: "End steps cannot have outgoing connections." };
  }

  const branch =
    connection.sourceHandle === "true"
      ? "true"
      : connection.sourceHandle === "false"
        ? "false"
        : undefined;

  if (isBranchingStep(source.data?.stepType) && !branch) {
    return {
      valid: false,
      message: "Use the Yes or No connector on branching steps.",
    };
  }

  const duplicate = edges.some(
    (e) =>
      e.source === connection.source &&
      e.target === connection.target &&
      (e.data?.branch || e.sourceHandle) === (branch || e.data?.branch),
  );
  if (duplicate) {
    return { valid: false, message: "This connection already exists." };
  }

  const sameSourceBranch = edges.filter(
    (e) =>
      e.source === connection.source &&
      (e.data?.branch || (e.sourceHandle === "true" ? "true" : e.sourceHandle === "false" ? "false" : undefined)) ===
        branch &&
      branch != null,
  );
  if (sameSourceBranch.length >= 1 && branch) {
    return {
      valid: false,
      message: `The "${branch === "true" ? "Yes" : "No"}" branch is already connected.`,
    };
  }

  const tentativeEdges = [
    ...edges,
    { source: connection.source, target: connection.target, data: { branch } },
  ];
  if (flowGraphHasCycle(nodes, tentativeEdges)) {
    return {
      valid: false,
      message: "This connection creates a cycle. Circular step loops are not allowed.",
    };
  }

  return { valid: true, branch };
}

/** Directed cycle check for React Flow nodes/edges (source → target). */
export function flowGraphHasCycle(nodes = [], edges = []) {
  const nodeIds = new Set((nodes || []).map((n) => n?.id).filter(Boolean));
  if (!nodeIds.size) return false;

  const adjacency = new Map();
  for (const id of nodeIds) adjacency.set(id, []);

  for (const edge of edges || []) {
    const from = edge?.source;
    const to = edge?.target;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    adjacency.get(from).push(to);
  }

  const visited = new Set();
  const stack = new Set();

  const dfs = (nodeId) => {
    visited.add(nodeId);
    stack.add(nodeId);
    for (const next of adjacency.get(nodeId) || []) {
      if (stack.has(next)) return true;
      if (!visited.has(next) && dfs(next)) return true;
    }
    stack.delete(nodeId);
    return false;
  };

  for (const id of nodeIds) {
    if (!visited.has(id) && dfs(id)) return true;
  }
  return false;
}

export function getBranchEdgeLabel(sourceNode, branch) {
  if (branch !== "true" && branch !== "false") return undefined;
  const cfg = sourceNode?.data?.config || {};
  if (branch === "true" && cfg.branchLabelTrue) return cfg.branchLabelTrue;
  if (branch === "false" && cfg.branchLabelFalse) return cfg.branchLabelFalse;
  return branch === "true" ? "Yes" : "No";
}

/** Red = failure / still present; green = success / removed */
export function getBranchEdgeStyle(sourceNode, branch, label) {
  if (label === "Still present") return { stroke: "#dc2626", animated: false };
  if (label === "Removed") return { stroke: "#16a34a", animated: true };
  if (branch === "true") return { stroke: "#16a34a", animated: true };
  if (branch === "false") return { stroke: "#dc2626", animated: false };
  return { stroke: "#64748b", animated: false };
}

export function buildEdgeFromConnection(connection, nodes) {
  const source = nodes.find((n) => n.id === connection.source);
  const branch =
    connection.sourceHandle === "true"
      ? "true"
      : connection.sourceHandle === "false"
        ? "false"
        : undefined;
  const isBranch = isBranchingStep(source?.data?.stepType);
  const label = isBranch ? getBranchEdgeLabel(source, branch) : undefined;
  const { stroke: strokeColor, animated } = getBranchEdgeStyle(source, branch, label);

  return {
    ...connection,
    sourceHandle: branch,
    id: `e-${connection.source}-${connection.target}-${branch || "default"}-${Date.now()}`,
    type: "workflowEdge",
    label,
    labelStyle: label
      ? {
          fill: strokeColor,
          fontWeight: 600,
        }
      : undefined,
    labelBgStyle: { fill: "#fff", fillOpacity: 0.95 },
    data: { branch },
    markerEnd: { type: MarkerType.ArrowClosed, color: strokeColor, width: 20, height: 20 },
    style: {
      stroke: strokeColor,
      strokeWidth: 2.5,
    },
    animated,
  };
}

/** Ensure saved edges match branch handles (fixes legacy linear edges on branch nodes) */
export function normalizeFlowEdges(nodes, edges) {
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return edges.map((e) => {
    const source = nodeById[e.source];
    if (!source || !isBranchingStep(source.data?.stepType)) {
      const stroke = e.style?.stroke || "#475569";
      return {
        ...e,
        type: "workflowEdge",
        markerEnd: e.markerEnd || {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 20,
          height: 20,
        },
        style: { stroke, strokeWidth: 2.5, ...e.style },
      };
    }
    const branch = e.data?.branch || e.sourceHandle;
    if (branch !== "true" && branch !== "false") return { ...e, type: "workflowEdge" };
    const label = getBranchEdgeLabel(source, branch);
    const { stroke, animated } = getBranchEdgeStyle(source, branch, label);
    return {
      ...e,
      sourceHandle: branch,
      type: "workflowEdge",
      label,
      labelStyle: { fill: stroke, fontWeight: 600 },
      data: { branch },
      style: { ...e.style, stroke, strokeWidth: 2.5 },
      animated,
      markerEnd: e.markerEnd || { type: MarkerType.ArrowClosed, color: stroke, width: 20, height: 20 },
    };
  });
}
