/**
 * Remediation Queue Scheduler
 * Polls identity quality / correlation / access analytics detection and enqueues remediation events.
 */

import Tenant from "../models/platform/Tenant.js";
import DistributedLock from "../models/scheduler/DistributedLock.js";
import { runTenantQueueIngestion } from "../services/remediation/remediationQueueIngestionService.js";

const POLL_INTERVAL_MS =
  Number(process.env.REMEDIATION_QUEUE_POLL_MS) || 60 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const LOCK_KEY = "remediation_queue_scheduler";

async function acquireLock(key) {
  try {
    await DistributedLock.create({
      _id: key,
      lockedBy: process.pid.toString(),
      expiresAt: new Date(Date.now() + LOCK_TTL_MS),
    });
    return true;
  } catch {
    return false;
  }
}

async function releaseLock(key) {
  try {
    await DistributedLock.findByIdAndDelete(key);
  } catch {
    // ignore
  }
}

async function runQueueIngestionJob() {
  const tenants = await Tenant.find({ isActive: { $ne: false } }).select("_id").lean();
  for (const tenant of tenants) {
    try {
      await runTenantQueueIngestion(tenant._id);
    } catch (err) {
      console.error(
        `[remediationQueueScheduler] tenant ${tenant._id} failed:`,
        err.message,
      );
    }
  }
}

export function startRemediationQueueScheduler() {
  const run = async () => {
    const locked = await acquireLock(LOCK_KEY);
    if (!locked) return;
    try {
      await runQueueIngestionJob();
    } catch (err) {
      console.error("[remediationQueueScheduler] job failed:", err.message);
    } finally {
      await releaseLock(LOCK_KEY);
    }
  };

  setTimeout(run, 30_000);
  setInterval(run, POLL_INTERVAL_MS);
  console.log(
    `[remediationQueueScheduler] started (interval ${POLL_INTERVAL_MS}ms)`,
  );
}
