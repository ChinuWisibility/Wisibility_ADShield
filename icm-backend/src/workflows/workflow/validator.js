import { validateNodeConfigFromCatalog } from "./stepConfigRequired.js";
import {
  getIscPaletteCatalog,
  getImplementedStepCatalog,
  getRemediationStepCatalog,
  getImplementedTypes,
  getStepScopeMap,
  TRIGGER_REMEDIATION_ACTION,
  TRIGGER_STEP_TYPES,
  TERMINAL_STEP_TYPES,
} from "../catalog/loader.js";

/** Resolve which remediation action a workflow serves, from trigger or tags. */
function resolveWorkflowAction(definition) {
  const triggerType = definition?.trigger?.type;
  if (triggerType && TRIGGER_REMEDIATION_ACTION[triggerType]) {
    return TRIGGER_REMEDIATION_ACTION[triggerType];
  }
  const tags = definition?.tags || [];
  if (tags.includes("CERTIFICATION_REVOKE") || tags.includes("ACCESS_REVOKE")) {
    return "ACCESS_REVOKE";
  }
  if (tags.includes("IAM_ORPHAN_REVIEW")) return "IAM_ORPHAN_REVIEW";
  return definition?.remediationAction || null;
}

function nodeAllowedForAction(scopeMap, nodeType, action) {
  if (!action) return true;
  const scope = scopeMap[nodeType];
  // Unknown / unscoped types are always allowed (avoids breaking legacy steps).
  if (!Array.isArray(scope) || scope.length === 0) return true;
  return scope.includes("SHARED") || scope.includes(action);
}

/**
 * Detect directed cycles in the workflow graph (save/validate time).
 * Matches executor runtime behavior so loops fail before they can be persisted.
 */
export function workflowGraphHasCycle(nodes = [], edges = []) {
  const nodeIds = new Set(
    (nodes || []).map((n) => n?.id).filter(Boolean).map(String),
  );
  if (!nodeIds.size) return false;

  const adjacency = new Map();
  for (const id of nodeIds) adjacency.set(id, []);

  for (const edge of edges || []) {
    const from = String(edge?.from || edge?.source || "");
    const to = String(edge?.to || edge?.target || "");
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

export function validateWorkflow(definition) {
  const STEP_TYPES = getImplementedTypes();
  const errors = [];
  if (!definition?.name?.trim()) errors.push("Workflow name is required");
  if (!definition?.trigger?.type) errors.push("Trigger is required");

  const nodes = definition?.nodes || [];
  if (!nodes.length) errors.push("At least one step node is required");

  const action = resolveWorkflowAction(definition);
  const scopeMap = getStepScopeMap();

  const nodeIds = new Set();
  for (const node of nodes) {
    if (!node.id) errors.push("Every node must have an id");
    else if (nodeIds.has(node.id)) errors.push(`Duplicate node id: ${node.id}`);
    else nodeIds.add(node.id);

    if (!STEP_TYPES.has(node.type)) {
      errors.push(`Unknown step type: ${node.type}`);
    } else if (!nodeAllowedForAction(scopeMap, node.type, action)) {
      errors.push(
        `"${node.label || node.type}" is not available for ${action} workflows`,
      );
    }

    errors.push(
      ...validateNodeConfigFromCatalog({
        type: node.type,
        label: node.label || node.id,
        config: node.config,
      }),
    );
  }

  const edges = definition?.edges || [];
  const hasTerminal = nodes.some((n) => TERMINAL_STEP_TYPES.has(n.type));
  if (nodes.length > 1 && !hasTerminal) {
    errors.push("Workflow should end with End Success or End Failure");
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from)) errors.push(`Edge references unknown node: ${edge.from}`);
    if (!nodeIds.has(edge.to)) errors.push(`Edge references unknown node: ${edge.to}`);
  }

  const triggerNodes = nodes.filter((n) => TRIGGER_STEP_TYPES.has(n.type));
  if (triggerNodes.length !== 1 && nodes.length > 0) {
    errors.push("Exactly one workflow trigger is required");
  }

  if (workflowGraphHasCycle(nodes, edges)) {
    errors.push(
      "Cycle detected in workflow graph — remove circular step connections",
    );
  }

  return { valid: errors.length === 0, errors };
}

export function getStepCatalog(remediationAction) {
  if (remediationAction) return getRemediationStepCatalog(remediationAction);
  return getImplementedStepCatalog();
}

export { getIscPaletteCatalog, getImplementedStepCatalog } from "../catalog/loader.js";
