/**
 * Generic lifecycle orchestration entry (P4/P5/P7).
 *
 * Plan → existing graph workflow → approval → task materialization.
 *
 * JOINER cutover is gated by GENERIC_JML_ORCHESTRATION_ENABLED in
 * lifecycleEventProcessor.
 *
 * MOVER (P7) reuses this same service with context.planningOnly=true:
 * policy → actual → delta → request → plan, then STOP (no workflow/tasks).
 *
 * Duplicate-entry hardening:
 * - Reuse request by sourceId `lifecycle-plan:{eventId}`
 * - Do not recompile locked/executing plans
 * - Atomically reserve workflow start before creating an execution
 *   (skipped entirely when planningOnly)
 */

import mongoose from "mongoose";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import ProvisioningPlan from "../../models/provisioning/ProvisioningPlan.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import {
  compileProvisioningPlan,
  isProvisioningPlanLockedAgainstRecompile,
} from "./provisioningPlanCompiler.js";
import { computeAccessDelta } from "./accessDeltaService.js";
import { evaluateDesiredAccess } from "./policyDecisionService.js";
import { loadActualAccessForIdentity } from "./actualAccessService.js";
import { startLifecycleProvisionWorkflow } from "./lifecycleWorkflowService.js";
import { createJmlCorrelationId } from "../lifecycle/jmlCorrelation.js";

function toOid(value) {
  return mongoose.isValidObjectId(value)
    ? new mongoose.Types.ObjectId(String(value))
    : null;
}

function successPayload({
  request,
  planId,
  executionId,
  jmlCorrelationId,
  lifecycleEventId,
  totalOperations,
  plan = null,
  reused = false,
  planningOnly = false,
  desiredAccess = null,
  actualAccess = null,
  accessDelta = null,
}) {
  return {
    success: true,
    provisioningRequestId: String(request._id),
    planId: planId ? String(planId) : null,
    workflowExecutionId: executionId || null,
    jmlCorrelationId,
    lifecycleEventId,
    totalOperations: totalOperations ?? plan?.totalOperations ?? 0,
    plan,
    reused,
    planningOnly: Boolean(planningOnly),
    desiredAccess,
    actualAccess,
    accessDelta,
  };
}

async function resolveLinkedExecutionId(request) {
  const linked = request?.metadata?.workflowExecutionId;
  if (linked) return String(linked);
  const existing = await RemediationWorkflowExecution.findOne({
    provisioningRequestId: String(request._id),
    eventOwner: "lifecycle",
  })
    .sort({ createdAt: 1 })
    .select({ executionId: 1 })
    .lean();
  return existing?.executionId ? String(existing.executionId) : null;
}

async function loadPlanForRequest(requestId) {
  return ProvisioningPlan.findOne({ requestId: toOid(requestId) || requestId }).lean();
}

/**
 * Start generic orchestration for a multi-item provisioning plan.
 *
 * Creates one Lifecycle ProvisioningRequest + persists the P3 plan.
 * When context.planningOnly is true (P7 MOVER), stops after plan persistence
 * and does not start workflow / create tasks / invoke connectors.
 */
export async function startGenericPlanOrchestration({
  identity,
  lifecycleEvent,
  desiredAccess,
  actualAccess,
  accessDelta,
  context = {},
} = {}) {
  const tenantId = toOid(
    context.tenantId || identity?.tenantId || lifecycleEvent?.tenantId,
  );
  const identityId = toOid(
    identity?._id || identity?.id || lifecycleEvent?.identityId,
  );
  const lifecycleEventId = String(
    context.lifecycleEventId ||
      lifecycleEvent?._id ||
      lifecycleEvent?.id ||
      accessDelta?.lifecycleEventId ||
      "",
  );
  let jmlCorrelationId =
    context.jmlCorrelationId ||
    lifecycleEvent?.jmlCorrelationId ||
    accessDelta?.jmlCorrelationId ||
    null;
  const planningOnly = Boolean(context.planningOnly);
  const lifecycleType =
    context.lifecycleType || lifecycleEvent?.lifecycleType || "JOINER";
  const requestType = context.requestType || lifecycleType || "JOINER";

  if (!tenantId || !identityId) {
    return { success: false, error: "tenantId and identityId are required" };
  }
  if (!lifecycleEventId) {
    return { success: false, error: "lifecycleEventId is required" };
  }
  if (
    identity?.tenantId &&
    String(identity.tenantId) !== String(tenantId)
  ) {
    return { success: false, error: "Identity tenantId mismatch" };
  }
  if (
    lifecycleEvent?.tenantId &&
    String(lifecycleEvent.tenantId) !== String(tenantId)
  ) {
    return { success: false, error: "LifecycleEvent tenantId mismatch" };
  }
  if (!jmlCorrelationId) {
    jmlCorrelationId = createJmlCorrelationId();
  }

  // Ensure we have a delta (caller may inject for tests)
  let delta = accessDelta;
  let desired = desiredAccess;
  let actual = actualAccess;
  if (!delta) {
    desired =
      desired ||
      (await evaluateDesiredAccess(identity, {
        tenantId,
        lifecycleType,
        lifecycleEventId,
        jmlCorrelationId,
      }));
    actual =
      actual ||
      (await loadActualAccessForIdentity({ tenantId, identityId }));
    delta = await computeAccessDelta({
      identity,
      context: {
        tenantId,
        lifecycleType,
        lifecycleEventId,
        jmlCorrelationId,
      },
      desiredAccess: desired,
      actualAccess: actual,
    });
  }

  const sourceId = `lifecycle-plan:${lifecycleEventId}`;
  let request = await ProvisioningRequest.findOne({
    sourceType: "LIFECYCLE",
    sourceId,
    status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
  });

  if (!request) {
    try {
      request = await ProvisioningRequest.create({
        requestType,
        tenantId,
        identityId,
        status: "PENDING",
        // Planning-only MOVER does not start approval workflow.
        approvalStatus: planningOnly ? "NOT_REQUIRED" : "PENDING",
        priority: "NORMAL",
        sourceType: "LIFECYCLE",
        sourceId,
        justification:
          context.justification ||
          (planningOnly
            ? "Generic lifecycle planning (no execution)"
            : "Generic lifecycle provisioning plan"),
        metadata: {
          genericPlan: true,
          planningOnly,
          lifecycleEventId,
          jmlCorrelationId,
          lifecycleType,
        },
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      request = await ProvisioningRequest.findOne({
        sourceType: "LIFECYCLE",
        sourceId,
        status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS", "COMPLETED"] },
      });
      if (!request) throw err;
    }
  }

  // Fast reuse: request already has plan (+ workflow linkage for non-planning).
  const existingExecutionId = planningOnly
    ? null
    : await resolveLinkedExecutionId(request);
  const existingPlan = await loadPlanForRequest(request._id);
  if (
    existingPlan &&
    isProvisioningPlanLockedAgainstRecompile(existingPlan)
  ) {
    return successPayload({
      request,
      planId: existingPlan._id,
      executionId: existingExecutionId,
      jmlCorrelationId:
        request.metadata?.jmlCorrelationId || jmlCorrelationId,
      lifecycleEventId,
      totalOperations: existingPlan.totalOperations,
      plan: existingPlan,
      reused: true,
      planningOnly,
      desiredAccess: desired,
      actualAccess: actual,
      accessDelta: delta,
    });
  }
  if (
    !planningOnly &&
    existingExecutionId &&
    (request.metadata?.planId || existingPlan?._id)
  ) {
    return successPayload({
      request,
      planId: request.metadata?.planId || existingPlan?._id,
      executionId: existingExecutionId,
      jmlCorrelationId:
        request.metadata?.jmlCorrelationId || jmlCorrelationId,
      lifecycleEventId,
      totalOperations: existingPlan?.totalOperations,
      plan: existingPlan,
      reused: true,
      planningOnly,
      desiredAccess: desired,
      actualAccess: actual,
      accessDelta: delta,
    });
  }
  // Planning-only reuse: same unlocked plan with matching request already linked.
  if (
    planningOnly &&
    existingPlan &&
    request.metadata?.planId &&
    String(request.metadata.planId) === String(existingPlan._id)
  ) {
    return successPayload({
      request,
      planId: existingPlan._id,
      executionId: null,
      jmlCorrelationId:
        request.metadata?.jmlCorrelationId || jmlCorrelationId,
      lifecycleEventId,
      totalOperations: existingPlan.totalOperations,
      plan: existingPlan,
      reused: true,
      planningOnly,
      desiredAccess: desired,
      actualAccess: actual,
      accessDelta: delta,
    });
  }

  // Compile + persist plan bound to this request (no-op overwrite if locked).
  const planResult = await compileProvisioningPlan({
    identity,
    lifecycleEvent: lifecycleEvent || {
      _id: lifecycleEventId,
      tenantId,
      identityId,
      jmlCorrelationId,
    },
    desiredAccess: desired,
    actualAccess: actual,
    accessDelta: delta,
    context: {
      tenantId,
      lifecycleEventId,
      jmlCorrelationId,
      requestId: String(request._id),
      dryRun: false,
      applications: context.applications,
      ambiguousApplicationIds: actual?.metadata?.ambiguousApplicationIds,
      ambiguousAccounts: actual?.metadata?.ambiguousAccounts,
    },
  });

  const planId = planResult._id;
  if (!planId) {
    return {
      success: false,
      error: "Plan persistence failed",
      plan: planResult,
    };
  }

  // Persist lineage on the request without starting workflow.
  await ProvisioningRequest.updateOne(
    { _id: request._id },
    {
      $set: {
        "metadata.genericPlan": true,
        "metadata.planningOnly": planningOnly,
        "metadata.planId": String(planId),
        "metadata.jmlCorrelationId": jmlCorrelationId,
        "metadata.lifecycleEventId": lifecycleEventId,
        "metadata.lifecycleType": lifecycleType,
      },
    },
  );
  request = (await ProvisioningRequest.findById(request._id)) || request;

  if (planningOnly) {
    await ProvisioningPlan.updateOne(
      { _id: toOid(planId) },
      {
        $set: {
          "metadata.genericPlan": true,
          "metadata.planningOnly": true,
          "metadata.workflowExecuted": false,
          "metadata.provisioningTasksCreated": false,
          "metadata.connectorInvoked": false,
          "metadata.targetWrites": false,
        },
      },
    );

    console.log(
      "[genericOrchestration] PLANNING_ONLY_COMPLETE",
      JSON.stringify({
        provisioningRequestId: String(request._id),
        planId: String(planId),
        operationCount: planResult.totalOperations,
        jmlCorrelationId,
        lifecycleEventId,
        lifecycleType,
        note: "NO_WORKFLOW_NO_TASKS_NO_CONNECTORS",
      }),
    );

    return successPayload({
      request,
      planId,
      executionId: null,
      jmlCorrelationId,
      lifecycleEventId,
      totalOperations: planResult.totalOperations,
      plan: {
        ...planResult,
        metadata: {
          ...(planResult.metadata || {}),
          planningOnly: true,
          workflowExecuted: false,
          provisioningTasksCreated: false,
          connectorInvoked: false,
          targetWrites: false,
        },
      },
      reused: Boolean(
        planResult?.metadata?.reused || planResult?.metadata?.lockedAgainstRecompile,
      ),
      planningOnly: true,
      desiredAccess: desired,
      actualAccess: actual,
      accessDelta: delta,
    });
  }

  // Atomically reserve workflow start so concurrent duplicates cannot create
  // multiple RemediationWorkflowExecution rows for one request.
  let executionId = await resolveLinkedExecutionId(request);
  if (!executionId && request.approvalStatus === "PENDING") {
    const reserved = await ProvisioningRequest.findOneAndUpdate(
      {
        _id: request._id,
        approvalStatus: "PENDING",
        $and: [
          {
            $or: [
              { "metadata.workflowExecutionId": { $exists: false } },
              { "metadata.workflowExecutionId": null },
              { "metadata.workflowExecutionId": "" },
            ],
          },
          {
            $or: [
              { "metadata.workflowStartReservedAt": { $exists: false } },
              { "metadata.workflowStartReservedAt": null },
              { "metadata.workflowStartReservedAt": "" },
            ],
          },
        ],
      },
      {
        $set: {
          "metadata.genericPlan": true,
          "metadata.planId": String(planId),
          "metadata.jmlCorrelationId": jmlCorrelationId,
          "metadata.lifecycleEventId": lifecycleEventId,
          "metadata.workflowStartReservedAt": new Date().toISOString(),
        },
      },
      { new: true },
    );

    if (reserved) {
      const primaryApp =
        planResult.operations?.find((op) => op.operationType === "ADD_ACCOUNT") ||
        planResult.operations?.[0];
      const started = await startLifecycleProvisionWorkflow({
        tenantId,
        identityId,
        applicationId: primaryApp?.applicationId || identityId,
        applicationName: primaryApp?.applicationName || "multi-app-plan",
        provisioningRequestId: request._id,
        requestType: request.requestType,
        operationType: primaryApp?.operationType || "ADD_ACCOUNT",
        jmlCorrelationId,
        triggerExtras: {
          genericPlan: true,
          planId: String(planId),
          lifecycleEventId,
        },
      });
      executionId = started.executionId || null;

      await ProvisioningRequest.updateOne(
        { _id: request._id },
        {
          $set: {
            "metadata.genericPlan": true,
            "metadata.planId": String(planId),
            "metadata.workflowExecutionId": executionId,
            "metadata.jmlCorrelationId": jmlCorrelationId,
            "metadata.lifecycleEventId": lifecycleEventId,
          },
        },
      );
      request = (await ProvisioningRequest.findById(request._id)) || reserved;
    } else {
      // Another worker reserved/started — reuse whatever is linked now.
      request = await ProvisioningRequest.findById(request._id);
      executionId = await resolveLinkedExecutionId(request);
    }
  }

  // Ensure plan metadata links execution
  await ProvisioningPlan.updateOne(
    { _id: toOid(planId) },
    {
      $set: {
        "metadata.genericPlan": true,
        "metadata.workflowExecutionId": executionId,
      },
    },
  );

  console.log(
    "[genericOrchestration] WORKFLOW_STARTED",
    JSON.stringify({
      provisioningRequestId: String(request._id),
      planId: String(planId),
      executionId,
      operationCount: planResult.totalOperations,
      jmlCorrelationId,
      lifecycleEventId,
      note: "WAITING_APPROVAL — no tasks yet",
    }),
  );

  return successPayload({
    request,
    planId,
    executionId,
    jmlCorrelationId,
    lifecycleEventId,
    totalOperations: planResult.totalOperations,
    plan: planResult,
    reused: Boolean(planResult?.metadata?.reused || planResult?.metadata?.lockedAgainstRecompile),
    planningOnly: false,
    desiredAccess: desired,
    actualAccess: actual,
    accessDelta: delta,
  });
}
