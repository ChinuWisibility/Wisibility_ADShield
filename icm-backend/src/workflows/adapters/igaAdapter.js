import mongoose from "mongoose";
import RemediationAuditLog from "../../models/remediation/RemediationAuditLog.js";
import RemediationEvent from "../../models/remediation/RemediationEvent.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import { hasIdentityEntitlement } from "../../services/workflow/workflowRevokeService.js";
import { checkIdentityEntitlement } from "../../services/workflow/workflowRevokeService.js";
import { enqueueCertRevokeProvisioning } from "../../services/provisioning/certRevokeProvisioningService.js";
import { enqueueWorkflowEmail } from "../../services/workflow/workflowEmailService.js";
import {
  createPseudoTicketId,
  notifyItsmAssigneeForTicket,
  resolveItsmAssigneeEmail,
} from "../../services/workflow/workflowItsmTicketService.js";

function toOid(value) {
  return mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;
}

/**
 * Live adapter — wires workflow step actions to real IGA persistence.
 *
 * Orchestration model: the adapter NEVER mutates IGA entitlement state (correlation,
 * cube, account fields) or the target system directly. Revoke enqueues a
 * ProvisioningRequest for the connector worker; verification re-reads the live identity
 * entitlement view (the same source as the Identity Accounts tab). Each method is
 * independent and never throws into the engine: failures are returned as
 * { success: false, error } so the run trace records which step broke and why.
 */
export function createIgaAdapter({
  tenantId = null,
  executedBy = "system",
  executionId = null,
  existingTicketId = null,
} = {}) {
  const createdTicketIds = [];
  const auditIds = [];
  const emailIds = [];
  const provisioningRequestIds = [];

  return {
    async getIdentity() {
      return null;
    },

    async hasEntitlement(
      identityId,
      { applicationId, entitlementId, entitlementName, applicationName } = {},
    ) {
      return checkIdentityEntitlement({
        tenantId,
        identityId,
        applicationId,
        entitlementId,
        entitlementName,
        applicationName,
      });
    },

    async revokeEntitlement(
      identityId,
      {
        applicationId,
        applicationName,
        entitlementId,
        entitlementName,
        reviewItemId,
        campaignName,
        nativeIdentity,
      } = {},
    ) {
      let error = null;
      let queue = { queued: false };

      try {
        queue = await enqueueCertRevokeProvisioning({
          tenantId,
          executionId,
          reviewItemId,
          identityId,
          applicationId,
          applicationName,
          entitlementId,
          entitlementName,
          nativeIdentity,
          campaignName,
          requestedByEmail: executedBy,
        });
        if (queue.provisioningRequestId) {
          provisioningRequestIds.push(queue.provisioningRequestId);
        }

        await RemediationAuditLog.create({
          tenantId: tenantId ? String(tenantId) : undefined,
          action: "RECORD_UPDATE",
          performedBy: executedBy,
          performedAt: new Date(),
          note: `Workflow revoke queued: ${entitlementName || entitlementId || "entitlement"}`,
          newValue: {
            identityId,
            applicationId: applicationId ? String(applicationId) : undefined,
            entitlementId,
            entitlementName,
            reviewItemId,
            provisioningRequestId: queue.provisioningRequestId,
            queued: queue.queued,
            connectorRef: "remediation_workflow_engine",
          },
        });
      } catch (err) {
        error = err?.message || "Revoke enqueue failed";
      }

      if (error) return { success: false, error };
      if (!queue.queued) {
        return { success: false, error: queue.error || "Provisioning request not queued" };
      }
      return {
        success: true,
        queued: true,
        provisioningRequestId: queue.provisioningRequestId,
        provisioningTaskId: queue.provisioningTaskId,
        reviewItemId,
      };
    },

    async addEmail(email) {
      const log = await RemediationAuditLog.create({
        tenantId: tenantId ? String(tenantId) : undefined,
        action: "NOTIFY",
        performedBy: executedBy,
        performedAt: new Date(),
        note: `Workflow email: ${email.subject || ""} → ${email.to || ""}`,
        newValue: {
          to: email.to,
          from: email.from,
          subject: email.subject,
          body: email.body,
          stepId: email.stepId,
          stepLabel: email.label,
          executionId: executionId || undefined,
          emailJobId: null,
        },
      });
      emailIds.push(String(log._id));

      let queue = { queued: false };
      try {
        queue = await enqueueWorkflowEmail({
          tenantId,
          campaignId: email.trigger?.campaignId,
          executionId,
          stepId: email.stepId,
          stepLabel: email.label,
          recipientEmail: email.to,
          subject: email.subject,
          body: email.body,
          // Fail-fast: SMTP must succeed before Wait / decision steps run.
          deliverNow: true,
          metadata: {
            workflowStep: email.label,
            identityId: email.trigger?.identityId,
            entitlementName: email.trigger?.entitlementName,
            orphanId: email.trigger?.orphanId,
          },
        });
        if (queue.emailJobId) {
          await RemediationAuditLog.updateOne(
            { _id: log._id },
            { $set: { "newValue.emailJobId": queue.emailJobId } },
          );
        }
      } catch (err) {
        queue = { queued: false, error: err?.message || "Email queue failed" };
      }

      return {
        id: String(log._id),
        emailJobId: queue.emailJobId || null,
        to: email.to,
        subject: email.subject,
        // Downstream CompareStrings often check queued=true; treat delivered as queued.
        queued: Boolean(queue.queued || queue.status === "SENT"),
        reused: Boolean(queue.reused),
        sent: queue.status === "SENT",
        status: queue.status || null,
        error: queue.error || queue.reason || null,
        reason: queue.reason || null,
      };
    },

    async addTicket(ticket) {
      // Idempotent on resume: reuse the ticket already linked to this execution
      // instead of opening a new one on every re-verify cycle.
      if (existingTicketId) {
        createdTicketIds.push(String(existingTicketId));
        return { id: String(existingTicketId), status: "OPEN", reused: true, ...ticket };
      }

      const itsmEmail = await resolveItsmAssigneeEmail(ticket.assignee, tenantId);
      const pseudoTicketId = createPseudoTicketId();

      const evt = await RemediationEvent.create({
        tenantId: tenantId ? String(tenantId) : undefined,
        eventType: "REVOKE_ACCESS",
        status: "OPEN",
        workflowState: "TICKET_CREATED",
        title: ticket.title,
        description: ticket.description,
        itsmEmail: itsmEmail || undefined,
        subject: {
          identityId: ticket.identityId,
          identityName: ticket.identityName,
          applicationId: toOid(ticket.applicationId) ? String(toOid(ticket.applicationId)) : undefined,
          applicationName: ticket.applicationName,
        },
        source: {
          sourceType: "CERTIFICATION_WORKFLOW",
          sourceId: ticket.reviewItemId,
          sourceRef: ticket.campaignName,
        },
        notification: {
          templateKey: "remediation-revoke-access",
          status: itsmEmail ? "PENDING" : "SKIPPED",
          to: itsmEmail || undefined,
        },
        ticket: {
          templateKey: "ticket-revoke-access",
          ticketId: pseudoTicketId,
          ticketStatus: "OPEN",
          openedAt: new Date(),
          assignedEmail: itsmEmail || undefined,
        },
        metadata: {
          priority: ticket.priority,
          assignee: ticket.assignee,
          portalLink: ticket.portalLink,
          entitlementName: ticket.entitlementName,
          executionId: executionId || undefined,
        },
        lastStatusAt: new Date(),
      });

      if (itsmEmail) {
        const notify = await notifyItsmAssigneeForTicket(evt.toObject ? evt.toObject() : evt);
        await RemediationEvent.updateOne(
          { _id: evt._id },
          {
            $set: {
              "notification.status": notify.status,
              "notification.sentAt": notify.status === "SENT" ? new Date() : undefined,
              "notification.error": notify.error || undefined,
              workflowState:
                notify.status === "SENT"
                  ? "NOTIFIED"
                  : notify.status === "SKIPPED"
                    ? "TICKET_CREATED"
                    : "NOTIFICATION_FAILED",
            },
          },
        );
      }

      createdTicketIds.push(String(evt._id));
      return {
        id: String(evt._id),
        ticketId: pseudoTicketId,
        status: "OPEN",
        ticketStatus: "OPEN",
        itsmEmail: itsmEmail || null,
        notified: Boolean(itsmEmail),
        ...ticket,
      };
    },

    async addAudit(entry) {
      const log = await RemediationAuditLog.create({
        tenantId: tenantId ? String(tenantId) : undefined,
        action: "RECORD_UPDATE",
        performedBy: executedBy,
        performedAt: new Date(),
        note: entry.message,
        newValue: {
          action: entry.action,
          outcome: entry.outcome,
          identityId: entry.identityId,
          entitlementName: entry.entitlementName,
          applicationName: entry.applicationName,
          campaignName: entry.campaignName,
          details: entry.details,
        },
      });
      auditIds.push(String(log._id));
      return { id: String(log._id), ...entry };
    },

    async updateOrphanWorkflowStatus(orphanId, { workflowStatus, currentStepLabel, nextCheckAt } = {}) {
      if (!orphanId) return { updated: false };
      try {
        const patch = { workflowStatus, currentStepLabel, updatedBy: executedBy };
        if (nextCheckAt !== undefined) patch.nextCheckAt = nextCheckAt;
        await OrphanAccount.updateOne(
          { _id: orphanId },
          { $set: patch },
        );
        return { updated: true };
      } catch {
        return { updated: false };
      }
    },

    async getOrphanDecision(orphanId) {
      if (!orphanId) return null;
      const doc = await OrphanAccount.findById(orphanId).select("iamDecision workflowStatus").lean();
      return doc ? { iamDecision: doc.iamDecision || null, workflowStatus: doc.workflowStatus } : null;
    },

    /**
     * Joiner: after approval, compile Plan + ADD_ACCOUNT Task (no LDAP here).
     * Generic multi-item plans: materialize executable plan items instead.
     */
    async compileJoinerProvisioning(provisioningRequestId, { approvedBy } = {}) {
      try {
        const ProvisioningRequest = (
          await import("../../models/provisioning/ProvisioningRequest.js")
        ).default;
        const request = await ProvisioningRequest.findById(provisioningRequestId)
          .select("metadata")
          .lean();
        if (request?.metadata?.genericPlan && request?.metadata?.planId) {
          const { materializeProvisioningTasks } = await import(
            "../../services/provisioning/taskMaterializationService.js"
          );
          const result = await materializeProvisioningTasks({
            planId: request.metadata.planId,
            workflowExecutionId: request.metadata.workflowExecutionId,
            approvedBy,
          });
          if (result.provisioningRequestId) {
            provisioningRequestIds.push(String(result.provisioningRequestId));
          }
          return { success: Boolean(result.success), ...result };
        }

        // Prefer generic lifecycle compiler (CREATE/UPDATE/DISABLE + Joiner)
        const { compileLifecyclePlanAndTask } = await import(
          "../../services/provisioning/lifecycleProvisioningService.js"
        );
        const result = await compileLifecyclePlanAndTask({
          provisioningRequestId,
          approvedBy,
        });
        if (result.provisioningRequestId) {
          provisioningRequestIds.push(String(result.provisioningRequestId));
        }
        return { success: Boolean(result.success), ...result };
      } catch (err) {
        try {
          const { compileJoinerPlanAndTask } = await import(
            "../../services/provisioning/joinerProvisioningService.js"
          );
          const result = await compileJoinerPlanAndTask({
            provisioningRequestId,
            approvedBy,
          });
          if (result.provisioningRequestId) {
            provisioningRequestIds.push(String(result.provisioningRequestId));
          }
          return { success: Boolean(result.success), ...result };
        } catch (err2) {
          return {
            success: false,
            error: err2?.message || err?.message || "compileJoinerProvisioning failed",
          };
        }
      }
    },

    async materializeProvisioningPlan(planId, { approvedBy, workflowExecutionId } = {}) {
      try {
        const { materializeProvisioningTasks } = await import(
          "../../services/provisioning/taskMaterializationService.js"
        );
        const result = await materializeProvisioningTasks({
          planId,
          workflowExecutionId,
          approvedBy,
        });
        if (result.provisioningRequestId) {
          provisioningRequestIds.push(String(result.provisioningRequestId));
        }
        return { success: Boolean(result.success), ...result };
      } catch (err) {
        return {
          success: false,
          error: err?.message || "materializeProvisioningPlan failed",
        };
      }
    },

    async rejectJoinerProvisioning(provisioningRequestId, { rejectedBy } = {}) {
      try {
        const { rejectLifecycleRequest } = await import(
          "../../services/provisioning/lifecycleProvisioningService.js"
        );
        const result = await rejectLifecycleRequest({
          provisioningRequestId,
          rejectedBy,
        });
        if (result.success) return { success: true, ...result };
      } catch {
        /* fall through */
      }
      try {
        const { rejectJoinerRequest } = await import(
          "../../services/provisioning/joinerProvisioningService.js"
        );
        const result = await rejectJoinerRequest({
          provisioningRequestId,
          rejectedBy,
        });
        return { success: Boolean(result.success), ...result };
      } catch (err) {
        return { success: false, error: err?.message || "rejectJoinerProvisioning failed" };
      }
    },

    async compileLifecycleProvisioning(provisioningRequestId, { approvedBy } = {}) {
      return this.compileJoinerProvisioning(provisioningRequestId, { approvedBy });
    },

    async rejectLifecycleProvisioning(provisioningRequestId, { rejectedBy } = {}) {
      return this.rejectJoinerProvisioning(provisioningRequestId, { rejectedBy });
    },

    dump() {
      return { emailIds, ticketIds: createdTicketIds, auditIds, provisioningRequestIds };
    },
  };
}
