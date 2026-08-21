import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import { runExecution } from "./workflowDispatcher.js";

/**
 * Scheduled re-verification for parked (WAITING_ITSM) certification revoke executions.
 *
 * Each parked execution carries a `nextPollAt` (default daily). When it falls due, the
 * workflow is resumed from its checkpoint (the verify node) in verify-only mode:
 *   - access now removed  → the run completes (COMPLETED) and notifies user + manager.
 *   - access still present → the run parks again; runExecution bumps `nextPollAt`.
 *
 * This is the orchestration heartbeat: it keeps the workflow status honest (in progress
 * until removal is actually verified) without ever mutating IGA state directly.
 */
let timer = null;

async function tick() {
  const now = new Date();
  const due = await RemediationWorkflowExecution.find({
    status: "WAITING_ITSM",
    nextPollAt: { $ne: null, $lte: now },
  })
    .limit(50)
    .lean();

  for (const exec of due) {
    try {
      await runExecution(exec.executionId, { resume: "verify" });
    } catch (err) {
      console.warn("[remediationVerifyScheduler] re-verify failed:", err.message);
    }
  }
}

export function startRemediationVerifyScheduler(intervalMs = 5 * 60 * 1000) {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) =>
      console.warn("[remediationVerifyScheduler] tick error:", err.message),
    );
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[remediationVerifyScheduler] started (interval", intervalMs, "ms)");
}
