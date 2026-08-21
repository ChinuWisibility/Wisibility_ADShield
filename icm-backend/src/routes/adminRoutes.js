import { Router } from "express";
import {
  authenticate,
  requirePermission,
  PERMISSIONS,
} from "../middleware/auth.js";
import * as sessionCtrl from "../controllers/sessionController.js";
import * as apiKeyCtrl from "../controllers/apiKeyController.js";

const router = Router();

// Admin sessions
router.get(
  "/sessions",
  authenticate,
  requirePermission(PERMISSIONS.ADMIN_SESSIONS_READ),
  sessionCtrl.listAllSessions,
);

// API keys
router.post(
  "/api-keys",
  authenticate,
  requirePermission(PERMISSIONS.API_KEYS_MANAGE),
  apiKeyCtrl.createApiKey,
);
router.get(
  "/api-keys",
  authenticate,
  requirePermission(PERMISSIONS.API_KEYS_MANAGE),
  apiKeyCtrl.listApiKeys,
);
router.delete(
  "/api-keys/:id",
  authenticate,
  requirePermission(PERMISSIONS.API_KEYS_MANAGE),
  apiKeyCtrl.revokeApiKey,
);
router.post(
  "/api-keys/:id/rotate",
  authenticate,
  requirePermission(PERMISSIONS.API_KEYS_MANAGE),
  apiKeyCtrl.rotateApiKey,
);

export default router;
