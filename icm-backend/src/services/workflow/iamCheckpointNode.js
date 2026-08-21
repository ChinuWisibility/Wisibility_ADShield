/**
 * Resolves which workflow node to resume after IAM submits a portal decision.
 * Custom builder graphs may rename/replace nodes — never assume a fixed id like "checkDecision".
 */
export function resolveIamCheckpointNodeId(workflow, preferredId = null) {
  const nodes = workflow?.nodes || [];
  if (!nodes.length) return null;

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const scheduleNode = nodes.find((n) => n.type === "OrphanReminderSchedule");
  const decisionNode = nodes.find((n) => n.type === "IamDecisionTaken");

  const candidates = [
    preferredId,
    scheduleNode?.config?.checkpointNodeId,
    decisionNode?.id,
    "checkDecision",
  ].filter(Boolean);

  for (const id of candidates) {
    if (byId[id]) return id;
  }
  return null;
}
