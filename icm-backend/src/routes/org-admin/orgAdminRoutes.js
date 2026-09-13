import { Router } from 'express';
import {
  authenticate,
  orgAdminOnly,
  requirePermission,
  PERMISSIONS,
} from '../middleware/auth.js';
import * as identityPostureRulesCtrl from '../controllers/identity/identityPostureRulesController.js';
import * as reportingRuleSetCtrl from '../controllers/report/reportingRuleSetController.js';
import * as uncorrelatedTrustMappingCtrl from '../controllers/datahygine/uncorrelatedTrustMappingController.js';
import * as workflowTaskQueueCtrl from '../controllers/workflowTaskQueueController.js';
import schedulerRoutes from './org-admin/scheduler.routes.js';

const router = Router();

router.use(authenticate, orgAdminOnly);

router.get(
  '/identity-posture-rules',
  requirePermission(PERMISSIONS.IDENTITY_POSTURE_RULES_MANAGE),
  identityPostureRulesCtrl.getIdentityPostureRules,
);

router.put(
  '/identity-posture-rules',
  requirePermission(PERMISSIONS.IDENTITY_POSTURE_RULES_MANAGE),
  identityPostureRulesCtrl.putIdentityPostureRules,
);

router.delete(
  '/identity-posture-rules',
  requirePermission(PERMISSIONS.IDENTITY_POSTURE_RULES_MANAGE),
  identityPostureRulesCtrl.deleteIdentityPostureRules,
);

router.post(
  '/identity-posture-rules/preview',
  requirePermission(PERMISSIONS.IDENTITY_POSTURE_RULES_MANAGE),
  identityPostureRulesCtrl.previewIdentityPostureRules,
);

router.get(
  '/reporting-rule-set',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  reportingRuleSetCtrl.getTenantReportingRuleSet,
);

router.put(
  '/reporting-rule-set',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  reportingRuleSetCtrl.putTenantReportingRuleSet,
);

router.delete(
  '/reporting-rule-set',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  reportingRuleSetCtrl.deleteTenantReportingRuleSet,
);

router.get(
  '/reporting-rule-set/risk-bands/:metricKey',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  reportingRuleSetCtrl.getTenantRiskBand,
);

router.put(
  '/reporting-rule-set/risk-bands/:metricKey',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  reportingRuleSetCtrl.putTenantRiskBand,
);

router.get(
  '/uncorrelated-trust-mapping',
  requirePermission(PERMISSIONS.UNCORRELATED_TRUST_MAPPING_MANAGE),
  uncorrelatedTrustMappingCtrl.getUncorrelatedTrustMapping,
);

router.put(
  '/uncorrelated-trust-mapping',
  requirePermission(PERMISSIONS.UNCORRELATED_TRUST_MAPPING_MANAGE),
  uncorrelatedTrustMappingCtrl.putUncorrelatedTrustMapping,
);

router.delete(
  '/uncorrelated-trust-mapping',
  requirePermission(PERMISSIONS.UNCORRELATED_TRUST_MAPPING_MANAGE),
  uncorrelatedTrustMappingCtrl.deleteUncorrelatedTrustMapping,
);

router.get(
  '/remediation-workflow-rules',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  workflowTaskQueueCtrl.getRemediationWorkflowRules,
);

router.put(
  '/remediation-workflow-rules',
  requirePermission(PERMISSIONS.REPORTING_RULE_SET_MANAGE),
  workflowTaskQueueCtrl.putRemediationWorkflowRules,
);

router.use('/scheduler', schedulerRoutes);

export default router;
