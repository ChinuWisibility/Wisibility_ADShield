/**
 * Apply trigger filter from start node config.
 * Returns { proceed: boolean, reason?: string }
 *
 * UncorrelatedAccountIAMDecision triggers are fired explicitly from the UI
 * (per-row action button) so no filter logic is needed — always proceed.
 */
export function applyTriggerFilter(definition, trigger) {
  const nodes = definition?.nodes || [];

  const iamTriggerNode = nodes.find((n) => n.type === "UncorrelatedAccountIAMDecision");
  if (iamTriggerNode) return { proceed: true };

  const triggerNode = nodes.find((n) => n.type === "CertificationSignedOff");
  if (!triggerNode) return { proceed: true };

  const filterDecision =
    triggerNode?.config?.filterDecision || definition?.trigger?.filter?.decision;
  if (!filterDecision || filterDecision === "") return { proceed: true };

  const decision = String(trigger.decision || "").toLowerCase();
  const expected = String(filterDecision).toLowerCase();
  if (decision !== expected) {
    return {
      proceed: false,
      reason: `Trigger filter requires decision "${filterDecision}"; received "${trigger.decision}"`,
    };
  }
  return { proceed: true };
}
