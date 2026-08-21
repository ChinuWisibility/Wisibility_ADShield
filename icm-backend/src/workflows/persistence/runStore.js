import { v4 as uuidv4 } from "uuid";
import RemediationWorkflowRun from "../../models/workflow/RemediationWorkflowRun.js";
import { buildWorkflowTenantReadFilter } from "./workflowTenantScope.js";

function tenantFilter(tenantId) {
  return buildWorkflowTenantReadFilter(tenantId);
}

export async function saveRun(workflowId, runPayload, opts = {}) {
  const runId = runPayload.runId || uuidv4();
  const doc = await RemediationWorkflowRun.findOneAndUpdate(
    { runId },
    {
      $set: {
        runId,
        workflowId: workflowId === "adhoc" ? null : String(workflowId),
        tenantId: opts.tenantId ? String(opts.tenantId) : null,
        executionId: opts.executionId ?? runPayload.executionId ?? null,
        mode: opts.mode || "TEST",
        status: runPayload.status,
        trigger: runPayload.trigger,
        steps: runPayload.steps || [],
        outputs: runPayload.outputs,
        sideEffects: runPayload.sideEffects,
        skipReason: runPayload.skipReason,
        validationErrors: runPayload.validationErrors,
        error: runPayload.error,
        startedAt: runPayload.startedAt,
        completedAt: runPayload.completedAt,
        durationMs: runPayload.durationMs,
      },
    },
    { upsert: true, new: true },
  ).lean();
  return doc;
}

export async function listRuns(workflowId, tenantId, limit = 50) {
  const docs = await RemediationWorkflowRun.find({
    workflowId: String(workflowId),
    ...tenantFilter(tenantId),
  })
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((raw) => ({
    runId: raw.runId,
    workflowId: raw.workflowId,
    executionId: raw.executionId,
    status: raw.status,
    mode: raw.mode,
    startedAt: raw.startedAt,
    completedAt: raw.completedAt,
    durationMs: raw.durationMs,
    stepCount: (raw.steps || []).length,
    skipReason: raw.skipReason,
  }));
}

export async function getRunById(runId, tenantId) {
  return RemediationWorkflowRun.findOne({
    runId,
    ...tenantFilter(tenantId),
  }).lean();
}
