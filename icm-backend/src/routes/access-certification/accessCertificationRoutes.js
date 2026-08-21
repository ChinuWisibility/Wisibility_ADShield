// ─── routes/access-certification/accessCertificationRoutes.js ────────────────

import express from "express";
import { authenticate } from "../../middleware/auth.js";
import { can, platformOnly, PRESETS } from "../../middleware/auth.js";
import {
  getCertificationData, getAllCampaigns, getCampaignById,
  createCampaign, activateCampaign, deleteCampaigns, backfillAccessContext,
} from "../../controllers/access-certification/campaignController.js";
import {
  getReviewerProgressHandler, updateCampaignReview, bulkOwnerDecision,
  repairCampaignReviewers, applyEntitlementDecisionHandler,
} from "../../controllers/access-certification/reviewerController.js";
import {
  getOrgWideManagers, updateReminderSettings, getReminderSettings, runReminderNow,
  triggerCampaignReminder, getDashboardStats,
  getAutoIdentitySettings, updateAutoIdentitySettings, debugAutoIdentity,
  getAutoPrivilegedSettings, updateAutoPrivilegedSettings, debugAutoPrivileged,
  getApplicationsList,
} from "../../controllers/access-certification/settingsController.js";
import {
  updateOwnerAction,
  ownerFinalizePending,
} from "../../controllers/access-certification/campaignOwnerActionController.js";
import {
  listCertificationProfiles,
  getCertificationProfileById,
  createCertificationProfile,
  updateCertificationProfile,
  archiveCertificationProfile,
} from "../../controllers/access-certification/certificationProfileController.js";
import {
  getCampaignReminders,
  getCampaignReminderLog,
  getCampaignReminderStatus,
} from "../../controllers/access-certification/certificationRemindersController.js";
import {
  getCampaignNotificationSummaryHandler,
  getCampaignNotificationsHandler,
  getNotificationJobLogHandler,
  getEmailQueueStatsHandler,
  getEmailQueueHealthHandler,
  getNotificationDashboardHandler,
  retryNotificationJobHandler,
} from "../../controllers/access-certification/campaignNotificationsController.js";
import TenantConfig from "../../models/platform/TenantConfig.js";
import User from "../../models/platform/User.js";

const router = express.Router();

// ─── Feature-flag gate ───────────────────────────────────────────────────────
// Platform admins are never blocked — only tenant users are feature-gated.
async function requireCertificationFeature(req, res, next) {
  try {
    // Platform plane bypasses feature flags (they control them)
    if (req.plane === "platform") return next();

    const config = await TenantConfig.findOne({
      tenantId: req.scopedTenantId, // already resolved + validated by can()
    }).lean();

    if (config?.features?.certification === false) {
      return res.status(403).json({
        success: false,
        message: "Certification module is not enabled for your tenant",
        code: "FEATURE_DISABLED",
      });
    }
    next();
  } catch {
    next(); // fail-open on config lookup errors
  }
}

// ─── Special case: email-link bulk decision (token-based, registered early) ──
router.post(
  "/campaigns/:id/owner-bulk-decision",
  authenticate,
  can(PRESETS.certWrite),
  bulkOwnerDecision,
);

// ─── Global middlewares ──────────────────────────────────────────────────────
router.use(authenticate);
// NOTE: can() must run before requireCertificationFeature so req.plane is set
router.use(requireCertificationFeature);

// ─── Certification data & org ────────────────────────────────────────────────
router.get("/data/:appId", can(PRESETS.certRead), getCertificationData);
router.get("/managers", can(PRESETS.certRead), getOrgWideManagers);

// ─── Campaigns ───────────────────────────────────────────────────────────────
router.get("/campaigns", can(PRESETS.certRead), getAllCampaigns);
router.get("/campaigns/:id", can(PRESETS.certRead), getCampaignById);
router.get(
  "/campaigns/:id/reviewer-progress",
  can(PRESETS.certRead),
  getReviewerProgressHandler,
);
router.post("/campaigns", can(PRESETS.campaignCreate), createCampaign);
router.post(
  "/campaigns/:id/activate",
  can(PRESETS.certWrite),
  activateCampaign,
);
router.post(
  "/campaigns/:id/repair-reviewers",
  can(PRESETS.certWrite),
  repairCampaignReviewers,
);
router.patch(
  "/campaigns/:id/review",
  can(PRESETS.certWrite),
  updateCampaignReview,
);
router.delete("/campaigns", can(PRESETS.certWrite), deleteCampaigns);
router.post(
  "/campaigns/:id/remind",
  can(PRESETS.certWrite),
  triggerCampaignReminder,
);
router.get(
  "/campaigns/:id/reminders",
  can(PRESETS.certRead),
  getCampaignReminders,
);
router.get(
  "/campaigns/:id/reminder-log",
  can(PRESETS.certRead),
  getCampaignReminderLog,
);
router.get(
  "/campaigns/:id/reminder-status",
  can(PRESETS.certRead),
  getCampaignReminderStatus,
);
router.get(
  "/campaigns/:id/notification-summary",
  can(PRESETS.certRead),
  getCampaignNotificationSummaryHandler,
);
router.get(
  "/campaigns/:id/notifications",
  can(PRESETS.certRead),
  getCampaignNotificationsHandler,
);
router.get(
  "/campaigns/:id/notifications/jobs/:jobId/log",
  can(PRESETS.certRead),
  getNotificationJobLogHandler,
);
router.get(
  "/notifications/queue-stats",
  can(PRESETS.certRead),
  getEmailQueueStatsHandler,
);
router.get(
  "/notifications/health",
  can(PRESETS.certRead),
  getEmailQueueHealthHandler,
);
router.get(
  "/notifications/dashboard",
  can(PRESETS.certRead),
  getNotificationDashboardHandler,
);
router.post(
  "/notifications/:jobId/retry",
  can(PRESETS.certWrite),
  retryNotificationJobHandler,
);
router.post(
  "/campaigns/:id/owner-action",
  can(PRESETS.certWrite),
  updateOwnerAction,
);
router.post(
  "/campaigns/:id/owner-finalize-pending",
  can(PRESETS.certWrite),
  ownerFinalizePending,
);
router.post(
  "/campaigns/backfill-access-context",
  can(PRESETS.certWrite),
  backfillAccessContext,
);

// ─── Certification profiles (Identity, Manager, Access Items) ───────────────
router.get("/profiles", can(PRESETS.certRead), listCertificationProfiles);
router.get("/profiles/:id", can(PRESETS.certRead), getCertificationProfileById);
router.post(
  "/profiles",
  can(PRESETS.settingsManage),
  createCertificationProfile,
);
router.put(
  "/profiles/:id",
  can(PRESETS.settingsManage),
  updateCertificationProfile,
);
router.delete(
  "/profiles/:id",
  can(PRESETS.settingsManage),
  archiveCertificationProfile,
);

// ─── Reminder settings ───────────────────────────────────────────────────────
router.put(
  "/settings/reminders",
  can(PRESETS.settingsManage),
  updateReminderSettings,
);
router.get(
  "/settings/reminders",
  can(PRESETS.settingsManage),
  getReminderSettings,
);
router.post(
  "/settings/reminders/run-now",
  can(PRESETS.settingsManage),
  runReminderNow,
);

// ─── Dashboard ───────────────────────────────────────────────────────────────
router.get("/dashboard", can(PRESETS.certRead), getDashboardStats);

// ─── Auto-identity settings ──────────────────────────────────────────────────
router.get(
  "/settings/auto-identity",
  can(PRESETS.settingsManage),
  getAutoIdentitySettings,
);
router.put(
  "/settings/auto-identity",
  can(PRESETS.settingsManage),
  updateAutoIdentitySettings,
);
router.get(
  "/settings/auto-identity/debug/:appId",
  can(PRESETS.settingsManage),
  debugAutoIdentity,
);

// ─── Auto-privileged settings ────────────────────────────────────────────────
router.get(
  "/settings/auto-privileged",
  can(PRESETS.settingsManage),
  getAutoPrivilegedSettings,
);
router.put(
  "/settings/auto-privileged",
  can(PRESETS.settingsManage),
  updateAutoPrivilegedSettings,
);
router.get(
  "/settings/auto-privileged/debug/:appId",
  can(PRESETS.settingsManage),
  debugAutoPrivileged,
);

// ─── Applications ────────────────────────────────────────────────────────────
router.get("/applications", can(PRESETS.allCertRoles), getApplicationsList);

// ─── Per-entitlement decision (SailPoint-style granular review) ───────────────
router.patch(
  "/campaigns/:campaignId/review-items/:reviewItemId/entitlement",
  authenticate,
  can(PRESETS.certWrite),
  requireCertificationFeature,
  applyEntitlementDecisionHandler,
);

// ─── Platform-only: tenant management (your team only) ───────────────────────
// These routes don't exist in client-facing APIs — only your backend dashboard uses them
router.get(
  "/platform/tenants/:tenantId/campaigns",
  platformOnly,
  getAllCampaigns,
);
router.put(
  "/platform/tenants/:tenantId/features",
  platformOnly,
  async (req, res) => {
    await TenantConfig.findOneAndUpdate(
      { tenantId: req.params.tenantId },
      { $set: { "features.certification": req.body.enabled } },
      { upsert: true, new: true },
    );
    res.json({ success: true });
  },
);

export default router;
