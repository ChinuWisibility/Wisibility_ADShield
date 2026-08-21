import { workflowApi } from "../../features/workflows/services/api";
import { remediationWorkflowRulesApi } from "../../features/remediation-events/services/api";
import { getRegistryEntryByAction } from "../../features/workflows/config/workflowTriggerRegistry";

export function dedupeWorkflows(list = []) {
  const seen = new Set();
  return list.filter((wf) => {
    if (!wf?.id || seen.has(wf.id)) return false;
    seen.add(wf.id);
    return true;
  });
}

export function workflowDisplayLabel(workflows, wf) {
  const sameName = workflows.filter((w) => w.name === wf.name);
  if (sameName.length <= 1) return wf.name;
  const version = wf.version ? `v${wf.version}` : null;
  const shortId = wf.id ? wf.id.slice(-6) : null;
  return [wf.name, version || (shortId ? `#${shortId}` : null)].filter(Boolean).join(" · ");
}

/**
 * Load enabled workflows for a remediation action and the Global Rule Set default mapping.
 */
export async function loadRemediationWorkflowOptions(queueAction) {
  const registry = getRegistryEntryByAction(queueAction);
  const triggerType = registry?.triggerType;

  const [wfRes, rulesRes] = await Promise.all([
    workflowApi.enabled(triggerType || undefined),
    remediationWorkflowRulesApi.get(),
  ]);

  const workflows = dedupeWorkflows(wfRes.data?.data || []);
  const actionMappings = rulesRes.data?.data?.actionMappings || [];
  const mapping = actionMappings.find((m) => m.action === queueAction && m.enabled !== false);
  const defaultWorkflowId = mapping?.workflowId || "";

  let defaultWorkflowIdResolved = defaultWorkflowId;
  if (defaultWorkflowId && !workflows.some((w) => w.id === defaultWorkflowId)) {
    const mapped = workflows.find((w) => w.name === mapping?.workflowName);
    if (mapped) defaultWorkflowIdResolved = mapped.id;
  }

  const initialWorkflowId =
    defaultWorkflowIdResolved && workflows.some((w) => w.id === defaultWorkflowIdResolved)
      ? defaultWorkflowIdResolved
      : workflows.length === 1
        ? workflows[0].id
        : "";

  return {
    workflows,
    defaultWorkflowId: defaultWorkflowIdResolved,
    initialWorkflowId,
    triggerLabel: registry?.eventMeta?.triggerLabel || triggerType || queueAction,
  };
}
