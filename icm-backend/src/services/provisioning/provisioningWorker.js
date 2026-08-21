/**
 * Provisioning worker — claims PENDING tasks atomically and dispatches to
 * family-resolved connectors (AD / CSV test / future).
 *
 * Supports CREATE (ADD_ACCOUNT), UPDATE (UPDATE_ACCOUNT), DISABLE.
 * Opt-in: PROVISIONING_WORKER_ENABLED=true
 */

import ProvisioningTask from "../../models/provisioning/ProvisioningTask.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import ProvisioningResult from "../../models/provisioning/ProvisioningResult.js";
import { runExecution } from "../workflow/workflowDispatcher.js";
import { resolveProvisioningConnector } from "./connectors/resolveProvisioningConnector.js";
import { verifyProvisioningOutcome } from "./provisioningVerificationService.js";

let timer = null;

async function resolveConnector(applicationId, opts = {}) {
  return resolveProvisioningConnector(applicationId, opts);
}

export async function claimProvisioningTask(taskId) {
  return ProvisioningTask.findOneAndUpdate(
    {
      _id: taskId,
      status: { $in: ["PENDING", "RETRYING"] },
      $or: [
        { nextAttemptAt: { $exists: false } },
        { nextAttemptAt: null },
        { nextAttemptAt: { $lte: new Date() } },
      ],
    },
    { $set: { status: "RUNNING", startedAt: new Date() } },
    { new: true },
  );
}

async function scheduleRetry(task, message) {
  const retryCount = (task.retryCount || 0) + 1;
  const maxRetries = task.maxRetries ?? 3;
  if (retryCount > maxRetries) {
    await ProvisioningTask.updateOne(
      { _id: task._id },
      {
        $set: {
          status: "FAILED",
          completedAt: new Date(),
          errorMessage: message,
          retryCount,
        },
      },
    );
    return { retried: false, failed: true };
  }
  const delayMs = Math.min(30 * 60 * 1000, 5000 * 2 ** Math.min(retryCount, 6));
  await ProvisioningTask.updateOne(
    { _id: task._id },
    {
      $set: {
        status: "RETRYING",
        retryCount,
        nextAttemptAt: new Date(Date.now() + delayMs),
        errorMessage: message,
      },
    },
  );
  return { retried: true, retryCount, nextAttemptAt: new Date(Date.now() + delayMs) };
}

async function dependenciesSatisfied(task) {
  const deps = task.dependsOnPlanItemIds || [];
  if (!deps.length) return { ok: true };
  const blockers = await ProvisioningTask.find({
    requestId: task.requestId,
    planItemId: { $in: deps },
    status: { $ne: "COMPLETED" },
  })
    .select("planItemId status")
    .lean();
  if (!blockers.length) return { ok: true };
  return {
    ok: false,
    reason: "DEPENDENCY_PENDING",
    blockers: blockers.map((b) => ({ planItemId: b.planItemId, status: b.status })),
  };
}

async function assertTaskExecutable(task) {
  if (!task.requestId) return { ok: true };

  const request = await ProvisioningRequest.findById(task.requestId)
    .select("approvalStatus status tenantId metadata")
    .lean();
  if (!request) {
    return { ok: false, reason: "REQUEST_MISSING", terminal: true };
  }
  if (request.approvalStatus === "REJECTED" || request.status === "CANCELLED") {
    return { ok: false, reason: "REQUEST_REJECTED", terminal: true };
  }
  if (
    request.approvalStatus !== "APPROVED" &&
    request.approvalStatus !== "NOT_REQUIRED"
  ) {
    return { ok: false, reason: "REQUEST_NOT_APPROVED", terminal: false };
  }

  const taskTenant = task.targetAttributes?.tenantId;
  if (
    taskTenant &&
    request.tenantId &&
    String(taskTenant) !== String(request.tenantId)
  ) {
    return { ok: false, reason: "TENANT_MISMATCH", terminal: true };
  }

  const executionClass = task.targetAttributes?.executionClass;
  if (
    executionClass &&
    executionClass !== "EXECUTABLE" &&
    task.targetAttributes?.genericPlan
  ) {
    return {
      ok: false,
      reason: `NON_EXECUTABLE_${executionClass}`,
      terminal: true,
    };
  }

  return { ok: true, request };
}

/**
 * Resume lifecycle/Joiner workflow once when all materialized tasks are terminal.
 * Prevents premature resume for multi-item generic plans.
 */
async function maybeResumeLifecycleWorkflow(task) {
  const executionId = task.targetAttributes?.executionId;
  const isLifecycle =
    task.targetAttributes?.joinerRequestId != null ||
    task.targetAttributes?.lifecycleRequestId != null;
  if (!executionId || !isLifecycle || !task.requestId) return { resumed: false };

  const openTasks = await ProvisioningTask.countDocuments({
    requestId: task.requestId,
    status: { $in: ["PENDING", "RUNNING", "RETRYING"] },
  });
  if (openTasks > 0) {
    return { resumed: false, reason: "TASKS_STILL_OPEN", openTasks };
  }

  const failedTasks = await ProvisioningTask.countDocuments({
    requestId: task.requestId,
    status: "FAILED",
  });
  if (failedTasks > 0) {
    // Do not resume success path; request/plan already rolled up as FAILED/PARTIAL.
    return { resumed: false, reason: "HAS_FAILED_TASKS", failedTasks };
  }

  // Atomic resume gate — only one concurrent completion resumes the workflow.
  const claimed = await ProvisioningRequest.findOneAndUpdate(
    {
      _id: task.requestId,
      "metadata.provisioningWorkflowResumedAt": { $exists: false },
    },
    {
      $set: {
        "metadata.provisioningWorkflowResumedAt": new Date().toISOString(),
      },
    },
    { new: true },
  );
  if (!claimed) {
    return { resumed: false, reason: "ALREADY_RESUMED" };
  }

  try {
    const { runLifecycleExecution } = await import("./lifecycleWorkflowService.js");
    await runLifecycleExecution(executionId, { resume: true });
    return { resumed: true };
  } catch {
    try {
      await runExecution(executionId, { resume: "joiner_provisioned" });
      return { resumed: true, mode: "joiner_provisioned" };
    } catch (err) {
      console.warn("[provisioningWorker] lifecycle resume failed:", err.message);
      // Allow a later retry by clearing the gate only on hard failure
      await ProvisioningRequest.updateOne(
        { _id: task.requestId },
        { $unset: { "metadata.provisioningWorkflowResumedAt": 1 } },
      );
      return { resumed: false, error: err.message };
    }
  }
}

async function processTask(task) {
  const tenantId = task.targetAttributes?.tenantId;
  const jmlCorrelationId =
    task.jmlCorrelationId || task.targetAttributes?.jmlCorrelationId;

  // Idempotent short-circuit: prior successful result for this task
  const priorOk = await ProvisioningResult.findOne({
    taskId: task._id,
    isSuccess: true,
  }).lean();
  if (priorOk) {
    await ProvisioningTask.updateOne(
      { _id: task._id },
      { $set: { status: "COMPLETED", completedAt: new Date() } },
    );
    return { ok: true, shortCircuited: true };
  }

  const gate = await assertTaskExecutable(task);
  if (!gate.ok) {
    if (gate.terminal) {
      await ProvisioningTask.updateOne(
        { _id: task._id, status: { $in: ["PENDING", "RETRYING"] } },
        {
          $set: {
            status: "SKIPPED",
            completedAt: new Date(),
            errorMessage: gate.reason,
          },
        },
      );
    }
    return { skipped: true, reason: gate.reason };
  }

  const deps = await dependenciesSatisfied(task);
  if (!deps.ok) {
    // Leave PENDING; try again on a later tick once prerequisites complete.
    await ProvisioningTask.updateOne(
      { _id: task._id, status: { $in: ["PENDING", "RETRYING"] } },
      {
        $set: {
          nextAttemptAt: new Date(Date.now() + 5000),
          errorMessage: `Waiting on dependencies: ${(deps.blockers || [])
            .map((b) => b.planItemId)
            .join(",")}`,
        },
      },
    );
    return { skipped: true, reason: deps.reason, blockers: deps.blockers };
  }

  const connector = await resolveConnector(task.applicationId, { tenantId });
  if (!connector) {
    return { skipped: true, reason: "NO_CONNECTOR" };
  }

  const claimed = await claimProvisioningTask(task._id);
  if (!claimed) {
    return { skipped: true, reason: "CLAIM_LOST" };
  }

  const started = Date.now();
  let result;
  try {
    console.log(
      "[provisioningWorker] TASK_STARTED",
      JSON.stringify({
        taskId: String(task._id),
        operation: task.operationType,
        jmlCorrelationId,
      }),
    );
    result = await connector.executeTask(claimed.toObject ? claimed.toObject() : claimed);
    console.log(
      "[provisioningWorker] CONNECTOR_EXECUTED",
      JSON.stringify({
        taskId: String(task._id),
        status: result?.status,
        jmlCorrelationId,
        // Distinguish orchestration from live AD success
        adLiveWrite: Boolean(result?.detail?.adLiveWrite),
      }),
    );
  } catch (err) {
    result = { status: "FAILED", message: err?.message || "Connector error" };
  }

  let completed = result?.status === "COMPLETED" || result?.status === "SKIPPED";
  const durationMs = Date.now() - started;

  // Verification — do not treat connector non-throw alone as final truth when verify fails
  if (completed) {
    try {
      console.log(
        "[provisioningWorker] VERIFICATION_STARTED",
        JSON.stringify({ taskId: String(task._id), jmlCorrelationId }),
      );
      const verification = await verifyProvisioningOutcome({
        task: claimed.toObject ? claimed.toObject() : claimed,
        connectorResult: result,
      });
      result = {
        ...result,
        detail: { ...(result.detail || {}), verification },
      };
      if (verification && verification.ok === false) {
        completed = false;
        result = {
          status: "FAILED",
          message: verification.reason || "Verification failed",
          detail: { ...(result.detail || {}), verification },
        };
        console.warn(
          "[provisioningWorker] VERIFICATION_FAILURE",
          JSON.stringify({ taskId: String(task._id), reason: verification.reason }),
        );
      } else {
        console.log(
          "[provisioningWorker] VERIFICATION_SUCCESS",
          JSON.stringify({
            taskId: String(task._id),
            mode: verification?.mode || "connector",
          }),
        );
      }
    } catch (err) {
      console.warn("[provisioningWorker] verification error:", err.message);
    }
  }

  if (!completed) {
    const retry = await scheduleRetry(claimed, result?.message || "Connector failed");
    try {
      await ProvisioningResult.create({
        taskId: task._id,
        applicationId: task.applicationId,
        statusCode: 500,
        jmlCorrelationId: jmlCorrelationId || undefined,
        responseBody: {
          status: result?.status,
          message: result?.message,
          detail: result?.detail,
          operation: task.operationType,
          identityId: task.targetAttributes?.identityId,
          requestId: task.requestId ? String(task.requestId) : undefined,
          tenantId: tenantId || undefined,
          jmlCorrelationId,
          retry,
        },
        executedAt: new Date(),
        durationMs,
        isSuccess: false,
      });
    } catch (err) {
      console.warn("[provisioningWorker] result persist failed:", err.message);
    }
    return { ok: false, result, retry };
  }

  await ProvisioningTask.updateOne(
    { _id: task._id, status: "RUNNING" },
    {
      $set: {
        status: "COMPLETED",
        completedAt: new Date(),
        errorMessage: undefined,
        ...(result?.nativeIdentifier
          ? { "targetAttributes.nativeIdentifier": result.nativeIdentifier }
          : {}),
        ...(result?.detail?.objectGUID
          ? { "targetAttributes.objectGUID": result.detail.objectGUID }
          : {}),
        ...(jmlCorrelationId ? { jmlCorrelationId } : {}),
      },
    },
  );

  try {
    await ProvisioningResult.create({
      taskId: task._id,
      applicationId: task.applicationId,
      statusCode: 200,
      jmlCorrelationId: jmlCorrelationId || undefined,
      responseBody: {
        status: result?.status,
        message: result?.message,
        nativeIdentifier: result?.nativeIdentifier,
        detail: result?.detail,
        operation: task.operationType,
        identityId: task.targetAttributes?.identityId,
        requestId: task.requestId ? String(task.requestId) : undefined,
        tenantId: tenantId || undefined,
        jmlCorrelationId,
      },
      executedAt: new Date(),
      durationMs,
      isSuccess: true,
    });
  } catch (err) {
    console.warn("[provisioningWorker] result persist failed:", err.message);
  }

  // Multi-task aware request/plan rollup
  const openTasks = await ProvisioningTask.countDocuments({
    requestId: task.requestId,
    status: { $in: ["PENDING", "RUNNING", "RETRYING"] },
  });
  const failedTasks = await ProvisioningTask.countDocuments({
    requestId: task.requestId,
    status: "FAILED",
  });
  if (openTasks === 0) {
    const reqStatus = failedTasks > 0 ? "FAILED" : "COMPLETED";
    await ProvisioningRequest.updateOne(
      { _id: task.requestId },
      {
        $set: {
          status: reqStatus,
          completedAt: new Date(),
        },
      },
    );
    await ProvisioningPlan.updateOne(
      { _id: task.planId },
      {
        $set: {
          status: failedTasks > 0 ? "PARTIAL" : "COMPLETED",
          executedAt: new Date(),
        },
        $inc: { completedOperations: 1 },
      },
    );
  } else {
    await ProvisioningPlan.updateOne(
      { _id: task.planId },
      { $inc: { completedOperations: 1 }, $set: { status: "EXECUTING" } },
    );
  }

  // Certification revoke resume (existing path)
  const executionId = task.targetAttributes?.executionId;
  const resumeMode = task.targetAttributes?.resumeMode || "verify";
  const isLifecycle =
    task.targetAttributes?.joinerRequestId != null ||
    task.targetAttributes?.lifecycleRequestId != null;

  if (executionId && !isLifecycle) {
    await runExecution(executionId, { resume: resumeMode });
  }

  // Lifecycle / Joiner resume only when all materialized tasks are terminal.
  if (executionId && isLifecycle) {
    await maybeResumeLifecycleWorkflow(task);
  }

  // Post-CREATE: schedule AD sync/correlation wiring (does not claim live success by itself)
  if (
    completed &&
    task.operationType === "ADD_ACCOUNT" &&
    result?.detail?.adLiveWrite
  ) {
    try {
      const { schedulePostCreateReconciliation } = await import(
        "./postProvisionReconciliation.js"
      );
      schedulePostCreateReconciliation({
        tenantId,
        applicationId: task.applicationId,
        identityId: task.targetAttributes?.identityId,
        nativeIdentifier: result.nativeIdentifier,
        jmlCorrelationId,
        taskId: String(task._id),
      });
    } catch (err) {
      console.warn("[provisioningWorker] post-create reconcile schedule failed:", err.message);
    }
  }

  return { ok: true, result };
}

async function tick() {
  const pending = await ProvisioningTask.find({
    status: { $in: ["PENDING", "RETRYING"] },
    $or: [
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: null },
      { nextAttemptAt: { $lte: new Date() } },
    ],
  })
    .limit(25)
    .lean();
  for (const task of pending) {
    try {
      await processTask(task);
    } catch (err) {
      console.warn("[provisioningWorker] task failed:", err.message);
    }
  }
}

export async function processProvisioningTaskById(taskId) {
  const task = await ProvisioningTask.findById(taskId).lean();
  if (!task) return { ok: false, error: "Task not found" };
  return processTask(task);
}

export function startProvisioningWorker(intervalMs) {
  if (timer) return;
  if (String(process.env.PROVISIONING_WORKER_ENABLED).toLowerCase() !== "true") {
    console.log(
      "[provisioningWorker] disabled (set PROVISIONING_WORKER_ENABLED=true once connectors are wired)",
    );
    return;
  }
  const configured = Number(process.env.PROVISIONING_WORKER_INTERVAL_MS);
  const effectiveInterval = intervalMs
    ?? (Number.isFinite(configured) && configured >= 1000 ? configured : 60000);
  timer = setInterval(() => {
    tick().catch((err) => console.warn("[provisioningWorker] tick error:", err.message));
  }, effectiveInterval);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[provisioningWorker] started (interval", effectiveInterval, "ms)");
}

export { resolveConnector, processTask, tick };
