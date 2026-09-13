import { Router } from "express";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import {
  getLicenseStatus,
  licenseUploadMiddleware,
  reloadLicense,
  uploadLicense,
} from "../../controllers/license/licenseController.js";

const router = Router();

/** Read-only status is public so the activation shell can render before login. */
router.get("/status", getLicenseStatus);
router.post(
  "/upload",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  licenseUploadMiddleware,
  uploadLicense,
);
router.post("/reload", authenticate, authorize(ROLES.SUPER_ADMIN), reloadLicense);

export default router;
