/**
 * Frequency-window helpers for reminder/escalation email dedupe.
 *
 * A "window" is the interval during which at most one email of a given type may
 * be sent to a given reviewer for a given campaign. The window size is derived
 * from the campaign's effective reminder frequency:
 *   - WEEKLY               → the ISO week (Monday..Sunday, UTC)
 *   - MONTHLY              → the calendar month (UTC)
 *   - TWO_DAYS_BEFORE_END  → the UTC day (frequency naturally gates to ~24h)
 *   - anything else / GLOBAL/DISABLED fallback → the UTC day
 *
 * ESCALATION and EXPIRY emails always use a UTC-day window (avoid duplicate
 * escalation/expiry notices on the same day).
 */

import { getUtcDayStart } from "./reminderSchedulerService.js";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )}`;
}

/** Start of the ISO week (Monday 00:00:00 UTC) containing `date`. */
export function getUtcWeekStart(date = new Date()) {
  const d = getUtcDayStart(date);
  const dow = d.getUTCDay(); // 0=Sun .. 6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** First day of the calendar month (00:00:00 UTC) containing `date`. */
export function getUtcMonthStart(date = new Date()) {
  const d = getUtcDayStart(date);
  d.setUTCDate(1);
  return d;
}

/**
 * Compute the dedupe window for a reminder-type email.
 *
 * @param {Object} args
 * @param {string} args.reminderType  STANDARD | ESCALATION | EXPIRY
 * @param {string} [args.effectiveFreq]  Resolved cadence for STANDARD reminders
 * @param {Date}   [args.at]          Reference time (defaults to now)
 * @returns {{ windowKey: string, windowStart: Date, windowEnd: Date }}
 */
export function computeReminderWindow({
  reminderType,
  effectiveFreq,
  at = new Date(),
} = {}) {
  const type = String(reminderType || "").toUpperCase();

  // Escalation/expiry: one per UTC day.
  if (type && type !== "STANDARD") {
    return dailyWindow(at);
  }

  const freq = String(effectiveFreq || "").toUpperCase();
  switch (freq) {
    case "WEEKLY": {
      const start = getUtcWeekStart(at);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { windowKey: `W:${isoDate(start)}`, windowStart: start, windowEnd: end };
    }
    case "MONTHLY": {
      const start = getUtcMonthStart(at);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      return {
        windowKey: `M:${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`,
        windowStart: start,
        windowEnd: end,
      };
    }
    // TWO_DAYS_BEFORE_END and any GLOBAL/DISABLED/unknown fallback → daily.
    default:
      return dailyWindow(at);
  }
}

function dailyWindow(at) {
  const start = getUtcDayStart(at);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { windowKey: `D:${isoDate(start)}`, windowStart: start, windowEnd: end };
}

/**
 * Build the idempotency key that backs the unique index on CampaignReminderLog.
 */
export function buildReminderDedupeKey({
  campaignId,
  recipientEmail,
  reminderType,
  windowKey,
}) {
  const cid = String(campaignId || "");
  const email = String(recipientEmail || "")
    .trim()
    .toLowerCase();
  const type = String(reminderType || "").toUpperCase();
  return `${cid}|${email}|${type}|${windowKey}`;
}
