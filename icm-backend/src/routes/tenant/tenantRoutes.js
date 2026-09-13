import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../middleware/auth.js";
import * as tenantCtrl from "../controllers/tenantController.js";

const router = Router();

router.get(
  "/config",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_CONFIG_READ),
  tenantCtrl.getTenantConfig,
);
router.put(
  "/config",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_CONFIG_WRITE),
  tenantCtrl.updateTenantConfig,
);
router.get(
  "/features",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_FEATURES_READ),
  tenantCtrl.getFeatureFlags,
);
router.put(
  "/features",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_FEATURES_WRITE),
  tenantCtrl.updateFeatureFlags,
);
router.get(
  "/licence",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_LICENCE_READ),
  tenantCtrl.getLicenceStatus,
);

// Tenant Management (Multi-tenant Architecture)
router.post(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_MANAGE),
  tenantCtrl.createTenant,
);
router.get(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.TENANT_MANAGE),
  tenantCtrl.getTenants,
);

export default router;
