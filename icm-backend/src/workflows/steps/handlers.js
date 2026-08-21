import { resolveObject, resolveValue, renderTemplate, buildContext } from "../workflow/jsonPath.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import Application from "../../models/application/Application.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import WorkflowTaskQueue from "../../models/workflowTaskQueue/WorkflowTaskQueue.js";
import { WORKFLOW_TASK_STATUS } from "../../constants/workflowTaskQueue.js";
import {
  createTicket as createTicketRecord,
  getTicket as getTicketRecord,
  updateTicket as updateTicketRecord,
  closeTicket as closeTicketRecord,
} from "../../services/ticket/ticketService.js";
import { enrichOrphanRowsForDisplay } from "../../utils/datahygine/orphanAccountDisplayEnrichment.js";
import {
  withReviewPortalStepContext,
  finalizeReviewPortalOutput,
} from "./reviewPortalHelper.js";
import {
  parseReminderPhasesMs,
  pollAtForPhase,
  formatPhaseLabels,
} from "../../services/workflow/orphanReminderPhases.js";
import {
  VERIFICATION_STATUS,
  validateVerificationContext,
  buildVerificationOutput,
  branchForVerificationStatus,
} from "../verification/verificationStatus.js";

function stepContext(context, priorOutputs) {
  return buildContext(context.trigger, priorOutputs, context.config);
}

function compareNumbers(left, right, operator) {
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  switch (operator) {
    case ">":
      return left > right;
    case "<":
      return left < right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      return false;
  }
}

const DELAY_MS = {
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: 24 * 60 * 60 * 1000,
  weeks: 7 * 24 * 60 * 60 * 1000,
  months: 30 * 24 * 60 * 60 * 1000,
};

function computeResumeAt(delayValue, delayUnit) {
  const ms = (DELAY_MS[delayUnit] || DELAY_MS.hours) * delayValue;
  return new Date(Date.now() + ms).toISOString();
}

/**
 * Each step is an independent unit: it resolves its own inputs from the
 * run context (trigger + prior step outputs), performs its action via the
 * adapter, and returns { status, output, branch }. A failing action reports
 * status FAILED with an error in its output so the run trace shows exactly
 * which step broke and why.
 */
export const stepHandlers = {
  CertificationSignedOff: {
    category: "trigger",
    async execute(node, context) {
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { ...context.trigger },
        branch: null,
      };
    },
  },

  UncorrelatedAccountIAMDecision: {
    category: "trigger",
    async execute(node, context) {
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { ...context.trigger },
        branch: null,
      };
    },
  },

  JoinerDetected: {
    category: "trigger",
    async execute(node, context) {
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { ...context.trigger },
        branch: null,
      };
    },
  },

  WaitForJoinerApproval: {
    category: "action",
    async execute(node, context) {
      const decision = context.trigger?.approvalDecision;
      if (decision === "APPROVED" || decision === "REJECTED") {
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type } },
          output: { approvalDecision: decision, waiting: false },
          branch: null,
        };
      }
      return {
        status: "WAITING",
        input: { node: { id: node.id, type: node.type } },
        output: {
          waitingForApproval: true,
          provisioningRequestId: context.trigger?.provisioningRequestId,
          checkpointNodeId: node.config?.checkpointNodeId || "checkDecision",
        },
        branch: null,
      };
    },
  },

  CheckJoinerDecision: {
    category: "operator",
    async execute(node, context) {
      const decision = String(context.trigger?.approvalDecision || "").toUpperCase();
      const approved = decision === "APPROVED";
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { approvalDecision: decision || null, approved },
        branch: approved ? "true" : "false",
      };
    },
  },

  ProvisionJoinerAccount: {
    category: "action",
    async execute(node, context) {
      const provisioningRequestId = context.trigger?.provisioningRequestId;
      // Generic multi-item plans materialize from the compiled plan after approval.
      if (context.trigger?.genericPlan && context.trigger?.planId) {
        const result = await context.adapter?.materializeProvisioningPlan?.(
          context.trigger.planId,
          {
            approvedBy: context.trigger?.decidedBy,
            workflowExecutionId: context.config?.executionId,
          },
        );
        const ok = result?.success !== false;
        return {
          status: ok ? "SUCCESS" : "FAILED",
          input: { node: { id: node.id, type: node.type } },
          output: {
            provisioningRequestId,
            planId: context.trigger.planId,
            genericPlan: true,
            ...result,
          },
          branch: null,
        };
      }

      const result = await context.adapter?.compileJoinerProvisioning?.(provisioningRequestId, {
        approvedBy: context.trigger?.decidedBy,
      });
      const ok = result?.success !== false;
      return {
        status: ok ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type } },
        output: { provisioningRequestId, ...result },
        branch: null,
      };
    },
  },

  RejectJoinerRequest: {
    category: "action",
    async execute(node, context) {
      const provisioningRequestId = context.trigger?.provisioningRequestId;
      const result = await context.adapter?.rejectJoinerProvisioning?.(provisioningRequestId, {
        rejectedBy: context.trigger?.decidedBy,
      });
      const ok = result?.success !== false;
      return {
        status: ok ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type } },
        output: { provisioningRequestId, ...result },
        branch: null,
      };
    },
  },

  GetOrphanContext: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const orphanId =
        resolveValue(node.config?.orphanId ?? "$.trigger.orphanId", stepCtx) ||
        context.trigger?.orphanId;
      if (!orphanId) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type } },
          output: { error: "orphanId is required" },
          branch: null,
        };
      }
      let orphan = await OrphanAccount.findById(orphanId)
        .populate("applicationId", "name tenantId userMappings")
        .lean();
      if (!orphan) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type } },
          output: { error: `Orphan account not found: ${orphanId}` },
          branch: null,
        };
      }
      const [enriched] = await enrichOrphanRowsForDisplay([orphan]);
      orphan = enriched || orphan;
      const app =
        orphan.applicationId && typeof orphan.applicationId === "object"
          ? orphan.applicationId
          : orphan.applicationId
            ? await Application.findById(orphan.applicationId).select("name").lean()
            : null;
      const output = {
        orphanId: String(orphan._id),
        accountId: orphan.accountId || null,
        accountName: orphan.accountName || context.trigger?.accountName || "",
        applicationId: app?._id ? String(app._id) : orphan.applicationId ? String(orphan.applicationId) : null,
        applicationName: app?.name || context.trigger?.applicationName || "",
        correlationKey: orphan.correlationKey || null,
        riskLevel: orphan.riskLevel || context.trigger?.riskLevel || "HIGH",
        userEmail: orphan.userEmail || null,
        userDisplayName: orphan.userDisplayName || null,
        userEmployeeId: orphan.userEmployeeId || null,
        userUsername: orphan.userUsername || null,
        detectedAt: orphan.detectedAt ? new Date(orphan.detectedAt).toISOString() : null,
      };
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output,
        branch: null,
      };
    },
  },

  OrphanReminderSchedule: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const orphanId = context.trigger?.orphanId;
      const executionId = context.config?.executionId;
      const phasesSpec = resolveValue(
        node.config?.reminderPhases ?? "1h,3h,6h,12h",
        stepCtx,
      );
      const phasesMs = parseReminderPhasesMs(phasesSpec);
      const labels = formatPhaseLabels(phasesMs);
      const checkpointNodeId =
        node.config?.checkpointNodeId || "checkDecision";
      let startedAt = new Date();
      if (executionId) {
        const execDoc = await RemediationWorkflowExecution.findOne({
          executionId: String(executionId),
        })
          .select("startedAt createdAt")
          .lean();
        startedAt = execDoc?.startedAt || execDoc?.createdAt || startedAt;
      }
      const nextPollAt = pollAtForPhase(startedAt, 0, phasesMs);

      if (executionId) {
        await RemediationWorkflowExecution.updateOne(
          { executionId: String(executionId) },
          {
            $set: {
              waitReason: "IAM_DECISION",
              checkpointNodeId,
              reminderPhases: labels,
              reminderPhaseIndex: 0,
              nextPollAt,
              pollIntervalMs: phasesMs[0] || null,
              reminderEmailConfig: {
                to: node.config?.reminderTo || "$.config.iamTeamEmail",
                subject:
                  node.config?.reminderSubject ||
                  "Reminder: IAM review pending — {{$.trigger.accountName}}",
                body:
                  node.config?.reminderBody ||
                  "IAM Team,\n\nReminder: account {{$.trigger.accountName}} on {{$.trigger.applicationName}} is still awaiting your decision.\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
              },
            },
          },
        );
      }

      if (orphanId) {
        await OrphanAccount.updateOne(
          { _id: orphanId },
          {
            $set: {
              nextCheckAt: nextPollAt,
              reminderPhaseIndex: 0,
              currentStepLabel: `Reminder schedule: ${labels.join(", ")}`,
            },
          },
        );
      }

      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: {
          orphanId,
          scheduleLabel: labels.join(", "),
          reminderPhases: labels,
          nextPollAt: nextPollAt?.toISOString() || null,
          checkpointNodeId,
        },
        branch: null,
      };
    },
  },

  IamDecisionTaken: {
    category: "operator",
    async execute(node, context) {
      const orphanId = context.trigger?.orphanId;
      const record = await context.adapter?.getOrphanDecision?.(orphanId);
      const iamDecision =
        record?.iamDecision || context.trigger?.iamDecision || null;
      const decided = Boolean(iamDecision);
      if (orphanId && decided) {
        await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
          workflowStatus: "IN_PROGRESS",
          currentStepLabel: `IAM decision: ${iamDecision}`,
        });
      }
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, iamDecision, decided },
        branch: decided ? "true" : "false",
      };
    },
  },

  StartGovernanceReview: {
    category: "action",
    async execute(node, context) {
      const orphanId = context.trigger?.orphanId;
      await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
        workflowStatus: "IN_PROGRESS",
        currentStepLabel: "Governance Review Started",
      });
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, governanceStarted: true },
        branch: null,
      };
    },
  },

  AssignIAMTeam: {
    category: "action",
    async execute(node, context) {
      const orphanId = context.trigger?.orphanId;
      await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
        workflowStatus: "IN_PROGRESS",
        currentStepLabel: "Assigned to IAM Team",
      });
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, iamTeamAssigned: true },
        branch: null,
      };
    },
  },

  SchedulerCheck: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const orphanId = context.trigger?.orphanId;
      const record = await context.adapter?.getOrphanDecision?.(orphanId);
      const hasDecision = Boolean(record?.iamDecision);

      if (!hasDecision) {
        const cfg = node.config || {};
        const resolveField = (val) => {
          if (!val) return "";
          if (typeof val === "string" && val.trim().startsWith("$")) {
            const resolved = resolveValue(val.trim(), stepCtx);
            return resolved == null ? "" : String(resolved);
          }
          return renderTemplate(String(val), stepCtx);
        };
        const portalCtx = withReviewPortalStepContext(stepCtx, context, node);
        const to = resolveField(cfg.to || "$.config.iamTeamEmail");
        const from =
          resolveField(cfg.from || "$.config.workflowFromEmail") ||
          portalCtx.config?.workflowFromEmail ||
          "";
        const subject = renderTemplate(
          cfg.subject || "Reminder: IAM review pending — {{$.trigger.accountName}}",
          portalCtx,
        );
        const body = renderTemplate(
          cfg.body ||
            "IAM Team,\n\nThis is an automated reminder. The orphan account {{$.trigger.accountName}} on {{$.trigger.applicationName}} is still awaiting your decision.\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
          portalCtx,
        );
        await context.adapter?.addEmail?.({
          to,
          from,
          subject,
          body,
          stepId: node.id,
          label: node.label,
          trigger: context.trigger,
        });
        await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
          workflowStatus: "WAITING_IAM",
          currentStepLabel: "Reminder Sent — Awaiting Decision",
        });
      }

      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, hasDecision, reminderSent: !hasDecision },
        branch: hasDecision ? "true" : "false",
      };
    },
  },

  WaitForIAMDecision: {
    category: "action",
    async execute(node, context) {
      const orphanId = context.trigger?.orphanId;
      await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
        workflowStatus: "WAITING_IAM",
        currentStepLabel: node.label || "Awaiting portal decision",
      });
      return {
        status: "WAITING",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, waitingForDecision: true },
        branch: null,
      };
    },
  },

  RecordIAMDecision: {
    category: "action",
    async execute(node, context) {
      const orphanId = context.trigger?.orphanId;
      const record = await context.adapter?.getOrphanDecision?.(orphanId);
      const iamDecision = record?.iamDecision || context.trigger?.iamDecision || null;
      await context.adapter?.updateOrphanWorkflowStatus?.(orphanId, {
        workflowStatus: "IN_PROGRESS",
        currentStepLabel: `IAM Decision: ${iamDecision || "Pending"}`,
      });
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { orphanId, iamDecision, decisionRecorded: Boolean(iamDecision) },
        branch: null,
      };
    },
  },

  GetCertificationItem: {
    category: "action",
    async execute(node, context) {
      const identity = context.adapter?.getIdentity
        ? await context.adapter.getIdentity(context.trigger.identityId)
        : null;
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: {
          reviewItem: context.trigger,
          identity: identity
            ? {
                id: identity.id,
                name: identity.name,
                displayName: identity.displayName,
                email: identity.email,
                managerEmail: identity.managerEmail,
                managerName: identity.managerName,
              }
            : null,
        },
        branch: null,
      };
    },
  },

  CompareStrings: {
    category: "operator",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const left = resolveValue(node.config?.left ?? "$.trigger.decision", stepCtx);
      const right = resolveValue(node.config?.right ?? "Revoke", stepCtx);
      const boolCompare =
        typeof left === "boolean" ||
        typeof right === "boolean" ||
        right === "true" ||
        right === "false";
      const match = boolCompare
        ? String(left) === String(right)
        : String(left).toLowerCase() === String(right).toLowerCase();
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { left, right, match },
        branch: match ? "true" : "false",
      };
    },
  },

  CompareNumbers: {
    category: "operator",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const leftRaw = resolveValue(node.config?.left ?? "$.steps.retryLoop.iteration", stepCtx);
      const operator = node.config?.operator || ">";
      const rightRaw = node.config?.right ?? 0;
      const rightResolved =
        typeof rightRaw === "string" && rightRaw.trim().startsWith("$")
          ? resolveValue(rightRaw, stepCtx)
          : rightRaw;
      const left = Number(leftRaw);
      const right = Number(rightResolved);
      const match = compareNumbers(left, right, operator);
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { left, right, operator, match },
        branch: match ? "true" : "false",
      };
    },
  },

  Loop: {
    category: "operator",
    async execute(node, context, priorOutputs) {
      const maxIterations = Math.max(1, Number(node.config?.maxIterations) || 10);
      const varName = String(node.config?.iterationVariableName || "iteration").trim() || "iteration";
      const prior = priorOutputs?.[node.id] || {};
      const lastIteration = Number(prior.iteration ?? prior[varName] ?? 0);
      const iteration = lastIteration + 1;

      if (iteration > maxIterations) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type } },
          output: {
            iteration,
            maxIterations,
            [varName]: iteration,
            error: `Maximum iterations (${maxIterations}) exceeded`,
          },
          branch: null,
        };
      }

      const output = { iteration, maxIterations, [varName]: iteration };
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output,
        branch: null,
      };
    },
  },

  VerifyDataType: {
    category: "operator",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const field = resolveValue(node.config?.field, stepCtx);
      const check = node.config?.check || "exists";
      const exists = field != null && field !== "";
      const match = check === "exists" ? exists : !exists;
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { field, check, match },
        branch: match ? "true" : "false",
      };
    },
  },

  RevokeAccess: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const identityId =
        resolveValue(node.config?.identityId ?? "$.trigger.identityId", stepCtx) ||
        context.trigger.identityId;
      const entitlementId = resolveValue(
        node.config?.entitlementId ?? "$.trigger.entitlementId",
        stepCtx,
      );
      const entitlementName = resolveValue(
        node.config?.entitlementName ?? "$.trigger.entitlementName",
        stepCtx,
      );
      const result = await context.adapter.revokeEntitlement(identityId, {
        applicationId: context.trigger.applicationId,
        applicationName: context.trigger.applicationName,
        entitlementId,
        entitlementName,
        reviewItemId: context.trigger.reviewItemId,
        campaignName: context.trigger.campaignName,
        nativeIdentity: context.trigger.nativeIdentity,
      });
      const output = { identityId, entitlementId, entitlementName, ...result };
      return {
        status: result.success ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output,
        branch: null,
      };
    },
  },

  VerifyAccessRemoved: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const identityId =
        resolveValue(node.config?.identityId ?? "$.trigger.identityId", stepCtx) ||
        context.trigger.identityId;
      const entitlementId = resolveValue(
        node.config?.entitlementId ?? "$.trigger.entitlementId",
        stepCtx,
      );
      const entitlementName = resolveValue(
        node.config?.entitlementName ?? "$.trigger.entitlementName",
        stepCtx,
      );
      const portalBaseUrl = stepCtx.config.portalBaseUrl;

      const preCheck = validateVerificationContext({
        identityId,
        entitlementId,
        entitlementName,
      });
      if (!preCheck.ok) {
        const output = buildVerificationOutput({
          identityId,
          entitlementId,
          entitlementName,
          verificationStatus: VERIFICATION_STATUS.VERIFICATION_FAILED,
          stillPresent: null,
          portalBaseUrl,
          reason: preCheck.reason,
        });
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output,
          branch: branchForVerificationStatus(VERIFICATION_STATUS.VERIFICATION_FAILED),
        };
      }

      const checkResult = await context.adapter.hasEntitlement(identityId, {
        applicationId: context.trigger.applicationId,
        applicationName: context.trigger.applicationName,
        entitlementId,
        entitlementName,
      });

      const verificationStatus =
        checkResult?.verificationStatus ??
        (checkResult === true
          ? VERIFICATION_STATUS.STILL_PRESENT
          : checkResult === false
            ? VERIFICATION_STATUS.REMOVED
            : VERIFICATION_STATUS.VERIFICATION_FAILED);
      const stillPresent =
        checkResult?.stillPresent ??
        (verificationStatus === VERIFICATION_STATUS.STILL_PRESENT
          ? true
          : verificationStatus === VERIFICATION_STATUS.REMOVED
            ? false
            : null);

      const output = buildVerificationOutput({
        identityId,
        entitlementId,
        entitlementName,
        verificationStatus,
        stillPresent,
        portalBaseUrl,
        reason: checkResult?.reason ?? null,
      });

      const failed = verificationStatus === VERIFICATION_STATUS.VERIFICATION_FAILED;
      return {
        status: failed ? "FAILED" : "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output,
        branch: branchForVerificationStatus(verificationStatus),
      };
    },
  },

  SendEmail: {
    category: "action",
    async execute(node, context, priorOutputs) {
      let stepCtx = stepContext(context, priorOutputs);
      stepCtx = withReviewPortalStepContext(stepCtx, context, node);
      const cfg = node.config || {};
      const resolveField = (val) => {
        if (val == null) return "";
        if (typeof val === "string" && val.trim().startsWith("$")) {
          const resolved = resolveValue(val.trim(), stepCtx);
          return resolved == null ? "" : String(resolved);
        }
        return renderTemplate(String(val), stepCtx);
      };
      const to = resolveField(cfg.to);
      const from =
        resolveField(cfg.from || "$.config.workflowFromEmail") ||
        stepCtx.config?.workflowFromEmail ||
        "";
      const subject = renderTemplate(cfg.subject || "", stepCtx);
      const body = renderTemplate(cfg.body || "", stepCtx);
      const email = await context.adapter.addEmail({
        to,
        from,
        subject,
        body,
        stepId: node.id,
        label: node.label,
        trigger: context.trigger,
      });
      const output = finalizeReviewPortalOutput(
        {
          emailId: email.id,
          emailJobId: email.emailJobId || null,
          to,
          subject,
          queued: Boolean(email.queued),
          sent: Boolean(email.sent),
          reused: Boolean(email.reused),
          error: email.error || null,
          reason: email.reason || null,
        },
        context,
        node,
        email,
      );

      // Require actual SMTP delivery (deliverNow). Queued-but-not-sent must not
      // continue into Wait-for-decision — otherwise the event looks "awaiting IAM".
      const delivered = Boolean(email.sent || email.status === "SENT");
      if (!delivered) {
        const detail =
          email.error ||
          email.reason ||
          (!to ? "missing_recipient" : "email_not_delivered");
        return {
          status: "FAILED",
          error: `Send email failed: ${detail}`,
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output,
          branch: null,
        };
      }

      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output,
        branch: null,
      };
    },
  },

  CreateTicket: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const resolveField = (val) => {
        if (val == null) return "";
        if (typeof val === "string" && val.trim().startsWith("$")) {
          const resolved = resolveValue(val.trim(), stepCtx);
          return resolved == null ? "" : String(resolved);
        }
        return renderTemplate(String(val), stepCtx);
      };
      // Subject fields default to the trigger when the config leaves them blank,
      // but every value is overridable in Step Config via {{$.trigger.*}}.
      const subject = (key) => resolveField(cfg[key]) || context.trigger?.[key] || "";

      if (context.config?.mode === "TEST") {
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: {
            id: "test-ticket",
            ticketId: "TKT-TEST",
            provider: cfg.provider || "internal",
            status: "NEW",
            title: renderTemplate(cfg.title || "Remediation Ticket", stepCtx),
            simulated: true,
          },
          branch: null,
        };
      }

      const ticket = await createTicketRecord({
        provider: cfg.provider || "internal",
        tenantId: context.config?.tenantId,
        executionId: context.config?.executionId,
        title: renderTemplate(cfg.title || "Remediation Ticket", stepCtx),
        description: renderTemplate(cfg.description || "", stepCtx),
        priority: cfg.priority || "MEDIUM",
        assignedTeam: resolveField(cfg.assignedTeam),
        assignee: resolveField(cfg.assignee),
        identityId: context.trigger?.identityId,
        identityName: subject("identityName"),
        identityEmail: subject("identityEmail"),
        managerName: subject("managerName"),
        managerEmail: subject("managerEmail"),
        applicationId: context.trigger?.applicationId,
        applicationName: subject("applicationName"),
        entitlementId: context.trigger?.entitlementId,
        entitlementName: subject("entitlementName"),
        reviewerName: subject("reviewerName"),
        reviewDate: subject("reviewDate"),
        comments: resolveField(cfg.comments) || context.trigger?.comment || "",
        reviewItemId: context.trigger?.reviewItemId,
      });
      return {
        status: ticket ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: ticket
          ? { ...ticket }
          : { error: "Ticket provider did not return a ticket" },
        branch: null,
      };
    },
  },

  GetTicket: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const ticketId = resolveValue(
        cfg.ticketId ?? "$.steps.createTicket.ticketId",
        stepCtx,
      );
      if (!ticketId) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { error: "ticketId is required" },
          branch: null,
        };
      }
      if (context.config?.mode === "TEST") {
        const simStatus = cfg.simulateStatus || "CLOSED";
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { ticketId: String(ticketId), status: simStatus, closed: simStatus === "CLOSED", simulated: true },
          branch: null,
        };
      }
      const ticket = await getTicketRecord({
        provider: cfg.provider || "internal",
        tenantId: context.config?.tenantId,
        ticketId: String(ticketId),
      });
      const closed = ticket?.status === "CLOSED";
      return {
        status: ticket ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: ticket
          ? { ...ticket, closed }
          : { error: `Ticket not found: ${ticketId}` },
        branch: null,
      };
    },
  },

  UpdateTicket: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const ticketId = resolveValue(
        cfg.ticketId ?? "$.steps.createTicket.ticketId",
        stepCtx,
      );
      if (!ticketId) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { error: "ticketId is required" },
          branch: null,
        };
      }
      const fields = {};
      ["status", "priority", "assignee", "assignedTeam", "comments"].forEach((key) => {
        if (cfg[key] != null && cfg[key] !== "") {
          fields[key] = renderTemplate(String(cfg[key]), stepCtx);
        }
      });
      if (context.config?.mode === "TEST") {
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { ticketId: String(ticketId), ...fields, simulated: true },
          branch: null,
        };
      }
      const ticket = await updateTicketRecord({
        provider: cfg.provider || "internal",
        tenantId: context.config?.tenantId,
        ticketId: String(ticketId),
        fields,
      });
      return {
        status: ticket ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: ticket ? { ...ticket } : { error: `Ticket not found: ${ticketId}` },
        branch: null,
      };
    },
  },

  CloseTicket: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const ticketId = resolveValue(
        cfg.ticketId ?? "$.steps.createTicket.ticketId",
        stepCtx,
      );
      if (!ticketId) {
        return {
          status: "FAILED",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { error: "ticketId is required" },
          branch: null,
        };
      }
      if (context.config?.mode === "TEST") {
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { ticketId: String(ticketId), status: "CLOSED", simulated: true },
          branch: null,
        };
      }
      const ticket = await closeTicketRecord({
        provider: cfg.provider || "internal",
        tenantId: context.config?.tenantId,
        ticketId: String(ticketId),
        resolution: renderTemplate(cfg.resolution || "", stepCtx),
      });
      return {
        status: ticket ? "SUCCESS" : "FAILED",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: ticket ? { ...ticket } : { error: `Ticket not found: ${ticketId}` },
        branch: null,
      };
    },
  },

  UpdateQueueTask: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const executionId = context.config?.executionId;
      const requested = String(cfg.status || WORKFLOW_TASK_STATUS.COMPLETED).toUpperCase();
      const status = WORKFLOW_TASK_STATUS[requested] || WORKFLOW_TASK_STATUS.COMPLETED;

      // No executionId in TEST runs — report intent without touching the queue.
      if (!executionId) {
        return {
          status: "SUCCESS",
          input: { node: { id: node.id, type: node.type }, context: stepCtx },
          output: { updated: false, status, reason: "No execution context (test run)" },
          branch: null,
        };
      }

      const patch = { status };
      if (status === WORKFLOW_TASK_STATUS.COMPLETED) patch.completedAt = new Date();
      const res = await WorkflowTaskQueue.updateOne({ executionId }, { $set: patch });
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { updated: res.modifiedCount > 0, status },
        branch: null,
      };
    },
  },

  Switch: {
    category: "operator",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const value = resolveValue(cfg.field ?? "$.trigger.decision", stepCtx);
      const cases = Array.isArray(cfg.cases) ? cfg.cases : [];
      const match = cases.find(
        (c) => String(c.value).toLowerCase() === String(value).toLowerCase(),
      );
      const branch = match?.branch || match?.value || cfg.defaultBranch || "default";
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { value, branch, matched: Boolean(match) },
        branch: String(branch),
      };
    },
  },

  AuditLog: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      let outcome = cfg.outcome;
      if (outcome != null && String(outcome).trim().startsWith("$")) {
        outcome = resolveValue(outcome, stepCtx);
      }
      if (outcome == null || outcome === "") {
        outcome = resolveValue("$.steps.verify.verified", stepCtx) ? "SUCCESS" : "FAILURE";
      }
      outcome = String(outcome).toUpperCase();
      const entry = await context.adapter.addAudit({
        action: cfg.action || "CERTIFICATION_REVOKE_WORKFLOW",
        outcome,
        identityId: context.trigger.identityId,
        entitlementName: context.trigger.entitlementName,
        applicationName: context.trigger.applicationName,
        campaignName: context.trigger.campaignName,
        message: renderTemplate(cfg.message || "Certification revoke workflow audit", stepCtx),
        details: {
          decision: context.trigger.decision,
          reviewItemId: context.trigger.reviewItemId,
        },
      });
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: { auditId: entry.id, ...entry },
        branch: null,
      };
    },
  },

  Scheduler: {
    category: "action",
    async execute(node, context, priorOutputs) {
      const stepCtx = stepContext(context, priorOutputs);
      const cfg = node.config || {};
      const delayValue = Math.max(1, Number(cfg.delayValue) || 1);
      const delayUnit = cfg.delayUnit || "hours";
      const resumeAt = computeResumeAt(delayValue, delayUnit);
      const nextStepId = cfg.nextStepId || null;
      const resumeWorkflow = cfg.resumeWorkflow !== false && cfg.resumeWorkflow !== "false";

      return {
        status: "WAITING",
        input: { node: { id: node.id, type: node.type }, context: stepCtx },
        output: {
          scheduled: true,
          scheduleType: cfg.scheduleType || "relativeDelay",
          delayValue,
          delayUnit,
          resumeAt,
          resumeWorkflow,
          nextStepId,
          ended: true,
          status: "WAITING",
        },
        branch: null,
      };
    },
  },

  EndSuccess: {
    category: "operator",
    async execute(node) {
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type } },
        output: { ended: true, status: "SUCCESS" },
        branch: null,
      };
    },
  },

  EndFailure: {
    category: "operator",
    async execute(node) {
      return {
        status: "FAILURE",
        input: { node: { id: node.id, type: node.type } },
        output: { ended: true, status: "FAILURE" },
        branch: null,
      };
    },
  },

  EndWaiting: {
    category: "operator",
    async execute(node) {
      return {
        status: "WAITING",
        input: { node: { id: node.id, type: node.type } },
        output: { ended: true, status: "WAITING" },
        branch: null,
      };
    },
  },

  CatalogStub: {
    category: "action",
    async execute(node) {
      const label = node.config?.catalogLabel || node.label;
      return {
        status: "SUCCESS",
        input: { node: { id: node.id, type: node.type, label } },
        output: {
          designOnly: true,
          catalogLabel: label,
          message: "ISC catalog step — design on canvas; not executed at runtime",
        },
        branch: null,
      };
    },
  },
};
