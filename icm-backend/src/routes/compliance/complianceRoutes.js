import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../../middleware/auth.js";
import { createCrudController } from "../../utils/crudFactory.js";
import UnifiedAuditEvent from "../../models/compliance/UnifiedAuditEvent.js";
import ComplianceFramework from "../../models/compliance/ComplianceFramework.js";
import ComplianceMapping from "../../models/compliance/ComplianceMapping.js";
import ReportDefinition from "../../models/compliance/ReportDefinition.js";
import ReportHistory from "../../models/compliance/ReportHistory.js";
import ComplianceEvidence from "../../models/compliance/ComplianceEvidence.js";
import TaskExecution from "../../models/compliance/TaskExecution.js";
import {
  listFrameworks,
  getFrameworkById,
  createFramework,
  getFrameworkCoverage,
} from "../../controllers/compliance/complianceFrameworkController.js";

const router = Router();

const auditEventCtrl = createCrudController(UnifiedAuditEvent, {
  searchFields: [
    "eventType",
    "entityType",
    "entityId",
    "action",
    "performedByEmail",
    "sourceDomain",
    "correlationId",
  ],
});
const frameworkCtrl = createCrudController(ComplianceFramework, {
  searchFields: ["frameworkName", "frameworkVersion"],
});
const mappingCtrl = createCrudController(ComplianceMapping, {
  searchFields: ["controlId", "entityType", "mappingNotes"],
});
const reportDefCtrl = createCrudController(ReportDefinition, {
  searchFields: ["reportName", "reportType"],
});
const reportHistCtrl = createCrudController(ReportHistory, {
  searchFields: ["status", "generatedBy", "fileLocation"],
});
const evidenceCtrl = createCrudController(ComplianceEvidence, {
  searchFields: ["controlId", "evidenceType", "status"],
});
const taskExecCtrl = createCrudController(TaskExecution, {
  searchFields: ["taskName", "taskType", "status", "lockedBy"],
});

// Unified audit events
router.get(
  "/audit-events",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  auditEventCtrl.list,
);
router.get(
  "/audit-events/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  auditEventCtrl.getById,
);
router.post(
  "/audit-events",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  auditEventCtrl.create,
);
router.put(
  "/audit-events/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  auditEventCtrl.update,
);
router.delete(
  "/audit-events/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  auditEventCtrl.remove,
);

// Frameworks
router.get(
  "/frameworks",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  listFrameworks,
);
router.get(
  "/frameworks/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  getFrameworkById,
);
router.post(
  "/frameworks",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  createFramework,
);
router.get(
  "/frameworks/:id/coverage",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  getFrameworkCoverage,
);
router.put(
  "/frameworks/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  frameworkCtrl.update,
);
router.delete(
  "/frameworks/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  frameworkCtrl.remove,
);

// Mappings
router.get(
  "/mappings",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  mappingCtrl.list,
);
router.get(
  "/mappings/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  mappingCtrl.getById,
);
router.post(
  "/mappings",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  mappingCtrl.create,
);
router.put(
  "/mappings/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  mappingCtrl.update,
);
router.delete(
  "/mappings/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  mappingCtrl.remove,
);

// Report definitions
router.get(
  "/report-definitions",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  reportDefCtrl.list,
);
router.get(
  "/report-definitions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  reportDefCtrl.getById,
);
router.post(
  "/report-definitions",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportDefCtrl.create,
);
router.put(
  "/report-definitions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportDefCtrl.update,
);
router.delete(
  "/report-definitions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportDefCtrl.remove,
);

// Report history
router.get(
  "/report-history",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  reportHistCtrl.list,
);
router.get(
  "/report-history/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  reportHistCtrl.getById,
);
router.post(
  "/report-history",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportHistCtrl.create,
);
router.put(
  "/report-history/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportHistCtrl.update,
);
router.delete(
  "/report-history/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  reportHistCtrl.remove,
);

// Evidence
router.get(
  "/evidence",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  evidenceCtrl.list,
);
router.get(
  "/evidence/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  evidenceCtrl.getById,
);
router.post(
  "/evidence",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  evidenceCtrl.create,
);
router.put(
  "/evidence/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  evidenceCtrl.update,
);
router.delete(
  "/evidence/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  evidenceCtrl.remove,
);

// Task executions (Medium)
router.get(
  "/task-executions",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  taskExecCtrl.list,
);
router.get(
  "/task-executions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_READ),
  taskExecCtrl.getById,
);
router.post(
  "/task-executions",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  taskExecCtrl.create,
);
router.put(
  "/task-executions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  taskExecCtrl.update,
);
router.delete(
  "/task-executions/:id",
  authenticate,
  requirePermission(PERMISSIONS.COMPLIANCE_WRITE),
  taskExecCtrl.remove,
);

export default router;
