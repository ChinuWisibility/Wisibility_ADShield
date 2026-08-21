import { v4 as uuidv4 } from "uuid";
import Audit from "../models/platform/Audit.js";

export const getIPLocation = async (ipAddress) => {
  try {
    if (
      ipAddress === "127.0.0.1" ||
      ipAddress === "::1" ||
      ipAddress.startsWith("192.168.") ||
      ipAddress.startsWith("10.") ||
      ipAddress.startsWith("172.")
    ) {
      return {
        country: "Local Network",
        region: "Local",
        city: "Local",
        timezone: "Local",
      };
    }
    const response = await fetch(`https://ipapi.co/${ipAddress}/json/`);
    const data = await response.json();
    if (data.error) throw new Error(data.reason || "IP geolocation failed");
    return {
      country: data.country_name || "Unknown",
      region: data.region || "Unknown",
      city: data.city || "Unknown",
      timezone: data.timezone || "Unknown",
      coordinates: { latitude: data.latitude, longitude: data.longitude },
    };
  } catch (error) {
    return {
      country: "Unknown",
      region: "Unknown",
      city: "Unknown",
      timezone: "Unknown",
    };
  }
};

export const parseUserAgent = (userAgent) => {
  const deviceInfo = {
    type: "desktop",
    os: "Unknown",
    browser: "Unknown",
    version: "Unknown",
  };
  if (userAgent) {
    if (/Mobile|Android|iPhone|iPod/.test(userAgent))
      deviceInfo.type = "mobile";
    else if (/Tablet|iPad/.test(userAgent)) deviceInfo.type = "tablet";

    if (/Windows NT 10.0/.test(userAgent)) deviceInfo.os = "Windows 10/11";
    else if (/Windows/.test(userAgent)) deviceInfo.os = "Windows";
    else if (/Mac OS X/.test(userAgent)) deviceInfo.os = "macOS";
    else if (/Linux/.test(userAgent)) deviceInfo.os = "Linux";
    else if (/Android/.test(userAgent)) deviceInfo.os = "Android";
    else if (/iPhone|iPad/.test(userAgent)) deviceInfo.os = "iOS";

    const chromeMatch = userAgent.match(/Chrome\/(\d+)/);
    if (chromeMatch) {
      deviceInfo.browser = "Chrome";
      deviceInfo.version = chromeMatch[1];
    } else if (/Firefox/.test(userAgent)) {
      const m = userAgent.match(/Firefox\/(\d+)/);
      deviceInfo.browser = "Firefox";
      if (m) deviceInfo.version = m[1];
    } else if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
      const m = userAgent.match(/Version\/(\d+)/);
      deviceInfo.browser = "Safari";
      if (m) deviceInfo.version = m[1];
    } else if (/Edge/.test(userAgent)) {
      const m = userAgent.match(/Edge\/(\d+)/);
      deviceInfo.browser = "Edge";
      if (m) deviceInfo.version = m[1];
    }
  }
  return deviceInfo;
};

const resolveIp = (req) => {
  let ip =
    req.headers["x-forwarded-for"] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip;
  if (ip === "::1" || ip === "::ffff:127.0.0.1") ip = "127.0.0.1";
  if (ip && ip.startsWith("::ffff:")) ip = ip.substring(7);
  return ip;
};

/** Friendly audit action names for auth routes that use trackSession. */
const ROUTE_ACTIONS = {
  "GET /profile": "get_profile",
  "PUT /profile": "update_profile",
  "PUT /change-password": "change_password",
  "POST /logout": "logout",
  "GET /users": "list_users",
  "PUT /users/:id": "update_user",
  "PUT /users/:id/deactivate": "deactivate_user",
  "PUT /users/:id/activate": "activate_user",
  "PUT /users/:id/role": "assign_role",
  "POST /users/:id/reset-password": "reset_user_password",
  "POST /users/:id/sessions/revoke": "revoke_user_sessions",
  "GET /users/:id/activity": "get_user_activity",
  "POST /users/bulk": "bulk_import_users",
};

function resolveSessionAction(req) {
  const routePath = req.route?.path;
  if (routePath) {
    const mapped = ROUTE_ACTIONS[`${req.method} ${routePath}`];
    if (mapped) return mapped;
  }

  const pathOnly = (req.originalUrl || req.path || "").split("?")[0];
  const segments = pathOnly
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^[0-9a-fA-F]{24}$/.test(s) && !s.startsWith(":"));

  return segments.join("_") || "request";
}

export const trackSession = async (req, res, next) => {
  if (req.user) {
    try {
      const action = resolveSessionAction(req);
      // logout is recorded by trackLogout — avoid a duplicate session entry
      if (action === "logout") {
        return next();
      }

      const ipAddress = resolveIp(req);
      const userAgent = req.get("User-Agent") || "";
      const location = await getIPLocation(ipAddress);
      const deviceInfo = parseUserAgent(userAgent);
      const deviceFingerprint = `${ipAddress}-${userAgent}-${deviceInfo.type}-${deviceInfo.os}`;

      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      const existingSession = await Audit.findOne({
        userId: req.user._id || req.user.id,
        "metadata.deviceFingerprint": deviceFingerprint,
        createdAt: { $gte: thirtyMinutesAgo },
      }).sort({ createdAt: -1 });

      const sessionId = existingSession?.metadata?.sessionId || uuidv4();

      await Audit.create({
        action,
        entityType: "System",
        entityId: "Session",
        userId: req.user._id || req.user.id,
        tenantId: req.user.tenantId || null,
        userEmail: req.user.email,
        method: req.method,
        path: req.originalUrl,
        ipAddress,
        userAgent,
        statusCode: 200,
        metadata: { sessionId, deviceFingerprint, location, deviceInfo },
      });
    } catch (e) {}
  }
  next();
};

export const trackLogin = async (req, res, next) => {
  try {
    const originalJson = res.json;
    res.json = function (data) {
      if (data && data.success && data.data && data.data.user) {
        const user = data.data.user;
        const sessionId = uuidv4();
        const ipAddress = resolveIp(req);
        const userAgent = req.get("User-Agent") || "";

        Promise.all([getIPLocation(ipAddress), parseUserAgent(userAgent)]).then(
          ([location, deviceInfo]) => {
            Audit.create({
              action: "login",
              entityType: "User",
              entityId: user._id || user.id,
              userId: user._id || user.id,
              tenantId: user.tenantId || null,
              userEmail: user.email,
              method: req.method,
              path: req.originalUrl,
              ipAddress,
              userAgent,
              statusCode: res.statusCode,
              metadata: {
                sessionId,
                location,
                deviceInfo,
                loginMethod: "email_password",
              },
            }).catch(console.error);
          },
        );
      }
      return originalJson.call(this, data);
    };
  } catch (e) {}
  next();
};

export const trackLogout = async (req, res, next) => {
  try {
    if (req.user) {
      const ipAddress = resolveIp(req);
      const userAgent = req.get("User-Agent") || "";
      Promise.all([getIPLocation(ipAddress), parseUserAgent(userAgent)]).then(
        ([location, deviceInfo]) => {
          Audit.create({
            action: "logout",
            entityType: "User",
            entityId: req.user._id || req.user.id,
            userId: req.user._id || req.user.id,
            tenantId: req.user.tenantId || null,
            userEmail: req.user.email,
            method: req.method,
            path: req.originalUrl,
            ipAddress,
            userAgent,
            statusCode: 200,
            metadata: { location, deviceInfo },
          }).catch(console.error);
        },
      );
    }
  } catch (e) {}
  next();
};
