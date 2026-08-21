/**
 * Reminder frequency helpers extracted from certificationScheduler.
 */

/** Minimum time after campaign start before the first automated REMINDER (not LAUNCH). */
export function getFirstReminderGraceMs(freq) {
  const fromEnv = Number(process.env.CERT_FIRST_REMINDER_GRACE_MS);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;

  switch (String(freq || "").toUpperCase()) {
    case "WEEKLY":
      return 7 * 24 * 60 * 60 * 1000;
    case "MONTHLY":
      return 30 * 24 * 60 * 60 * 1000;
    case "TWO_DAYS_BEFORE_END":
      return 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export function getCampaignStartAt(campaign) {
  return campaign?.startDate || campaign?.createdAt || null;
}

export function getUtcDayStart(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns true if a reviewer should receive a reminder now.
 */
export function isDueForReminder(campaign, lastSentAt, freq) {
  if (!freq || freq === "GLOBAL" || freq === "DISABLED") return false;

  const now = new Date();

  if (freq === "TWO_DAYS_BEFORE_END") {
    if (!campaign.dueDate) return false;
    const daysUntilDue =
      (new Date(campaign.dueDate).getTime() - now.getTime()) /
      (1000 * 60 * 60 * 24);
    if (daysUntilDue > 2 || daysUntilDue <= 0) return false;
    if (
      lastSentAt &&
      now.getTime() - new Date(lastSentAt).getTime() < 24 * 60 * 60 * 1000
    ) {
      return false;
    }
    return true;
  }

  if (!lastSentAt) {
    const startAt = getCampaignStartAt(campaign);
    if (!startAt) return false;
    const graceMs = getFirstReminderGraceMs(freq);
    return now.getTime() - new Date(startAt).getTime() >= graceMs;
  }

  const msPerFreq =
    freq === "WEEKLY"
      ? 7 * 24 * 60 * 60 * 1000
      : freq === "MONTHLY"
        ? 30 * 24 * 60 * 60 * 1000
        : null;

  if (!msPerFreq) return false;
  return now.getTime() - new Date(lastSentAt).getTime() >= msPerFreq;
}

/**
 * Resolve effective reminder frequency for a campaign.
 */
export function resolveEffectiveFrequency(campaign, tenantSettings) {
  const globalActive = tenantSettings?.isActive !== false;
  const globalFrequency = tenantSettings?.frequency || "WEEKLY";
  const campaignFreq = campaign.reminderFrequency;
  const usesGlobal = !campaignFreq || campaignFreq === "GLOBAL";

  if (campaignFreq === "DISABLED") {
    return { skip: true, reason: "campaign_disabled" };
  }

  if (usesGlobal && !globalActive) {
    return { skip: true, reason: "global_disabled" };
  }

  const effectiveFreq = usesGlobal ? globalFrequency : campaignFreq;
  return { skip: false, effectiveFreq, usesGlobal };
}

/**
 * Map email job type to CampaignReminderLog reminderType.
 */
export function jobTypeToReminderLogType(jobType) {
  switch (String(jobType || "").toUpperCase()) {
    case "REMINDER":
      return "STANDARD";
    case "ESCALATION":
      return "ESCALATION";
    case "EXPIRY":
      return "EXPIRY";
    default:
      return null;
  }
}

/**
 * Check same-day dedupe: ≤1 of each reminder type per UTC day.
 */
export function shouldSkipSameDayDedupe(lastSentAt, todayStart) {
  if (!lastSentAt) return false;
  return new Date(lastSentAt) >= todayStart;
}
