import Audit from "../../models/platform/Audit.js";
import SystemConfiguration from "../../models/platform/SystemConfiguration.js";
import env from "../../config/env.js";
import { AppError } from "../../middleware/errorHandler.js";

const SETTINGS_KEY = "platform.settings";
const DEFAULTS = Object.freeze({
  sessionTimeoutMinutes: 1440,
  maintenanceMode: false,
  maintenanceMessage: "ADSecurity is temporarily unavailable for maintenance.",
  supportEmail: "support@ADSecurity.io",
  auditRetentionDays: 365,
});

let current = { ...DEFAULTS };
let retentionTimer = null;

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("Support email must be a valid email address", 400, "INVALID_EMAIL");
  }
  return email;
}

function boundedInteger(value, field, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AppError(
      `${field} must be between ${min} and ${max}`,
      400,
      "INVALID_PLATFORM_SETTING",
    );
  }
  return number;
}

export function normalizePlatformSettings(input = {}, previous = DEFAULTS) {
  const maintenanceMessage = String(
    input.maintenanceMessage ?? previous.maintenanceMessage,
  ).trim();
  if (!maintenanceMessage || maintenanceMessage.length > 300) {
    throw new AppError(
      "Maintenance message is required and must be 300 characters or fewer",
      400,
      "INVALID_MAINTENANCE_MESSAGE",
    );
  }

  return {
    sessionTimeoutMinutes: boundedInteger(
      input.sessionTimeoutMinutes ?? previous.sessionTimeoutMinutes,
      "Session timeout",
      15,
      1440,
    ),
    maintenanceMode: Boolean(
      input.maintenanceMode ?? previous.maintenanceMode,
    ),
    maintenanceMessage,
    supportEmail: normalizeEmail(input.supportEmail ?? previous.supportEmail),
    auditRetentionDays: boundedInteger(
      input.auditRetentionDays ?? previous.auditRetentionDays,
      "Audit retention days",
      30,
      3650,
    ),
  };
}

function applyRuntime(settings) {
  current = settings;
  env.jwt.expiresIn = `${settings.sessionTimeoutMinutes}m`;
}

export async function initializePlatformSettings() {
  const stored = await SystemConfiguration.findOne({ key: SETTINGS_KEY }).lean();
  const settings = stored?.value
    ? normalizePlatformSettings(stored.value, DEFAULTS)
    : { ...DEFAULTS };

  if (!stored) {
    await SystemConfiguration.create({
      key: SETTINGS_KEY,
      value: settings,
      category: "general",
      description: "Validated platform-wide operational settings",
      isSecret: false,
    });
  }

  applyRuntime(settings);
  return { ...settings };
}

export function getPlatformSettings() {
  return { ...current };
}

export async function updatePlatformSettings(input, updatedBy) {
  const settings = normalizePlatformSettings(input, current);
  await SystemConfiguration.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      value: settings,
      category: "general",
      description: "Validated platform-wide operational settings",
      isSecret: false,
      updatedBy,
    },
    { new: true, upsert: true, runValidators: true },
  );
  applyRuntime(settings);
  return { ...settings };
}

/**
 * Outside production the guard stays dormant so a persisted maintenance flag
 * cannot lock a developer out. Set MAINTENANCE_MODE_ENFORCE=true to exercise it.
 * MAINTENANCE_MODE_FORCE_OFF is the production break-glass control: it requires
 * server access and a restart, avoiding an unauthenticated HTTP bypass.
 */
export function isMaintenanceForcedOff() {
  return (
    String(process.env.MAINTENANCE_MODE_FORCE_OFF || "").toLowerCase() === "true"
  );
}

export function isMaintenanceEnforced() {
  if (isMaintenanceForcedOff()) return false;
  if (!env.isDev) return true;
  return (
    String(process.env.MAINTENANCE_MODE_ENFORCE || "").toLowerCase() === "true"
  );
}

export function getMaintenanceState() {
  return {
    enabled: current.maintenanceMode,
    message: current.maintenanceMessage,
    supportEmail: current.supportEmail,
    enforced: current.maintenanceMode && isMaintenanceEnforced(),
    forcedOff: isMaintenanceForcedOff(),
  };
}

export async function purgeExpiredAuditLogs() {
  const cutoff = new Date(
    Date.now() - current.auditRetentionDays * 24 * 60 * 60 * 1000,
  );
  const result = await Audit.deleteMany({ createdAt: { $lt: cutoff } });
  return { deletedCount: result.deletedCount, cutoffDate: cutoff.toISOString() };
}

export function startAuditRetentionScheduler() {
  if (retentionTimer) return retentionTimer;
  const run = () => {
    purgeExpiredAuditLogs().catch((error) => {
      console.error("[audit-retention] cleanup failed:", error.message);
    });
  };
  run();
  retentionTimer = setInterval(run, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();
  return retentionTimer;
}
