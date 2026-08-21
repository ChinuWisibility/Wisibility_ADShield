import mongoose from "mongoose";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import {
  buildWorkflowTenantReadFilter,
  buildWorkflowTenantOwnedFilter,
  buildWorkflowTenantWriteFilter,
} from "./workflowTenantScope.js";

function tenantFilter(tenantId) {
  return buildWorkflowTenantReadFilter(tenantId);
}

export function toApiWorkflow(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    name: o.name,
    description: o.description || "",
    version: o.version ?? 1,
    enabled: o.enabled !== false,
    trigger: o.trigger || { type: "CertificationSignedOff" },
    nodes: o.nodes || [],
    edges: o.edges || [],
    tags: o.tags || [],
    tenantId: o.tenantId ? String(o.tenantId) : null,
    successCount: o.successCount || 0,
    errorCount: o.errorCount || 0,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Catalog list — tenant-owned workflows only (never all tenants, never global templates). */
export async function getWorkflows(tenantId) {
  if (!tenantId) return [];
  const docs = await RemediationWorkflowDefinition.find(buildWorkflowTenantOwnedFilter(tenantId))
    .sort({ updatedAt: -1 })
    .lean();
  return docs.map(toApiWorkflow);
}

/** Global starter templates, annotated with an existing tenant-owned copy when present. */
export async function getGlobalWorkflowTemplates(tenantId) {
  if (!tenantId) return [];
  const [templates, tenantWorkflows] = await Promise.all([
    RemediationWorkflowDefinition.find({
      $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
    })
      .sort({ name: 1 })
      .lean(),
    RemediationWorkflowDefinition.find(buildWorkflowTenantOwnedFilter(tenantId))
      .select("_id name")
      .lean(),
  ]);
  const tenantWorkflowByName = new Map(
    tenantWorkflows.map((workflow) => [String(workflow.name || "").trim().toLowerCase(), workflow]),
  );
  return templates.map((template) => {
    const existing = tenantWorkflowByName.get(String(template.name || "").trim().toLowerCase());
    return {
      ...toApiWorkflow(template),
      tenantWorkflowId: existing ? String(existing._id) : null,
    };
  });
}

/**
 * Copy a global starter template into a tenant. Repeated calls are idempotent by
 * case-insensitive workflow name and return the existing tenant-owned workflow.
 */
export async function createWorkflowFromGlobalTemplate(templateId, tenantId, createdBy) {
  if (!tenantId || !mongoose.isValidObjectId(templateId)) return null;
  const template = await RemediationWorkflowDefinition.findOne({
    _id: templateId,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
  if (!template) return null;

  const existing = await RemediationWorkflowDefinition.findOne({
    ...buildWorkflowTenantOwnedFilter(tenantId),
    name: { $regex: new RegExp(`^${escapeRegex(String(template.name || "").trim())}$`, "i") },
  }).lean();
  if (existing) {
    return { workflow: toApiWorkflow(existing), created: false };
  }

  const workflow = await createWorkflow(
    {
      name: template.name,
      description: template.description,
      version: template.version,
      enabled: template.enabled,
      trigger: template.trigger,
      nodes: template.nodes,
      edges: template.edges,
      tags: template.tags,
    },
    tenantId,
    createdBy,
  );
  return { workflow, created: true };
}

export async function getEnabledWorkflows(tenantId, triggerType) {
  const filter = { ...tenantFilter(tenantId), enabled: true };
  if (triggerType) filter["trigger.type"] = triggerType;
  const docs = await RemediationWorkflowDefinition.find(filter)
    .sort({ name: 1 })
    .lean();
  return docs.map(toApiWorkflow);
}

export async function getWorkflowById(id, tenantId) {
  if (!mongoose.isValidObjectId(id)) return null;
  const doc = await RemediationWorkflowDefinition.findOne({
    _id: id,
    ...tenantFilter(tenantId),
  }).lean();
  return toApiWorkflow(doc);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function workflowNameExists(name, tenantId, excludeId = null) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;
  const filter = tenantId
    ? {
        ...buildWorkflowTenantOwnedFilter(tenantId),
        name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, "i") },
      }
    : {
        $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
        name: { $regex: new RegExp(`^${escapeRegex(trimmed)}$`, "i") },
      };
  if (excludeId && mongoose.isValidObjectId(excludeId)) {
    filter._id = { $ne: excludeId };
  }
  const doc = await RemediationWorkflowDefinition.findOne(filter).select("_id").lean();
  return Boolean(doc);
}

export async function createWorkflow(workflow, tenantId, createdBy) {
  if (!tenantId) {
    const err = new Error("tenantId is required to create a workflow");
    err.statusCode = 400;
    err.code = "TENANT_REQUIRED";
    throw err;
  }
  const doc = await RemediationWorkflowDefinition.create({
    tenantId: String(tenantId),
    name: workflow.name || "Untitled workflow",
    description: workflow.description || "",
    version: workflow.version ?? 1,
    enabled: workflow.enabled !== false,
    trigger: workflow.trigger ?? { type: "" },
    nodes: workflow.nodes || [],
    edges: workflow.edges || [],
    tags: workflow.tags || ["CERTIFICATION_REVOKE"],
    createdBy: createdBy || undefined,
  });
  return toApiWorkflow(doc);
}

/** System boot seeds only — global templates (tenantId null), not shown in tenant catalogs. */
export async function createGlobalWorkflowTemplate(workflow, createdBy = "system") {
  const doc = await RemediationWorkflowDefinition.create({
    tenantId: null,
    name: workflow.name || "Untitled workflow",
    description: workflow.description || "",
    version: workflow.version ?? 1,
    enabled: workflow.enabled !== false,
    trigger: workflow.trigger ?? { type: "" },
    nodes: workflow.nodes || [],
    edges: workflow.edges || [],
    tags: workflow.tags || ["CERTIFICATION_REVOKE"],
    createdBy: createdBy || undefined,
  });
  return toApiWorkflow(doc);
}

export async function updateWorkflow(id, patch, tenantId) {
  if (!mongoose.isValidObjectId(id) || !tenantId) return null;
  const set = {};
  for (const key of ["name", "description", "version", "enabled", "trigger", "nodes", "edges", "tags"]) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  // Owned-only write filter — global templates (tenantId null) stay immutable.
  const doc = await RemediationWorkflowDefinition.findOneAndUpdate(
    { _id: id, ...buildWorkflowTenantWriteFilter(tenantId) },
    { $set: set },
    { new: true },
  ).lean();
  return toApiWorkflow(doc);
}

export async function deleteWorkflow(id, tenantId) {
  if (!mongoose.isValidObjectId(id) || !tenantId) return false;
  const res = await RemediationWorkflowDefinition.deleteOne({
    _id: id,
    ...buildWorkflowTenantWriteFilter(tenantId),
  });
  return res.deletedCount > 0;
}

export async function recordRunResult(workflowId, status, tenantId) {
  if (!mongoose.isValidObjectId(workflowId)) return;
  const inc = status === "SUCCESS" ? { successCount: 1 } : { errorCount: 1 };
  await RemediationWorkflowDefinition.updateOne(
    { _id: workflowId, ...tenantFilter(tenantId) },
    { $inc: inc },
  );
}
