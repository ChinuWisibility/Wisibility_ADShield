/**
 * Durable lifecycle event enqueue + claim helpers.
 * Does not block HRMS sync on provisioning; does await event persistence.
 */

import mongoose from "mongoose";
import LifecycleEvent, {
  LIFECYCLE_PRIORITY,
  LIFECYCLE_PRIMARY_EVENT_TYPES,
} from "../../models/identity/LifecycleEvent.js";
import { createJmlCorrelationId } from "./jmlCorrelation.js";
import {
  detectIdentityLifecycleChanges,
  buildLifecycleIdempotencyKey,
  fingerprintChanges,
  pickSnapshot,
} from "./lifecycleDetectionService.js";

const STALE_IN_PROGRESS_MS = Number(process.env.LIFECYCLE_STALE_MS || 5 * 60 * 1000);

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function priorityFor(eventType) {
  return LIFECYCLE_PRIORITY[eventType] ?? 10;
}

function isPrimaryEvent(eventType) {
  return LIFECYCLE_PRIMARY_EVENT_TYPES.includes(eventType);
}

function logLifecycle(eventName, payload) {
  console.log(`[lifecycle] ${eventName}`, JSON.stringify(payload));
}

function safeSnapshots(detection) {
  return {
    previousState: detection.previousState
      ? pickSnapshot(detection.previousState)
      : null,
    newState: pickSnapshot(detection.newState || {}),
  };
}

/**
 * Persist detected events for one identity transition (idempotent).
 */
export async function enqueueLifecycleEventsFromIdentityChange(args) {
  const result = await enqueueLifecycleEventsBatch([args]);
  return result.results?.[0] || { enqueued: [], skipped: "EMPTY" };
}

/**
 * Batch durable persistence for many identity transitions.
 * Awaits Mongo upserts so callers can treat events as durable before returning.
 */
export async function enqueueLifecycleEventsBatch(transitions = []) {
  const results = [];
  for (const t of transitions) {
    results.push(await enqueueOneTransition(t));
  }
  return { results, count: results.length };
}

async function enqueueOneTransition({
  tenantId,
  identityId,
  before,
  after,
  syncJobId,
  triggeredBy = "SYSTEM",
  sourceApplicationId,
  jmlCorrelationId,
  metadata = {},
}) {
  const tenantOid = toOid(tenantId);
  const identityOid = toOid(identityId);
  if (!tenantOid || !identityOid || !after) {
    return { enqueued: [], skipped: "INVALID_INPUT" };
  }

  const detection = detectIdentityLifecycleChanges(before, after);
  if (!detection.changed) {
    return { enqueued: [], skipped: "NO_CHANGE", detection };
  }

  const correlationId = jmlCorrelationId || createJmlCorrelationId();
  const fp = fingerprintChanges(detection.changes);
  const eventTypes = [...detection.attributeEvents, ...detection.lifecycleEvents];
  const uniqueTypes = [...new Set(eventTypes)];
  const snaps = safeSnapshots(detection);
  const enqueued = [];

  for (const eventType of uniqueTypes) {
    const idempotencyKey = buildLifecycleIdempotencyKey({
      tenantId: String(tenantOid),
      identityId: String(identityOid),
      eventType,
      syncJobId,
      changeFingerprint: fp,
    });

    const lifecycleType =
      detection.lifecycleTypeByEvent?.[eventType] ||
      (isPrimaryEvent(eventType) ? eventType : "NONE");

    const primary = isPrimaryEvent(eventType);
    // Attribute facts are closed immediately so they do not clog the claim queue.
    // TERMINATION_SCHEDULED stays PENDING until effective-date promotion.
    let initialStatus = "DETECTED";
    let nextAttemptAt = new Date();
    let completedAt;
    if (!primary) {
      if (eventType === "TERMINATION_SCHEDULED" && detection.effectiveDate) {
        initialStatus = "PENDING";
        nextAttemptAt = new Date(detection.effectiveDate);
      } else {
        initialStatus = "COMPLETED";
        completedAt = new Date();
      }
    }

    const insertDoc = {
      tenantId: tenantOid,
      identityId: identityOid,
      eventType,
      lifecycleType,
      eventStatus: initialStatus,
      isPrimary: primary,
      priority: priorityFor(eventType),
      detectedAt: new Date(),
      effectiveDate: detection.effectiveDate || new Date(),
      triggeredBy,
      previousState: snaps.previousState,
      newState: snaps.newState,
      changeSet: {
        changes: detection.changes,
        changedAttributes: detection.changedAttributes || [],
        attributeEvents: detection.attributeEvents,
        lifecycleEvents: detection.lifecycleEvents,
      },
      idempotencyKey,
      jmlCorrelationId: correlationId,
      syncJobId: syncJobId || undefined,
      sourceApplicationId: toOid(sourceApplicationId) || undefined,
      nextAttemptAt,
      ...(completedAt ? { completedAt } : {}),
      metadata: {
        ...metadata,
        fingerprint: fp,
      },
    };

    try {
      const existing = await LifecycleEvent.findOne({
        tenantId: tenantOid,
        idempotencyKey,
      }).lean();
      if (existing) {
        enqueued.push({
          eventId: String(existing._id),
          eventType,
          reused: true,
          jmlCorrelationId: existing.jmlCorrelationId,
          isPrimary: existing.isPrimary,
          eventStatus: existing.eventStatus,
          lifecycleType: existing.lifecycleType,
        });
        continue;
      }

      const created = await LifecycleEvent.create(insertDoc);
      logLifecycle("LIFECYCLE_EVENT_CREATED", {
        tenantId: String(tenantOid),
        identityId: String(identityOid),
        eventId: String(created._id),
        eventType,
        lifecycleType,
        correlationId,
        syncJobId: syncJobId || null,
        isPrimary: primary,
      });
      enqueued.push({
        eventId: String(created._id),
        eventType,
        reused: false,
        jmlCorrelationId: created.jmlCorrelationId,
        isPrimary: created.isPrimary,
        eventStatus: created.eventStatus,
        lifecycleType: created.lifecycleType,
      });
    } catch (err) {
      if (err?.code === 11000) {
        const raced = await LifecycleEvent.findOne({
          tenantId: tenantOid,
          idempotencyKey,
        }).lean();
        if (raced) {
          enqueued.push({
            eventId: String(raced._id),
            eventType,
            reused: true,
            jmlCorrelationId: raced.jmlCorrelationId,
            isPrimary: raced.isPrimary,
            eventStatus: raced.eventStatus,
            lifecycleType: raced.lifecycleType,
          });
        }
        continue;
      }
      throw err;
    }
  }

  return { enqueued, detection, jmlCorrelationId: correlationId };
}

/**
 * Atomic claim for durable worker.
 */
export async function claimLifecycleEvent(eventId, claimedBy = "lifecycle-worker") {
  const claimed = await LifecycleEvent.findOneAndUpdate(
    {
      _id: eventId,
      eventStatus: { $in: ["DETECTED", "PENDING"] },
      $or: [
        { nextAttemptAt: { $exists: false } },
        { nextAttemptAt: null },
        { nextAttemptAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        eventStatus: "IN_PROGRESS",
        claimedAt: new Date(),
        claimedBy,
      },
    },
    { new: true },
  );
  if (claimed) {
    logLifecycle("LIFECYCLE_EVENT_CLAIMED", {
      tenantId: claimed.tenantId ? String(claimed.tenantId) : null,
      identityId: claimed.identityId ? String(claimed.identityId) : null,
      eventId: String(claimed._id),
      eventType: claimed.eventType,
      lifecycleType: claimed.lifecycleType,
      correlationId: claimed.jmlCorrelationId,
      claimedBy,
    });
  }
  return claimed;
}

/**
 * Poll next primary (actionable) events ready for processing.
 */
export async function findClaimableLifecycleEvents({ limit = 25, tenantId } = {}) {
  const filter = {
    isPrimary: true,
    eventStatus: { $in: ["DETECTED", "PENDING"] },
    $or: [
      { nextAttemptAt: { $exists: false } },
      { nextAttemptAt: null },
      { nextAttemptAt: { $lte: new Date() } },
    ],
  };
  if (tenantId) {
    const oid = toOid(tenantId);
    if (oid) filter.tenantId = oid;
  }
  return LifecycleEvent.find(filter)
    .sort({ priority: -1, detectedAt: 1 })
    .limit(limit)
    .lean();
}

/**
 * Recover events stuck in IN_PROGRESS after a worker crash.
 */
export async function recoverStaleLifecycleEvents(staleMs = STALE_IN_PROGRESS_MS) {
  const cutoff = new Date(Date.now() - staleMs);
  const stale = await LifecycleEvent.find({
    eventStatus: "IN_PROGRESS",
    claimedAt: { $lt: cutoff },
  })
    .select("_id retryCount maxRetries tenantId identityId eventType jmlCorrelationId")
    .lean();

  let recovered = 0;
  for (const row of stale) {
    const nextRetry = (row.retryCount || 0) + 1;
    const maxRetries = row.maxRetries ?? 5;
    if (nextRetry <= maxRetries) {
      const delayMs = Math.min(60 * 60 * 1000, 5000 * 2 ** Math.min(nextRetry, 6));
      await LifecycleEvent.updateOne(
        { _id: row._id, eventStatus: "IN_PROGRESS" },
        {
          $set: {
            eventStatus: "PENDING",
            retryCount: nextRetry,
            nextAttemptAt: new Date(Date.now() + delayMs),
            error: "Recovered stale IN_PROGRESS claim",
          },
          $unset: { claimedAt: 1, claimedBy: 1 },
        },
      );
      logLifecycle("LIFECYCLE_EVENT_RETRYING", {
        tenantId: row.tenantId ? String(row.tenantId) : null,
        identityId: row.identityId ? String(row.identityId) : null,
        eventId: String(row._id),
        eventType: row.eventType,
        correlationId: row.jmlCorrelationId,
        retryCount: nextRetry,
        reason: "STALE_IN_PROGRESS",
      });
      recovered += 1;
    } else {
      await LifecycleEvent.updateOne(
        { _id: row._id, eventStatus: "IN_PROGRESS" },
        {
          $set: {
            eventStatus: "FAILED",
            retryCount: nextRetry,
            completedAt: new Date(),
            error: "Stale IN_PROGRESS exceeded maxRetries",
          },
          $unset: { claimedAt: 1, claimedBy: 1 },
        },
      );
      logLifecycle("LIFECYCLE_EVENT_FAILED", {
        tenantId: row.tenantId ? String(row.tenantId) : null,
        identityId: row.identityId ? String(row.identityId) : null,
        eventId: String(row._id),
        eventType: row.eventType,
        correlationId: row.jmlCorrelationId,
        reason: "STALE_MAX_RETRIES",
      });
    }
  }
  return { recovered, scanned: stale.length };
}

/**
 * Promote due TERMINATION_SCHEDULED attribute facts into TERMINATION_EFFECTIVE + LEAVER.
 */
export async function promoteDueTerminationScheduled({ limit = 50 } = {}) {
  const due = await LifecycleEvent.find({
    eventType: "TERMINATION_SCHEDULED",
    eventStatus: { $in: ["PENDING", "DETECTED"] },
    effectiveDate: { $lte: new Date() },
  })
    .limit(limit)
    .lean();

  const promoted = [];
  for (const row of due) {
    const syncJobId =
      row.syncJobId || `term-promote:${String(row._id)}:${row.effectiveDate?.toISOString?.() || ""}`;
    const result = await enqueueLifecycleEventsFromIdentityChange({
      tenantId: row.tenantId,
      identityId: row.identityId,
      before: {
        ...(row.previousState || {}),
        lifecycleState: row.previousState?.lifecycleState || "ACTIVE",
        isActive: row.previousState?.isActive !== false,
      },
      after: {
        ...(row.newState || {}),
        lifecycleState: "TERMINATED",
        isActive: false,
        endDate: row.effectiveDate || row.newState?.endDate || new Date(),
      },
      syncJobId,
      triggeredBy: row.triggeredBy || "SYSTEM",
      sourceApplicationId: row.sourceApplicationId,
      jmlCorrelationId: row.jmlCorrelationId,
      metadata: {
        ...(row.metadata || {}),
        promotedFrom: String(row._id),
        promotion: "TERMINATION_SCHEDULED",
      },
    });

    await LifecycleEvent.updateOne(
      { _id: row._id },
      {
        $set: {
          eventStatus: "COMPLETED",
          completedAt: new Date(),
          error: "Promoted to TERMINATION_EFFECTIVE/LEAVER",
        },
      },
    );
    promoted.push({
      fromEventId: String(row._id),
      enqueued: result.enqueued?.map((e) => e.eventType) || [],
    });
  }
  return { promoted: promoted.length, details: promoted };
}

export async function markLifecycleEventCompleted(eventId, patch = {}) {
  const updated = await LifecycleEvent.findOneAndUpdate(
    { _id: eventId },
    {
      $set: {
        eventStatus: "COMPLETED",
        completedAt: new Date(),
        error: undefined,
        ...patch,
      },
      $unset: { claimedAt: 1, claimedBy: 1 },
    },
    { new: true },
  );
  if (updated) {
    logLifecycle("LIFECYCLE_EVENT_COMPLETED", {
      tenantId: updated.tenantId ? String(updated.tenantId) : null,
      identityId: updated.identityId ? String(updated.identityId) : null,
      eventId: String(updated._id),
      eventType: updated.eventType,
      lifecycleType: updated.lifecycleType,
      correlationId: updated.jmlCorrelationId,
    });
  }
  return updated;
}

export async function markLifecycleEventFailed(eventId, error, { retry = true } = {}) {
  const event = await LifecycleEvent.findOne({
    _id: eventId,
    eventStatus: "IN_PROGRESS",
  });
  if (!event) {
    // Fallback for non-claimed paths
    const any = await LifecycleEvent.findById(eventId);
    if (!any) return null;
    return markFailedDoc(any, error, retry);
  }
  return markFailedDoc(event, error, retry);
}

async function markFailedDoc(event, error, retry) {
  const nextRetry = (event.retryCount || 0) + 1;
  if (retry && nextRetry <= (event.maxRetries ?? 5)) {
    const delayMs = Math.min(60 * 60 * 1000, 5000 * 2 ** Math.min(nextRetry, 6));
    event.eventStatus = "PENDING";
    event.retryCount = nextRetry;
    event.nextAttemptAt = new Date(Date.now() + delayMs);
    event.error = String(error || "processing failed").slice(0, 2000);
    event.claimedAt = undefined;
    event.claimedBy = undefined;
    await event.save();
    logLifecycle("LIFECYCLE_EVENT_RETRYING", {
      tenantId: event.tenantId ? String(event.tenantId) : null,
      identityId: event.identityId ? String(event.identityId) : null,
      eventId: String(event._id),
      eventType: event.eventType,
      lifecycleType: event.lifecycleType,
      correlationId: event.jmlCorrelationId,
      retryCount: nextRetry,
      delayMs,
    });
    return event;
  }
  event.eventStatus = "FAILED";
  event.retryCount = nextRetry;
  event.completedAt = new Date();
  event.error = String(error || "processing failed").slice(0, 2000);
  event.claimedAt = undefined;
  event.claimedBy = undefined;
  await event.save();
  logLifecycle("LIFECYCLE_EVENT_FAILED", {
    tenantId: event.tenantId ? String(event.tenantId) : null,
    identityId: event.identityId ? String(event.identityId) : null,
    eventId: String(event._id),
    eventType: event.eventType,
    lifecycleType: event.lifecycleType,
    correlationId: event.jmlCorrelationId,
    error: event.error,
  });
  return event;
}

/**
 * Concurrency: if a higher-priority open lifecycle exists for same identity, defer lower ones.
 * Priority: TERMINATION/LEAVER > MOVER > JOINER
 */
export async function findBlockingHigherPriorityEvent(event) {
  if (!event?.tenantId || !event?.identityId) return null;
  const myPriority = event.priority ?? priorityFor(event.eventType);
  return LifecycleEvent.findOne({
    tenantId: event.tenantId,
    identityId: event.identityId,
    isPrimary: true,
    _id: { $ne: event._id },
    eventStatus: { $in: ["DETECTED", "PENDING", "IN_PROGRESS"] },
    priority: { $gt: myPriority },
  })
    .select("_id eventType priority eventStatus jmlCorrelationId")
    .lean();
}

export { priorityFor, isPrimaryEvent, logLifecycle };
