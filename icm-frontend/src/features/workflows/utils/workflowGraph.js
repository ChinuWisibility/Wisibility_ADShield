import dagre from "@dagrejs/dagre";
import { MarkerType } from "reactflow";
import {
  BRANCHING_STEP_TYPES,
  getBranchEdgeLabel,
  getBranchEdgeStyle,
  normalizeFlowEdges,
} from "./workflowConstraints.js";
import { isTriggerStepType } from "./workflowStepMeta.js";
import { getRemediationEventByTrigger } from "../config/remediationWorkflowCatalog.js";

import { WORKFLOW_NODE_H, WORKFLOW_NODE_W } from "./workflowNodeVisuals.js";

const NODE_W = WORKFLOW_NODE_W;
const NODE_H = WORKFLOW_NODE_H;

/**
 * Ensure the fixed trigger appears as the canvas start node. The trigger is no
 * longer draggable from the palette (it is fixed per remediation event), so when
 * a workflow has a trigger.type but no trigger node yet (e.g. fresh scratch
 * create), inject a read-only start node.
 */
export function ensureTriggerStartNode(definition) {
  if (!definition) return definition;
  const triggerType = definition.trigger?.type;
  if (!triggerType) return definition;
  const nodes = definition.nodes || [];
  if (nodes.some((n) => isTriggerStepType(n.type))) return definition;

  const event = getRemediationEventByTrigger(triggerType);
  const triggerNode = {
    id: "trigger",
    type: triggerType,
    label: event?.triggerLabel || triggerType,
    position: { x: 320, y: 40 },
    config: {},
  };
  return { ...definition, nodes: [triggerNode, ...nodes] };
}

/** Verify Access Removed is a linear action; strip legacy Yes/No edges on load. */
export function repairWorkflowDefinition(definition) {
  if (!definition?.nodes?.length) return definition;
  const linearIds = new Set(
    definition.nodes.filter((n) => n.type === "VerifyAccessRemoved").map((n) => n.id),
  );
  if (!linearIds.size) return definition;
  const edges = (definition.edges || []).map((e) => {
    if (!linearIds.has(e.from) || !e.branch) return e;
    const { branch, ...rest } = e;
    return rest;
  });
  return { ...definition, edges };
}

/** Normalize definition for canvas load — empty scratch workflows stay empty */
export function normalizeDefinitionForCanvas(definition) {
  if (!definition) return definition;
  const nodes = definition.nodes || [];
  const triggerNode = nodes.find((n) => isTriggerStepType(n.type));
  const triggerType = definition.trigger?.type || triggerNode?.type || "";
  return {
    ...definition,
    trigger: triggerType ? { ...definition.trigger, type: triggerType } : { type: "" },
    nodes,
    edges: definition.edges || [],
  };
}

export function definitionToFlow(definition) {
  definition = ensureTriggerStartNode(
    repairWorkflowDefinition(normalizeDefinitionForCanvas(definition)),
  );
  const nodes = (definition?.nodes || []).map((n) => ({
    id: n.id,
    type: "workflowStep",
    position: n.position || { x: 0, y: 0 },
    data: {
      label: n.label || n.type,
      stepType: n.type,
      config: n.config || {},
      raw: n,
    },
  }));

  const nodeById = Object.fromEntries((definition?.nodes || []).map((n) => [n.id, n]));
  const flowNodes = nodes;
  let edges = (definition?.edges || []).map((e, i) => {
    const sourceNode = flowNodes.find((n) => n.id === e.from);
    const sourceType = nodeById[e.from]?.type;
    const isBranch = BRANCHING_STEP_TYPES.has(sourceType);
    const branch = e.branch;
    const label = isBranch && sourceNode ? getBranchEdgeLabel(sourceNode, branch) : branch === "true" ? "Yes" : branch === "false" ? "No" : undefined;
    const { stroke, animated } =
      isBranch && sourceNode
        ? getBranchEdgeStyle(sourceNode, branch, label)
        : { stroke: "#64748b", animated: false };
    return {
      id: `e-${e.from}-${e.to}-${branch || i}`,
      source: e.from,
      target: e.to,
      sourceHandle: branch === "true" ? "true" : branch === "false" ? "false" : undefined,
      type: "workflowEdge",
      label: isBranch && branch ? label : undefined,
      labelStyle: label ? { fill: stroke, fontWeight: 600 } : undefined,
      labelBgStyle: { fill: "#fff", fillOpacity: 0.95 },
      data: { branch },
      animated,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 20, height: 20 },
      style: { stroke, strokeWidth: 2.5 },
    };
  });

  edges = normalizeFlowEdges(flowNodes, edges);

  return { nodes, edges };
}

export function flowToDefinition(definition, nodes, edges) {
  const nodeDefs = nodes.map((n) => ({
    id: n.id,
    type: n.data.stepType,
    label: n.data.label,
    position: n.position,
    config: n.data.config || {},
  }));

  const edgeDefs = edges.map((e) => ({
    from: e.source,
    to: e.target,
    branch:
      e.data?.branch ||
      e.sourceHandle ||
      (e.label === "Yes" || e.label === "Still present"
        ? "true"
        : e.label === "No" || e.label === "Removed"
          ? "false"
          : undefined),
  }));

  const triggerNode = nodes.find((n) => isTriggerStepType(n.data?.stepType));
  const trigger = triggerNode
    ? { ...(definition.trigger || {}), type: triggerNode.data.stepType }
    : { ...(definition.trigger || {}), type: definition.trigger?.type || "" };

  return {
    ...definition,
    trigger,
    nodes: nodeDefs,
    edges: edgeDefs,
  };
}

export function autoLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 72, ranksep: 96, marginx: 24, marginy: 24 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      ...n,
      position: {
        x: pos.x - NODE_W / 2,
        y: pos.y - NODE_H / 2,
      },
    };
  });
}

export { getNodeCategory } from "./workflowStepMeta.js";

import { TRIGGER_OUTPUT_SCHEMA, STEP_CONFIG_CATALOG } from "../config/stepConfigCatalog.js";

/** @deprecated use stepConfigCatalog outputSchema */
export const SAMPLE_SCHEMAS = {
  trigger: TRIGGER_OUTPUT_SCHEMA,
  getItem: STEP_CONFIG_CATALOG.GetCertificationItem?.outputSchema,
  verify: STEP_CONFIG_CATALOG.VerifyAccessRemoved?.outputSchema,
};
