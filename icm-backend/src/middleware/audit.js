import Audit from "../models/platform/Audit.js";

const AUDIT_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/** Path-based action name without HTTP method (method is stored separately). */
function resolveAuditAction(req) {
  const fullPath = `${req.baseUrl || ""}${req.path || ""}`;
  const segments = fullPath
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^[0-9a-fA-F]{24}$/.test(s) && !s.startsWith(":"));

  return segments.join("_") || fullPath.replace(/^\//, "") || "request";
}

export function auditTrail(req, res, next) {
  if (!AUDIT_METHODS.includes(req.method)) return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (req.user && res.statusCode < 400) {
      const path = `${req.baseUrl}${req.path}`;
      Audit.create({
        userId: req.user.id,
        tenantId: req.user.tenantId || null,
        userEmail: req.user.email,
        action: resolveAuditAction(req),
        method: req.method,
        path,
        statusCode: res.statusCode,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        details: {
          params: req.params,
          query: req.query,
        },
      }).catch((err) => console.error("Audit log failed:", err.message));
    }
    return originalJson(body);
  };

  next();
}
