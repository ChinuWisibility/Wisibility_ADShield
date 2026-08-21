/**
 * Durable lifecycle event worker — Mongo claim + retry, no Kafka/Redis.
 * Reuses DistributedLock for multi-instance tick safety.
 */

import os from "os";
import DistributedLock from "../../models/scheduler/DistributedLock.js";
import {
  findClaimableLifecycleEvents,
  claimLifecycleEvent,
  recoverStaleLifecycleEvents,
  promoteDueTerminationScheduled,
} from "./lifecycleEventService.js";
import { processLifecycleEvent } from "./lifecycleEventProcessor.js";

const LOCK_KEY = "lifecycle-event-worker";
const DEFAULT_INTERVAL_MS = 15_000;
let timer = null;
const claimedBy = `lifecycle-worker:${os.hostname()}:${process.pid}`;

async function acquireLock(ttlMs = 55_000) {
  const expiresAt = new Date(Date.now() + ttlMs);
  try {
    await DistributedLock.create({
      _id: LOCK_KEY,
      lockedBy: claimedBy,
      lockedAt: new Date(),
      expiresAt,
    });
    return true;
  } catch {
    // Reclaim expired lock (TTL deletion can lag)
    const existing = await DistributedLock.findById(LOCK_KEY).lean();
    if (existing?.expiresAt && new Date(existing.expiresAt).getTime() <= Date.now()) {
      const reclaimed = await DistributedLock.findOneAndUpdate(
        {
          _id: LOCK_KEY,
          expiresAt: { $lte: new Date() },
        },
        {
          $set: {
            lockedBy: claimedBy,
            lockedAt: new Date(),
            expiresAt,
          },
        },
        { new: true },
      );
      return Boolean(reclaimed);
    }
    return false;
  }
}

async function releaseLock() {
  await DistributedLock.deleteOne({ _id: LOCK_KEY, lockedBy: claimedBy }).catch(() => {});
}

export async function tickLifecycleEvents({ limit = 25, tenantId } = {}) {
  await recoverStaleLifecycleEvents().catch((err) =>
    console.warn("[lifecycleWorker] stale recovery failed:", err.message),
  );
  await promoteDueTerminationScheduled({ limit }).catch((err) =>
    console.warn("[lifecycleWorker] termination promote failed:", err.message),
  );

  const candidates = await findClaimableLifecycleEvents({ limit, tenantId });
  const results = [];
  for (const row of candidates) {
    const claimed = await claimLifecycleEvent(row._id, claimedBy);
    if (!claimed) continue;
    const result = await processLifecycleEvent(claimed);
    results.push({ eventId: String(row._id), ...result });
  }
  return { processed: results.length, results };
}

async function lockedTick() {
  if (!(await acquireLock())) return;
  try {
    await tickLifecycleEvents();
  } finally {
    await releaseLock();
  }
}

export function startLifecycleEventWorker(intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) return;
  if (String(process.env.LIFECYCLE_WORKER_ENABLED || "true").toLowerCase() === "false") {
    console.log("[lifecycleWorker] disabled (LIFECYCLE_WORKER_ENABLED=false)");
    return;
  }
  timer = setInterval(() => {
    lockedTick().catch((err) =>
      console.warn("[lifecycleWorker] tick error:", err.message),
    );
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  // Kick once promptly after start
  lockedTick().catch((err) =>
    console.warn("[lifecycleWorker] initial tick error:", err.message),
  );
  console.log("[lifecycleWorker] started (interval", intervalMs, "ms)");
}

export function stopLifecycleEventWorker() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
