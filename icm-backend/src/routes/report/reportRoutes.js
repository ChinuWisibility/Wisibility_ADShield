import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  getGovernanceRiskBandSetting,
  putGovernanceRiskBandSetting,
} from "../../controllers/report/governanceRiskBandController.js";
import {
  getEffectiveReportingRuleSet,
  putApplicationReportingRuleSet,
} from "../../controllers/report/reportingRuleSetController.js";

const router = Router();

router.get("/governance-risk-bands/:applicationId", authenticate, getGovernanceRiskBandSetting);
router.put("/governance-risk-bands/:applicationId", authenticate, putGovernanceRiskBandSetting);
router.get("/reporting-rule-set/:applicationId", authenticate, getEffectiveReportingRuleSet);
router.put("/reporting-rule-set/:applicationId", authenticate, putApplicationReportingRuleSet);

export default router;
