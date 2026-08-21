import { v4 as uuidv4 } from "uuid";
import { validateWorkflow } from "../workflow/validator.js";
import { ensureStepsRegistered, executeStep, buildRunContext } from "../steps/index.js";
import { saveRun } from "../persistence/runStore.js";
import { recordRunResult } from "../persistence/workflowStore.js";
import { VERIFICATION_STATUS } from "../verification/verificationStatus.js";
import {
  beginNodeExecution,
  completeNodeExecution,
  failNodeExecution,
  skipNodeExecution,
  markNodeExecutionSkipped,
  getNextAttemptNumber,
} from "../persistence/nodeExecutionStore.js";
import { createExecutionContext, setCurrentNode, recordNodeOutput } from "./executionContext.js";
import { applyTriggerFilter } from "./triggerFilter.js";
import { findStartNode, pickNextEdge, isTerminalType, collectDownstreamNodes } from "./graph.js";

const MAX_STEPS = 50;
const SKIPPED_REASON = "Workflow stopped due to upstream step failure";

function logStep(runId, workflowId, entry) {
  console.log(
    JSON.stringify({
      level: "info",
      event: "workflow.step",
      runId,
      workflowId,
      ...entry,
    }),
  );
}

function extractStepError(result, caughtError) {
  if (caughtError?.message) return caughtError.message;
  if (result?.output?.verificationReason) return String(result.output.verificationReason);
  if (result?.output?.error) return String(result.output.error);
  if (result?.status === "FAILED") return "Step failed";
  return undefined;
}

function createStepRecord(node, result, stepStartMs, caughtError = null) {
  const completedAt = new Date();
  const executionTime = Date.now() - stepStartMs;
  const error = extractStepError(result, caughtError);

  return {
    stepId: node.id,
    type: node.type,
    label: node.label || node.type,
    status: result.status,
    branch: result.branch ?? null,
    input: result.input,
    output: result.output,
    startedAt: new Date(stepStartMs).toISOString(),
    completedAt: completedAt.toISOString(),
    executionTime,
    error,
    stackTrace: caughtError?.stack || result.output?.stackTrace || undefined,
  };
}

function createSkippedStepRecord(node, reason = SKIPPED_REASON) {
  return {
    stepId: node.id,
    type: node.type,
    label: node.label || node.type,
    status: "SKIPPED",
    branch: null,
    input: undefined,
    output: { skipped: true, reason },
    startedAt: undefined,
    completedAt: undefined,
    executionTime: 0,
    error: undefined,
  };
}

function shouldTrackNodes(options) {
  if (options.trackNodeExecutions === false) return false;
  return Boolean(options.executionId || options.runId);
}

async function persistSkippedNodes(tracking, nodes, reason) {
  if (!tracking?.enabled) return;
  for (const node of nodes) {
    await skipNodeExecution({
      tenantId: tracking.tenantId,
      executionId: tracking.executionId,
      runId: tracking.runId,
      workflowId: tracking.workflowId,
      nodeId: node.id,
      nodeName: node.label || node.type,
      nodeType: node.type,
      reason,
    });
  }
}

async function finalizeNodeExecution(tracking, nodeExec, node, result, stepStartMs, caughtError) {
  if (!tracking?.enabled || !nodeExec?.nodeExecutionId) return;

  const durationMs = Date.now() - stepStartMs;
  const errorMessage = extractStepError(result, caughtError);
  const stackTrace = caughtError?.stack || result.output?.stackTrace || undefined;
  const payload = {
    input: result.input,
    output: result.output,
    branch: result.branch ?? null,
    durationMs,
  };

  if (result.status === "FAILED") {
    await failNodeExecution(nodeExec.nodeExecutionId, {
      ...payload,
      errorMessage,
      stackTrace,
    });
  } else if (result.status === "SKIPPED") {
    const reason = result.output?.reason || SKIPPED_REASON;
    if (nodeExec?.nodeExecutionId) {
      await markNodeExecutionSkipped(nodeExec.nodeExecutionId, {
        ...payload,
        reason,
      });
    } else {
      await skipNodeExecution({
        tenantId: tracking.tenantId,
        executionId: tracking.executionId,
        runId: tracking.runId,
        workflowId: tracking.workflowId,
        nodeId: node.id,
        nodeName: node.label || node.type,
        nodeType: node.type,
        reason,
      });
    }
  } else {
    await completeNodeExecution(nodeExec.nodeExecutionId, payload);
  }
}

function appendSkippedDownstream(stepResults, nodes, edges, fromId) {
  const executedIds = new Set(stepResults.map((s) => s.stepId));
  const downstream = collectDownstreamNodes(nodes, edges, fromId, executedIds);
  downstream.forEach((node) => {
    stepResults.push(createSkippedStepRecord(node));
  });
  return downstream;
}

function isFailFastStepFailure(result, node, failFast) {
  if (!failFast || result.status !== "FAILED") return false;
  if (node.type === "VerifyAccessRemoved") {
    return result.output?.verificationStatus === VERIFICATION_STATUS.VERIFICATION_FAILED;
  }
  return true;
}

/**
 * Execute a workflow graph against a trigger payload.
 * options:
 *   adapter      — side-effect adapter (demo for tests, IGA for live). Required.
 *   tenantId     — tenant scope for run persistence.
 *   mode         — "TEST" | "LIVE".
 *   failFast     — stop on first FAILED step and mark downstream SKIPPED (default: TEST only).
 *   executionId  — links this run to a remediation execution (live).
 *   runId        — optional stable run id (generated if omitted).
 *   onNodeProgress — async callback({ nodeId, nodeName, status }) during live tracking.
 *   persist      — set false to skip saving the run (unsaved ad-hoc definitions).
 *   trackNodeExecutions — persist NodeExecution records (default: true when executionId/runId set).
 *   startNodeId  — resume from this node (skips earlier graph).
 *   seedOutputs  — prior step outputs keyed by node id (for resume after partial runs).
 *   portalBaseUrl, iamTeamEmail — config exposed to steps.
 */
export async function executeWorkflow(definition, triggerInput, options = {}) {
  ensureStepsRegistered();

  const runId = options.runId || uuidv4();
  const workflowId = definition?.id || "adhoc";
  const tenantId = options.tenantId ?? null;
  const mode = options.mode || "TEST";
  const failFast = options.failFast ?? mode === "TEST";
  const persist = options.persist !== false && workflowId !== "adhoc";
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const persistOpts = { tenantId, mode, executionId: options.executionId };
  const tracking = shouldTrackNodes({ ...options, runId })
    ? {
        enabled: true,
        tenantId,
        executionId: options.executionId ?? null,
        runId,
        workflowId: workflowId === "adhoc" ? null : String(workflowId),
        onProgress: options.onNodeProgress,
      }
    : { enabled: false };

  const execContext = createExecutionContext({
    executionId: options.executionId,
    workflowId,
    runId,
    triggerPayload: triggerInput?.trigger || triggerInput,
  });

  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    const result = {
      runId,
      status: "FAILED",
      success: false,
      validationErrors: validation.errors,
      error: validation.errors.join("; "),
      steps: [],
      executionSteps: [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    if (persist) {
      await saveRun(workflowId, { ...result, trigger: triggerInput?.trigger || triggerInput }, persistOpts);
    }
    return result;
  }

  const context = await buildRunContext(triggerInput, {
    adapter: options.adapter,
    portalBaseUrl: options.portalBaseUrl,
    orphanIamPortalUrl: options.orphanIamPortalUrl,
    iamTeamEmail: options.iamTeamEmail,
    workflowFromEmail: options.workflowFromEmail,
    executionId: options.executionId,
    tenantId: options.tenantId,
    mode,
  });
  const filter = applyTriggerFilter(definition, context.trigger);

  if (!filter.proceed) {
    const result = {
      runId,
      status: "SKIPPED",
      success: false,
      skipReason: filter.reason,
      trigger: context.trigger,
      steps: [],
      executionSteps: [],
      outputs: {},
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
    if (persist) {
      await saveRun(workflowId, result, persistOpts);
      await recordRunResult(workflowId, "SUCCESS", tenantId);
    }
    return result;
  }

  const { nodes, edges } = definition;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let start;
  if (options.startNodeId) {
    start = byId[options.startNodeId];
    if (!start) {
      return {
        runId,
        status: "FAILED",
        success: false,
        error: `Resume node "${options.startNodeId}" was not found in this workflow definition`,
        steps: [],
        executionSteps: [],
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
      };
    }
  } else {
    start = findStartNode(nodes);
  }
  if (!start) {
    return {
      runId,
      status: "FAILED",
      success: false,
      error: "No start node",
      steps: [],
      executionSteps: [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
    };
  }

  const stepResults = [];
  const priorOutputs = {
    ...(options.seedOutputs || {}),
    ...execContext.nodeOutputs,
  };
  const visited = new Set();
  let currentId = start.id;
  let finalStatus = "SUCCESS";
  let stepCount = 0;
  let failedStepId;
  let failedStepLabel;
  let rootError;

  while (currentId && stepCount < MAX_STEPS) {
    if (visited.has(currentId)) {
      finalStatus = "FAILED";
      const cycleRecord = {
        stepId: currentId,
        type: "engine",
        label: "Cycle detected",
        status: "FAILED",
        output: { error: "Cycle detected in workflow graph" },
        error: "Cycle detected in workflow graph",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        executionTime: 0,
      };
      stepResults.push(cycleRecord);
      failedStepId = currentId;
      failedStepLabel = "Cycle detected";
      rootError = cycleRecord.error;
      if (failFast) {
        const skipped = appendSkippedDownstream(stepResults, nodes, edges, currentId);
        await persistSkippedNodes(tracking, skipped);
      }
      break;
    }
    visited.add(currentId);
    stepCount += 1;

    const node = byId[currentId];
    if (!node) break;

    setCurrentNode(execContext, node);
    if (tracking.enabled && tracking.onProgress) {
      await tracking.onProgress({
        nodeId: node.id,
        nodeName: node.label || node.type,
        status: "RUNNING",
      });
    }

    const stepStartMs = Date.now();
    let nodeExec = null;
    if (tracking.enabled) {
      const attemptNumber = tracking.executionId
        ? await getNextAttemptNumber(tracking.executionId, node.id)
        : 1;
      nodeExec = await beginNodeExecution({
        tenantId: tracking.tenantId,
        executionId: tracking.executionId,
        runId: tracking.runId,
        workflowId: tracking.workflowId,
        nodeId: node.id,
        nodeName: node.label || node.type,
        nodeType: node.type,
        attemptNumber,
      });
    }

    let result;
    let caughtError = null;
    try {
      result = await executeStep(node, context, priorOutputs);
    } catch (err) {
      caughtError = err;
      result = {
        status: "FAILED",
        input: { node: { id: node.id, type: node.type } },
        output: { error: err?.message || "Step execution failed", stackTrace: err?.stack },
        branch: null,
      };
    }
    recordNodeOutput(execContext, node.id, result.output);
    priorOutputs[node.id] = result.output;

    const stepRecord = createStepRecord(node, result, stepStartMs, caughtError);
    stepResults.push(stepRecord);

    await finalizeNodeExecution(tracking, nodeExec, node, result, stepStartMs, caughtError);

    if (tracking.enabled && tracking.onProgress) {
      await tracking.onProgress({
        nodeId: node.id,
        nodeName: node.label || node.type,
        status: result.status,
      });
    }

    logStep(runId, workflowId, {
      nodeId: node.id,
      stepType: node.type,
      branch: result.branch,
      status: result.status,
      executionTime: stepRecord.executionTime,
    });

    if (isFailFastStepFailure(result, node, failFast)) {
      finalStatus = "FAILED";
      failedStepId = node.id;
      failedStepLabel = node.label || node.type;
      rootError = stepRecord.error;
      const skipped = appendSkippedDownstream(stepResults, nodes, edges, node.id);
      await persistSkippedNodes(tracking, skipped);
      break;
    }

    // Notify must not continue into Wait / decision steps when email delivery fails.
    if (result.status === "FAILED" && node.type === "SendEmail") {
      finalStatus = "FAILED";
      failedStepId = node.id;
      failedStepLabel = node.label || node.type;
      rootError = stepRecord.error;
      const skipped = appendSkippedDownstream(stepResults, nodes, edges, node.id);
      await persistSkippedNodes(tracking, skipped);
      break;
    }

    if (result.status === "FAILED" && node.type !== "VerifyAccessRemoved") {
      finalStatus = "FAILED";
      if (!failedStepId) {
        failedStepId = node.id;
        failedStepLabel = node.label || node.type;
        rootError = stepRecord.error;
      }
    }

    if (
      result.status === "FAILED" &&
      node.type === "VerifyAccessRemoved" &&
      result.output?.verificationStatus === VERIFICATION_STATUS.VERIFICATION_FAILED
    ) {
      finalStatus = "FAILED";
      failedStepId = failedStepId || node.id;
      failedStepLabel = failedStepLabel || node.label || node.type;
      rootError =
        rootError ||
        result.output?.verificationReason ||
        "Access verification failed — missing or invalid context";
      const skipped = appendSkippedDownstream(stepResults, nodes, edges, node.id);
      await persistSkippedNodes(tracking, skipped);
      break;
    }

    if (node.type === "EndFailure") {
      finalStatus = "FAILED";
      failedStepId = failedStepId || node.id;
      failedStepLabel = failedStepLabel || node.label || node.type;
      rootError = rootError || "Workflow reached failure end step";
      break;
    }
    if (result.status === "WAITING" || node.type === "WaitForIAMDecision") {
      finalStatus = "WAITING";
      break;
    }
    if (node.type === "EndWaiting") {
      finalStatus = "WAITING";
      break;
    }
    if (node.type === "EndSuccess") {
      finalStatus = "SUCCESS";
      break;
    }

    const nextEdge = pickNextEdge(edges, currentId, result.branch);
    currentId = nextEdge?.to || null;

    if (isTerminalType(node.type)) break;
  }

  if (stepCount >= MAX_STEPS && finalStatus === "SUCCESS") {
    finalStatus = "FAILED";
    rootError = rootError || "Maximum step limit exceeded";
  }

  const completedAt = new Date().toISOString();
  const sideEffects =
    context.adapter && typeof context.adapter.dump === "function"
      ? context.adapter.dump()
      : undefined;

  const runResult = {
    runId,
    executionId: options.executionId ?? null,
    status: finalStatus,
    success: finalStatus === "SUCCESS",
    trigger: context.trigger,
    steps: stepResults,
    outputs: priorOutputs,
    sideEffects,
    startedAt,
    completedAt,
    durationMs: Date.now() - startMs,
    failedStepId,
    failedStepLabel,
    error: finalStatus === "SUCCESS" ? undefined : rootError,
    executionContext: {
      executionId: execContext.executionId,
      workflowId: execContext.workflowId,
      nodeOutputs: execContext.nodeOutputs,
      variables: execContext.variables,
    },
  };

  if (persist) {
    await saveRun(workflowId, runResult, persistOpts);
    if (finalStatus !== "WAITING") {
      await recordRunResult(workflowId, finalStatus, tenantId);
    }
  }

  return runResult;
}
