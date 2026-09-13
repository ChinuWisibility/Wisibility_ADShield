import * as authService from "../../services/auth/authService.js";
import { logActivity } from "../../services/system/activityService.js";
import { AppError } from "../../middleware/errorHandler.js";
import { hashSessionToken } from "../../middleware/auth.js";
import UserSession from "../../models/platform/UserSession.js";

function requestMeta(req) {
  return {
    ipAddress: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers["user-agent"] || "",
  };
}

export async function register(req, res, next) {
  try {
    const isAdminContext =
      req.user && (req.user.role === "admin" || req.user.role === "superAdmin");
    const result = await authService.registerUser({
      ...req.body,
      actor: req.user || null,
      isAdminContext,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const result = await authService.loginUser(req.body, requestMeta(req));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyLoginMfa(req, res, next) {
  try {
    const { mfaToken, code } = req.body;
    const result = await authService.completeMfaLogin({ mfaToken, code }, requestMeta(req));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getProfile(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return next(new AppError("Invalid session: missing user id", 401, "INVALID_SESSION"));
    }
    const user = await authService.getProfile(userId);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return next(new AppError("Invalid session: missing user id", 401, "INVALID_SESSION"));
    }
    const user = await authService.updateProfile(userId, req.body);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const result = await authService.changePassword(req.user.id, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body || {};
    const requestedIp = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || "";
    const result = await authService.requestPasswordReset({
      email,
      requestedIp,
      userAgent,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyPasswordResetToken(req, res, next) {
  try {
    const { token } = req.query;
    await authService.verifyPasswordResetToken(String(token || ""));
    res.json({ success: true, data: { valid: true } });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordWithToken(req, res, next) {
  try {
    const { token, newPassword } = req.body || {};
    const result = await authService.resetPasswordWithToken(
      String(token || ""),
      { newPassword },
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyIdentityOnboardingToken(req, res, next) {
  try {
    const { token } = req.query;
    const result = await authService.verifyIdentityOnboardingToken(String(token || ""));
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function completeIdentityOnboardingPassword(req, res, next) {
  try {
    const { token, oldPassword, newPassword, confirmPassword } = req.body || {};
    const result = await authService.completeIdentityOnboardingPassword(String(token || ""), {
      oldPassword,
      newPassword,
      confirmPassword,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function requestPasswordOtp(req, res, next) {
  try {
    const { email, purpose } = req.body || {};
    const result = await authService.requestPasswordOtp({ email, purpose });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function verifyPasswordOtp(req, res, next) {
  try {
    const { email, otpCode, purpose } = req.body || {};
    const result = await authService.verifyPasswordOtp({
      email,
      otpCode,
      purpose,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordWithOtp(req, res, next) {
  try {
    const { email, otpCode, newPassword } = req.body || {};
    const result = await authService.resetPasswordWithOtp({
      email,
      otpCode,
      newPassword,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res) {
  const token =
    req.headers.authorization?.replace("Bearer ", "") || req.cookies?.token;
  if (token) {
    await UserSession.updateOne(
      { sessionToken: hashSessionToken(token) },
      { $set: { isRevoked: true } },
    ).catch(() => {});
  }
  if (req.user) {
    await logActivity({
      userId: req.user.id || req.user._id,
      type: "logout",
      description: "User logged out",
      entityType: "User",
      entityId: String(req.user.id || req.user._id),
      metadata: { email: req.user.email },
    });
  }
  res.json({ success: true, data: { message: "Logged out successfully" } });
}

export async function listUsers(req, res, next) {
  try {
    const { page, limit, search, role, status, tenantId } = req.query;
    const result = await authService.listUsers({
      page: Number(page),
      limit: Number(limit),
      search,
      role,
      status,
      tenantId,
      actor: req.user,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function deactivateUser(req, res, next) {
  try {
    const user = await authService.deactivateUser(req.params.id, req.user);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function activateUser(req, res, next) {
  try {
    const user = await authService.activateUser(req.params.id, req.user);
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function updateUserByAdmin(req, res, next) {
  try {
    const user = await authService.updateUserByAdmin(
      req.params.id,
      req.body,
      req.user,
    );
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function assignRole(req, res, next) {
  try {
    const user = await authService.assignRole(
      req.params.id,
      req.body.role,
      req.user,
    );
    res.json({ success: true, data: user });
  } catch (err) {
    next(err);
  }
}

export async function resetUserPassword(req, res, next) {
  try {
    const result = await authService.resetUserPassword(req.params.id, req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function revokeAllSessions(req, res, next) {
  try {
    const result = await authService.revokeAllSessions(req.params.id, req.user);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getUserActivity(req, res, next) {
  try {
    const { page, limit } = req.query;
    const result = await authService.getUserActivity(
      req.params.id,
      {
        page,
        limit,
      },
      req.user,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function bulkImportUsers(req, res, next) {
  try {
    if (!req.file)
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_FILE", message: "CSV file is required" },
      });
    const defaultTenantId =
      req.body?.defaultTenantId || req.query?.defaultTenantId || null;
    const result = await authService.bulkImportUsers(req.file.buffer, req.user, {
      defaultTenantId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
