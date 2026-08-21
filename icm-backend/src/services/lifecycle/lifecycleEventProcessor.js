/**
 * Process claimed primary lifecycle events into reusable provisioning flows.
 *
 * JOINER:
 *   GENERIC_JML_ORCHESTRATION_ENABLED=true  → P1–P4 generic plan orchestration
 *   GENERIC_JML_ORCHESTRATION_ENABLED=false → legacy ENSURE_ACCOUNT / Joiner evaluator
 *
 * REHIRE → legacy Joiner evaluator (unchanged in P5)
 * MOVER:
 *   GENERIC_MOVER_ORCHESTRATION_ENABLED=false → P6 detection-only
 *   GENERIC_MOVER_ORCHESTRATION_ENABLED=true  → P7 planning-only
 *     (policy → actual → delta → plan; no workflow/tasks/connectors)
 * LEAVER → existing consumer (unchanged)
 *
 * Exclusive one-path rule: never run generic and legacy for the same event.
 */

import mongoose from "mongoose";
import LifecycleEvent from "../../models/identity/LifecycleEvent.js";
import ProvisioningRequest from "../../models/provisioning/ProvisioningRequest.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";
import {
  findBlockingHigherPriorityEvent,
  markLifecycleEventCompleted,
  markLifecycleEventFailed,
  logLifecycle,
} from "./lifecycleEventService.js";
import { isGenericJmlOrchestrationEnabled } from "./genericJmlOrchestrationFlag.js";
import { isGenericMoverOrchestrationEnabled } from "./genericMoverOrchestrationFlag.js";
import { evaluateJoinersForIdentities } from "../provisioning/joinerProvisioningService.js";
import { startLeaverProvisioningFromEvent } from "../provisioning/lifecycleProvisioningService.js";
import { startGenericPlanOrchestration } from "../provisioning/genericLifecycleOrchestrationService.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

async function attachCorrelationToOpenRequests({
  tenantId,
  identityId,
  jmlCorrelationId,
  lifecycleEventId,
}) {
  if (!jmlCorrelationId) return;
  await ProvisioningRequest.updateMany(
    {
      tenantId: toOid(tenantId) || tenantId,
      identityId: toOid(identityId) || identityId,
      sourceType: "LIFECYCLE",
      status: { $in: ["PENDING", "APPROVED", "IN_PROGRESS"] },
      $or: [
        { "metadata.jmlCorrelationId": { $exists: false } },
        { "metadata.jmlCorrelationId": null },
        { "metadata.jmlCorrelationId": "" },
      ],
    },
    {
      $set: {
        "metadata.jmlCorrelationId": jmlCorrelationId,
        "metadata.lifecycleEventId": String(lifecycleEventId),
      },
    },
  );
}

async function loadIdentityForEvent(event) {
  const tenantId = event.tenantId;
  const identityId = event.identityId;
  if (!tenantId || !identityId) {
    throw new Error("Lifecycle event missing tenantId/identityId");
  }
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const identity = await Identity.findOne({
    _id: toOid(identityId) || identityId,
    tenantId: toOid(tenantId) || tenantId,
  }).lean();
  if (!identity) {
    throw new Error(
      `Identity ${String(identityId)} not found for tenant ${String(tenantId)}`,
    );
  }
  return identity;
}

/**
 * @param {object} event - LifecycleEvent mongoose doc or lean
 * @param {object} [deps] - optional injectable seams for unit tests
 */
export async function processLifecycleEvent(event, deps = {}) {
  if (!event?._id) return { ok: false, error: "Missing event" };

  const resolveFlag =
    deps.isGenericJmlOrchestrationEnabled || isGenericJmlOrchestrationEnabled;
  const resolveMoverFlag =
    deps.isGenericMoverOrchestrationEnabled || isGenericMoverOrchestrationEnabled;
  const evaluateJoiners =
    deps.evaluateJoinersForIdentities || evaluateJoinersForIdentities;
  const startGeneric =
    deps.startGenericPlanOrchestration || startGenericPlanOrchestration;
  const loadIdentity = deps.loadIdentityForEvent || loadIdentityForEvent;
  const startLeaver =
    deps.startLeaverProvisioningFromEvent || startLeaverProvisioningFromEvent;
  const attachCorrelation =
    deps.attachCorrelationToOpenRequests || attachCorrelationToOpenRequests;
  const findBlocking =
    deps.findBlockingHigherPriorityEvent || findBlockingHigherPriorityEvent;
  const markCompleted = deps.markLifecycleEventCompleted || markLifecycleEventCompleted;
  const markFailed = deps.markLifecycleEventFailed || markLifecycleEventFailed;

  logLifecycle("LIFECYCLE_EVENT_STARTED", {
    tenantId: event.tenantId ? String(event.tenantId) : null,
    identityId: event.identityId ? String(event.identityId) : null,
    eventId: String(event._id),
    eventType: event.eventType,
    lifecycleType: event.lifecycleType,
    correlationId: event.jmlCorrelationId,
  });

  const blocking = await findBlocking(event);
  if (blocking) {
    // Use PENDING (not unreclaimable DEFERRED) so the event is claimable again
    await LifecycleEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          eventStatus: "PENDING",
          nextAttemptAt: new Date(Date.now() + 60_000),
          error: `Deferred behind ${blocking.eventType} (${blocking._id})`,
        },
        $unset: { claimedAt: 1, claimedBy: 1 },
      },
    );
    logLifecycle("LIFECYCLE_EVENT_RETRYING", {
      eventId: String(event._id),
      eventType: event.eventType,
      lifecycleType: event.lifecycleType,
      correlationId: event.jmlCorrelationId,
      reason: "PRIORITY_BLOCKED",
      blockedBy: String(blocking._id),
      blockedType: blocking.eventType,
    });
    return { ok: true, deferred: true, blockedBy: String(blocking._id) };
  }

  // Scheduled termination primary LEAVER not yet effective → wait
  if (
    event.eventType === "LEAVER" &&
    Array.isArray(event.changeSet?.attributeEvents) &&
    event.changeSet.attributeEvents.includes("TERMINATION_SCHEDULED") &&
    event.effectiveDate &&
    new Date(event.effectiveDate).getTime() > Date.now() + 30_000
  ) {
    await LifecycleEvent.updateOne(
      { _id: event._id },
      {
        $set: {
          eventStatus: "PENDING",
          nextAttemptAt: new Date(event.effectiveDate),
          error: "Waiting for termination effective date",
        },
        $unset: { claimedAt: 1, claimedBy: 1 },
      },
    );
    return { ok: true, deferred: true, reason: "TERMINATION_SCHEDULED" };
  }

  try {
    let result;
    let route = null;

    switch (event.eventType) {
      case "JOINER": {
        const genericEnabled = Boolean(resolveFlag());
        if (genericEnabled) {
          route = "GENERIC";
          logLifecycle("LIFECYCLE_GENERIC_ORCHESTRATION_SELECTED", {
            eventId: String(event._id),
            eventType: event.eventType,
            lifecycleType: event.lifecycleType || "JOINER",
            correlationId: event.jmlCorrelationId,
            flag: "GENERIC_JML_ORCHESTRATION_ENABLED",
          });

          const identity = await loadIdentity(event);
          const genericResult = await startGeneric({
            identity,
            lifecycleEvent: event,
            context: {
              tenantId: event.tenantId,
              lifecycleEventId: String(event._id),
              lifecycleType: event.lifecycleType || "JOINER",
              jmlCorrelationId: event.jmlCorrelationId,
              requestType: "JOINER",
            },
          });

          if (!genericResult?.success) {
            throw new Error(
              genericResult?.error || "Generic Joiner orchestration failed",
            );
          }

          logLifecycle("LIFECYCLE_GENERIC_ORCHESTRATION_STARTED", {
            eventId: String(event._id),
            correlationId: event.jmlCorrelationId || genericResult.jmlCorrelationId,
            provisioningRequestId: genericResult.provisioningRequestId,
            planId: genericResult.planId,
            workflowExecutionId: genericResult.workflowExecutionId,
            totalOperations: genericResult.totalOperations,
            note:
              (genericResult.totalOperations || 0) === 0
                ? "EMPTY_DELTA_OR_NO_EXECUTABLE_OPS"
                : "WAITING_APPROVAL",
          });

          result = {
            route,
            ...genericResult,
            requests: genericResult.provisioningRequestId
              ? [{ provisioningRequestId: genericResult.provisioningRequestId }]
              : [],
          };
        } else {
          route = "LEGACY";
          logLifecycle("LIFECYCLE_LEGACY_JOINER_SELECTED", {
            eventId: String(event._id),
            eventType: event.eventType,
            correlationId: event.jmlCorrelationId,
            flag: "GENERIC_JML_ORCHESTRATION_ENABLED=false",
          });
          result = await evaluateJoiners({
            tenantId: event.tenantId,
            identityIds: [String(event.identityId)],
            syncJobId: event.syncJobId || `lifecycle:${event.eventType}:${event._id}`,
            jmlCorrelationId: event.jmlCorrelationId,
            lifecycleEventId: String(event._id),
          });
          await attachCorrelation({
            tenantId: event.tenantId,
            identityId: event.identityId,
            jmlCorrelationId: event.jmlCorrelationId,
            lifecycleEventId: event._id,
          });
          result = { route, ...result };
        }
        break;
      }
      case "REHIRE": {
        // P5: REHIRE remains on the legacy Joiner evaluator.
        route = "LEGACY";
        result = await evaluateJoiners({
          tenantId: event.tenantId,
          identityIds: [String(event.identityId)],
          syncJobId: event.syncJobId || `lifecycle:${event.eventType}:${event._id}`,
          jmlCorrelationId: event.jmlCorrelationId,
          lifecycleEventId: String(event._id),
        });
        await attachCorrelation({
          tenantId: event.tenantId,
          identityId: event.identityId,
          jmlCorrelationId: event.jmlCorrelationId,
          lifecycleEventId: event._id,
        });
        result = { route, ...result };
        break;
      }
      case "MOVER": {
        const moverEnabled = Boolean(resolveMoverFlag());
        if (!moverEnabled) {
          // P6: durable MOVER detection only — provisioning not cut over yet.
          route = "DETECTION_ONLY";
          logLifecycle("LIFECYCLE_MOVER_DETECTION_ONLY", {
            eventId: String(event._id),
            eventType: event.eventType,
            lifecycleType: event.lifecycleType || "MOVER",
            correlationId: event.jmlCorrelationId,
            changedAttributes:
              event.changeSet?.changedAttributes ||
              event.changeSet?.changes ||
              [],
            note: "MOVER provisioning not enabled (legacy + generic skipped)",
          });
          result = {
            route,
            skipped: true,
            reason: "MOVER_DETECTION_ONLY",
            provisioningDeferred: true,
            jmlCorrelationId: event.jmlCorrelationId || null,
            changedAttributes:
              event.changeSet?.changedAttributes ||
              event.changeSet?.changes ||
              [],
          };
          break;
        }

        // P7: decision/planning spine only — no workflow/tasks/connectors.
        route = "PLANNING_ONLY";
        logLifecycle("LIFECYCLE_MOVER_PLANNING_SELECTED", {
          eventId: String(event._id),
          eventType: event.eventType,
          lifecycleType: event.lifecycleType || "MOVER",
          correlationId: event.jmlCorrelationId,
          flag: "GENERIC_MOVER_ORCHESTRATION_ENABLED",
          note: "policy→actual→delta→plan; no execution",
        });

        const identity = await loadIdentity(event);
        const planResult = await startGeneric({
          identity,
          lifecycleEvent: event,
          context: {
            tenantId: event.tenantId,
            lifecycleEventId: String(event._id),
            lifecycleType: event.lifecycleType || "MOVER",
            jmlCorrelationId: event.jmlCorrelationId,
            requestType: "MOVER",
            planningOnly: true,
            justification: "MOVER decision/planning (P7)",
          },
        });

        if (!planResult?.success) {
          throw new Error(
            planResult?.error || "MOVER planning orchestration failed",
          );
        }

        logLifecycle("LIFECYCLE_MOVER_PLANNING_COMPLETE", {
          eventId: String(event._id),
          correlationId: event.jmlCorrelationId || planResult.jmlCorrelationId,
          provisioningRequestId: planResult.provisioningRequestId,
          planId: planResult.planId,
          totalOperations: planResult.totalOperations,
          planningOnly: true,
          note:
            (planResult.totalOperations || 0) === 0
              ? "EMPTY_DELTA_NOOP"
              : "PLAN_PERSISTED_NO_EXECUTION",
        });

        result = {
          route,
          planningOnly: true,
          ...planResult,
          workflowExecutionId: null,
          requests: planResult.provisioningRequestId
            ? [{ provisioningRequestId: planResult.provisioningRequestId }]
            : [],
        };
        break;
      }
      case "LEAVER": {
        // Preserved consumer — not a P5/P7 generic cutover target
        result = await startLeaver(event);
        break;
      }
      default:
        result = { skipped: true, reason: "NON_ACTIONABLE_PRIMARY" };
    }

    await markCompleted(event._id, {
      provisioningRequestId: result?.provisioningRequestId
        ? toOid(result.provisioningRequestId)
        : undefined,
      workflowExecutionId: result?.workflowExecutionId || undefined,
      metadata: {
        ...(event.metadata || {}),
        processResult: {
          route: result?.route || route || null,
          planId: result?.planId || null,
          provisioningRequestId: result?.provisioningRequestId || null,
          workflowExecutionId: result?.workflowExecutionId || null,
          totalOperations: result?.totalOperations,
          requestCount: result?.requests?.length,
          skipped: result?.skipped,
          satisfied: result?.satisfied,
          planningOnly: result?.planningOnly || false,
          jmlCorrelationId:
            result?.jmlCorrelationId || event.jmlCorrelationId || null,
        },
      },
    });

    return { ok: true, result };
  } catch (err) {
    await markFailed(event._id, err.message);
    return { ok: false, error: err.message };
  }
}

export { attachCorrelationToOpenRequests, loadIdentityForEvent };
