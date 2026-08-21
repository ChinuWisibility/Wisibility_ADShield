import { isTriggerStepType } from "./workflowStepMeta.js";

/** Shared layout constants for canvas nodes and first-step placement. */
export const WORKFLOW_NODE_W = 228;
export const WORKFLOW_NODE_H = 92;
export const STEP_VERTICAL_GAP = 56;

export function getPlacementBelowNode(sourceNode, offsetY = WORKFLOW_NODE_H + STEP_VERTICAL_GAP) {
  if (!sourceNode?.position) {
    return { x: 320, y: 160 };
  }
  return {
    x: sourceNode.position.x,
    y: sourceNode.position.y + offsetY,
  };
}

export function findTriggerNode(nodes = []) {
  return nodes.find((n) => n.id === "trigger" && isTriggerStepType(n.data?.stepType))
    || nodes.find((n) => isTriggerStepType(n.data?.stepType));
}

export function countNonTriggerNodes(nodes = []) {
  return nodes.filter((n) => !isTriggerStepType(n.data?.stepType)).length;
}
