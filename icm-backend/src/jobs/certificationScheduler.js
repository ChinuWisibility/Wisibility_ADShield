/**
 * Certification Scheduler
 *
 * Runs four automated jobs on a polling interval (no external cron library needed):
 *
 * 1. runDueSchedules          — Every 1 h: launch new campaigns for due CertificationSchedules
 * 2. sendReminderEmails       — Every 1 h: email reviewers with pending items based on reminderFrequency
 * 3. autoEscalateOverdue      — Every 1 h: escalate reviewers who are past their escalation threshold
 * 4. notifyExpiredCampaigns   — Every 1 h: email application owners when campaigns expire
 *
 * Uses DistributedLock to prevent double-firing in multi-process deployments.
 */

import Campaign from "../models/certification/Campaign.js";
import CertificationSchedule from "../models/certification/CertificationSchedule.js";
import CampaignReminderLog from "../models/certification/CampaignReminderLog.js";
import DistributedLock from "../models/scheduler/DistributedLock.js";
import Application from "../models/application/Application.js";
import {
  buildCertificationAssignmentEmail,
  buildCertificationReminderEmail,
  buildOwnerActionExpiredEmail,
} from "../services/email/appEmailService.js";
import { enqueueCertificationEmail } from "../services/email/emailJobService.js";
import {
  isDueForReminder,
  resolveEffectiveFrequency,
} from "../services/email/reminderSchedulerService.js";
import { resolveReminderSettingsForCampaign } from "../services/email/tenantReminderSettingsService.js";
import { runAutoEscalations } from "../services/email/escalationService.js";
import {
  buildReviewerAssignmentMap,
  buildReviewerEmailTokens,
  loadScopeRowsForCampaign,
} from "../services/access-certification/certificationScopeService.js";
import { resolveCampaignOwnerContact } from "../services/access-certification/campaignOwnerActionService.js";
import { countPendingEntitlementsByReviewerForCampaign } from "../services/access-certification/reviewItemService.js";
import { generateReviewItems } from "../services/access-certification/reviewItemService.js";
import ReviewItem from "../models/certification/ReviewItem.js";
import CertificationReviewerAssignment from "../models/certification/CertificationReviewerAssignment.js";

const POLL_INTERVAL_MS =
  Number(process.env.CERT_POLL_INTERVAL_MS) || 60 * 60 * 1000;
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 min lock TTL (prevents stuck locks)

// ─── Distributed lock helpers ─────────────────────────────────────────────────

async function acquireLock(key) {
  try {
    const expiresAt = new Date(Date.now() + LOCK_TTL_MS);
    await DistributedLock.create({
      _id: key,
      lockedBy: process.pid.toString(),
      expiresAt,
    });
    return true;
  } catch {
    return false; // lock already held
  }
}

async function releaseLock(key) {
  try {
    await DistributedLock.findByIdAndDelete(key);
  } catch {
    // ignore
  }
}

// ─── Frequency helpers ────────────────────────────────────────────────────────

function frequencyToDays(freq) {
  switch (String(freq ?? "").toUpperCase()) {
    case "QUARTERLY":
      return 90;
    case "SEMI_ANNUAL":
      return 180;
    case "ANNUAL":
      return 365;
    case "MONTHLY":
    default:
      return 30;
  }
}

// ─── Job 1: Run due certification schedules ───────────────────────────────────

async function runDueSchedules() {
  const lockKey = "cert:runDueSchedules";
  if (!(await acquireLock(lockKey))) return;

  try {
    const now = new Date();
    const dueSchedules = await CertificationSchedule.find({
      isActive: true,
      nextRunAt: { $lte: now },
    }).lean();

    for (const schedule of dueSchedules) {
      try {
        const tpl = schedule.campaignTemplate || {};
        const campaign = await Campaign.create({
          applicationId: schedule.applicationId,
          applicationName: tpl.applicationName,
          name: `${schedule.scheduleName} — ${now.toISOString().slice(0, 10)}`,
          description: tpl.description,
          category: tpl.category || "IDENTITY",
          campaignMode: tpl.campaignMode,
          identityFilter: tpl.identityFilter || "ALL",
          status: "Draft",
          startDate: now,
          dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
          reminderFrequency: tpl.reminderFrequency || "GLOBAL",
          escalationConfig: tpl.escalationConfig,
          reviewersAssigned: tpl.reviewersAssigned || [],
          selectedIds: tpl.selectedIds || [],
          sourceContext: {
            scheduleId: schedule._id,
            source: "certification-schedule",
          },
        });

        let assignmentMap;
        try {
          assignmentMap = await buildReviewerAssignmentMap(campaign);
        } catch (e) {
          console.warn(
            `[CertScheduler] buildReviewerAssignmentMap failed for campaign '${campaign.name}':`,
            e.message,
          );
          assignmentMap = new Map();
        }

        try {
          const fresh = await Campaign.findById(campaign._id)
            .populate("applicationId", "name tenantId")
            .lean();
          const app = await Application.findById(schedule.applicationId)
            .select("tenantId")
            .lean();
          const userTenantId = app?.tenantId || null;
          if (fresh && userTenantId) {
            const { scopeData } = await loadScopeRowsForCampaign(fresh, {
              userTenantId,
            });
            await generateReviewItems(fresh, scopeData, assignmentMap);
          }
        } catch (e) {
          console.warn(
            `[CertScheduler] generateReviewItems failed for '${campaign.name}':`,
            e.message,
          );
        }

        await CertificationSchedule.findByIdAndUpdate(schedule._id, {
          lastRunAt: now,
          lastCampaignId: campaign._id,
          runCount: (schedule.runCount || 0) + 1,
          nextRunAt: new Date(
            now.getTime() +
              frequencyToDays(schedule.frequency) * 24 * 60 * 60 * 1000,
          ),
        });

        // Notify assigned reviewers — pool reviewers + manager-derived (DEFAULT routing)
        const poolReviewers = tpl.reviewersAssigned || [];
        let scheduledReviewers = [...poolReviewers];
        if (scheduledReviewers.length === 0) {
          // DEFAULT routing: pool is empty; reviewers were written to CertificationReviewerAssignment
          try {
            const assignments = await CertificationReviewerAssignment.find(
              { campaignId: campaign._id },
              { reviewerEmail: 1, reviewerName: 1 },
            ).lean();
            for (const a of assignments) {
              if (a.reviewerEmail) {
                scheduledReviewers.push({ email: a.reviewerEmail, name: a.reviewerName || a.reviewerEmail });
              }
            }
          } catch (e) {
            console.warn("[CertScheduler] Could not load reviewer assignments for email:", e.message);
          }
        }
        for (const reviewer of scheduledReviewers) {
          if (!reviewer.email) continue;
          try {
            const {
              itemDecisions,
              approveAllToken,
              revokeAllToken,
              scopeItems,
              reviewerJwt,
            } = await buildReviewerEmailTokens(campaign, reviewer.email);
            const { subject, html } = await buildCertificationAssignmentEmail({
              reviewerName: reviewer.name || reviewer.email,
              campaignName: campaign.name,
              campaignId: campaign._id.toString(),
              dueDate: campaign.dueDate,
              itemDecisions,
              approveAllToken,
              revokeAllToken,
              scopeItems,
              reviewerJwt,
              category: tpl.category || "",
            });
            await enqueueCertificationEmail({
              type: "LAUNCH",
              campaignId: campaign._id,
              tenantId: campaign.tenantId,
              recipientEmail: reviewer.email,
              subject,
              html,
              metadata: { source: "scheduler" },
            });
          } catch (e) {
            console.error(
              `[CertScheduler] Email failed for ${reviewer.email}:`,
              e.message,
            );
          }
        }

        console.log(
          `[CertScheduler] Launched campaign '${campaign.name}' from schedule '${schedule.scheduleName}'`,
        );
      } catch (e) {
        console.error(
          `[CertScheduler] Failed to run schedule '${schedule.scheduleName}':`,
          e.message,
        );
      }
    }
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── Job 2: Send periodic reminder emails ─────────────────────────────────────

async function sendReminderEmails() {
  const lockKey = "cert:sendReminderEmails";
  if (!(await acquireLock(lockKey))) return;

  try {
    const tenantSettingsCache = new Map();

    const activeCampaigns = await Campaign.find({
      status: { $in: ["Active", "DecisionPending"] },
      dueDate: { $gte: new Date() },
    }).lean();

    for (const campaign of activeCampaigns) {
      const tenantSettings = await resolveReminderSettingsForCampaign(
        campaign,
        tenantSettingsCache,
      );
      const freqResult = resolveEffectiveFrequency(campaign, tenantSettings);
      if (freqResult.skip) {
        if (freqResult.reason === "global_disabled") {
          console.log(
            `[CertScheduler] Skipping '${campaign.name}' — global reminders disabled`,
          );
        }
        continue;
      }
      const { effectiveFreq, usesGlobal } = freqResult;
      const baseReviewers = Array.isArray(campaign.reviewersAssigned)
        ? campaign.reviewersAssigned
        : [];

      const derivedEmails = await ReviewItem.distinct("reviewerEmail", {
        campaignId: campaign._id,
        status: "PENDING",
      });
      const derivedFromReview = derivedEmails.map((e) => {
        const email = String(e || "")
          .trim()
          .toLowerCase();
        return { email, name: email };
      });

      const reviewers = [...baseReviewers];
      for (const r of derivedFromReview) {
        const key = String(r?.email || r?.reviewerEmail || "")
          .trim()
          .toLowerCase();
        const hasExisting = reviewers.some(
          (existing) =>
            String(existing?.email || existing?.reviewerEmail || "")
              .trim()
              .toLowerCase() === key,
        );
        if (!hasExisting && key)
          reviewers.push({ ...r, email: r.email || key });
      }

      if (reviewers.length === 0) continue;

      const pendingByEmail = await countPendingEntitlementsByReviewerForCampaign(
        campaign._id,
      );
      const riCount = await ReviewItem.countDocuments({
        campaignId: campaign._id,
      });
      const currentReviewIsEmpty = riCount === 0;

      const totalSelectedIds = Array.isArray(campaign.selectedIds)
        ? campaign.selectedIds.length
        : 0;
      const fallbackPendingCount =
        currentReviewIsEmpty && totalSelectedIds > 0 ? totalSelectedIds : null;

      // Batch-load the most recent SENT log for every reviewer on this campaign
      // in a single query — avoids N+1 round-trips (one per reviewer)
      const reviewerEmails = reviewers
        .map((r) =>
          String(r.email || r.reviewerEmail || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean);

      const recentLogs = await CampaignReminderLog.aggregate([
        {
          $match: {
            campaignId: campaign._id,
            recipientEmail: { $in: reviewerEmails },
            reminderType: "STANDARD",
            deliveryStatus: "SENT",
          },
        },
        { $sort: { sentAt: -1 } },
        {
          $group: {
            _id: "$recipientEmail",
            lastSentAt: { $first: "$sentAt" },
          },
        },
      ]);
      // Build a map: email → lastSentAt
      const lastSentByEmail = {};
      for (const log of recentLogs) {
        lastSentByEmail[
          String(log._id || "")
            .trim()
            .toLowerCase()
        ] = log.lastSentAt;
      }

      let emailsSent = 0;
      let attemptedRecipients = 0;
      let skippedNoPending = 0;
      let failedDeliveries = 0;

      for (const reviewer of reviewers) {
        const to = String(reviewer.email || reviewer.reviewerEmail || "")
          .trim()
          .toLowerCase();
        if (!to) continue;

        const pendingCount = pendingByEmail[to] ?? fallbackPendingCount;
        if (pendingCount === 0) {
          skippedNoPending++;
          continue; // reviewer has nothing pending
        }

        const lastSentAt = lastSentByEmail[to] ?? null;
        // Cadence gate only. Same-window dedupe is now enforced atomically by the
        // reservation guard inside enqueueCertificationEmail.
        if (!isDueForReminder(campaign, lastSentAt, effectiveFreq)) {
          continue;
        }

        let itemDecisions = [],
          approveAllToken = null,
          revokeAllToken = null,
          scopeItems = [],
          reviewerJwt = null;
        try {
          ({ itemDecisions, approveAllToken, revokeAllToken, scopeItems, reviewerJwt } =
            await buildReviewerEmailTokens(campaign, to));
        } catch {
          // token generation is best-effort — send reminder without action links
        }

        try {
          const scopeCount = Array.isArray(scopeItems) ? scopeItems.length : 0;
          const tokenCount = Array.isArray(itemDecisions)
            ? itemDecisions.length
            : 0;
          const effectivePending = Math.max(
            pendingCount ?? 0,
            scopeCount,
            tokenCount,
          );
          if (effectivePending <= 0) {
            skippedNoPending++;
            continue;
          }
          attemptedRecipients++;

          const { subject, html } = await buildCertificationReminderEmail({
            reviewerName: reviewer.name || reviewer.email,
            campaignName: campaign.name,
            campaignId: campaign._id.toString(),
            dueDate: campaign.dueDate,
            pendingCount: effectivePending,
            approveAllToken,
            revokeAllToken,
            itemDecisions,
            scopeItems,
            reviewerJwt,
            category: campaign.category || "",
          });
          const job = await enqueueCertificationEmail({
            type: "REMINDER",
            campaignId: campaign._id,
            tenantId: campaign.tenantId,
            recipientEmail: to,
            subject,
            html,
            reminderSubtype: effectiveFreq,
            effectiveFreq,
            metadata: { reviewerEmail: to, campaignId: campaign._id.toString(), source: "scheduler" },
          });
          if (!job) continue;
          emailsSent++;

          console.log(
            `[CertScheduler] Reminder enqueued for ${to} — campaign '${campaign.name}' (freq: ${effectiveFreq}${usesGlobal ? " via tenant settings" : ""})`,
          );
        } catch (e) {
          failedDeliveries++;
          console.error(
            `[CertScheduler] Reminder enqueue failed for ${to} (campaign: '${campaign.name}'):`,
            e.message,
          );
        }
      }

      // Reminder delivery is fully tracked in CampaignReminderLog — no campaign.history push needed
    }
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── Job 3: Auto-escalate overdue reviewers ───────────────────────────────────

async function autoEscalateOverdue() {
  const lockKey = "cert:autoEscalateOverdue";
  if (!(await acquireLock(lockKey))) return;

  try {
    await runAutoEscalations();
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── Job 4: Notify application owners when campaigns expire ───────────────────

async function notifyExpiredCampaigns() {
  const lockKey = "cert:notifyExpiredCampaigns";
  if (!(await acquireLock(lockKey))) return;

  try {
    const now = new Date();

    // Find campaigns that are past due, not yet in end-state, and haven't had owner email sent
    const expiredCampaigns = await Campaign.find({
      dueDate: { $lt: now },
      status: { $nin: ["EndPhase", "Closed", "Completed"] },
      ownerActionEmailSentAt: { $exists: false },
    }).lean();

    for (const campaign of expiredCampaigns) {
      try {
        const ownerContact = await resolveCampaignOwnerContact(campaign);
        const ownerEmail = ownerContact?.email || null;
        const ownerName = ownerContact?.name || null;
        const applicationName =
          ownerContact?.applicationName || campaign.applicationName || null;

        if (!ownerEmail) {
          console.log(
            `[CertScheduler] No owner email for campaign '${campaign.name}' — moving to EndPhase without email`,
          );
          await Campaign.findByIdAndUpdate(campaign._id, {
            status: "EndPhase",
            ownerActionEmailSentAt: now,
          });
          continue;
        }

        const { subject, html } = await buildOwnerActionExpiredEmail({
          ownerName: ownerName || ownerEmail,
          campaignName: campaign.name,
          campaignId: campaign._id.toString(),
          applicationName,
          dueDate: campaign.dueDate,
        });

        await enqueueCertificationEmail({
          type: "EXPIRY",
          campaignId: campaign._id,
          tenantId: campaign.tenantId,
          recipientEmail: ownerEmail,
          subject,
          html,
        });

        // Transition to EndPhase — owner must Extend or Close before campaign can complete
        await Campaign.findByIdAndUpdate(campaign._id, {
          status: "EndPhase",
          ownerActionEmailSentAt: now,
        });

        console.log(
          `[CertScheduler] Expiry notification sent to ${ownerEmail} for campaign '${campaign.name}'`,
        );
      } catch (e) {
        console.error(
          `[CertScheduler] Expiry notification failed for campaign '${campaign.name}':`,
          e.message,
        );
      }
    }
  } finally {
    await releaseLock(lockKey);
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runAllJobs() {
  await Promise.allSettled([
    runDueSchedules(),
    sendReminderEmails(),
    autoEscalateOverdue(),
    notifyExpiredCampaigns(),
  ]);
}

/**
 * Start the certification scheduler.
 * Call once from server.js after DB is connected.
 */
export function startCertificationScheduler() {
  console.log(
    "[CertScheduler] Starting — poll interval:",
    POLL_INTERVAL_MS / 60000,
    "minutes",
  );

  // Run immediately on startup (catches any missed jobs during downtime)
  runAllJobs().catch((err) =>
    console.error("[CertScheduler] Startup run error:", err.message),
  );

  // Then poll every hour
  setInterval(() => {
    runAllJobs().catch((err) =>
      console.error("[CertScheduler] Poll error:", err.message),
    );
  }, POLL_INTERVAL_MS);
}
