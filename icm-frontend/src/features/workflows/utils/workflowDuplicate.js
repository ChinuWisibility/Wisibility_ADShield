import { suggestCopyWorkflowName } from "./workflowImport.js";

export function buildDuplicatePayload(sourceDefinition, workflows = []) {
  const name = suggestCopyWorkflowName(sourceDefinition.name || "Workflow", workflows);
  return {
    name,
    description: sourceDefinition.description || "",
    trigger: sourceDefinition.trigger,
    tags: sourceDefinition.tags || [],
    nodes: sourceDefinition.nodes || [],
    edges: sourceDefinition.edges || [],
    remediationAction: sourceDefinition.remediationAction,
    enabled: sourceDefinition.enabled !== false,
  };
}
