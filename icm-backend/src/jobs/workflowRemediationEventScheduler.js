import env from "../config/env.js";
import Tenant from "../models/platform/Tenant.js";
import DistributedLock from "../models/scheduler/DistributedLock.js";
import { runTenantWorkflowRemediationIngestion } from "../services/workflowRemediation/workflowRemediationEventIngestionService.js";

const POLL_INTERVAL_MS = env.workflowRemediation.queuePollMs;
const LOCK_TTL_MS = 10 * 60 * 1000;
const LOCK_KEY = "workflow_remediation_event_scheduler";

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

async function runIngestionJob() {
  const tenants = await Tenant.find({ isActive: { $ne: false } }).select("_id").lean();
  for (const tenant of tenants) {
    try {
      await runTenantWorkflowRemediationIngestion(tenant._id);
    } catch (err) {
      console.error(
        `[workflowRemediationEventScheduler] tenant ${tenant._id} failed:`,
        err.message,
      );
    }
  }
}

export function startWorkflowRemediationEventScheduler() {
  if (!env.workflowRemediation.schedulerEnabled) {
    console.log(
      "[workflowRemediationEventScheduler] disabled (WORKFLOW_REMEDIATION_SCHEDULER_ENABLED=false)",
    );
    return;
  }

  const run = async () => {
    const locked = await acquireLock(LOCK_KEY);
    if (!locked) return;
    try {
      await runIngestionJob();
    } catch (err) {
      console.error("[workflowRemediationEventScheduler] job failed:", err.message);
    } finally {
      await releaseLock(LOCK_KEY);
    }
  };

  setInterval(run, POLL_INTERVAL_MS);
  run().catch((err) =>
    console.error("[workflowRemediationEventScheduler] initial run failed:", err.message),
  );
}
