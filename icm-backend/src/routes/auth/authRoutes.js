import { Router } from "express";
import multer from "multer";
import * as auth from "../../controllers/auth/authController.js";
import * as mfaCtrl from "../../controllers/auth/mfaController.js";
import * as sessionCtrl from "../../controllers/auth/sessionController.js";
import {
  authenticate,
  authenticateOptional,
  authorize,
  ROLES,
  requirePermission,
  PERMISSIONS,
} from "../../middleware/auth.js";
import { authLimiter } from "../../middleware/rateLimiter.js";
import {
  validateRegister,
  validateLogin,
  validateChangePassword,
  validateUpdateProfile,
} from "../../middleware/authValidation.js";
import {
  trackSession,
  trackLogin,
  trackLogout,
} from "../../middleware/sessionTracker.js";
import { csvFileFilter } from "../../utils/uploadFilters.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: csvFileFilter,
});
const router = Router();

// Public
router.post(
  "/register",
  authenticateOptional,
  authLimiter,
  validateRegister,
  auth.register,
);
router.post("/login", authLimiter, validateLogin, trackLogin, auth.login);
router.post("/login/mfa", authLimiter, trackLogin, auth.verifyLoginMfa);
router.post("/forgot-password", authLimiter, auth.requestPasswordReset);
router.get(
  "/reset-password/verify",
  authLimiter,
  auth.verifyPasswordResetToken,
);
router.post("/reset-password", authLimiter, auth.resetPasswordWithToken);
router.get(
  "/create-own-password/verify",
  authLimiter,
  auth.verifyIdentityOnboardingToken,
);
router.post(
  "/create-own-password",
  authLimiter,
  auth.completeIdentityOnboardingPassword,
);
router.post("/password-otp/request", authLimiter, auth.requestPasswordOtp);
router.post("/password-otp/verify", authLimiter, auth.verifyPasswordOtp);
router.post("/password-otp/confirm", authLimiter, auth.resetPasswordWithOtp);

// Authenticated
router.get("/profile", authenticate, trackSession, auth.getProfile);
router.put(
  "/profile",
  authenticate,
  trackSession,
  validateUpdateProfile,
  auth.updateProfile,
);
router.put(
  "/change-password",
  authenticate,
  trackSession,
  validateChangePassword,
  auth.changePassword,
);
// Optional auth: expired/invalid tokens still get 200 so clients can clear local session without 401 noise
router.post("/logout", authenticateOptional, trackSession, trackLogout, auth.logout);

// MFA (authenticated user)
router.get("/mfa/status", authenticate, mfaCtrl.getMfaStatus);
router.post("/mfa/enroll", authenticate, mfaCtrl.enrollMfa);
router.post("/mfa/verify", authenticate, mfaCtrl.verifyMfaToken);
router.post("/mfa/totp/setup", authenticate, mfaCtrl.setupTotp);
router.delete("/mfa", authenticate, mfaCtrl.disableMfa);
router.post("/mfa/backup-codes", authenticate, mfaCtrl.generateBackupCodes);

// Sessions (authenticated user)
router.get("/sessions", authenticate, sessionCtrl.listActiveSessions);
router.delete("/sessions/:id", authenticate, sessionCtrl.revokeSession);

// Admin only
router.get(
  "/users",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_READ),
  auth.listUsers,
);
router.put(
  "/users/:id",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_UPDATE),
  auth.updateUserByAdmin,
);
router.put(
  "/users/:id/deactivate",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_DEACTIVATE),
  auth.deactivateUser,
);
router.put(
  "/users/:id/activate",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_ACTIVATE),
  auth.activateUser,
);
router.put(
  "/users/:id/role",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_ASSIGN_ROLE),
  auth.assignRole,
);
router.post(
  "/users/:id/reset-password",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_RESET_PASSWORD),
  auth.resetUserPassword,
);
router.post(
  "/users/:id/sessions/revoke",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_REVOKE_SESSIONS),
  auth.revokeAllSessions,
);
router.get(
  "/users/:id/activity",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_ACTIVITY_READ),
  auth.getUserActivity,
);
router.post(
  "/users/bulk",
  authenticate,
  trackSession,
  requirePermission(PERMISSIONS.USERS_BULK_IMPORT),
  upload.single("file"),
  auth.bulkImportUsers,
);

export default router;
