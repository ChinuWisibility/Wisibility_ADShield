import mongoose from "mongoose";
import EmailReminderSettings from "../../models/certification/EmailReminderSettings.js";
import { resolveCampaignTenantId } from "./campaignReminderLogService.js";

export const DEFAULT_TENANT_REMINDER_SETTINGS = {
  frequency: "WEEKLY",
  isActive: true,
};

/**
 * Tenant-level reminder settings (campaignId: null).
 */
export async function loadTenantReminderSettings(tenantId) {
  if (!tenantId) {
    return loadLegacyGlobalReminderSettings();
  }

  const tid =
    tenantId instanceof mongoose.Types.ObjectId
      ? tenantId
      : new mongoose.Types.ObjectId(String(tenantId));

  const doc = await EmailReminderSettings.findOne({
    campaignId: null,
    tenantId: tid,
  }).lean();

  if (doc) return doc;

  return { ...DEFAULT_TENANT_REMINDER_SETTINGS, tenantId: tid };
}

/** Pre-tenant docs: campaignId null without tenantId (deprecated). */
async function loadLegacyGlobalReminderSettings() {
  const legacy = await EmailReminderSettings.findOne({
    campaignId: null,
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  }).lean();
  return legacy || { ...DEFAULT_TENANT_REMINDER_SETTINGS };
}

/**
 * Resolve tenant reminder settings for a campaign (cached per scheduler run).
 */
export async function resolveReminderSettingsForCampaign(campaign, cache = new Map()) {
  let tenantId = campaign?.tenantId ?? null;
  if (!tenantId && campaign?._id) {
    tenantId = await resolveCampaignTenantId(campaign._id);
  }

  const cacheKey = tenantId ? String(tenantId) : "__legacy__";
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const settings = tenantId
    ? await loadTenantReminderSettings(tenantId)
    : await loadLegacyGlobalReminderSettings();

  cache.set(cacheKey, settings);
  return settings;
}
