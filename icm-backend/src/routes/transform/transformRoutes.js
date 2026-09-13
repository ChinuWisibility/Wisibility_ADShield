import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../../middleware/auth.js";
import {
  listTransforms,
  getTransformById,
  createTransform,
  updateTransform,
  deleteTransform,
  postValidate,
  postExecute,
} from "../../controllers/transform/transformController.js";

const router = Router();

router.post(
  "/validate",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  postValidate,
);
router.post(
  "/execute",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  postExecute,
);

router.get(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  listTransforms,
);
router.post(
  "/",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  createTransform,
);
router.get(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_READ),
  getTransformById,
);
router.put(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  updateTransform,
);
router.delete(
  "/:id",
  authenticate,
  requirePermission(PERMISSIONS.GOVERNANCE_WRITE),
  deleteTransform,
);

export default router;
