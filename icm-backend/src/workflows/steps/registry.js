const handlers = new Map();

export function registerStep(type, handler) {
  handlers.set(type, handler);
}

export function getStepHandler(type) {
  return handlers.get(type);
}

export function getRegisteredTypes() {
  return [...handlers.keys()];
}

export async function executeStep(node, context, priorOutputs) {
  const handler = handlers.get(node.type);
  if (!handler) {
    return {
      status: "SUCCESS",
      input: { node: { id: node.id, type: node.type } },
      output: { skipped: true, reason: "No handler registered" },
      branch: null,
    };
  }
  return handler.execute(node, context, priorOutputs);
}
