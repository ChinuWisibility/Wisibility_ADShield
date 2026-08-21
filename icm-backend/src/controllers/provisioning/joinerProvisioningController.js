import mongoose from "mongoose";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import {
  listIdentityProvisioningRules,
  createIdentityProvisioningRule,
  updateIdentityProvisioningRule,
  deleteIdentityProvisioningRule,
} from "../../services/provisioning/identityProvisioningRuleService.js";
import {
  evaluateJoinersForIdentities,
  findInsertedIdentityIds,
} from "../../services/provisioning/joinerProvisioningService.js";
import { processProvisioningTaskById } from "../../services/provisioning/provisioningWorker.js";

function tenantIdFromReq(req) {
  return req.user?.tenantId || req.headers["x-tenant-id"] || req.query.tenantId;
}

/** JWT payloads carry `id`; only fall back to `_id` for non-JWT callers. Never an email — these land in ObjectId fields. */
function actorIdFromReq(req) {
  return req.user?.id || req.user?._id || undefined;
}

export async function listRules(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const rules = await listIdentityProvisioningRules(tenantId);
    return res.json({ data: rules });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

export async function createRule(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const rule = await createIdentityProvisioningRule(tenantId, req.body || {}, actorIdFromReq(req));
    return res.status(201).json({ data: rule });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

export async function updateRule(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const rule = await updateIdentityProvisioningRule(
      tenantId,
      req.params.id,
      req.body || {},
      actorIdFromReq(req),
    );
    if (!rule) return res.status(404).json({ message: "Rule not found" });
    return res.json({ data: rule });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

export async function removeRule(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const result = await deleteIdentityProvisioningRule(tenantId, req.params.id);
    if (!result.deletedCount) return res.status(404).json({ message: "Rule not found" });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

export async function approveJoiner(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const { decideLifecycleApproval } = await import(
      "../../services/provisioning/lifecycleWorkflowService.js"
    );
    const result = await decideLifecycleApproval({
      provisioningRequestId: req.params.requestId,
      decision: "APPROVED",
      decidedBy: actorIdFromReq(req),
      tenantId,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    return res.json({
      ...result,
      notice: "WORKFLOW_TRIGGERED_OR_RESUMED — not target provisioning success",
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

export async function rejectJoiner(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const { decideLifecycleApproval } = await import(
      "../../services/provisioning/lifecycleWorkflowService.js"
    );
    const result = await decideLifecycleApproval({
      provisioningRequestId: req.params.requestId,
      decision: "REJECTED",
      decidedBy: actorIdFromReq(req),
      tenantId,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/** Admin/test: evaluate Joiner for specific identity IDs (does not bypass approval). */
export async function evaluateJoiner(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const identityIds = req.body?.identityIds || [];
    const syncJobId = req.body?.syncJobId || `manual:${Date.now()}`;
    const result = await evaluateJoinersForIdentities({ tenantId, identityIds, syncJobId });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/** Admin/test: process one provisioning task immediately (worker claim + connector). */
export async function runProvisioningTask(req, res) {
  try {
    const guard = await assertTaskInTenant(req.params.taskId, tenantIdFromReq(req));
    if (!guard.ok) return res.status(guard.status).json({ message: guard.message });
    const result = await processProvisioningTaskById(req.params.taskId);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * Re-arm a FAILED task and execute it. The worker only claims PENDING/RETRYING tasks,
 * so a terminal FAILED task is otherwise unrecoverable without direct DB edits.
 */
export async function retryProvisioningTask(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const guard = await assertTaskInTenant(req.params.taskId, tenantId);
    if (!guard.ok) return res.status(guard.status).json({ message: guard.message });

    const { task } = guard;
    if (!["FAILED", "PENDING", "RETRYING"].includes(task.status)) {
      return res.status(409).json({
        message: `Task is ${task.status} and cannot be retried`,
        status: task.status,
      });
    }

    await ProvisioningTask.updateOne(
      { _id: task._id },
      {
        $set: {
          status: "PENDING",
          nextAttemptAt: new Date(),
          retryCount: 0,
          updatedBy: actorIdFromReq(req),
        },
        $unset: { errorMessage: "", startedAt: "", completedAt: "" },
      },
    );

    const result = await processProvisioningTaskById(String(task._id));
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * ProvisioningTask has no tenantId of its own, so scope through its parent request.
 * A platform admin with no tenant context is allowed through unscoped.
 */
async function assertTaskInTenant(taskId, tenantId) {
  if (!mongoose.isValidObjectId(taskId)) {
    return { ok: false, status: 400, message: "Invalid task id" };
  }
  const task = await ProvisioningTask.findById(taskId).lean();
  if (!task) return { ok: false, status: 404, message: "Task not found" };
  if (!tenantId) return { ok: true, task };

  const request = task.requestId
    ? await ProvisioningRequest.findById(task.requestId).select("tenantId").lean()
    : null;
  if (request && String(request.tenantId) !== String(tenantId)) {
    return { ok: false, status: 404, message: "Task not found" };
  }
  return { ok: true, task };
}

export async function listRecentJoinerCandidates(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ message: "tenantId required" });
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 3600_000);
    const ids = await findInsertedIdentityIds(tenantId, { since });
    return res.json({ data: ids, since });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
