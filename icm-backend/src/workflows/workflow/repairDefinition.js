/** Linear actions must not use Yes/No branch edges (legacy builder versions). */
const LINEAR_ACTION_TYPES = new Set(["VerifyAccessRemoved"]);

function normalizeEdge(e) {
  if (e.from && e.to) return e;
  if (e.source && e.target) {
    const branch =
      e.branch ||
      (e.sourceHandle === "true" ? "true" : e.sourceHandle === "false" ? "false" : undefined);
    const { source, target, sourceHandle, id, ...rest } = e;
    return { ...rest, from: source, to: target, branch };
  }
  return e;
}

export function repairWorkflowDefinition(definition) {
  if (!definition?.nodes?.length) return definition;

  let edges = (definition.edges || []).map(normalizeEdge);

  const linearIds = new Set(
    definition.nodes.filter((n) => LINEAR_ACTION_TYPES.has(n.type)).map((n) => n.id),
  );
  if (linearIds.size) {
    edges = edges.map((e) => {
      if (!linearIds.has(e.from) || !e.branch) return e;
      const { branch, ...rest } = e;
      return rest;
    });
  }

  return { ...definition, edges };
}
