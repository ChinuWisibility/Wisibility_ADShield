import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getApplicationSecurityFindings,
  getApplicationSecurityOverview,
  getApplicationSecurityScan,
  listApplicationSecurityScans,
  compareApplicationSecurityScans,
  deleteApplicationSecurityScan,
  runApplicationSecurityScan,
  getApplicationSecurityRemediationSummary,
  getSecurityRemediationApplicationsSummary,
  listApplicationAssessments,
  createApplicationAssessment,
  getApplicationAssessment,
  patchApplicationAssessment,
  attachOrphanScansToApplicationAssessment,
  listApplicationAssessmentVersions,
  getApplicationAssessmentVersion,
  getApplicationAssessmentVersionConfig,
  migrateApplicationAssessmentLegacyVersions,
  getApplicationAssessmentWorkingConfiguration,
  putApplicationAssessmentWorkingConfiguration,
  upsertApplicationAssessmentWorkingFeature,
  resetApplicationAssessmentWorkingConfiguration,
  cloneApplicationAssessmentVersionToWorking,
  executeApplicationAssessment,
} from "../controllers/securityController.js";
import {
  validateSecurityLdapQuery,
  getApplicationFeatureConfig,
  upsertApplicationFeatureConfig,
  testApplicationSecurityQuery,
} from "../controllers/securityQueryController.js";
import {
  listSecurityPolicies,
  listPolicyConditions,
  getSecurityPolicy,
  createSecurityPolicyHandler,
  updateSecurityPolicyHandler,
  cloneSecurityPolicyHandler,
  deleteSecurityPolicyHandler,
} from "../controllers/securityPolicyController.js";

const router = Router();

router.post("/query/validate", authenticate, validateSecurityLdapQuery);

router.get("/policies/conditions", authenticate, listPolicyConditions);
router.get("/policies", authenticate, listSecurityPolicies);
router.get("/policies/:policyId", authenticate, getSecurityPolicy);
router.post("/policies", authenticate, createSecurityPolicyHandler);
router.put("/policies/:policyId", authenticate, updateSecurityPolicyHandler);
router.post("/policies/:policyId/clone", authenticate, cloneSecurityPolicyHandler);
router.delete("/policies/:policyId", authenticate, deleteSecurityPolicyHandler);

router.get(
  "/remediation/applications-summary",
  authenticate,
  getSecurityRemediationApplicationsSummary,
);
router.get(
  "/applications/:applicationId/overview",
  authenticate,
  getApplicationSecurityOverview,
);
router.get(
  "/applications/:applicationId/remediation-summary",
  authenticate,
  getApplicationSecurityRemediationSummary,
);
router.get(
  "/applications/:applicationId/findings",
  authenticate,
  getApplicationSecurityFindings,
);

router.get(
  "/applications/:applicationId/assessments",
  authenticate,
  listApplicationAssessments,
);
router.post(
  "/applications/:applicationId/assessments",
  authenticate,
  createApplicationAssessment,
);
router.get(
  "/applications/:applicationId/assessments/:assessmentId",
  authenticate,
  getApplicationAssessment,
);
router.patch(
  "/applications/:applicationId/assessments/:assessmentId",
  authenticate,
  patchApplicationAssessment,
);
router.post(
  "/applications/:applicationId/assessments/:assessmentId/attach-orphan-scans",
  authenticate,
  attachOrphanScansToApplicationAssessment,
);
router.post(
  "/applications/:applicationId/assessments/:assessmentId/migrate-legacy-versions",
  authenticate,
  migrateApplicationAssessmentLegacyVersions,
);
router.post(
  "/applications/:applicationId/assessments/:assessmentId/execute",
  authenticate,
  executeApplicationAssessment,
);

router.get(
  "/applications/:applicationId/assessments/:assessmentId/working-configuration",
  authenticate,
  getApplicationAssessmentWorkingConfiguration,
);
router.put(
  "/applications/:applicationId/assessments/:assessmentId/working-configuration",
  authenticate,
  putApplicationAssessmentWorkingConfiguration,
);
router.put(
  "/applications/:applicationId/assessments/:assessmentId/working-configuration/features/:featureKey",
  authenticate,
  upsertApplicationAssessmentWorkingFeature,
);
router.post(
  "/applications/:applicationId/assessments/:assessmentId/working-configuration/reset",
  authenticate,
  resetApplicationAssessmentWorkingConfiguration,
);

router.get(
  "/applications/:applicationId/assessments/:assessmentId/versions",
  authenticate,
  listApplicationAssessmentVersions,
);
router.get(
  "/applications/:applicationId/assessments/:assessmentId/versions/:versionId",
  authenticate,
  getApplicationAssessmentVersion,
);
router.get(
  "/applications/:applicationId/assessments/:assessmentId/versions/:versionId/config",
  authenticate,
  getApplicationAssessmentVersionConfig,
);
router.post(
  "/applications/:applicationId/assessments/:assessmentId/versions/:versionId/clone-to-working",
  authenticate,
  cloneApplicationAssessmentVersionToWorking,
);

router.get(
  "/applications/:applicationId/scans",
  authenticate,
  listApplicationSecurityScans,
);
router.get(
  "/applications/:applicationId/scans/compare",
  authenticate,
  compareApplicationSecurityScans,
);
router.get(
  "/applications/:applicationId/scans/:scanId",
  authenticate,
  getApplicationSecurityScan,
);
router.delete(
  "/applications/:applicationId/scans/:scanId",
  authenticate,
  deleteApplicationSecurityScan,
);
router.post(
  "/applications/:applicationId/scans/run",
  authenticate,
  runApplicationSecurityScan,
);
router.get(
  "/applications/:applicationId/feature-config",
  authenticate,
  getApplicationFeatureConfig,
);
router.put(
  "/applications/:applicationId/feature-config/:featureKey",
  authenticate,
  upsertApplicationFeatureConfig,
);
router.post(
  "/applications/:applicationId/query/test",
  authenticate,
  testApplicationSecurityQuery,
);

export default router;
