/**
 * Mutable workflow execution context passed through the engine walk.
 * Nodes read prior outputs via nodeOutputs; variables hold cross-step state.
 */
export function createExecutionContext({
  executionId,
  workflowId,
  runId,
  triggerPayload,
}) {
  return {
    executionId: executionId ?? null,
    workflowId: workflowId ?? null,
    runId: runId ?? null,
    triggerPayload: triggerPayload ?? null,
    nodeOutputs: {},
    variables: {},
    currentNode: null,
  };
}

export function setCurrentNode(ctx, node) {
  ctx.currentNode = node
    ? { id: node.id, type: node.type, label: node.label || node.type }
    : null;
  return ctx;
}

export function recordNodeOutput(ctx, nodeId, output) {
  ctx.nodeOutputs[nodeId] = output;
  return ctx;
}
