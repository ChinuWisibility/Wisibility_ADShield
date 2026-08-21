import { v4 as uuidv4 } from "uuid";
import RemediationWorkflowNodeExecution from "../../models/workflow/RemediationWorkflowNodeExecution.js";
import { buildWorkflowTenantReadFilter } from "./workflowTenantScope.js";

function tenantFilter(tenantId) {
  return buildWorkflowTenantReadFilter(tenantId);
}

export async function getNextAttemptNumber(executionId, nodeId) {
  if (!executionId) return 1;
  const latest = await RemediationWorkflowNodeExecution.findOne({ executionId, nodeId })
    .sort({ attemptNumber: -1 })
    .select("attemptNumber")
    .lean();
  return (latest?.attemptNumber || 0) + 1;
}

export async function beginNodeExecution({
  tenantId,
  executionId,
  runId,
  workflowId,
  nodeId,
  nodeName,
  nodeType,
  attemptNumber,
}) {
  const nodeExecutionId = uuidv4();
  const startedAt = new Date();
  const retryCount = Math.max(0, (attemptNumber || 1) - 1);

  const doc = await RemediationWorkflowNodeExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    nodeExecutionId,
    executionId: executionId ?? null,
    runId,
    workflowId: workflowId ?? null,
    attemptNumber: attemptNumber || 1,
    nodeId,
    nodeName,
    nodeType,
    status: "RUNNING",
    retryCount,
    startedAt,
  });

  return doc.toObject ? doc.toObject() : doc;
}

export async function markNodeExecutionSkipped(
  nodeExecutionId,
  { input, output, branch, reason, durationMs },
) {
  const completedAt = new Date();
  return RemediationWorkflowNodeExecution.findOneAndUpdate(
    { nodeExecutionId },
    {
      $set: {
        status: "SKIPPED",
        input,
        output: output ?? { skipped: true, reason },
        branch: branch ?? null,
        completedAt,
        durationMs: durationMs ?? 0,
      },
    },
    { new: true },
  ).lean();
}

export async function completeNodeExecution(nodeExecutionId, { input, output, branch, durationMs }) {
  const completedAt = new Date();
  return RemediationWorkflowNodeExecution.findOneAndUpdate(
    { nodeExecutionId },
    {
      $set: {
        status: "SUCCESS",
        input,
        output,
        branch: branch ?? null,
        completedAt,
        durationMs,
      },
    },
    { new: true },
  ).lean();
}

export async function failNodeExecution(
  nodeExecutionId,
  { input, output, branch, errorMessage, stackTrace, durationMs },
) {
  const completedAt = new Date();
  return RemediationWorkflowNodeExecution.findOneAndUpdate(
    { nodeExecutionId },
    {
      $set: {
        status: "FAILED",
        input,
        output,
        branch: branch ?? null,
        errorMessage,
        stackTrace,
        completedAt,
        durationMs,
      },
    },
    { new: true },
  ).lean();
}

export async function skipNodeExecution({
  tenantId,
  executionId,
  runId,
  workflowId,
  nodeId,
  nodeName,
  nodeType,
  reason,
}) {
  const nodeExecutionId = uuidv4();
  const now = new Date();
  return RemediationWorkflowNodeExecution.create({
    tenantId: tenantId ? String(tenantId) : null,
    nodeExecutionId,
    executionId: executionId ?? null,
    runId,
    workflowId: workflowId ?? null,
    attemptNumber: 1,
    nodeId,
    nodeName,
    nodeType,
    status: "SKIPPED",
    retryCount: 0,
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    output: { skipped: true, reason },
  }).then((d) => (d.toObject ? d.toObject() : d));
}

export async function listNodeExecutionsByExecutionId(executionId, tenantId) {
  return RemediationWorkflowNodeExecution.find({
    executionId,
    ...tenantFilter(tenantId),
  })
    .sort({ startedAt: 1, attemptNumber: 1 })
    .lean();
}

export async function listNodeExecutionsByRunId(runId, tenantId) {
  return RemediationWorkflowNodeExecution.find({
    runId,
    ...tenantFilter(tenantId),
  })
    .sort({ startedAt: 1 })
    .lean();
}

export function nodeExecutionsToTimelineSteps(nodeExecutions = []) {
  const latestByNode = new Map();
  for (const ne of nodeExecutions) {
    const prev = latestByNode.get(ne.nodeId);
    if (!prev || (ne.attemptNumber || 1) >= (prev.attemptNumber || 1)) {
      latestByNode.set(ne.nodeId, ne);
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const ne of nodeExecutions) {
    if (seen.has(ne.nodeId)) continue;
    seen.add(ne.nodeId);
    ordered.push(latestByNode.get(ne.nodeId));
  }

  return ordered.map(formatNodeExecutionStep);
}

function resolveNodeDurationMs(ne) {
  if (ne?.durationMs != null) return ne.durationMs;
  if (ne?.startedAt && ne?.completedAt) {
    const ms = new Date(ne.completedAt).getTime() - new Date(ne.startedAt).getTime();
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return null;
}

export function formatNodeExecutionStep(ne) {
  const executionTime = resolveNodeDurationMs(ne);
  return {
    stepId: ne.nodeId,
    nodeExecutionId: ne.nodeExecutionId,
    label: ne.nodeName || ne.nodeType,
    stepType: ne.nodeType,
    status: ne.status,
    executionTime,
    durationMs: executionTime,
    error: ne.errorMessage,
    stackTrace: ne.stackTrace,
    input: ne.input,
    output: ne.output,
    branch: ne.branch ?? undefined,
    retryCount: ne.retryCount ?? 0,
    attemptNumber: ne.attemptNumber ?? 1,
    startedAt: ne.startedAt,
    completedAt: ne.completedAt,
    runId: ne.runId,
  };
}
