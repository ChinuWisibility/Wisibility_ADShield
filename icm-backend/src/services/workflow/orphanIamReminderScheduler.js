import env from "../../config/env.js";
import OrphanAccount from "../../models/identity/OrphanAccount.js";
import RemediationWorkflowExecution from "../../models/workflow/RemediationWorkflowExecution.js";
import { createIgaAdapter } from "../../workflows/adapters/igaAdapter.js";
import { buildRunContext } from "../../workflows/steps/context.js";
import { renderTemplate, resolveValue } from "../../workflows/workflow/jsonPath.js";
import {
  parseReminderPhasesMs,
  pollAtForPhase,
} from "./orphanReminderPhases.js";
import { issueOrphanIamPortalUrl } from "./orphanIamPortalTokenService.js";
import { logOrphanIamTask } from "./orphanIamTaskLogger.js";

let timer = null;

function phasesMsFromExecution(exec) {
  const labels = exec.reminderPhases;
  if (Array.isArray(labels) && labels.length) {
    return parseReminderPhasesMs(labels.join(","));
  }
  return parseReminderPhasesMs("1h,3h,6h,12h");
}

async function sendReminderEmail(exec, orphan) {
  const cfg = exec.reminderEmailConfig || {};
  const trigger = {
    ...(exec.triggerPayload || {}),
    orphanId: exec.orphanId || orphan?._id ? String(orphan._id) : null,
  };
  const adapter = createIgaAdapter({
    tenantId: exec.tenantId,
    executedBy: "orphan-iam-reminder-scheduler",
    executionId: exec.executionId,
  });
  const phaseIndex = exec.reminderPhaseIndex ?? 0;
  const phaseNumber = phaseIndex + 1;
  const reviewPortalUrl = issueOrphanIamPortalUrl({
    orphanId: exec.orphanId,
    executionId: exec.executionId,
    tenantId: exec.tenantId,
    stepId: "orphanIamReminderScheduler",
    stepLabel: `IAM reminder ${phaseNumber}`,
    source: `reminder-phase-${phaseNumber}`,
  });
  const context = await buildRunContext({ trigger }, {
    adapter,
    tenantId: exec.tenantId,
    executionId: exec.executionId,
    portalBaseUrl: env.frontendUrl,
    orphanIamPortalUrl: reviewPortalUrl,
    workflowFromEmail: env.workflow?.fromEmail,
  });
  const stepCtx = {
    trigger: context.trigger,
    config: {
      ...context.config,
      reviewPortalUrl,
      orphanIamPortalUrl: reviewPortalUrl,
    },
    steps: {},
  };

  const to =
    resolveValue(cfg.to || "$.config.iamTeamEmail", stepCtx) ||
    context.config.iamTeamEmail ||
    "";
  const from =
    resolveValue(cfg.from || "$.config.workflowFromEmail", stepCtx) ||
    env.workflow?.fromEmail ||
    "";
  const subject = renderTemplate(
    cfg.subject || "Reminder: IAM review pending — {{$.trigger.accountName}}",
    stepCtx,
  );
  const body = renderTemplate(
    cfg.body ||
      "IAM Team,\n\nReminder: account {{$.trigger.accountName}} on {{$.trigger.applicationName}} is still awaiting your decision.\n\nReview portal (no login required): {{$.config.reviewPortalUrl}}",
    stepCtx,
  );

  if (!to) return { sent: false, reason: "no_recipient" };

  const emailResult = await adapter.addEmail({
    to,
    from,
    subject,
    body,
    stepId: "orphanIamReminderScheduler",
    label: `IAM reminder ${phaseNumber}`,
    trigger,
  });
  return { sent: true, reviewPortalUrl, emailJobId: emailResult.emailJobId || null };
}

async function processExecution(exec) {
  const orphan = exec.orphanId
    ? await OrphanAccount.findById(exec.orphanId).lean()
    : null;
  if (!orphan) return;
  if (orphan.iamDecision) return;

  const phasesMs = phasesMsFromExecution(exec);
  const phaseIndex = exec.reminderPhaseIndex ?? 0;
  if (phaseIndex >= phasesMs.length) return;

  const startedAt = new Date();
  let emailResult = { sent: false };
  try {
    emailResult = await sendReminderEmail(exec, orphan);
  } catch (err) {
    await logOrphanIamTask({
      tenantId: exec.tenantId,
      taskName: "IAM_ORPHAN_REMINDER",
      taskType: "SCHEDULED",
      status: "FAILED",
      orphanId: exec.orphanId,
      executionId: exec.executionId,
      accountName: orphan.accountName,
      applicationName: exec.applicationName || exec.triggerPayload?.applicationName,
      detail: `Reminder phase ${phaseIndex + 1}/${phasesMs.length} failed`,
      errorMessage: err.message,
      startedAt,
    });
    throw err;
  }

  const nextIndex = phaseIndex + 1;
  const workflowStartedAt = exec.startedAt || exec.createdAt || new Date();
  const nextPollAt =
    nextIndex < phasesMs.length
      ? pollAtForPhase(workflowStartedAt, nextIndex, phasesMs)
      : null;
  const total = phasesMs.length;
  const stepLabel =
    nextPollAt != null
      ? `Reminder ${nextIndex}/${total} sent — Awaiting IAM`
      : `Final reminder sent — Awaiting IAM`;

  await RemediationWorkflowExecution.updateOne(
    { executionId: exec.executionId },
    {
      $set: {
        reminderPhaseIndex: nextIndex,
        nextPollAt,
        currentStepLabel: stepLabel,
      },
      $push: {
        stepStatuses: `Reminder ${nextIndex}/${total} email sent`,
      },
    },
  );

  if (orphan._id) {
    await OrphanAccount.updateOne(
      { _id: orphan._id },
      {
        $set: {
          reminderPhaseIndex: nextIndex,
          nextCheckAt: nextPollAt,
          currentStepLabel: stepLabel,
        },
      },
    );
  }

  const nextLabel = nextPollAt
    ? `Next reminder at ${new Date(nextPollAt).toLocaleString()}`
    : "No further reminders scheduled";

  await logOrphanIamTask({
    tenantId: exec.tenantId,
    taskName: "IAM_ORPHAN_REMINDER",
    taskType: "SCHEDULED",
    status: emailResult.sent ? "COMPLETED" : "FAILED",
    orphanId: exec.orphanId,
    executionId: exec.executionId,
    accountName: orphan.accountName,
    applicationName: exec.applicationName || exec.triggerPayload?.applicationName,
    detail: emailResult.sent
      ? `Reminder ${nextIndex}/${total} email queued · ${stepLabel} · ${nextLabel}`
      : `Reminder ${phaseIndex + 1}/${total} skipped — no recipient`,
    errorMessage: emailResult.sent ? null : emailResult.reason || "Email not sent",
    recordsProcessed: emailResult.sent ? 1 : 0,
    startedAt,
  });
}

async function tick() {
  const now = new Date();
  const due = await RemediationWorkflowExecution.find({
    status: "WAITING",
    waitReason: "IAM_DECISION",
    nextPollAt: { $ne: null, $lte: now },
  })
    .limit(50)
    .lean();

  for (const exec of due) {
    try {
      await processExecution(exec);
    } catch (err) {
      console.warn("[orphanIamReminderScheduler] reminder failed:", err.message);
    }
  }
}

export function startOrphanIamReminderScheduler(
  intervalMs = Number(process.env.ORPHAN_IAM_REMINDER_POLL_MS) || 5 * 60 * 1000,
) {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) =>
      console.warn("[orphanIamReminderScheduler] tick error:", err.message),
    );
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  console.log("[orphanIamReminderScheduler] started (interval", intervalMs, "ms)");
}
