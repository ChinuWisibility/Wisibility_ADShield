import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../middleware/auth.js";
import { createCrudController } from "../utils/crudFactory.js";
import PolicyException from "../models/governance/PolicyException.js";
import RiskMatrix from "../models/governance/RiskMatrix.js";
import AuditComment from "../models/governance/AuditComment.js";
import DataRetentionPolicy from "../models/governance/DataRetentionPolicy.js";
import GovernancePolicy from "../models/governance/GovernancePolicy.js";

const router = Router();

const exceptionCtrl = createCrudController(PolicyException, {
  searchFields: ["policyType", "exceptionReason", "status"],
});
const riskMatrixCtrl = createCrudController(RiskMatrix, {
  searchFields: ["matrixName"],
});
const commentCtrl = createCrudController(AuditComment, {
  searchFields: ["entityType", "comment"],
});
const retentionCtrl = createCrudController(DataRetentionPolicy, {
  searchFields: ["collectionName", "regulatoryBasis"],
});
const policyCtrl = createCrudController(GovernancePolicy, {
  searchFields: ["policyName", "policyType", "owner"],
});

router.get(
  "/policy-exceptions",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  exceptionCtrl.list,
);
router.get(
  "/policy-exceptions/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  exceptionCtrl.getById,
);
router.post(
  "/policy-exceptions",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  exceptionCtrl.create,
);
router.put(
  "/policy-exceptions/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  exceptionCtrl.update,
);
router.delete(
  "/policy-exceptions/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  exceptionCtrl.remove,
);

router.get(
  "/risk-matrices",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  riskMatrixCtrl.list,
);
router.get(
  "/risk-matrices/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  riskMatrixCtrl.getById,
);
router.post(
  "/risk-matrices",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  riskMatrixCtrl.create,
);
router.put(
  "/risk-matrices/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  riskMatrixCtrl.update,
);
router.delete(
  "/risk-matrices/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  riskMatrixCtrl.remove,
);

// Audit comments (Medium)
router.get(
  "/audit-comments",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  commentCtrl.list,
);
router.get(
  "/audit-comments/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  commentCtrl.getById,
);
router.post(
  "/audit-comments",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  commentCtrl.create,
);
router.put(
  "/audit-comments/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  commentCtrl.update,
);
router.delete(
  "/audit-comments/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  commentCtrl.remove,
);

// Data retention policies (Medium)
router.get(
  "/data-retention",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  retentionCtrl.list,
);
router.get(
  "/data-retention/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  retentionCtrl.getById,
);
router.post(
  "/data-retention",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  retentionCtrl.create,
);
router.put(
  "/data-retention/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  retentionCtrl.update,
);
router.delete(
  "/data-retention/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  retentionCtrl.remove,
);

// Governance policies (Medium)
router.get(
  "/policies",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  policyCtrl.list,
);
router.get(
  "/policies/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  policyCtrl.getById,
);
router.post(
  "/policies",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  policyCtrl.create,
);
router.put(
  "/policies/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  policyCtrl.update,
);
router.delete(
  "/policies/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  policyCtrl.remove,
);

export default router;
