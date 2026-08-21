import { Router } from "express";
import { authenticate, authorize, ROLES } from "../middleware/auth.js";
import * as ctrl from "../controllers/workflowTaskQueueController.js";

const router = Router();

const remediationRead = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);

router.use(authenticate);

const remediationWrite = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
);

router.get("/tasks", remediationRead, ctrl.listWorkflowTasks);
router.get("/tasks/summary", remediationRead, ctrl.getWorkflowTaskSummary);
router.get("/tasks/:taskId", remediationRead, ctrl.getWorkflowTask);
router.get("/iam-orphan-review/check", remediationRead, ctrl.checkIamOrphanQueued);
router.post("/iam-orphan-review", remediationWrite, ctrl.enqueueIamOrphanReview);
router.post("/access-revoke", remediationWrite, ctrl.enqueueAccessRevoke);
router.post("/tasks/:taskId/launch-immediately", remediationWrite, ctrl.immediatelyLaunchTaskHandler);
router.post("/tasks/:taskId/retry-notifications", remediationWrite, ctrl.retryFailedNotificationsHandler);
router.post("/tasks/:taskId/mark-complete", remediationWrite, ctrl.markTaskCompleteHandler);
router.post("/tasks/:taskId/cancel", remediationWrite, ctrl.cancelWorkflowTaskHandler);

export default router;
