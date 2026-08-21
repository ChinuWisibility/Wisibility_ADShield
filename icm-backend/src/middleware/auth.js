import jwt from "jsonwebtoken";
import crypto from "crypto";
import env from "../config/env.js";
import { AppError } from "./errorHandler.js";
import User from "../models/platform/User.js";
import UserSession from "../models/platform/UserSession.js";

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function authenticate(req, res, next) {
  const token =
    req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;

  if (!token) {
    return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
  }

  try {
    const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"] });

    // Session-revocation check: a signature-valid token can still have been
    // explicitly revoked (logout, admin "revoke session"). Tokens issued
    // before this check existed (or any other typed token, e.g. mfa_pending)
    // have no matching session row and are rejected too.
    const session = await UserSession.findOne({
      sessionToken: hashSessionToken(token),
      isRevoked: false,
    }).lean();
    if (!session) {
      return next(new AppError("Session expired or revoked", 401, "SESSION_REVOKED"));
    }

    req.user = decoded;
    req.scopedTenantId = getScopedTenantId(decoded);
    req.authPlane = isPlatformPlaneUser(decoded)
      ? "platform"
      : isOrgAdminPlaneUser(decoded)
        ? "org-admin"
        : "tenant";
    req.plane = req.authPlane;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new AppError("Token expired", 401, "TOKEN_EXPIRED"));
    }
    return next(new AppError("Invalid token", 401, "INVALID_TOKEN"));
  }
}

export function authenticateOptional(req, res, next) {
  const token =
    req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, env.jwt.secret, { algorithms: ["HS256"] });
    req.user = decoded;
    req.scopedTenantId = getScopedTenantId(decoded);
    req.authPlane = isPlatformPlaneUser(decoded)
      ? "platform"
      : isOrgAdminPlaneUser(decoded)
        ? "org-admin"
        : "tenant";
    req.plane = req.authPlane;
  } catch {
    // For public endpoints, invalid optional tokens are ignored.
  }

  next();
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError("Authentication required", 401, "AUTH_REQUIRED"),
      );
    }
    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next();
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }
    next();
  };
}

export function generateToken(user) {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId || null,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn, algorithm: "HS256" },
  );
}

export const ROLES = {
  ADMIN: "admin",
  CERT_ADMIN: "certAdmin",
  SUPER_ADMIN: "superAdmin",
  SOD_ADMIN: "sodAdmin",
  MANAGER: "manager",
  VIEWER: "viewer",
  AUDIT_ANALYTICS: "auditAnalytics",
};

export const PRESETS = {
  certRead: [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CERT_ADMIN,
    ROLES.SOD_ADMIN,
    ROLES.MANAGER,
    ROLES.VIEWER,
    ROLES.AUDIT_ANALYTICS,
  ],
  certWrite: [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CERT_ADMIN,
    ROLES.SOD_ADMIN,
  ],
  campaignCreate: [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CERT_ADMIN,
    ROLES.SOD_ADMIN,
  ],
  settingsManage: [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.CERT_ADMIN],
  allCertRoles: [
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.CERT_ADMIN,
    ROLES.SOD_ADMIN,
    ROLES.MANAGER,
    ROLES.VIEWER,
    ROLES.AUDIT_ANALYTICS,
  ],
};

export const PERMISSIONS = {
  USERS_READ: "users.read",
  USERS_UPDATE: "users.update",
  USERS_ASSIGN_ROLE: "users.assignRole",
  USERS_ACTIVATE: "users.activate",
  USERS_DEACTIVATE: "users.deactivate",
  USERS_RESET_PASSWORD: "users.resetPassword",
  USERS_REVOKE_SESSIONS: "users.revokeSessions",
  USERS_ACTIVITY_READ: "users.activity.read",
  USERS_BULK_IMPORT: "users.bulkImport",
  SETTINGS_READ: "settings.read",
  SETTINGS_WRITE: "settings.write",
  SETTINGS_RESET: "settings.reset",
  PASSWORD_POLICY_READ: "passwordPolicy.read",
  PASSWORD_POLICY_WRITE: "passwordPolicy.write",
  AUDIT_EXPORT_JOBS_READ: "auditExportJobs.read",
  AUDIT_EXPORT_JOBS_WRITE: "auditExportJobs.write",
  MFA_CONFIG_MANAGE: "mfaConfig.manage",
  TENANT_CONFIG_READ: "tenantConfig.read",
  TENANT_CONFIG_WRITE: "tenantConfig.write",
  TENANT_FEATURES_READ: "tenantFeatures.read",
  TENANT_FEATURES_WRITE: "tenantFeatures.write",
  TENANT_LICENCE_READ: "tenantLicence.read",
  TENANT_MANAGE: "tenant.manage",
  AUDIT_READ: "audit.read",
  AUDIT_LOGIN_READ: "audit.login.read",
  AUDIT_ENTITY_READ: "audit.entity.read",
  AUDIT_ENTRY_READ: "audit.entry.read",
  AUDIT_EXPORT: "audit.export",
  AUDIT_PURGE: "audit.purge",
  APPLICATION_TYPE_MANAGE: "applicationType.manage",
  APPLICATION_WRITE: "application.write",
  APPLICATION_RISK_PROFILE_MANAGE: "applicationRiskProfile.manage",
  APPLICATION_INTEGRATION_LOG_MANAGE: "applicationIntegrationLog.manage",
  APPLICATION_RISK_WRITE: "applicationRisk.write",
  APPLICATION_COMPLIANCE_WRITE: "applicationCompliance.write",
  ADMIN_SESSIONS_READ: "adminSessions.read",
  API_KEYS_MANAGE: "apiKeys.manage",
  ACTIVITY_READ: "activity.read",
  COMPLIANCE_READ: "compliance.read",
  COMPLIANCE_WRITE: "compliance.write",
  GOVERNANCE_READ: "governance.read",
  GOVERNANCE_WRITE: "governance.write",
  IDENTITY_POSTURE_RULES_MANAGE: "identityPostureRules.manage",
  REPORTING_RULE_SET_MANAGE: "reportingRuleSet.manage",
  UNCORRELATED_TRUST_MAPPING_MANAGE: "uncorrelatedTrustMapping.manage",
};

export const ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: Object.values(PERMISSIONS),
  [ROLES.CERT_ADMIN]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_ACTIVITY_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_LOGIN_READ,
    PERMISSIONS.AUDIT_ENTITY_READ,
    PERMISSIONS.AUDIT_ENTRY_READ,
  ],
  [ROLES.SOD_ADMIN]: [],
  [ROLES.MANAGER]: [],
  [ROLES.VIEWER]: [],
  [ROLES.AUDIT_ANALYTICS]: [
    PERMISSIONS.USERS_ACTIVITY_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_LOGIN_READ,
    PERMISSIONS.AUDIT_ENTITY_READ,
    PERMISSIONS.AUDIT_ENTRY_READ,
    PERMISSIONS.AUDIT_EXPORT_JOBS_READ,
    PERMISSIONS.COMPLIANCE_READ,
  ],
};

function resolveTenantIdValue(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  if (typeof tenantId === "object") {
    const id = tenantId._id ?? tenantId.id;
    if (id == null || id === "") return null;
    return String(id);
  }
  return String(tenantId);
}

export function isPlatformPlaneUser(user) {
  return (
    user?.role === ROLES.SUPER_ADMIN ||
    (user?.role === ROLES.ADMIN && !resolveTenantIdValue(user?.tenantId))
  );
}

export function isOrgAdminPlaneUser(user) {
  if (user?.role !== ROLES.ADMIN) return false;
  if (isPlatformPlaneUser(user)) return false;
  return Boolean(resolveTenantIdValue(user?.tenantId));
}

export function isTenantPlaneUser(user) {
  return [
    ROLES.CERT_ADMIN,
    ROLES.SOD_ADMIN,
    ROLES.MANAGER,
    ROLES.VIEWER,
    ROLES.AUDIT_ANALYTICS,
  ].includes(user?.role);
}

export function getScopedTenantId(user) {
  if (isPlatformPlaneUser(user)) return null;
  return resolveTenantIdValue(user?.tenantId);
}

export function can(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError("Authentication required", 401, "AUTH_REQUIRED"),
      );
    }

    req.plane =
      req.authPlane ||
      (isPlatformPlaneUser(req.user)
        ? "platform"
        : isOrgAdminPlaneUser(req.user)
          ? "org-admin"
          : "tenant");

    if (req.user.role === ROLES.SUPER_ADMIN) {
      return next();
    }

    if (!Array.isArray(allowedRoles) || !allowedRoles.includes(req.user.role)) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }
    next();
  };
}

export function hasPermission(user, permission) {
  if (!user) return false;
  if (user.role === ROLES.SUPER_ADMIN) return true;
  const permissions = ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes(permission);
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError("Authentication required", 401, "AUTH_REQUIRED"),
      );
    }

    req.plane =
      req.authPlane ||
      (isPlatformPlaneUser(req.user)
        ? "platform"
        : isOrgAdminPlaneUser(req.user)
          ? "org-admin"
          : "tenant");

    if (!hasPermission(req.user, permission)) {
      return next(new AppError("Insufficient permissions", 403, "FORBIDDEN"));
    }
    next();
  };
}

export function orgAdminOnly(req, res, next) {
  if (!req.user) {
    return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
  }

  if (!isOrgAdminPlaneUser(req.user)) {
    return next(
      new AppError("Org admin access required", 403, "FORBIDDEN"),
    );
  }

  const tenantId = getScopedTenantId(req.user);
  if (!tenantId) {
    return next(
      new AppError("Tenant context required for org admin", 403, "TENANT_REQUIRED"),
    );
  }

  req.plane = "org-admin";
  req.scopedTenantId = tenantId;
  next();
}

export function platformOnly(req, res, next) {
  if (!req.user) {
    return next(new AppError("Authentication required", 401, "AUTH_REQUIRED"));
  }

  if (!isPlatformPlaneUser(req.user)) {
    return next(
      new AppError("Platform-wide access required", 403, "FORBIDDEN"),
    );
  }

  req.plane = "platform";
  req.scopedTenantId = null;
  next();
}
