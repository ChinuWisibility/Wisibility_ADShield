import jwt from "jsonwebtoken";
import env from "../config/env.js";
import { getMaintenanceState } from "../services/system/platformSettingsService.js";

const EXEMPT_PATHS = [
  "/api/health",
  "/api/system/info",
  "/api/auth",
  "/api/license",
  "/api/setup",
  "/api/settings/platform",
];

function isExempt(path) {
  return EXEMPT_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

function isSuperAdminRequest(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, env.jwt.secret, {
      algorithms: ["HS256"],
    });
    return decoded?.role === "superAdmin";
  } catch {
    return false;
  }
}

export function maintenanceModeGuard(req, res, next) {
  const maintenance = getMaintenanceState();
  if (
    !maintenance.enforced ||
    !req.path.startsWith("/api") ||
    isExempt(req.path) ||
    isSuperAdminRequest(req)
  ) {
    return next();
  }

  return res.status(503).json({
    success: false,
    code: "MAINTENANCE_MODE",
    message: maintenance.message,
    data: { supportEmail: maintenance.supportEmail || null },
  });
}
