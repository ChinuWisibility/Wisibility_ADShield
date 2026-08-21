import { Router } from "express";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import Campaign from "../../models/certification/Campaign.js";
import CertificationReport from "../../models/certification/CertificationReport.js";
import CertificationSchedule from "../../models/certification/CertificationSchedule.js";
import CertificationEscalation from "../../models/certification/CertificationEscalation.js";
import CertificationSignOff from "../../models/certification/CertificationSignOff.js";
import { createCrudController } from "../../utils/crudFactory.js";
import {
  getCertificationData, getAllCampaigns, getCampaignById,
  createCampaign, activateCampaign, deleteCampaigns, backfillAccessContext,
} from "../../controllers/access-certification/campaignController.js";
import {
  updateCampaignReview, bulkOwnerDecision, getCampaignReviewerProgress,
} from "../../controllers/access-certification/reviewerController.js";
import {
  triggerCampaignReminder, updateReminderSettings, getReminderSettings,
  runReminderNow, getDashboardStats,
} from "../../controllers/access-certification/settingsController.js";
import {
  updateOwnerAction,
  ownerFinalizePending,
} from "../../controllers/access-certification/campaignOwnerActionController.js";
import { getCertificationISOReport } from "../../controllers/access-certification/certificationISOReportController.js";
import {
  enableRecurring,
  getCampaignProgress,
  closeCampaign,
  exportCampaignData,
  getCampaignResults,
  getResultDetail,
  overrideDecision,
  markProvisioned,
  getPendingProvisioning,
} from "../../controllers/access-certification/certificationResultsController.js";
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
import {
  getReviewSession,
  postReviewDecision,
  postReviewBulkDecision,
  postEntitlementDecision,
  postBulkEntitlementDecision,
} from "../../controllers/reviewPortalController.js";
import {
  pauseSchedule,
  resumeSchedule,
  runScheduleNow,
  getScheduleHistory,
  generateCampaignReport,
  listCampaignReports,
  downloadReport,
  triggerEscalation,
  resolveEscalation,
  configureAutoEscalation,
} from "../../controllers/access-certification/certificationScheduleReportEscalationController.js";
import {
  requestSignOff,
  submitSignOff,
  getSignOffStatus,
  verifySignature,
} from "../../controllers/access-certification/certificationSignOffController.js";
import {
  completeCampaign,
  listCampaignItems,
  decideItem,
  bulkDecideItems,
} from "../../controllers/access-certification/certificationWorkflowController.js";

const router = Router();
const campaignCtrl = createCrudController(Campaign, {
  searchFields: ["name", "description", "reviewerName"],
});
const reportCtrl = createCrudController(CertificationReport, {
  searchFields: ["reportType", "format", "fileLocation"],
});
const scheduleCtrl = createCrudController(CertificationSchedule, {
  searchFields: ["scheduleName", "frequency", "recurrenceRule"],
});
const escalationCtrl = createCrudController(CertificationEscalation, {
  searchFields: ["originalReviewerId", "escalatedToId", "escalationReason"],
});
const signOffCtrl = createCrudController(CertificationSignOff, {
  searchFields: ["signerName", "signerEmail", "signatureHash"],
});

// Campaigns
router.get(
  "/campaigns",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.MANAGER, ROLES.VIEWER),
  getAllCampaigns,
);
router.get("/campaigns/stats", authenticate, async (req, res, next) => {
  try {
    const tenantFilter =
      req.user?.role === "superAdmin" ||
      (req.user?.role === "admin" && !req.user?.tenantId)
        ? {}
        : { tenantId: req.user?.tenantId || null };

    const [total, active, completed, overdue, byStatus] = await Promise.all([
      Campaign.countDocuments(tenantFilter),
      Campaign.countDocuments({
        ...tenantFilter,
        status: { $in: ["Active", "DecisionPending"] },
      }),
      Campaign.countDocuments({ ...tenantFilter, status: "Completed" }),
      Campaign.countDocuments({ ...tenantFilter, status: "Closed" }),
      Campaign.aggregate([
        { $match: tenantFilter },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
    ]);
    const avgCompletion = await Campaign.aggregate([
      { $match: { ...tenantFilter, status: { $ne: "Draft" } } },
      { $group: { _id: null, avg: { $avg: "$completionPercentage" } } },
    ]);
    res.json({
      success: true,
      data: {
        total,
        active,
        completed,
        overdue,
        byStatus,
        avgCompletion: avgCompletion[0]?.avg || 0,
      },
    });
  } catch (err) {
    next(err);
  }
});
// Must be before /campaigns/:id to avoid route shadowing
router.get(
  "/campaigns/iso-report",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.AUDIT_ANALYTICS, ROLES.VIEWER),
  getCertificationISOReport,
);
router.get(
  "/campaigns/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.MANAGER, ROLES.VIEWER),
  getCampaignById,
);
router.get(
  "/campaigns/:id/reviewer-progress",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.MANAGER, ROLES.VIEWER),
  getCampaignReviewerProgress,
);
router.post(
  "/campaigns",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  createCampaign,
);
router.patch(
  "/campaigns/:id/review",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  updateCampaignReview,
);
// Bulk cleanup (draft/completed)
router.delete(
  "/campaigns",
  authenticate,
  authorize(ROLES.ADMIN),
  deleteCampaigns,
);
router.put(
  "/campaigns/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  campaignCtrl.update,
);
router.delete(
  "/campaigns/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  campaignCtrl.remove,
);

// Cert wizard data loader
router.get(
  "/data/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCertificationData,
);

// Executive overview stats
router.get(
  "/dashboard",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.MANAGER, ROLES.VIEWER),
  getDashboardStats,
);

// Owner decisions (bulk + single)
router.post(
  "/campaigns/:id/owner-bulk-decision",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  bulkOwnerDecision,
);
router.post(
  "/campaigns/:id/owner-action",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  updateOwnerAction,
);
router.post(
  "/campaigns/:id/owner-finalize-pending",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  ownerFinalizePending,
);

// Data enrichment for legacy campaigns
router.post(
  "/campaigns/:id/backfill",
  authenticate,
  authorize(ROLES.ADMIN),
  backfillAccessContext,
);

// Manual reminder trigger
router.post(
  "/campaigns/:id/remind",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  triggerCampaignReminder,
);

// Global reminder settings
router.put(
  "/settings/reminders",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  updateReminderSettings,
);
router.get(
  "/settings/reminders",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getReminderSettings,
);
router.post(
  "/settings/reminders/run-now",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  runReminderNow,
);

// Per-campaign reminder configuration and logs
router.get(
  "/campaigns/:id/reminders",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignReminders,
);
router.get(
  "/campaigns/:id/reminder-log",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignReminderLog,
);
router.get(
  "/campaigns/:id/reminder-status",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignReminderStatus,
);
router.get(
  "/campaigns/:id/notification-summary",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignNotificationSummaryHandler,
);
router.get(
  "/campaigns/:id/notifications",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignNotificationsHandler,
);
router.get(
  "/campaigns/:id/notifications/jobs/:jobId/log",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getNotificationJobLogHandler,
);
router.get(
  "/notifications/queue-stats",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getEmailQueueStatsHandler,
);
router.get(
  "/notifications/health",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getEmailQueueHealthHandler,
);
router.get(
  "/notifications/dashboard",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getNotificationDashboardHandler,
);
router.post(
  "/notifications/:jobId/retry",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  retryNotificationJobHandler,
);

// Recurring + progress + closure + exports
router.put(
  "/campaigns/:id/recurring",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  enableRecurring,
);
router.get(
  "/campaigns/:id/progress",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignProgress,
);
router.put(
  "/campaigns/:id/close",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  closeCampaign,
);
router.get(
  "/campaigns/:id/export",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.AUDIT_ANALYTICS),
  exportCampaignData,
);

// Results + overrides + provisioning
router.get(
  "/campaigns/:id/results",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getCampaignResults,
);
router.get(
  "/results/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  getResultDetail,
);
router.put(
  "/results/:id/override",
  authenticate,
  authorize(ROLES.ADMIN),
  overrideDecision,
);
router.put(
  "/results/:id/provisioned",
  authenticate,
  authorize(ROLES.ADMIN),
  markProvisioned,
);
router.get(
  "/results/pending-provisioning",
  authenticate,
  authorize(ROLES.ADMIN),
  getPendingProvisioning,
);

// Public review portal (JWT in query/body only)
router.get("/review", getReviewSession);
router.post("/decision", postReviewDecision);
router.post("/bulk-decision", postReviewBulkDecision);
router.post("/entitlement-decision", postEntitlementDecision);
router.post("/bulk-entitlement-decision", postBulkEntitlementDecision);

// Schedule management (custom actions)
router.put(
  "/schedules/:id/pause",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  pauseSchedule,
);
router.put(
  "/schedules/:id/resume",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  resumeSchedule,
);
router.post(
  "/schedules/:id/run",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  runScheduleNow,
);
router.get(
  "/schedules/:id/history",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  getScheduleHistory,
);

// Report generation/list/download (custom actions)
router.post(
  "/campaigns/:id/report",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.AUDIT_ANALYTICS),
  generateCampaignReport,
);
router.get(
  "/campaigns/:id/reports",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.AUDIT_ANALYTICS),
  listCampaignReports,
);
router.get(
  "/reports/:id/download",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN, ROLES.AUDIT_ANALYTICS),
  downloadReport,
);

// Escalations (custom actions)
router.post(
  "/campaigns/:id/escalate",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  triggerEscalation,
);
router.put(
  "/escalations/:id/resolve",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  resolveEscalation,
);
router.put(
  "/campaigns/:id/escalation-config",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  configureAutoEscalation,
);

// Sign-off flow (request -> submit -> status -> verify)
router.post(
  "/campaigns/:id/sign-off",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  requestSignOff,
);
router.put(
  "/campaigns/:id/sign-off",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SUPER_ADMIN),
  submitSignOff,
);
router.get(
  "/campaigns/:id/sign-off",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.AUDIT_ANALYTICS),
  getSignOffStatus,
);
router.post(
  "/sign-off/:id/verify",
  authenticate,
  authorize(ROLES.AUDIT_ANALYTICS),
  verifySignature,
);

// Activate campaign (Staged → Active, sends assignment emails)
router.post(
  "/campaigns/:id/activate",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  activateCampaign,
);

// Complete campaign
router.post(
  "/campaigns/:id/complete",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  completeCampaign,
);


// Certification results (review items)
router.get("/campaigns/:id/items", authenticate, listCampaignItems);

// Make decision
router.put(
  "/items/:id/decide",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  decideItem,
);

// Bulk decision
router.post(
  "/campaigns/:id/bulk-decide",
  authenticate,
  authorize(ROLES.MANAGER, ROLES.CERT_ADMIN),
  bulkDecideItems,
);

// Reports
router.get("/reports", authenticate, reportCtrl.list);
router.get("/reports/:id", authenticate, reportCtrl.getById);
router.post(
  "/reports",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  reportCtrl.create,
);
router.put(
  "/reports/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  reportCtrl.update,
);
router.delete(
  "/reports/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  reportCtrl.remove,
);

// Schedules
router.get("/schedules", authenticate, scheduleCtrl.list);
router.get("/schedules/:id", authenticate, scheduleCtrl.getById);
router.post(
  "/schedules",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  scheduleCtrl.create,
);
router.put(
  "/schedules/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  scheduleCtrl.update,
);
router.delete(
  "/schedules/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  scheduleCtrl.remove,
);

// Escalations
router.get("/escalations", authenticate, escalationCtrl.list);
router.get("/escalations/:id", authenticate, escalationCtrl.getById);
router.post(
  "/escalations",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  escalationCtrl.create,
);
router.put(
  "/escalations/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  escalationCtrl.update,
);
router.delete(
  "/escalations/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  escalationCtrl.remove,
);

// Sign-offs
router.get("/signoffs", authenticate, signOffCtrl.list);
router.get("/signoffs/:id", authenticate, signOffCtrl.getById);
router.post(
  "/signoffs",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  signOffCtrl.create,
);
router.put(
  "/signoffs/:id",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.CERT_ADMIN),
  signOffCtrl.update,
);
router.delete(
  "/signoffs/:id",
  authenticate,
  authorize(ROLES.ADMIN),
  signOffCtrl.remove,
);

export default router;
