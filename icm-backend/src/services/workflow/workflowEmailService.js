import mongoose from "mongoose";
import EmailJob from "../../models/email/EmailJob.js";
import { deliverWorkflowEmailNow } from "./workflowEmailImmediateDelivery.js";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Plain-text workflow body → minimal HTML for the email worker. */
export function workflowBodyToHtml(body) {
  const escaped = escapeHtml(body);
  const withBreaks = escaped.replace(/\r\n/g, "\n").replace(/\n/g, "<br />");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a;">${withBreaks}</div>`;
}

function toObjectId(value) {
  if (!value) return undefined;
  const s = String(value).trim();
  return mongoose.isValidObjectId(s) ? new mongoose.Types.ObjectId(s) : undefined;
}

/**
 * Queue a remediation workflow email for async SMTP delivery via the email worker.
 * Idempotent per execution + workflow step (safe on resume).
 *
 * @param {object} opts
 * @param {boolean} [opts.deliverNow=false] — when true, attempt SMTP immediately and
 *   fail the enqueue result if delivery fails (used by SendEmail fail-fast).
 */
export async function enqueueWorkflowEmail({
  tenantId,
  campaignId,
  executionId,
  stepId,
  stepLabel,
  recipientEmail,
  subject,
  body,
  metadata = {},
  deliverNow = false,
}) {
  const to = String(recipientEmail || "")
    .trim()
    .toLowerCase();
  if (!to || !to.includes("@")) {
    return { queued: false, reason: "invalid_recipient" };
  }
  if (!subject || !body) {
    return { queued: false, reason: "missing_content" };
  }

  const dedupeQuery = {
    type: "WORKFLOW",
    recipientEmail: to,
    "metadata.executionId": executionId || undefined,
    "metadata.stepId": stepId || undefined,
  };

  if (executionId && stepId) {
    const existing = await EmailJob.findOne({
      ...dedupeQuery,
      status: { $in: ["PENDING", "PROCESSING", "SENT", "FAILED"] },
    })
      .select("_id status lastError")
      .lean();

    if (existing?.status === "SENT") {
      return {
        queued: false,
        reused: true,
        emailJobId: String(existing._id),
        status: "SENT",
      };
    }

    if (existing && !deliverNow && ["PENDING", "PROCESSING"].includes(existing.status)) {
      return {
        queued: existing.status !== "SENT",
        reused: true,
        emailJobId: String(existing._id),
        status: existing.status,
      };
    }

    // Fail-fast re-send: reuse the same job id and try SMTP again.
    if (existing && deliverNow && existing.status !== "PROCESSING") {
      const delivery = await deliverWorkflowEmailNow(existing._id);
      if (delivery.ok) {
        return {
          queued: true,
          reused: true,
          emailJobId: String(existing._id),
          status: "SENT",
        };
      }
      return {
        queued: false,
        reused: true,
        emailJobId: String(existing._id),
        status: "FAILED",
        error: delivery.error || existing.lastError || "SMTP delivery failed",
        reason: "smtp_failed",
      };
    }
  }

  const job = await EmailJob.create({
    type: "WORKFLOW",
    status: "PENDING",
    campaignId: toObjectId(campaignId),
    tenantId: toObjectId(tenantId),
    recipientEmail: to,
    subject: String(subject).trim(),
    html: workflowBodyToHtml(body),
    nextRunAt: new Date(),
    metadata: {
      source: "remediation_workflow",
      executionId: executionId || undefined,
      stepId: stepId || undefined,
      stepLabel: stepLabel || undefined,
      ...metadata,
    },
    maxAttempts: Number(process.env.EMAIL_JOB_MAX_ATTEMPTS || 4),
  });

  if (!deliverNow) {
    return { queued: true, emailJobId: String(job._id), status: "PENDING" };
  }

  const delivery = await deliverWorkflowEmailNow(job._id);
  if (delivery.ok) {
    return { queued: true, emailJobId: String(job._id), status: "SENT" };
  }

  return {
    queued: false,
    emailJobId: String(job._id),
    status: "FAILED",
    error: delivery.error || "SMTP delivery failed",
    reason: "smtp_failed",
  };
}
