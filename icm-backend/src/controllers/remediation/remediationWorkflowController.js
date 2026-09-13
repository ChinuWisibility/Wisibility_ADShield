import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import env from "../../config/env.js";
import { AppError } from "../../middleware/errorHandler.js";
import {
  getWorkflows,
  getGlobalWorkflowTemplates,
  createWorkflowFromGlobalTemplate,
  getEnabledWorkflows,
  getWorkflowById,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  toApiWorkflow,
  workflowNameExists,
} from "../../workflows/persistence/workflowStore.js";
import { listRuns, getRunById } from "../../workflows/persistence/runStore.js";
import RemediationWorkflowRun from "../../models/workflow/RemediationWorkflowRun.js";
import {
  buildIamOrphanProgressTrace,
} from "../../services/workflow/orphanIamProgressTrace.js";
import {
  listNodeExecutionsByExecutionId,
  listNodeExecutionsByRunId,
  nodeExecutionsToTimelineSteps,
} from "../../workflows/persistence/nodeExecutionStore.js";
import { formatWorkflowExecution } from "../../workflows/engine/executionFormat.js";
import RemediationWorkflowDefinition from "../../models/workflow/RemediationWorkflowDefinition.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import TaskExecution from "../../models/compliance/TaskExecution.js";
import { validateWorkflow, getStepCatalog } from "../../workflows/workflow/validator.js";
import { repairWorkflowDefinition } from "../../workflows/workflow/repairDefinition.js";
import { STEP_CONFIG_CATALOG_EXPORT } from "../../workflows/workflow/stepConfigExport.js";
import { executeWorkflow } from "../../workflows/engine/executor.js";
import { formatTestRunResult } from "../../workflows/engine/testRunFormat.js";
import {
  getTriggerTemplate,
  getSampleTriggerScenarios,
  getEmptyTriggerTemplate,
  getOrphanIamTriggerTemplate,
  getOrphanIamSampleScenarios,
} from "../../workflows/engine/sampleTriggers.js";
import { createDemoAdapter } from "../../workflows/adapters/demoAdapter.js";
import { buildWorkflowTenantReadFilter } from "../../workflows/persistence/workflowTenantScope.js";
import { recordOrphanIamDecisionAndResume } from "../../services/workflow/orphanIamWorkflowService.js";
import { manualEnqueueOrphanAccount } from "../../services/workflowRemediation/workflowRemediationManualEnqueueService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../../workflows/templates/cert-revoke-flow.json");
const IAM_ORPHAN_TEMPLATE_PATH = path.join(__dirname, "../../workflows/templates/iam-orphan-review-flow.json");
const ACCESS_REVOKE_DUAL_NOTIFY_PATH = path.join(
  __dirname,
  "../../workflows/templates/access-revoke-dual-notify-flow.json",
);

function readTemplate() {
  return JSON.parse(fs.readFileSync(TEMPLATE_PATH, "utf8"));
}

function readIAMOrphanTemplate() {
  return JSON.parse(fs.readFileSync(IAM_ORPHAN_TEMPLATE_PATH, "utf8"));
}

function readAccessRevokeDualNotifyTemplate() {
  return JSON.parse(fs.readFileSync(ACCESS_REVOKE_DUAL_NOTIFY_PATH, "utf8"));
}

/**
 * Tenant for catalog create/list: JWT scope, or platform admin ?tenantId / body.tenantId.
 */
function resolveWorkflowTenantId(req) {
  if (req.scopedTenantId) return String(req.scopedTenantId);
  const fromQuery = req.query?.tenantId;
  const fromBody = req.body?.tenantId;
  const raw = fromQuery || fromBody;
  return raw ? String(raw) : null;
}

function requireWorkflowTenant(req, next) {
  const tenantId = resolveWorkflowTenantId(req);
  if (!tenantId) {
    next(
      new AppError(
        "Select a tenant to manage workflows. Workflows are tenant-scoped and cannot be created globally.",
        400,
        "TENANT_REQUIRED",
      ),
    );
    return null;
  }
  return tenantId;
}

export function getCatalog(req, res) {
  res.set("Cache-Control", "no-store");
  const remediationAction = req.query.remediationAction || undefined;
  res.json({ success: true, data: getStepCatalog(remediationAction) });
}

export function getStepConfig(_req, res) {
  res.json({ success: true, data: STEP_CONFIG_CATALOG_EXPORT });
}

export function getTemplate(_req, res) {
  res.json({ success: true, data: readTemplate() });
}

export async function listWorkflows(req, res, next) {
  try {
    const tenantId = resolveWorkflowTenantId(req);
    if (!tenantId) {
      return res.json({ success: true, data: [], tenantRequired: true });
    }
    const data = await getWorkflows(tenantId);
    res.json({ success: true, data, tenantId });
  } catch (err) {
    next(err);
  }
}

export async function listWorkflowTemplates(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const data = await getGlobalWorkflowTemplates(tenantId);
    res.json({ success: true, data, tenantId });
  } catch (err) {
    next(err);
  }
}

export async function useWorkflowTemplate(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const result = await createWorkflowFromGlobalTemplate(
      req.params.templateId,
      tenantId,
      req.user?.email,
    );
    if (!result) {
      return next(new AppError("Workflow template not found", 404, "NOT_FOUND"));
    }
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result.workflow,
      created: result.created,
      tenantId,
    });
  } catch (err) {
    next(err);
  }
}

export async function listEnabledWorkflows(req, res, next) {
  try {
    const triggerType = req.query.trigger || undefined;
    const data = await getEnabledWorkflows(req.scopedTenantId, triggerType);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflow(req, res, next) {
  try {
    const raw = await getWorkflowById(req.params.id, req.scopedTenantId);
    if (!raw) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    const wf = repairWorkflowDefinition(raw);
    const validation = validateWorkflow(wf);
    res.json({ success: true, data: wf, validation });
  } catch (err) {
    next(err);
  }
}

export async function getWorkflowRuns(req, res, next) {
  try {
    const wf = await getWorkflowById(req.params.id, req.scopedTenantId);
    if (!wf) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    const data = await listRuns(req.params.id, req.scopedTenantId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getRun(req, res, next) {
  try {
    const run = await getRunById(req.params.runId, req.scopedTenantId);
    if (!run) return next(new AppError("Run not found", 404, "NOT_FOUND"));
    const nodeExecutions = await listNodeExecutionsByRunId(req.params.runId, req.scopedTenantId);
    const formatted = formatTestRunResult(run);
    formatted.nodeExecutions = nodeExecutions;
    if (!formatted.executionSteps?.length && nodeExecutions.length) {
      formatted.executionSteps = nodeExecutionsToTimelineSteps(nodeExecutions);
    }
    res.json({ success: true, data: formatted });
  } catch (err) {
    next(err);
  }
}

export async function createWorkflowHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const body = repairWorkflowDefinition(req.body || {});
    delete body.tenantId;
    const trimmedName = String(body.name || "").trim();
    if (!trimmedName) {
      return next(new AppError("Workflow name is required", 400, "VALIDATION_ERROR"));
    }
    body.name = trimmedName;
    body.description = String(body.description || "").trim();
    if (await workflowNameExists(trimmedName, tenantId)) {
      return next(
        new AppError(`A workflow named "${trimmedName}" already exists.`, 409, "DUPLICATE_NAME"),
      );
    }
    const validation = validateWorkflow(body);
    const workflow = await createWorkflow(
      body,
      tenantId,
      req.user?.email,
    );
    res.status(201).json({ success: true, data: workflow, validation });
  } catch (err) {
    next(err);
  }
}

export async function seedTemplateHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const template = readTemplate();
    const existing = await RemediationWorkflowDefinition.findOne({
      name: template.name,
      tenantId: String(tenantId),
    }).lean();
    if (existing) {
      return res.json({ success: true, data: toApiWorkflow(existing), seeded: false });
    }
    const workflow = await createWorkflow(
      template,
      tenantId,
      req.user?.email,
    );
    res.status(201).json({ success: true, data: workflow, seeded: true });
  } catch (err) {
    next(err);
  }
}

export async function seedIAMOrphanTemplateHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const template = readIAMOrphanTemplate();
    const existing = await RemediationWorkflowDefinition.findOne({
      name: template.name,
      tenantId: String(tenantId),
    }).lean();
    if (existing) {
      return res.json({ success: true, data: toApiWorkflow(existing), seeded: false });
    }
    const workflow = await createWorkflow(template, tenantId, req.user?.email);
    res.status(201).json({ success: true, data: workflow, seeded: true });
  } catch (err) {
    next(err);
  }
}

export async function seedAccessRevokeDualNotifyTemplateHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const template = readAccessRevokeDualNotifyTemplate();
    const existing = await RemediationWorkflowDefinition.findOne({
      name: template.name,
      tenantId: String(tenantId),
    }).lean();
    if (existing) {
      return res.json({ success: true, data: toApiWorkflow(existing), seeded: false });
    }
    const workflow = await createWorkflow(template, tenantId, req.user?.email);
    res.status(201).json({ success: true, data: workflow, seeded: true });
  } catch (err) {
    next(err);
  }
}

export async function updateWorkflowHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const existing = await getWorkflowById(req.params.id, tenantId);
    if (!existing) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    // Global templates are readable for runtime fallback, but never mutated in place.
    if (!existing.tenantId) {
      return next(
        new AppError(
          "Global workflow templates are read-only. Use the template library to create a tenant copy.",
          403,
          "GLOBAL_TEMPLATE_READONLY",
        ),
      );
    }
    if (String(existing.tenantId) !== String(tenantId)) {
      return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    }
    const merged = repairWorkflowDefinition({ ...existing, ...req.body, id: req.params.id });
    const validation = validateWorkflow(merged);
    const allowInvalid = req.query.allowInvalid === "true";
    if (!validation.valid && !allowInvalid) {
      return res.status(422).json({
        success: false,
        message: "Workflow validation failed",
        validation,
        data: merged,
      });
    }
    const workflow = await updateWorkflow(req.params.id, merged, tenantId);
    if (!workflow) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    res.json({ success: true, data: workflow, validation });
  } catch (err) {
    next(err);
  }
}

export async function deleteWorkflowHandler(req, res, next) {
  try {
    const tenantId = requireWorkflowTenant(req, next);
    if (!tenantId) return;
    const ok = await deleteWorkflow(req.params.id, tenantId);
    if (!ok) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function validateWorkflowHandler(req, res, next) {
  try {
    const raw = await getWorkflowById(req.params.id, req.scopedTenantId);
    const wf = repairWorkflowDefinition(req.body?.nodes ? req.body : raw || req.body);
    const validation = validateWorkflow(wf);
    res.json({ success: true, data: validation });
  } catch (err) {
    next(err);
  }
}

export async function validateDefinitionHandler(req, res, next) {
  try {
    const definition = repairWorkflowDefinition(req.body?.definition || req.body);
    const validation = validateWorkflow({
      ...definition,
      name: String(definition?.name || "").trim() || "Import preview",
    });
    res.json({ success: true, data: validation });
  } catch (err) {
    next(err);
  }
}

export async function testWorkflowHandler(req, res, next) {
  try {
    const wf = await getWorkflowById(req.params.id, req.scopedTenantId);
    if (!wf) return next(new AppError("Workflow not found", 404, "NOT_FOUND"));
    const triggerInput = req.body?.trigger ?? req.body ?? getTriggerTemplate();
    const result = await executeWorkflow(repairWorkflowDefinition(wf), { trigger: triggerInput }, {
      adapter: createDemoAdapter({ trigger: triggerInput }),
      tenantId: req.scopedTenantId,
      mode: "TEST",
      portalBaseUrl: env.frontendUrl,
      workflowFromEmail: env.workflow.fromEmail,
    });
    res.json({ success: true, data: formatTestRunResult(result) });
  } catch (err) {
    next(err);
  }
}

export async function testDefinitionHandler(req, res, next) {
  try {
    const definition = repairWorkflowDefinition(req.body?.definition || req.body);
    const triggerInput = req.body?.trigger ?? getTriggerTemplate();
    const result = await executeWorkflow(definition, { trigger: triggerInput }, {
      adapter: createDemoAdapter({ trigger: triggerInput }),
      tenantId: req.scopedTenantId,
      mode: "TEST",
      persist: Boolean(definition?.id),
      portalBaseUrl: env.frontendUrl,
      workflowFromEmail: env.workflow.fromEmail,
    });
    res.json({ success: true, data: formatTestRunResult(result) });
  } catch (err) {
    next(err);
  }
}

export async function listExecutions(req, res, next) {
  try {
    const filter = buildWorkflowTenantReadFilter(req.scopedTenantId);
    if (req.query.status) filter.status = req.query.status;
    if (req.query.campaignId) filter.campaignId = String(req.query.campaignId);
    if (req.query.eventType) filter.eventType = req.query.eventType;
    if (req.query.orphanId) filter.orphanId = req.query.orphanId;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const data = await RemediationWorkflowExecution.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getExecution(req, res, next) {
  try {
    const filter = { executionId: req.params.executionId, ...buildWorkflowTenantReadFilter(req.scopedTenantId) };
    const execution = await RemediationWorkflowExecution.findOne(filter).lean();
    if (!execution) return next(new AppError("Execution not found", 404, "NOT_FOUND"));

    const tenantFilter = buildWorkflowTenantReadFilter(req.scopedTenantId);
    const runs = await RemediationWorkflowRun.find({
      executionId: execution.executionId,
      ...tenantFilter,
    })
      .sort({ startedAt: 1 })
      .lean();

    const run = runs.length
      ? runs[runs.length - 1]
      : execution.runId
        ? await getRunById(execution.runId, req.scopedTenantId)
        : null;

    let tasks = [];
    let progressTrace = null;
    if (execution.eventType === "IAM_ORPHAN_REVIEW") {
      const taskFilter = {
        taskName: { $in: ["IAM_ORPHAN_REVIEW", "IAM_ORPHAN_REMINDER", "IAM_ORPHAN_DECISION"] },
        $or: [
          { executionId: execution.executionId },
          ...(execution.orphanId ? [{ orphanId: execution.orphanId }] : []),
        ],
      };
      if (req.scopedTenantId) taskFilter.tenantId = req.scopedTenantId;
      tasks = await TaskExecution.find(taskFilter).sort({ startedAt: 1 }).lean();
      progressTrace = buildIamOrphanProgressTrace(
        execution,
        runs.length ? runs : run ? [run] : [],
        tasks,
      );
    }

    const nodeExecutions = await listNodeExecutionsByExecutionId(
      req.params.executionId,
      req.scopedTenantId,
    );
    const formattedExecution = formatWorkflowExecution(execution, { nodeExecutions });
    const runFormatted = run ? formatTestRunResult(run) : null;
    if (runFormatted && !runFormatted.executionSteps?.length && nodeExecutions.length) {
      runFormatted.executionSteps = nodeExecutionsToTimelineSteps(nodeExecutions);
    }

    res.json({
      success: true,
      data: {
        execution: formattedExecution,
        run: runFormatted,
        runs,
        tasks,
        progressTrace,
        nodeExecutions,
        nodeTimeline: nodeExecutionsToTimelineSteps(nodeExecutions),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getExecutionNodes(req, res, next) {
  try {
    const filter = { executionId: req.params.executionId, ...buildWorkflowTenantReadFilter(req.scopedTenantId) };
    const execution = await RemediationWorkflowExecution.findOne(filter).select("executionId").lean();
    if (!execution) return next(new AppError("Execution not found", 404, "NOT_FOUND"));
    const nodeExecutions = await listNodeExecutionsByExecutionId(
      req.params.executionId,
      req.scopedTenantId,
    );
    res.json({
      success: true,
      data: {
        executionId: req.params.executionId,
        nodeExecutions,
        nodeTimeline: nodeExecutionsToTimelineSteps(nodeExecutions),
      },
    });
  } catch (err) {
    next(err);
  }
}

export function getSampleTriggers(_req, res) {
  res.json({
    success: true,
    data: {
      template: getTriggerTemplate(),
      emptyTemplate: getEmptyTriggerTemplate(),
      scenarios: getSampleTriggerScenarios(),
      orphanIamTemplate: getOrphanIamTriggerTemplate(),
      orphanIamScenarios: getOrphanIamSampleScenarios(),
      description:
        "Certification revoke: use scenarios for Still Present vs Removed. IAM orphan: use orphanIamScenarios for review start vs portal decisions (Assign/Delete/Disable/Ignore).",
    },
  });
}

export async function triggerIAMOrphanWorkflow(req, res, next) {
  try {
    let { workflowId } = req.body || {};
    if (!workflowId) {
      const { resolveWorkflowForAction } = await import("../../services/workflowTaskQueue/remediationWorkflowRuleService.js"
      );
      const { WORKFLOW_TASK_ACTIONS } = await import("../../constants/workflowTaskQueue.js");
      const mapping = await resolveWorkflowForAction(
        req.scopedTenantId,
        WORKFLOW_TASK_ACTIONS.IAM_ORPHAN_REVIEW,
      );
      if (!mapping?.workflowId) {
        return next(
          new AppError(
            "No workflow mapped for IAM_ORPHAN_REVIEW in Global Rule Set → Remediation workflow rules",
            400,
          ),
        );
      }
      workflowId = mapping.workflowId;
    }

    const result = await manualEnqueueOrphanAccount({
      tenantId: req.scopedTenantId,
      targetId: req.params.id,
      workflowId: String(workflowId),
      queuedBy: req.user?.email || "system",
    });

    if (!result?.event) {
      return res.status(422).json({
        success: false,
        message: "Could not create workflow remediation queue event",
      });
    }

    res.status(result.created ? 201 : 200).json({
      success: true,
      data: {
        eventId: result.event.eventId,
        created: result.created,
        duplicate: Boolean(result.duplicate),
        message: result.message,
        queueStatus: result.event.queueStatus,
        event: result.event,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function recordOrphanIamDecision(req, res, next) {
  try {
    const { decision } = req.body || {};
    const result = await recordOrphanIamDecisionAndResume({
      orphanId: req.params.id,
      decision,
      tenantId: req.scopedTenantId,
      decidedBy: req.user?.email || "iam-portal",
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.error });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listTasks(req, res, next) {
  try {
    const filter = {};
    if (req.scopedTenantId) filter.tenantId = req.scopedTenantId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.taskName) filter.taskName = req.query.taskName;
    if (req.query.orphanId) filter.orphanId = String(req.query.orphanId);
    if (req.query.executionId) filter.executionId = String(req.query.executionId);
    const taskNamesRaw = req.query.taskNames;
    if (taskNamesRaw && typeof taskNamesRaw === "string") {
      const names = taskNamesRaw.split(",").map((s) => s.trim()).filter(Boolean);
      if (names.length) filter.taskName = { $in: names };
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (page - 1) * limit;
    const data = await TaskExecution.find(filter)
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const total = await TaskExecution.countDocuments(filter);
    res.json({ success: true, data, total, page, limit });
  } catch (err) {
    next(err);
  }
}
