import mongoose from "mongoose";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import RemediationEvent from "../../models/remediation/RemediationEvent.js";
import { runExecution } from "./workflowDispatcher.js";
import {
  ensureWorkflowTicketShape,
  formatItsmTicketStatusLabel,
} from "./workflowItsmTicketService.js";

/**
 * Background poller for executions parked in WAITING_ITSM.
 *
 * On each tick it (1) refreshes the denormalized ITSM ticket status on the execution
 * so the dashboard shows live ticket progress, and (2) when the linked ticket reaches a
 * closed state, resumes the workflow with escalation enabled: the run re-verifies access
 * removal and either completes (removed) or escalates to IAM (still present), instead of
 * parking again. This mirrors "monitor the ticket; finalize when Closed".
 */
const CLOSED_EVENT_STATUS = new Set(["COMPLETED", "CANCELED"]);
const CLOSED_TICKET_STATUS = new Set(["CLOSED", "COMPLETED", "RESOLVED", "DONE"]);

let timer = null;

function ticketStatusLabel(evt) {
  return formatItsmTicketStatusLabel(evt);
}

function isTicketClosed(evt) {
  if (!evt) return false;
  if (CLOSED_EVENT_STATUS.has(evt.status)) return true;
  if (evt.workflowState === "TICKET_CLOSED") return true;
  const ts = String(evt.ticket?.ticketStatus || "").toUpperCase();
  return CLOSED_TICKET_STATUS.has(ts);
}

async function tick() {
  const waiting = await RemediationWorkflowExecution.find({
    status: "WAITING_ITSM",
    ticketEventId: { $ne: null },
  })
    .limit(50)
    .lean();

  for (const exec of waiting) {
    try {
      if (!mongoose.isValidObjectId(exec.ticketEventId)) continue;
      let evt = await RemediationEvent.findById(exec.ticketEventId).lean();
      if (evt) {
        await ensureWorkflowTicketShape(exec.ticketEventId);
        evt = await RemediationEvent.findById(exec.ticketEventId).lean();
      }

      // Keep the dashboard ticket status fresh while waiting.
      const label = ticketStatusLabel(evt);
      if (label && label !== exec.itsmTicketStatus) {
        await RemediationWorkflowExecution.updateOne(
          { _id: exec._id },
          { $set: { itsmTicketStatus: label } },
        );
      }

      // Ticket closed → re-verify with escalation (removed = success, still present = IAM escalation).
      if (isTicketClosed(evt)) {
        await runExecution(exec.executionId, { resume: "itsm_closed" });
      }
    } catch (err) {
      console.warn("[itsmWaitWorker] resume failed:", err.message);
    }
  }
}

export function startItsmWaitWorker(intervalMs = 30000) {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => console.warn("[itsmWaitWorker] tick error:", err.message));
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[itsmWaitWorker] started (interval", intervalMs, "ms)");
}
