import { Router } from "express";
import { authenticate, authorize, ROLES } from "../middleware/auth.js";
import * as wf from "../controllers/remediationWorkflowController.js";
import * as orphanPortal from "../controllers/orphanIamPortalController.js";

const router = Router();

// Public IAM orphan review portal (token-based, no login — like cert-review)
router.get("/orphan-iam-portal", orphanPortal.getOrphanIamPortal);
router.post("/orphan-iam-portal/decision", orphanPortal.submitOrphanIamPortalDecision);

const wfRead = authorize(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);
const wfWrite = authorize(
  ROLES.ADMIN,
  ROLES.SUPER_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.SOD_ADMIN,
);

router.use(authenticate);

// Catalog + reference data
router.get("/catalog", wfRead, wf.getCatalog);
router.get("/catalog/step-config", wfRead, wf.getStepConfig);
router.get("/template/cert-revoke", wfRead, wf.getTemplate);
router.get("/samples/triggers", wfRead, wf.getSampleTriggers);
router.get("/runs/:runId", wfRead, wf.getRun);

// Task execution tracking
router.get("/tasks", wfRead, wf.listTasks);

// Orphan account IAM workflow trigger
router.post("/orphan-accounts/:id/trigger-iam-workflow", wfWrite, wf.triggerIAMOrphanWorkflow);
router.post("/orphan-accounts/:id/iam-decision", wfWrite, wf.recordOrphanIamDecision);

// Remediation executions (dashboard)
router.get("/executions", wfRead, wf.listExecutions);
router.get("/executions/:executionId/nodes", wfRead, wf.getExecutionNodes);
router.get("/executions/:executionId", wfRead, wf.getExecution);

// Static workflow subpaths (registered before /workflows/:id)
router.get("/workflows/enabled", wfRead, wf.listEnabledWorkflows);
router.get("/workflow-templates", wfRead, wf.listWorkflowTemplates);
router.post("/workflow-templates/:templateId/use", wfWrite, wf.useWorkflowTemplate);
router.post("/workflows/validate-definition", wfWrite, wf.validateDefinitionHandler);
router.post("/workflows/test-definition", wfWrite, wf.testDefinitionHandler);
router.post("/workflows/seed-template", wfWrite, wf.seedTemplateHandler);
router.post("/workflows/seed-iam-orphan-template", wfWrite, wf.seedIAMOrphanTemplateHandler);
router.post(
  "/workflows/seed-access-revoke-dual-notify-template",
  wfWrite,
  wf.seedAccessRevokeDualNotifyTemplateHandler,
);

router.get("/workflows", wfRead, wf.listWorkflows);
router.post("/workflows", wfWrite, wf.createWorkflowHandler);

router.get("/workflows/:id", wfRead, wf.getWorkflow);
router.put("/workflows/:id", wfWrite, wf.updateWorkflowHandler);
router.delete("/workflows/:id", wfWrite, wf.deleteWorkflowHandler);
router.get("/workflows/:id/runs", wfRead, wf.getWorkflowRuns);
router.post("/workflows/:id/validate", wfWrite, wf.validateWorkflowHandler);
router.post("/workflows/:id/test", wfWrite, wf.testWorkflowHandler);

export default router;
