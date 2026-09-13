import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../middleware/auth.js";
import * as activityCtrl from "../controllers/activityController.js";

const router = Router();

router.post("/", authenticate, activityCtrl.logActivity);
router.get(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_READ),
  activityCtrl.getActivityFeed,
);
router.get("/me", authenticate, activityCtrl.getMyActivity);
router.get(
  "/entity/:id",
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_READ),
  activityCtrl.getEntityActivity,
);

export default router;
