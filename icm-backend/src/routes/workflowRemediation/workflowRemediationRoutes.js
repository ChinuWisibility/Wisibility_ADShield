import { Router } from "express";
import { authenticate, authorize, ROLES } from "../middleware/auth.js";
import * as wr from "../controllers/workflowRemediationController.js";

const router = Router();

const wrRead = authorize(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);
const wrWrite = authorize(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.SOD_ADMIN,
);

router.use(authenticate);
// WRQ remains the SoD / certification remediation intake until those event types
// are migrated onto /api/workflow-task-queue. Do not gate with blockLegacyRemediationApi.

router.get("/summary", wrRead, wr.getSummary);
router.get("/workflows", wrRead, wr.getWorkflowsHandler);
router.get("/open-event", wrRead, wr.getOpenEventHandler);
router.get("/column-config/:eventType", wrRead, wr.getColumnConfigHandler);
router.get("/events", wrRead, wr.listEventsHandler);
router.post("/events", wrWrite, wr.createEventHandler);
router.post("/check-queued", wrRead, wr.checkQueuedHandler);
router.post("/manual-enqueue", wrWrite, wr.manualEnqueueHandler);
router.post("/events/enqueue", wrWrite, wr.enqueueManualHandler);
router.get("/events/:eventId", wrRead, wr.getEventHandler);
router.get("/events/:eventId/items", wrRead, wr.listEventItemsHandler);
router.post("/events/:eventId/ticket", wrWrite, wr.createTicketHandler);
router.post("/events/:eventId/trigger", wrWrite, wr.triggerWorkflowHandler);
router.post("/events/:eventId/launch-immediately", wrWrite, wr.immediatelyLaunchHandler);

export default router;
