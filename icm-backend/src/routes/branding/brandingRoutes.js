import { Router } from "express";
import { authenticate, authorize, ROLES } from "../../middleware/auth.js";
import * as brandingCtrl from "../../controllers/branding/brandingController.js";

const router = Router();

router.get("/", brandingCtrl.getBranding); // public — needed by login page before auth
router.put(
  "/",
  authenticate,
  authorize(ROLES.ADMIN),
  brandingCtrl.updateBranding,
);
router.delete(
  "/reset",
  authenticate,
  authorize(ROLES.ADMIN),
  brandingCtrl.resetBranding,
);
router.post(
  "/preview",
  authenticate,
  authorize(ROLES.ADMIN),
  brandingCtrl.previewBranding,
);

export default router;
