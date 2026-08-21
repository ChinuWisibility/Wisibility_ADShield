import RemediationTicket from "../../models/remediation/RemediationTicket.js";
import WorkflowRemediationEvent from "../../models/workflowRemediation/WorkflowRemediationEvent.js";
import { WORKFLOW_REMEDIATION_QUEUE_STATUS } from "../../constants/workflowRemediation.js";
import { appendAudit, updateQueueStatus } from "./workflowRemediationEventService.js";

const POLL_INTERVAL_MS =
  Number(process.env.WORKFLOW_REMEDIATION_ITSM_POLL_MS) || 5 * 60 * 1000;

function deriveTicketClosed(status) {
  return ["CLOSED", "IN_PROGRESS"].includes(String(status || "").toUpperCase());
}

async function tick() {
  const events = await WorkflowRemediationEvent.find({
    queueStatus: WORKFLOW_REMEDIATION_QUEUE_STATUS.AWAITING_ITSM,
    ticketId: { $exists: true, $ne: null },
  })
    .limit(50)
    .lean();

  for (const event of events) {
    try {
      const ticket = await RemediationTicket.findById(event.ticketId).lean();
      if (!ticket) continue;

      const status = String(ticket.status || "").toUpperCase();
      if (status === "CLOSED") {
        await updateQueueStatus(event.eventId, WORKFLOW_REMEDIATION_QUEUE_STATUS.VALIDATED);
        await appendAudit(event.eventId, "ITSM_TICKET_CLOSED", "system", {
          ticketId: event.ticketId,
          ticketStatus: ticket.status,
        });
      } else if (deriveTicketClosed(status) && status !== "OPEN") {
        await updateQueueStatus(
          event.eventId,
          WORKFLOW_REMEDIATION_QUEUE_STATUS.VALIDATION_PENDING,
        );
        await appendAudit(event.eventId, "ITSM_TICKET_IN_PROGRESS", "system", {
          ticketId: event.ticketId,
          ticketStatus: ticket.status,
        });
      }
    } catch (err) {
      console.warn(
        `[workflowRemediationItsmPoller] event ${event.eventId}:`,
        err.message,
      );
    }
  }
}

export function startWorkflowRemediationItsmPoller() {
  setInterval(() => {
    tick().catch((err) =>
      console.error("[workflowRemediationItsmPoller] tick failed:", err.message),
    );
  }, POLL_INTERVAL_MS);

  tick().catch((err) =>
    console.error("[workflowRemediationItsmPoller] initial tick failed:", err.message),
  );
}
