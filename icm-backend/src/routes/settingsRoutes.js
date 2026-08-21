import { Router } from "express";
import {
  authenticate,
  authorize,
  requirePermission,
  PERMISSIONS,
  ROLES,
} from "../middleware/auth.js";
import PasswordPolicy from "../models/platform/PasswordPolicy.js";
import AuditExportJob from "../models/platform/AuditExportJob.js";
import MFAConfiguration from "../models/platform/MFAConfiguration.js";
import { createCrudController } from "../utils/crudFactory.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  getDeploymentAccess,
  updateDeploymentAccess,
} from "../services/system/deploymentAccessService.js";
import {
  getPlatformSettings,
  isMaintenanceEnforced,
  isMaintenanceForcedOff,
  updatePlatformSettings,
} from "../services/system/platformSettingsService.js";

const router = Router();
const auditExportCtrl = createCrudController(AuditExportJob, {
  searchFields: ["exportType", "domain", "status", "format", "fileLocation"],
});
const mfaAdminCtrl = createCrudController(MFAConfiguration, {
  searchFields: ["mfaType"],
});

// Validated platform-wide settings. Super Admin only.
router.get(
  "/platform",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  (req, res) => {
    res.json({
      success: true,
      data: {
        ...getPlatformSettings(),
        maintenanceEnforced: isMaintenanceEnforced(),
        maintenanceForcedOff: isMaintenanceForcedOff(),
      },
    });
  },
);

router.put(
  "/platform",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const settings = await updatePlatformSettings(req.body, req.user.id);
      res.json({
        success: true,
        data: {
          ...settings,
          maintenanceEnforced: isMaintenanceEnforced(),
          maintenanceForcedOff: isMaintenanceForcedOff(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Organization deployment access (must come before /:key).
router.get(
  "/deployment-access",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  (req, res) => {
    res.json({ success: true, data: getDeploymentAccess() });
  },
);

router.put(
  "/deployment-access",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const settings = await updateDeploymentAccess(req.body, req.user.id);
      res.json({ success: true, data: settings });
    } catch (err) {
      next(err);
    }
  },
);

// Password policy (must come before /:key)
router.get(
  "/password-policy",
  authenticate,
  requirePermission(PERMISSIONS.PASSWORD_POLICY_READ),
  async (req, res, next) => {
    try {
      let policy = await PasswordPolicy.findOne({ isDefault: true });
      if (!policy) policy = await PasswordPolicy.findOne();
      if (!policy) return res.json({ success: true, data: null });
      res.json({ success: true, data: policy });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/password-policy",
  authenticate,
  requirePermission(PERMISSIONS.PASSWORD_POLICY_WRITE),
  async (req, res, next) => {
    try {
      const allowed = [
        "policyName",
        "minLength",
        "requireUppercase",
        "requireNumbers",
        "requireSpecialChars",
        "maxAgeDays",
        "historyCount",
        "lockoutAttempts",
        "lockoutDurationMinutes",
        "isDefault",
      ];
      const filtered = Object.fromEntries(
        Object.entries(req.body).filter(([k]) => allowed.includes(k)),
      );

      let policy = await PasswordPolicy.findOne({ isDefault: true });
      if (!policy) policy = await PasswordPolicy.findOne();

      if (policy) {
        Object.assign(policy, filtered);
        await policy.save();
      } else {
        policy = await PasswordPolicy.create({
          ...filtered,
          policyName: filtered.policyName || "Default Policy",
          isDefault: true,
        });
      }
      res.json({ success: true, data: policy });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/password-policy/validate",
  authenticate,
  async (req, res, next) => {
    try {
      const { password } = req.body;
      if (!password)
        throw new AppError("Password is required", 400, "MISSING_PASSWORD");

      let policy = await PasswordPolicy.findOne({ isDefault: true });
      if (!policy) policy = await PasswordPolicy.findOne();

      const violations = [];
      if (policy) {
        if (password.length < policy.minLength)
          violations.push(`Minimum length is ${policy.minLength} characters`);
        if (policy.requireUppercase && !/[A-Z]/.test(password))
          violations.push("Must contain at least one uppercase letter");
        if (policy.requireNumbers && !/[0-9]/.test(password))
          violations.push("Must contain at least one number");
        if (policy.requireSpecialChars && !/[^A-Za-z0-9]/.test(password))
          violations.push("Must contain at least one special character");
      }

      res.json({
        success: true,
        data: { valid: violations.length === 0, violations },
      });
    } catch (err) {
      next(err);
    }
  },
);

// Audit export jobs
router.get(
  "/audit-export-jobs",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT_JOBS_READ),
  auditExportCtrl.list,
);
router.get(
  "/audit-export-jobs/:id",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT_JOBS_READ),
  auditExportCtrl.getById,
);
router.post(
  "/audit-export-jobs",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT_JOBS_WRITE),
  auditExportCtrl.create,
);
router.put(
  "/audit-export-jobs/:id",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT_JOBS_WRITE),
  auditExportCtrl.update,
);
router.delete(
  "/audit-export-jobs/:id",
  authenticate,
  requirePermission(PERMISSIONS.AUDIT_EXPORT_JOBS_WRITE),
  auditExportCtrl.remove,
);

// MFA configuration (admin-managed)
router.get(
  "/mfa-configurations",
  authenticate,
  requirePermission(PERMISSIONS.MFA_CONFIG_MANAGE),
  mfaAdminCtrl.list,
);
router.get(
  "/mfa-configurations/:id",
  authenticate,
  requirePermission(PERMISSIONS.MFA_CONFIG_MANAGE),
  mfaAdminCtrl.getById,
);
router.post(
  "/mfa-configurations",
  authenticate,
  requirePermission(PERMISSIONS.MFA_CONFIG_MANAGE),
  mfaAdminCtrl.create,
);
router.put(
  "/mfa-configurations/:id",
  authenticate,
  requirePermission(PERMISSIONS.MFA_CONFIG_MANAGE),
  mfaAdminCtrl.update,
);
router.delete(
  "/mfa-configurations/:id",
  authenticate,
  requirePermission(PERMISSIONS.MFA_CONFIG_MANAGE),
  mfaAdminCtrl.remove,
);

export default router;
