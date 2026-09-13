import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../../middleware/auth.js";
import * as auditCtrl from "../../controllers/audit/auditController.js";

const router = Router();

router.get(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_READ),
  auditCtrl.listAuditLogs,
);
router.get(
  "/stats",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_READ),
  auditCtrl.getAuditStats,
);
router.get(
  "/logins",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_LOGIN_READ),
  auditCtrl.getLoginHistory,
);
router.get(
  "/entity/:type/:id",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_ENTITY_READ),
  auditCtrl.getAuditByEntity,
);
router.get(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_ENTRY_READ),
  auditCtrl.getAuditEntry,
);
router.post(
  "/export",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT),
  auditCtrl.exportAuditLog,
);
router.delete(
  "/purge",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_PURGE),
  auditCtrl.purgeAuditLogs,
);

export default router;
