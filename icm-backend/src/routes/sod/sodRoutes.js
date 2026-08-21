import { Router } from "express";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import * as sod from "../../controllers/sod/sodController.js";

const router = Router();

const adminSod = authorize(ROLES.ADMIN, ROLES.SOD_ADMIN);
const adminOnly = authorize(ROLES.ADMIN);
const readPolicies = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
  ROLES.AUDIT_ANALYTICS,
);
const readCert = authorize(
  ROLES.ADMIN,
  ROLES.SOD_ADMIN,
  ROLES.CERT_ADMIN,
  ROLES.MANAGER,
  ROLES.VIEWER,
);

// Policies
router.get("/policies", authenticate, readPolicies, sod.listPolicies);
router.get("/policies/stats", authenticate, sod.getPolicyStats);
router.get("/policies/next-id", authenticate, adminSod, sod.getNextPolicyId);
router.get(
  "/policies/:id/violation-summary",
  authenticate,
  readPolicies,
  sod.getPolicyViolationSummary,
);
router.get("/policies/:id", authenticate, sod.getPolicyById);
router.post("/policies", authenticate, adminSod, sod.createPolicy);
router.put("/policies/:id", authenticate, adminSod, sod.updatePolicy);
router.delete("/policies/:id", authenticate, adminOnly, sod.deletePolicy);
router.post("/policies/:id/clone", authenticate, adminSod, sod.clonePolicy);

// Violations
router.get("/violations", authenticate, readPolicies, sod.listViolations);
router.get("/violations/:id", authenticate, sod.getViolationById);
router.patch(
  "/violations/:id/status",
  authenticate,
  adminSod,
  sod.patchViolationStatus,
);
router.post(
  "/violations/bulk-update",
  authenticate,
  adminSod,
  sod.bulkUpdateViolations,
);

// Exceptions
router.get("/exceptions", authenticate, readPolicies, sod.listExceptions);
router.post("/exceptions", authenticate, adminSod, sod.createException);
router.post(
  "/exceptions/:id/revoke",
  authenticate,
  adminOnly,
  sod.revokeException,
);
router.post(
  "/exceptions/:id/extend",
  authenticate,
  adminSod,
  sod.extendException,
);

// Remediations
router.get("/remediations", authenticate, readPolicies, sod.listRemediations);
router.post("/remediations", authenticate, adminSod, sod.createRemediation);
router.patch("/remediations/:id", authenticate, adminSod, sod.patchRemediation);

// Dashboard
router.get("/dashboard", authenticate, sod.getDashboard);

// Certification helpers
router.get(
  "/certification/applications",
  authenticate,
  readCert,
  sod.getCertificationApplications,
);
router.get(
  "/certification/applications/:appId/policies",
  authenticate,
  readCert,
  sod.getCertificationPoliciesByApp,
);
router.post(
  "/certification/violations",
  authenticate,
  readCert,
  sod.getCertificationViolations,
);
router.get(
  "/certification/managers",
  authenticate,
  authorize(ROLES.ADMIN, ROLES.SOD_ADMIN, ROLES.CERT_ADMIN),
  sod.getCertificationManagers,
);

// Evaluation
router.post("/run-evaluation", authenticate, adminSod, sod.runEvaluation);

// Entitlements for policy builder
router.get(
  "/applications/:appId/entitlements",
  authenticate,
  adminSod,
  sod.getApplicationEntitlementsForSod,
);

// Audit logs
router.get("/audit-logs", authenticate, adminSod, sod.listSodAuditLogs);

router.get("/health", sod.sodHealth);

export default router;
