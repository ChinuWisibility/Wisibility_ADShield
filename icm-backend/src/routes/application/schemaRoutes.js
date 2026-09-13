import { Router } from "express";
import { authenticate, requirePermission, PERMISSIONS } from "../../middleware/auth.js";
import { getSchemaByAppId } from "../../controllers/application/schemaController.js";

const router = Router();

router.get(
  "/:appId",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  getSchemaByAppId,
);

export default router;
