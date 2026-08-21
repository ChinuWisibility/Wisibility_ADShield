import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import RemediationWorkflowRule from "../../models/workflowTaskQueue/RemediationWorkflowRule.js";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import {
  getEnabledWorkflows,
  getWorkflowById,
  createWorkflow,
  toApiWorkflow,
} from "../../workflows/persistence/workflowStore.js";
import { buildWorkflowTenantReadFilter } from "../../workflows/persistence/workflowTenantScope.js";
import { WORKFLOW_TASK_ACTIONS } from "../../constants/workflowTaskQueue.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACCESS_REVOKE_OPTION2_TEMPLATE = path.join(
  __dirname,
  "../../workflows/templates/access-revoke-option2-flow.json",
);

const ACTION_WORKFLOW_DEFAULTS = {
  [WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW]: {
    tag: "IAM_ORPHAN_REVIEW",
    triggerType: "UncorrelatedAccountIAMDecision",
  },
  [WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE]: {
    tag: "CERTIFICATION_REVOKE",
    triggerType: "CertificationSignedOff",
    // Prefer the automated Option 2 starter when present.
    preferredName: "Access Revoke — Automated (Option 2)",
    seedTemplatePath: ACCESS_REVOKE_OPTION2_TEMPLATE,
  },
};

async function findByPreferredName(tenantId, name) {
  if (!name) return null;
  const doc = await RemediationWorkflowDefinition.findOne({
    ...buildWorkflowTenantReadFilter(tenantId),
    enabled: { $ne: false },
    name,
  })
    .sort({ updatedAt: -1 })
    .lean();
  return doc ? toApiWorkflow(doc) : null;
}

/** Create the seed template if it does not exist yet (auto-provision). */
async function seedDefaultTemplate(tenantId, seedTemplatePath) {
  if (!seedTemplatePath) return null;
  try {
    const template = JSON.parse(fs.readFileSync(seedTemplatePath, "utf8"));
    const existing = await RemediationWorkflowDefinition.findOne({
      ...buildWorkflowTenantReadFilter(tenantId),
      name: template.name,
    }).lean();
    if (existing) return toApiWorkflow(existing);
    if (!tenantId) return null;
    return await createWorkflow(template, String(tenantId), "system");
  } catch {
    return null;
  }
}

async function findDefaultWorkflowForAction(tenantId, action) {
  const defaults = ACTION_WORKFLOW_DEFAULTS[action];
  if (!defaults) return null;

  const preferred = await findByPreferredName(tenantId, defaults.preferredName);
  if (preferred) return preferred;

  if (defaults.triggerType) {
    const byTrigger = await getEnabledWorkflows(tenantId, defaults.triggerType);
    if (byTrigger.length) return byTrigger[0];
  }

  if (defaults.tag) {
    const doc = await RemediationWorkflowDefinition.findOne({
      ...buildWorkflowTenantReadFilter(tenantId),
      enabled: { $ne: false },
      tags: defaults.tag,
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (doc) return toApiWorkflow(doc);
  }

  // Nothing mapped yet — auto-provision the seed starter template.
  return seedDefaultTemplate(tenantId, defaults.seedTemplatePath);
}

async function upsertActionMapping(tenantId, action, workflow, updatedBy = "system") {
  const tid = String(tenantId);
  const doc = await RemediationWorkflowRule.findOne({ tenantId: tid }).lean();
  const mappings = [...(doc?.actionMappings || [])];
  const idx = mappings.findIndex((m) => m.action === action);
  const entry = {
    action,
    workflowId: workflow.id,
    workflowName: workflow.name,
    enabled: true,
  };

  if (idx >= 0) mappings[idx] = { ...mappings[idx], ...entry };
  else mappings.push(entry);

  await RemediationWorkflowRule.findOneAndUpdate(
    { tenantId: tid },
    { $set: { actionMappings: mappings, updatedBy } },
    { upsert: true },
  );
  return entry;
}

async function autoProvisionWorkflowMapping(tenantId, action) {
  const wf = await findDefaultWorkflowForAction(tenantId, action);
  if (!wf) return null;
  await upsertActionMapping(tenantId, action, wf);
  return { workflowId: wf.id, workflowName: wf.name };
}

export async function getRemediationWorkflowRules(tenantId) {
  const tid = tenantId ? String(tenantId) : null;
  if (!tid) return { actionMappings: [] };
  const doc = await RemediationWorkflowRule.findOne({ tenantId: tid }).lean();
  return doc || { tenantId: tid, actionMappings: [] };
}

export async function putRemediationWorkflowRules(tenantId, actionMappings = [], updatedBy) {
  const tid = String(tenantId);
  const normalized = [];
  for (const row of actionMappings) {
    const action = row.action || WORKFLOW_TASK_ACTIONS.ACCESS_REVOKE;
    const workflowId = String(row.workflowId || "").trim();
    if (!workflowId) continue;
    const wf = await getWorkflowById(workflowId, tid);
    if (!wf) {
      throw new Error(`Workflow not found for action ${action}: ${workflowId}`);
    }
    normalized.push({
      action,
      workflowId: wf.id,
      workflowName: row.workflowName || wf.name,
      enabled: row.enabled !== false,
    });
  }
  const doc = await RemediationWorkflowRule.findOneAndUpdate(
    { tenantId: tid },
    { $set: { actionMappings: normalized, updatedBy: updatedBy || "system" } },
    { upsert: true, new: true },
  ).lean();
  return doc;
}

export async function resolveWorkflowForAction(tenantId, action) {
  const tid = tenantId ? String(tenantId) : null;
  if (!tid) return null;

  const doc = await RemediationWorkflowRule.findOne({ tenantId: tid }).lean();
  const mapping = (doc?.actionMappings || []).find(
    (m) => m.action === action && m.enabled !== false,
  );

  if (mapping?.workflowId) {
    const wf = await getWorkflowById(mapping.workflowId, tid);
    if (wf) {
      return {
        workflowId: wf.id,
        workflowName: wf.name,
      };
    }
  }

  return autoProvisionWorkflowMapping(tid, action);
}
