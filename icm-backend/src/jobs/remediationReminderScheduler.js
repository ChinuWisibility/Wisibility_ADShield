/**
 * Remediation Validation Reminder Scheduler
 * Sends VALIDATION_DUE (1 day before) and VALIDATION_EXPIRED (after due date) emails.
 */

import RemediationValidation from "../models/remediation/RemediationValidation.js";
import RemediationNotification from "../models/remediation/RemediationNotification.js";
import RemediationQueue from "../models/remediation/RemediationQueue.js";
import DistributedLock from "../models/scheduler/DistributedLock.js";
import { sendEmail } from "../services/email/appEmailService.js";
import { updateStage } from "../services/remediation/remediationTrackingService.js";
import { updateQueueStatus } from "../services/remediation/remediationQueueService.js";

const POLL_INTERVAL_MS =
  Number(process.env.REMEDIATION_REMINDER_POLL_MS) || 60 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000;
const LOCK_KEY = "remediation_reminder_scheduler";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

async function alreadySent(validationId, notificationType) {
  const existing = await RemediationNotification.findOne({
    validationId,
    notificationType,
    status: "SENT",
  }).lean();
  return Boolean(existing);
}

async function sendValidationEmail(validation, queue, notificationType) {
  const recipient = validation.validationOwnerEmail;
  if (!recipient) return;

  const isDue = notificationType === "VALIDATION_DUE";
  const subject = isDue
    ? `Remediation validation due tomorrow — ${queue?.eventId || ""}`
    : `Remediation validation expired — ${queue?.eventId || ""}`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#2563EB;">${isDue ? "Validation Due Reminder" : "Validation Expired"}</h2>
      <p>Event: <strong>${queue?.eventId || "—"}</strong></p>
      <p>Type: <strong>${queue?.eventType || "—"}</strong></p>
      <p>Due date: <strong>${validation.validationDueDate ? new Date(validation.validationDueDate).toLocaleDateString() : "—"}</strong></p>
      <p>${isDue ? "Please complete validation before the due date." : "This validation has expired and requires attention."}</p>
    </div>`;

  try {
    await sendEmail({ to: recipient, subject, html });
    await RemediationNotification.create({
      tenantId: validation.tenantId,
      queueId: validation.queueId,
      ticketId: validation.ticketId,
      validationId: validation._id,
      notificationType,
      recipientEmail: recipient,
      sentAt: new Date(),
      status: "SENT",
      templateName: isDue ? "validation_due" : "validation_expired",
    });
  } catch (err) {
    await RemediationNotification.create({
      tenantId: validation.tenantId,
      queueId: validation.queueId,
      ticketId: validation.ticketId,
      validationId: validation._id,
      notificationType,
      recipientEmail: recipient,
      sentAt: new Date(),
      status: "FAILED",
      templateName: isDue ? "validation_due" : "validation_expired",
      error: err?.message,
    });
  }
}

async function runReminderJob() {
  const now = Date.now();
  const tomorrow = new Date(now + MS_PER_DAY);
  const dayAfterTomorrow = new Date(now + 2 * MS_PER_DAY);

  const dueSoon = await RemediationValidation.find({
    validationStatus: "PENDING",
    validationDueDate: { $gte: tomorrow, $lt: dayAfterTomorrow },
  }).lean();

  for (const v of dueSoon) {
    if (await alreadySent(v._id, "VALIDATION_DUE")) continue;
    const queue = await RemediationQueue.findById(v.queueId).lean();
    await sendValidationEmail(v, queue, "VALIDATION_DUE");
  }

  const overdue = await RemediationValidation.find({
    validationStatus: "PENDING",
    validationDueDate: { $lt: new Date() },
  });

  for (const validation of overdue) {
    if (!(await alreadySent(validation._id, "VALIDATION_EXPIRED"))) {
      const queue = await RemediationQueue.findById(validation.queueId).lean();
      await sendValidationEmail(validation, queue, "VALIDATION_EXPIRED");
    }

    validation.validationStatus = "EXPIRED";
    await validation.save();

    const queue = await RemediationQueue.findById(validation.queueId).lean();
    if (queue?.eventId) {
      await updateStage(queue.eventId, "validation", "EXPIRED");
      await updateQueueStatus(queue._id, "EXPIRED");
    }
  }
}

export function startRemediationReminderScheduler() {
  const run = async () => {
    const locked = await acquireLock(LOCK_KEY);
    if (!locked) return;
    try {
      await runReminderJob();
    } catch (err) {
      console.error("[remediationReminderScheduler] job failed:", err.message);
    } finally {
      await releaseLock(LOCK_KEY);
    }
  };

  setTimeout(run, 45_000);
  setInterval(run, POLL_INTERVAL_MS);
  console.log(
    `[remediationReminderScheduler] started (interval ${POLL_INTERVAL_MS}ms)`,
  );
}
