import { Router } from "express";
import { authenticate, authorize, ROLES } from "../middleware/auth.js";
import { blockLegacyRemediationApi } from "../middleware/legacyRemediation.js";
import * as remediation from "../controllers/remediationController.js";
import * as tickets from "../controllers/remediationTicketController.js";
import * as queue from "../controllers/remediationQueueController.js";
import * as validations from "../controllers/remediationValidationController.js";
import * as tracking from "../controllers/remediationTrackingController.js";

const router = Router();

const remediationRead = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);
const remediationWrite = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
);

// ── Public ITSM review portal (token-based) ─────────────────────────────────
router.get("/tickets/:ticketId/review", tickets.getTicketReviewPortal);
router.post("/tickets/:ticketId/review", tickets.submitTicketReviewPortal);

// ── Authenticated remediation APIs ──────────────────────────────────────────
router.use(authenticate);
router.use(blockLegacyRemediationApi);

router.get("/events", remediationRead, remediation.listRemediationEvents);
router.get("/events/:id", remediationRead, remediation.getRemediationEvent);
router.post("/events", remediationWrite, remediation.createRemediationEvent);
router.patch("/events/:id", remediationWrite, remediation.patchRemediationEvent);
router.post("/events/:id/duplicate", remediationWrite, remediation.duplicateRemediationEvent);
router.delete("/events/:id", remediationWrite, remediation.deleteRemediationEvent);

// Legacy campaign revoke flow (preserved)
router.get("/campaigns", remediationRead, remediation.listApplicationCampaigns);
router.get(
  "/campaigns/:campaignId/revoked-users",
  remediationRead,
  remediation.getCampaignRevokedUsers,
);
router.post(
  "/campaigns/:campaignId/import",
  remediationWrite,
  remediation.importCampaignRevokeEvent,
);
router.post(
  "/campaigns/:campaignId/actions",
  remediationWrite,
  remediation.submitCampaignRevokeActions,
);

// ITSM ticket workflow (v2)
router.get("/campaigns-v2", remediationRead, tickets.listCampaignsV2);
router.post("/revoked-users/fetch", remediationRead, tickets.fetchRevokedUsers);
router.get("/tickets", remediationRead, tickets.listTickets);
router.post("/tickets", remediationWrite, tickets.createTicket);
router.get("/tickets/:ticketId", remediationRead, tickets.getTicketDetail);
router.post("/tickets/:ticketId/run", remediationWrite, tickets.runTicketExecution);
router.post(
  "/tickets/:ticketId/responses",
  remediationWrite,
  tickets.submitTicketReviewAuthenticated,
);

// Queue-driven remediation (v3)
router.get("/queue/summary", remediationRead, queue.getQueueSummaryHandler);
router.get("/queue", remediationRead, queue.listQueue);
router.get("/queue/:id", remediationRead, queue.getQueue);
router.get("/queue/:id/items", remediationRead, queue.getQueueItems);
router.post("/queue/:id/create-ticket", remediationWrite, queue.createTicketFromQueue);
router.post("/queue/enqueue", remediationWrite, queue.enqueueManual);
router.post("/queue/sync-revoke-access", remediationWrite, queue.syncRevokeAccessQueues);
router.post("/queue/sync-all", remediationWrite, queue.syncAllQueues);

router.get("/validations", remediationRead, validations.listValidationsHandler);
router.post("/validations/:id/respond", remediationWrite, validations.respondValidation);

router.get("/tracking/:eventId", remediationRead, tracking.getTracking);

export default router;
