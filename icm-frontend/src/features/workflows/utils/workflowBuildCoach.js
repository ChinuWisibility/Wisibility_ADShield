import { isTriggerStepType } from "./workflowStepMeta.js";
import {
  getCoachPathForAction,
  getCoachPathForTrigger,
} from "../config/workflowTriggerRegistry.js";
import { nodesOfStepType } from "./paletteItems.js";

function inferCoachPaletteLabel(node, pathStep) {
  if (node.data?.paletteLabel) return node.data.paletteLabel;
  if (pathStep.paletteLabel && node.data?.stepType === "CompareStrings") {
    return pathStep.paletteLabel;
  }
  return null;
}

function findMatchingNode(nodes, pathStep) {
  const matches = nodesOfStepType(nodes, pathStep.stepType);
  if (!matches.length) return null;

  if (pathStep.paletteLabel) {
    const byLabel = matches.filter((n) => {
      const label = inferCoachPaletteLabel(n, pathStep);
      return label === pathStep.paletteLabel;
    });
    if (byLabel.length) {
      return byLabel[pathStep.matchIndex ?? 0] || byLabel[0];
    }
  }

  return matches[pathStep.matchIndex ?? 0] || null;
}

function countMatchedSteps(nodes, path) {
  let matched = 0;
  for (const pathStep of path.steps) {
    if (findMatchingNode(nodes, pathStep)) matched += 1;
    else break;
  }
  return matched;
}

function findCoachStepForNode(path, node, nonTriggerNodes) {
  if (!node || isTriggerStepType(node.data?.stepType)) return null;
  const ordinal =
    nonTriggerNodes.filter(
      (n) =>
        n.data?.stepType === node.data?.stepType &&
        nonTriggerNodes.indexOf(n) <= nonTriggerNodes.indexOf(node),
    ).length - 1;

  return (
    path.steps.find(
      (s) => s.stepType === node.data?.stepType && (s.matchIndex ?? 0) === ordinal,
    ) ||
    path.steps.find((s) => s.stepType === node.data?.stepType) ||
    null
  );
}

export function getBuildCoachPath(remediationAction) {
  return getCoachPathForAction(remediationAction);
}

export { getCoachPathForTrigger as getBuildCoachPathForTrigger };

export function resolveBuildCoachState({
  nodes = [],
  remediationAction,
  triggerType,
  selectedNodeId,
}) {
  const path =
    getCoachPathForAction(remediationAction) ||
    (triggerType ? getCoachPathForTrigger(triggerType) : null);
  if (!path) return null;

  const nonTrigger = nodes.filter((n) => !isTriggerStepType(n.data?.stepType));
  const matchedCount = countMatchedSteps(nonTrigger, path);
  const isComplete = matchedCount >= path.steps.length;
  const nextPathStep = isComplete ? null : path.steps[matchedCount];

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  const activeCoachStep =
    selectedNode && !isTriggerStepType(selectedNode.data?.stepType)
      ? findCoachStepForNode(path, selectedNode, nonTrigger)
      : null;

  let phase = "add";
  if (isComplete) phase = "finish";
  else if (activeCoachStep) phase = "configure";

  return {
    path,
    matchedCount,
    totalSteps: path.steps.length,
    nextPathStep,
    activeCoachStep,
    isComplete,
    phase,
    progressLabel: isComplete
      ? "Complete"
      : `Step ${matchedCount + 1} of ${path.steps.length}`,
  };
}

export function paletteTabLabel(tab) {
  if (tab === "operator") return "Operators";
  if (tab === "trigger") return "Triggers";
  return "Actions";
}

export function paletteGroupLabel(group) {
  const map = {
    ticket: "Ticket",
    notifications: "Notify",
    queue: "Queue",
    process: "Process",
    flow: "Flow",
  };
  return map[group] || group;
}
