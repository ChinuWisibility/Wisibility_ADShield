/**
 * Remediation event metadata — derived from workflowTriggerRegistry (single source of truth).
 */
import {
  getAllRegistryEvents,
  getRegistryEntryByAction,
  getTriggerRegistryEntry,
} from "./workflowTriggerRegistry.js";

export const REMEDIATION_WORKFLOW_EVENTS = getAllRegistryEvents();

export function getRemediationEventByAction(action) {
  return getRegistryEntryByAction(action)?.eventMeta || null;
}

export function getRemediationEventByTrigger(triggerType) {
  return getTriggerRegistryEntry(triggerType)?.eventMeta || null;
}

/** Resolve the remediation event for a workflow definition (trigger first, then tags). */
export function getRemediationEventForDefinition(definition) {
  if (!definition) return null;
  const byTrigger = getRemediationEventByTrigger(definition.trigger?.type);
  if (byTrigger) return byTrigger;
  const tags = definition.tags || [];
  return (
    REMEDIATION_WORKFLOW_EVENTS.find(
      (e) => tags.includes(e.tag) || tags.includes(e.action),
    ) || null
  );
}
