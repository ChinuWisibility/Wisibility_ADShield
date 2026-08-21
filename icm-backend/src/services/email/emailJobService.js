import EmailJob from "../../models/email/EmailJob.js";
import Campaign from "../../models/certification/Campaign.js";
import CampaignReminderLog from "../../models/certification/CampaignReminderLog.js";
import {
  resolveCampaignTenantId,
  releaseReminderReservation,
} from "./campaignReminderLogService.js";
import { recordCertificationEmailAudit } from "./campaignEmailAuditService.js";
import {
  jobTypeToReminderLogType,
  resolveEffectiveFrequency,
} from "./reminderSchedulerService.js";
import { resolveReminderSettingsForCampaign } from "./tenantReminderSettingsService.js";
import {
  computeReminderWindow,
  buildReminderDedupeKey,
} from "./reminderWindow.js";

const BACKOFF_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
];

/**
 * Resolve the effective reminder cadence for a campaign so that BOTH the manual
 * button and the scheduler compute an identical window bucket. Caller-supplied
 * subtypes are intentionally ignored here to guarantee cross-path agreement.
 * Returns a cadence string ("WEEKLY" | "MONTHLY" | "TWO_DAYS_BEFORE_END") or
 * "GLOBAL" (which maps to a daily window fallback).
 */
export async function resolveEffectiveFreqForCampaign(campaignId) {
  if (!campaignId) return "GLOBAL";
  const campaign = await Campaign.findById(campaignId)
    .select("reminderFrequency tenantId")
    .lean();
  if (!campaign) return "GLOBAL";
  const settings = await resolveReminderSettingsForCampaign(campaign);
  const result = resolveEffectiveFrequency(campaign, settings);
  return result.skip ? "GLOBAL" : result.effectiveFreq;
}

/**
 * Enqueue a certification email with atomic, frequency-window dedupe.
 *
 * Returns a structured outcome:
 *   { status: "ENQUEUED", job }
 *   { status: "SKIPPED_ALREADY_QUEUED", existingJobId }
 *   { status: "SKIPPED_WINDOW", reason, nextEligibleAt, lastSentAt }
 */
export async function reserveAndEnqueueCertificationEmail({
  type,
  campaignId,
  recipientEmail,
  tenantId,
  subject,
  html,
  reminderSubtype,
  metadata,
  scheduledFor,
  force,
}) {
  const to = String(recipientEmail || "")
    .trim()
    .toLowerCase();
  if (!to || !to.includes("@")) {
    throw new Error("Valid recipientEmail is required");
  }
  if (!subject || !html) {
    throw new Error("subject and html are required");
  }

  const typeUpper = String(type || "").toUpperCase();
  const resolvedTenantId =
    tenantId ?? (campaignId ? await resolveCampaignTenantId(campaignId) : null);
  const forced = force ?? metadata?.force === true;
  const actorType = metadata?.manual
    ? "USER"
    : metadata?.source === "scheduler"
      ? "SCHEDULER"
      : "SYSTEM";

  const reminderLogType = jobTypeToReminderLogType(typeUpper);

  let reservation = null;
  let windowKey;
  let dedupeKey;
  let windowEnd = null;

  if (!forced) {
    // Cheap pre-guard for all types: never create a second in-flight job for the
    // same campaign + reviewer + type.
    const inFlight = await EmailJob.findOne({
      campaignId: campaignId || undefined,
      recipientEmail: to,
      type: typeUpper,
      status: { $in: ["PENDING", "PROCESSING"] },
    })
      .select("_id")
      .lean();

    if (inFlight) {
      await recordCertificationEmailAudit({
        campaignId,
        tenantId: resolvedTenantId,
        eventType: "EMAIL_DEDUPE_SKIPPED",
        emailType: type,
        recipientEmail: to,
        actorType,
        actorId: metadata?.actorId,
        details: {
          phase: "enqueue",
          reason: "already_queued",
          existingJobId: inFlight._id,
          reminderSubtype,
        },
      });
      return {
        status: "SKIPPED_ALREADY_QUEUED",
        existingJobId: inFlight._id,
      };
    }

    // Frequency-window reservation (only for reminder-log-backed types).
    if (reminderLogType && campaignId) {
      const effectiveFreq =
        reminderLogType === "STANDARD"
          ? await resolveEffectiveFreqForCampaign(campaignId)
          : undefined;
      const window = computeReminderWindow({
        reminderType: reminderLogType,
        effectiveFreq,
      });
      windowKey = window.windowKey;
      windowEnd = window.windowEnd;
      dedupeKey = buildReminderDedupeKey({
        campaignId,
        recipientEmail: to,
        reminderType: reminderLogType,
        windowKey,
      });

      const existing = await CampaignReminderLog.findOne({ dedupeKey })
        .select("deliveryStatus sentAt")
        .lean();
      if (existing) {
        await recordCertificationEmailAudit({
          campaignId,
          tenantId: resolvedTenantId,
          eventType: "EMAIL_DEDUPE_SKIPPED",
          emailType: type,
          recipientEmail: to,
          actorType,
          actorId: metadata?.actorId,
          details: {
            phase: "enqueue",
            reason:
              existing.deliveryStatus === "SENT"
                ? "already_sent_window"
                : "already_reserved_window",
            windowKey,
            nextEligibleAt: windowEnd,
            lastSentAt: existing.sentAt,
            reminderSubtype,
          },
        });
        return {
          status: "SKIPPED_WINDOW",
          reason:
            existing.deliveryStatus === "SENT"
              ? "already_sent_window"
              : "already_reserved_window",
          nextEligibleAt: windowEnd,
          lastSentAt: existing.sentAt || null,
        };
      }

      try {
        reservation = await CampaignReminderLog.create({
          campaignId,
          tenantId: resolvedTenantId || undefined,
          recipientEmail: to,
          reminderType: reminderLogType,
          deliveryStatus: "PENDING",
          windowKey,
          dedupeKey,
        });
      } catch (err) {
        // Unique-index collision: a concurrent trigger won the reservation race.
        if (err?.code === 11000) {
          await recordCertificationEmailAudit({
            campaignId,
            tenantId: resolvedTenantId,
            eventType: "EMAIL_DEDUPE_SKIPPED",
            emailType: type,
            recipientEmail: to,
            actorType,
            actorId: metadata?.actorId,
            details: {
              phase: "enqueue",
              reason: "window_reserved_race",
              windowKey,
              nextEligibleAt: windowEnd,
              reminderSubtype,
            },
          });
          return {
            status: "SKIPPED_WINDOW",
            reason: "window_reserved_race",
            nextEligibleAt: windowEnd,
            lastSentAt: null,
          };
        }
        throw err;
      }
    }
  }

  let job;
  try {
    job = await EmailJob.create({
      type,
      status: "PENDING",
      campaignId: campaignId || undefined,
      tenantId: resolvedTenantId || undefined,
      recipientEmail: to,
      reminderSubtype: reminderSubtype || undefined,
      subject,
      html,
      nextRunAt: scheduledFor || new Date(),
      metadata: {
        ...(metadata || {}),
        ...(reservation
          ? { reminderLogId: String(reservation._id), windowKey }
          : {}),
      },
      maxAttempts: Number(process.env.EMAIL_JOB_MAX_ATTEMPTS || 4),
    });
  } catch (err) {
    // Job insert failed after reserving — free the window so it can be retried.
    if (reservation) {
      await releaseReminderReservation(reservation._id);
    }
    throw err;
  }

  await recordCertificationEmailAudit({
    campaignId,
    tenantId: resolvedTenantId,
    eventType: "EMAIL_ENQUEUED",
    emailType: type,
    recipientEmail: to,
    emailJobId: job._id,
    actorType,
    actorId: metadata?.actorId,
    details: { reminderSubtype, windowKey },
  });

  return { status: "ENQUEUED", job };
}

/**
 * Backward-compatible wrapper: returns the created EmailJob, or null when the
 * send was deduped/skipped. Existing callers rely on this null contract.
 */
export async function enqueueCertificationEmail(args) {
  const result = await reserveAndEnqueueCertificationEmail(args);
  return result.status === "ENQUEUED" ? result.job : null;
}

export function getRetryDelayMs(attempts) {
  const idx = Math.min(Math.max(attempts - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[idx];
}

export { BACKOFF_MS };
