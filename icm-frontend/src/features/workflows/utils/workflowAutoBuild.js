import { v4 as uuidv4 } from "./uuid.js";
import { buildEdgeFromConnection } from "./workflowConstraints.js";
import { isTriggerStepType } from "./workflowStepMeta.js";
import { findTriggerNode, getPlacementBelowNode } from "./workflowNodeVisuals.js";
import { getAutoFlowForTrigger, getCoachPathForTrigger } from "../config/workflowTriggerRegistry.js";
import { resolveBuildCoachState } from "./workflowBuildCoach.js";
import { resolveStepConfig } from "./workflowStepConfig.js";
import {
  inferCompareStringsConfigOnAdd,
} from "./compareStringsContext.js";

export { getPresetConfig, resolveStepConfig } from "./workflowStepConfig.js";

function makeNodeId(prefix) {
  return `${prefix}-${uuidv4().slice(0, 6)}`;
}

export function canBuildFullAutoFlow(nodes, triggerType) {
  const flow = getAutoFlowForTrigger(triggerType);
  if (!flow) return false;
  const nonTrigger = nodes.filter((n) => !isTriggerStepType(n.data?.stepType));
  return nonTrigger.length === 0;
}

export function buildFullAutoFlow(nodes, edges, triggerType) {
  const flow = getAutoFlowForTrigger(triggerType);
  if (!flow) {
    return { error: "No recommended auto-flow for this trigger yet." };
  }
  return flow.build(nodes, edges);
}

export function resolveCoachContext({ nodes, triggerType, remediationAction, selectedNodeId }) {
  return resolveBuildCoachState({
    nodes,
    remediationAction,
    triggerType,
    selectedNodeId,
  });
}

function findCatalogItem(catalog, stepType, preferredLabel) {
  const groups = [...(catalog.actions || []), ...(catalog.operators || [])];
  if (preferredLabel) {
    const exact = groups.find(
      (i) => i.type === stepType && i.implemented && i.label === preferredLabel,
    );
    if (exact) return exact;
  }
  return groups.find((i) => i.type === stepType && i.implemented) || null;
}

function findAutoConnectSourceForAdd(nodes, edges, pathStep) {
  if (pathStep.connectAfterStepType) {
    const matches = nodes.filter((n) => n.data?.stepType === pathStep.connectAfterStepType);
    const target = matches[pathStep.connectAfterMatchIndex ?? 0];
    if (target) {
      return { node: target, sourceHandle: pathStep.connectBranch || undefined };
    }
  }
  const trigger = findTriggerNode(nodes);
  if (!trigger) return null;

  const nonTrigger = nodes.filter((n) => !isTriggerStepType(n.data?.stepType));
  if (nonTrigger.length === 0) {
    return { node: trigger, sourceHandle: undefined };
  }

  const last = [...nonTrigger].sort((a, b) => (b.position?.y || 0) - (a.position?.y || 0))[0];
  if (last?.data?.stepType === "CompareStrings" && pathStep.connectBranch) {
    return { node: last, sourceHandle: pathStep.connectBranch };
  }
  return { node: last, sourceHandle: undefined };
}

export function buildNextAutoStep(nodes, edges, triggerType, catalog = {}) {
  const coach = resolveBuildCoachState({ nodes, triggerType });
  const next = coach?.nextPathStep;
  if (!next) {
    return {
      error: coach?.isComplete
        ? "Recommended flow is already on the canvas."
        : "Nothing to add.",
    };
  }

  const item = findCatalogItem(catalog, next.stepType, next.paletteLabel);
  if (!item) {
    return { error: `Step "${next.shortLabel}" is not available for this trigger.` };
  }

  const config = resolveStepConfig(next, nodes);
  const source = findAutoConnectSourceForAdd(nodes, edges, next);
  const position = source?.node
    ? getPlacementBelowNode(source.node)
    : getPlacementBelowNode(findTriggerNode(nodes));

  const id = makeNodeId(next.stepType.replace(/[^a-zA-Z]/g, "").toLowerCase());
  const node = {
    id,
    type: "workflowStep",
    position,
    data: {
      label: next.shortLabel,
      stepType: next.stepType,
      config,
      paletteLabel: next.paletteLabel,
    },
  };

  const nodesWithNew = [...nodes, node];
  let newEdges = [...edges];

  if (source?.node) {
    newEdges.push(
      buildEdgeFromConnection(
        { source: source.node.id, target: id, sourceHandle: source.sourceHandle },
        nodesWithNew,
      ),
    );
  }

  return { nodes: nodesWithNew, edges: newEdges, newNode: node };
}

/** Resolve coach config when user manually adds a step from palette/picker. */
export function resolveConfigForManualAdd(
  triggerType,
  stepType,
  nodes,
  paletteLabel,
  { edges = [], remediationAction, connectAfterNode = null } = {},
) {
  const coach = resolveBuildCoachState({ nodes, triggerType, remediationAction });
  let coachConfig = null;

  if (coach?.path) {
    const sameType = coach.path.steps.filter((s) => s.stepType === stepType);
    if (sameType.length) {
      if (paletteLabel) {
        const byLabel = sameType.find((s) => s.paletteLabel === paletteLabel);
        if (byLabel) coachConfig = resolveStepConfig(byLabel, nodes);
      }
      if (!coachConfig) {
        const countOnCanvas = nodes.filter((n) => n.data?.stepType === stepType).length;
        const stepDef = sameType[countOnCanvas] || sameType[sameType.length - 1];
        coachConfig = resolveStepConfig(stepDef, nodes);
      }
    }
  }

  if (stepType === "CompareStrings") {
    const inferred = inferCompareStringsConfigOnAdd({
      nodes,
      edges,
      triggerType,
      remediationAction,
      connectAfterNode,
      coachConfig,
    });
    if (inferred) return inferred;
  }

  return coachConfig;
}

export { getCoachPathForTrigger };
