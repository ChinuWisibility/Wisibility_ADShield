import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/platform/User.js";
import UserSession from "../models/platform/UserSession.js";
import Activity from "../models/platform/Activity.js";
import PasswordResetToken, {
  PASSWORD_TOKEN_PURPOSE,
} from "../models/platform/PasswordResetToken.js";
import PasswordOtp from "../models/platform/PasswordOtp.js";
import { generateToken } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { logActivity } from "./activityService.js";
import Tenant from "../models/platform/Tenant.js";
import env from "../config/env.js";
import { getActivePasswordPolicy, validatePasswordAgainstPolicy } from "../utils/passwordPolicy.js";
import { verifyMfaCodeForLogin } from "./mfaService.js";
import {
  sendEmail,
  buildPasswordResetEmail,
  buildAdminInitiatedResetEmail,
  buildPasswordOtpEmail,
} from "./emailService.js";
import { getDeploymentAccess } from "./system/deploymentAccessService.js";
import { buildActiveUserLoginQuery } from "../utils/loginIdentifier.js";
import {
  isPortalOnboardingLoginBlocked,
  getIdentityOnboardingTokenTtlMs,
  ONBOARDING_LOGIN_BLOCKED_MESSAGE,
  ONBOARDING_TOKEN_EXPIRED_MESSAGE,
  PASSWORD_STATUS,
} from "../utils/identityOnboardingState.js";

const USER_ROLES = [
  "admin",
  "superAdmin",
  "certAdmin",
  "sodAdmin",
  "manager",
  "viewer",
  "auditAnalytics",
];

function resolveTenantIdValue(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  if (typeof tenantId === "object") {
    const id = tenantId._id ?? tenantId.id;
    if (id == null || id === "") return null;
    return String(id);
  }
  return String(tenantId);
}

function isPlatformPlaneActor(actor) {
  return (
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !resolveTenantIdValue(actor?.tenantId))
  );
}

function isOrgAdminPlaneActor(actor) {
  if (actor?.role !== "admin") return false;
  if (isPlatformPlaneActor(actor)) return false;
  return Boolean(resolveTenantIdValue(actor?.tenantId));
}

function ensureActorCanManageUser(actor, targetUser, action = "manage") {
  if (!actor) {
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  }

  if (isPlatformPlaneActor(actor)) {
    return;
  }

  if (!isOrgAdminPlaneActor(actor)) {
    throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
  }

  if (
    !targetUser?.tenantId ||
    String(targetUser.tenantId) !== String(actor.tenantId)
  ) {
    throw new AppError(
      `Cannot ${action} user outside your tenant`,
      403,
      "TENANT_SCOPE_VIOLATION",
    );
  }

  if (targetUser?.role === "superAdmin") {
    throw new AppError("Cannot manage system admins", 403, "FORBIDDEN");
  }
}

async function resolveSelfRegisterTenantId({ tenantId, tenantCode } = {}) {
  if (tenantId) {
    const byId = await Tenant.findOne({ _id: tenantId, isActive: true }).select("_id");
    if (byId) return byId._id;
  }

  const code = typeof tenantCode === "string" ? tenantCode.trim() : "";
  if (code) {
    const byCode = await Tenant.findOne({
      code: new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
      isActive: true,
    }).select("_id");
    if (byCode) return byCode._id;
  }

  const fromEnv = String(process.env.SELF_REGISTER_TENANT_ID || "").trim();
  if (fromEnv) {
    const byEnv = await Tenant.findOne({ _id: fromEnv, isActive: true }).select("_id");
    if (byEnv) return byEnv._id;
  }

  // Single-tenant deployments: auto-assign the only active tenant.
  const active = await Tenant.find({ isActive: true }).limit(2).select("_id");
  if (active.length === 1) return active[0]._id;

  return null;
}

export async function registerUser(data) {
  const {
    firstName,
    lastName,
    email,
    password,
    role,
    tenantId,
    tenantCode,
    isAdminContext = false, // If called from Admin panel
    actor = null,
  } = data;

  const existing = await User.findOne({ email });
  if (existing)
    throw new AppError("Email already registered", 409, "EMAIL_EXISTS");

  const passwordViolations = await validatePasswordAgainstPolicy(password);
  if (passwordViolations.length) {
    throw new AppError(
      `Password does not meet policy requirements: ${passwordViolations.join("; ")}`,
      400,
      "PASSWORD_POLICY_VIOLATION",
    );
  }

  let safeRole = "viewer";
  if (isAdminContext) {
    // If Admin is creating the user, allow any valid role
    safeRole = USER_ROLES.includes(role) ? role : "viewer";
  } else {
    // Public/self-registration: viewer only (TC208)
    safeRole = "viewer";
  }

  let resolvedTenantId = tenantId || null;

  // Org-admin plane users are tenant locked and cannot create system admins.
  if (isOrgAdminPlaneActor(actor)) {
    resolvedTenantId = resolveTenantIdValue(actor.tenantId);
    if (safeRole === "superAdmin") {
      throw new AppError(
        "Org Admin cannot create System Admin users",
        403,
        "FORBIDDEN",
      );
    }
  }

  // Public self-registration: resolve tenant from code/env/single-tenant default.
  if (!isAdminContext && !isOrgAdminPlaneActor(actor) && !resolvedTenantId) {
    resolvedTenantId = await resolveSelfRegisterTenantId({ tenantId, tenantCode });
  }

  // Tenant validation by plane:
  // - superAdmin: no tenant required/used
  // - admin: can be platform (no tenant) OR org admin (tenant assigned)
  // - tenant roles: tenant is required
  if (safeRole !== "admin" && safeRole !== "superAdmin" && !resolvedTenantId) {
    throw new AppError(
      isAdminContext
        ? "Tenant assignment is required for this role"
        : "Self-registration is unavailable. Enter a valid organization code or contact your administrator.",
      400,
      "TENANT_REQUIRED",
    );
  }

  const user = await User.create({
    firstName,
    lastName,
    email,
    password,
    role: safeRole,
    tenantId: safeRole === "superAdmin" ? null : resolvedTenantId,
  });
  const token = generateToken(user);
  return { user: user.toJSON(), token };
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function issuePasswordResetTokenForUser(user, { requestedIp, userAgent } = {}) {
  const ttlMinutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 60);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  await PasswordResetToken.findOneAndUpdate(
    { userId: user._id, purpose: PASSWORD_TOKEN_PURPOSE.PASSWORD_RESET },
    {
      userId: user._id,
      tokenHash,
      purpose: PASSWORD_TOKEN_PURPOSE.PASSWORD_RESET,
      requestedIp: requestedIp || null,
      userAgent: userAgent || null,
      expiresAt,
      usedAt: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const baseUrl = getDeploymentAccess().publicUrl;
  const resetUrlBase = (baseUrl || "").replace(/\/$/, "");
  const resetUrl = `${resetUrlBase}/reset-password/confirm?token=${encodeURIComponent(rawToken)}`;
  return { resetUrl, ttlMinutes };
}

export async function issueIdentityOnboardingTokenForUser(user, { requestedIp, userAgent } = {}) {
  const ttlMs = getIdentityOnboardingTokenTtlMs(env.identityOnboardingTokenTtlDays);
  const expiresAt = new Date(Date.now() + ttlMs);
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const now = new Date();
  await PasswordResetToken.updateMany(
    {
      userId: user._id,
      purpose: PASSWORD_TOKEN_PURPOSE.IDENTITY_ONBOARDING,
      usedAt: null,
    },
    { $set: { usedAt: now, expiresAt: now } },
  );

  await PasswordResetToken.create({
    userId: user._id,
    tokenHash,
    purpose: PASSWORD_TOKEN_PURPOSE.IDENTITY_ONBOARDING,
    requestedIp: requestedIp || null,
    userAgent: userAgent || null,
    expiresAt,
    usedAt: null,
  });

  const baseUrl = getDeploymentAccess().publicUrl;
  const resetUrlBase = (baseUrl || "").replace(/\/$/, "");
  const createPasswordUrl = `${resetUrlBase}/create-own-password?token=${encodeURIComponent(rawToken)}`;
  return {
    createPasswordUrl,
    ttlDays: Math.round(ttlMs / (24 * 60 * 60 * 1000)),
  };
}

async function createSessionRecord(user, token, { ipAddress, userAgent } = {}) {
  const decoded = jwt.decode(token);
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : null;
  await UserSession.create({
    userId: user._id,
    tenantId: user.tenantId || null,
    sessionToken: hashToken(token),
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    expiresAt,
    isRevoked: false,
  });
}

async function issueSessionForUser(user, meta) {
  user.lastLogin = new Date();
  await user.save();
  const token = generateToken(user);
  await createSessionRecord(user, token, meta);
  return { user: user.toJSON(), token };
}

export async function loginUser({ email, password }, meta = {}) {
  const query = buildActiveUserLoginQuery(email);
  const user = query
    ? await User.findOne(query).select("+password")
    : null;
  if (!user) {
    await logActivity({
      userId: null,
      type: "login",
      description: "Failed login attempt",
      entityType: "User",
      entityId: email,
      metadata: { email, outcome: "failed" },
    });
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logActivity({
      userId: user._id,
      type: "login",
      description: "Login attempt while account locked",
      entityType: "User",
      entityId: String(user._id),
      metadata: { email, outcome: "locked" },
    });
    throw new AppError(
      "Account temporarily locked due to repeated failed login attempts. Try again later.",
      423,
      "ACCOUNT_LOCKED",
    );
  }

  if (isPortalOnboardingLoginBlocked(user)) {
    await logActivity({
      userId: user._id,
      type: "login",
      description: "Login blocked — identity onboarding password pending",
      entityType: "User",
      entityId: String(user._id),
      metadata: { outcome: "onboarding_blocked" },
    });
    throw new AppError(
      ONBOARDING_LOGIN_BLOCKED_MESSAGE,
      401,
      "ONBOARDING_LOGIN_BLOCKED",
    );
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const policy = await getActivePasswordPolicy();
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= policy.lockoutAttempts) {
      user.lockedUntil = new Date(Date.now() + policy.lockoutDurationMinutes * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();

    await logActivity({
      userId: user._id,
      type: "login",
      description: "Failed login attempt",
      entityType: "User",
      entityId: String(user._id),
      metadata: { email, outcome: "failed" },
    });
    throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
  }

  // Successful password check — clear lockout counters regardless of MFA outcome.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;

  if (user.mfaEnabled) {
    await user.save();
    const mfaToken = jwt.sign(
      { typ: "mfa_pending", userId: String(user._id) },
      env.jwt.secret,
      { expiresIn: "5m", algorithm: "HS256" },
    );
    await logActivity({
      userId: user._id,
      type: "login",
      description: "Password verified, awaiting MFA code",
      entityType: "User",
      entityId: String(user._id),
      metadata: { email, outcome: "mfa_pending" },
    });
    return { mfaRequired: true, mfaToken };
  }

  const result = await issueSessionForUser(user, meta);

  await logActivity({
    userId: user._id,
    type: "login",
    description: "User logged in",
    entityType: "User",
    entityId: String(user._id),
    metadata: { email, outcome: "success" },
  });

  return result;
}

export async function completeMfaLogin({ mfaToken, code }, meta = {}) {
  if (!mfaToken || !code) {
    throw new AppError("MFA token and code are required", 400, "MFA_INCOMPLETE");
  }
  let decoded;
  try {
    decoded = jwt.verify(mfaToken, env.jwt.secret, { algorithms: ["HS256"] });
  } catch {
    throw new AppError("MFA session expired — please log in again", 401, "MFA_TOKEN_INVALID");
  }
  if (decoded.typ !== "mfa_pending" || !decoded.userId) {
    throw new AppError("Invalid MFA session", 401, "MFA_TOKEN_INVALID");
  }

  const user = await User.findOne({ _id: decoded.userId, isActive: true });
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  if (isPortalOnboardingLoginBlocked(user)) {
    throw new AppError(
      ONBOARDING_LOGIN_BLOCKED_MESSAGE,
      401,
      "ONBOARDING_LOGIN_BLOCKED",
    );
  }

  await verifyMfaCodeForLogin(user._id, code);

  const result = await issueSessionForUser(user, meta);
  await logActivity({
    userId: user._id,
    type: "login",
    description: "User logged in (MFA verified)",
    entityType: "User",
    entityId: String(user._id),
    metadata: { email: user.email, outcome: "success" },
  });
  return result;
}

export async function getProfile(userId) {
  const user = await User.findById(userId).populate("tenantId", "name code");
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

export async function updateProfile(userId, updates) {
  const allowed = [
    "firstName",
    "lastName",
    "phoneNumber",
    "department",
    "profilePicture",
  ];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k)),
  );

  if (Object.prototype.hasOwnProperty.call(filtered, "phoneNumber")) {
    const raw = filtered.phoneNumber;
    filtered.phoneNumber =
      raw == null || raw === ""
        ? ""
        : String(raw).replace(/[\s()-]/g, "");
  }

  const user = await User.findByIdAndUpdate(userId, filtered, {
    new: true,
    runValidators: true,
  });
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

export async function changePassword(userId, { oldPassword, newPassword }) {
  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

  const isMatch = await user.comparePassword(oldPassword);
  if (!isMatch)
    throw new AppError("Current password is incorrect", 400, "WRONG_PASSWORD");

  const passwordViolations = await validatePasswordAgainstPolicy(newPassword);
  if (passwordViolations.length) {
    throw new AppError(
      `Password does not meet policy requirements: ${passwordViolations.join("; ")}`,
      400,
      "PASSWORD_POLICY_VIOLATION",
    );
  }

  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();
  await logActivity({
    userId,
    type: "authentication",
    description: "User changed password",
    metadata: { email: user.email },
  });
  return { message: "Password changed successfully" };
}

export async function requestPasswordReset({ email, requestedIp, userAgent }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return {
      message:
        "If an account exists for this email, a reset link will be sent shortly.",
    };
  }

  const user = await User.findOne({ email: normalizedEmail, isActive: true });

  if (!user) {
    // Do not reveal user existence
    return {
      message:
        "If an account exists for this email, a reset link will be sent shortly.",
    };
  }

  if (isPortalOnboardingLoginBlocked(user)) {
    return {
      message:
        "If an account exists for this email, a reset link will be sent shortly.",
    };
  }

  const ttlMinutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 60);
  const { resetUrl } = await issuePasswordResetTokenForUser(user, {
    requestedIp,
    userAgent,
  });

  const { subject, html } = await buildPasswordResetEmail({
    recipientName:
      user.firstName || user.lastName
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : user.email,
    resetUrl,
    expiresInMinutes: ttlMinutes,
  });

  await sendEmail({ to: user.email, subject, html });

  await logActivity({
    userId: user._id,
    type: "authentication",
    description: "Password reset email requested",
    metadata: { email: user.email },
  });

  return {
    message:
      "If an account exists for this email, a reset link will be sent shortly.",
  };
}

export async function verifyPasswordResetToken(rawToken) {
  if (!rawToken) {
    throw new AppError("Invalid or expired reset link", 400, "TOKEN_INVALID");
  }

  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const now = new Date();

  const tokenDoc = await PasswordResetToken.findOne({
    tokenHash,
    expiresAt: { $gt: now },
    $or: [{ usedAt: null }, { usedAt: { $exists: false } }],
    $and: [
      {
        $or: [
          { purpose: PASSWORD_TOKEN_PURPOSE.PASSWORD_RESET },
          { purpose: { $exists: false } },
          { purpose: null },
        ],
      },
    ],
  });

  if (!tokenDoc) {
    throw new AppError("Invalid or expired reset link", 400, "TOKEN_INVALID");
  }

  return { userId: tokenDoc.userId };
}

export async function resetPasswordWithToken(rawToken, { newPassword }) {
  const { userId } = await verifyPasswordResetToken(rawToken);

  const user = await User.findById(userId).select("+password");
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  if (isPortalOnboardingLoginBlocked(user)) {
    throw new AppError("Invalid or expired reset link", 400, "TOKEN_INVALID");
  }

  const passwordViolations = await validatePasswordAgainstPolicy(newPassword);
  if (passwordViolations.length) {
    throw new AppError(
      `Password does not meet policy requirements: ${passwordViolations.join("; ")}`,
      400,
      "PASSWORD_POLICY_VIOLATION",
    );
  }

  user.password = newPassword;
  user.mustChangePassword = false;
  await user.save();

  const now = new Date();
  await PasswordResetToken.updateMany(
    {
      userId,
      usedAt: null,
      $or: [
        { purpose: PASSWORD_TOKEN_PURPOSE.PASSWORD_RESET },
        { purpose: { $exists: false } },
        { purpose: null },
      ],
    },
    { $set: { usedAt: now, expiresAt: now } },
  );

  await logActivity({
    userId,
    type: "authentication",
    description: "User reset password via email link",
    metadata: { email: user.email },
  });

  return { message: "Password has been reset successfully" };
}

async function loadIdentityOnboardingToken(rawToken) {
  if (!rawToken) {
    throw new AppError("This password creation link is invalid.", 400, "TOKEN_INVALID");
  }

  const tokenHash = hashToken(String(rawToken));
  const tokenDoc = await PasswordResetToken.findOne({
    tokenHash,
    purpose: PASSWORD_TOKEN_PURPOSE.IDENTITY_ONBOARDING,
  });

  if (!tokenDoc) {
    throw new AppError("This password creation link is invalid.", 400, "TOKEN_INVALID");
  }
  if (tokenDoc.usedAt) {
    throw new AppError("This password creation link is no longer valid.", 400, "TOKEN_USED");
  }
  if (!tokenDoc.expiresAt || tokenDoc.expiresAt <= new Date()) {
    throw new AppError(ONBOARDING_TOKEN_EXPIRED_MESSAGE, 400, "TOKEN_EXPIRED");
  }
  return tokenDoc;
}

export async function verifyIdentityOnboardingToken(rawToken) {
  const tokenDoc = await loadIdentityOnboardingToken(rawToken);
  const user = await User.findById(tokenDoc.userId).select("passwordStatus isActive");
  if (!user || !user.isActive || !isPortalOnboardingLoginBlocked(user)) {
    throw new AppError("This password creation link is invalid.", 400, "TOKEN_INVALID");
  }
  return { valid: true };
}

export async function completeIdentityOnboardingPassword(rawToken, {
  oldPassword,
  newPassword,
  confirmPassword,
}) {
  if (!oldPassword || !newPassword || !confirmPassword) {
    throw new AppError(
      "Older password, new password, and confirmation are required",
      400,
      "VALIDATION_FAILED",
    );
  }
  if (String(newPassword) !== String(confirmPassword)) {
    throw new AppError(
      "New password and confirmation do not match",
      400,
      "PASSWORD_MISMATCH",
    );
  }

  const tokenDoc = await loadIdentityOnboardingToken(rawToken);
  const user = await User.findById(tokenDoc.userId).select("+password");
  if (!user || !user.isActive) {
    throw new AppError("This password creation link is invalid.", 400, "TOKEN_INVALID");
  }
  if (!isPortalOnboardingLoginBlocked(user)) {
    throw new AppError("This password creation link is no longer valid.", 400, "TOKEN_USED");
  }

  const oldMatches = await user.comparePassword(oldPassword);
  if (!oldMatches) {
    throw new AppError("Older password is incorrect", 400, "WRONG_PASSWORD");
  }

  const passwordViolations = await validatePasswordAgainstPolicy(newPassword);
  if (passwordViolations.length) {
    throw new AppError(
      `Password does not meet policy requirements: ${passwordViolations.join("; ")}`,
      400,
      "PASSWORD_POLICY_VIOLATION",
    );
  }

  user.password = newPassword;
  user.passwordStatus = PASSWORD_STATUS.ACTIVE;
  user.mustChangePassword = false;
  await user.save();

  const now = new Date();
  await PasswordResetToken.updateMany(
    {
      userId: user._id,
      purpose: PASSWORD_TOKEN_PURPOSE.IDENTITY_ONBOARDING,
      usedAt: null,
    },
    { $set: { usedAt: now, expiresAt: now } },
  );

  await logActivity({
    userId: user._id,
    tenantId: user.tenantId,
    type: "authentication",
    description: "Create Own Password completed",
    entityType: "User",
    entityId: String(user._id),
    metadata: { username: user.username, email: user.email },
  });

  return {
    message:
      "Your password has been created successfully. You can now log in to ADSecurity using your email address or User ID.",
  };
}

const OTP_GENERIC_MESSAGE =
  "If an account exists for this email, a one-time code will be sent shortly.";

export async function requestPasswordOtp({ email, purpose = "forgot" }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return { message: OTP_GENERIC_MESSAGE };
  }

  try {
    const user = await User.findOne({ email: normalizedEmail, isActive: true });
    if (!user) {
      return { message: OTP_GENERIC_MESSAGE };
    }
    if (isPortalOnboardingLoginBlocked(user)) {
      return { message: OTP_GENERIC_MESSAGE };
    }

    const ttlMinutes = Number(process.env.PASSWORD_OTP_TTL_MINUTES || 10);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const otpCode = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(otpCode).digest("hex");

    await PasswordOtp.findOneAndUpdate(
      { email: normalizedEmail, purpose },
      { email: normalizedEmail, purpose, codeHash, expiresAt, usedAt: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const { subject, html } = await buildPasswordOtpEmail({
      recipientName:
        user.firstName || user.lastName
          ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
          : user.email,
      otpCode,
      expiresInMinutes: ttlMinutes,
    });

    await sendEmail({ to: user.email, subject, html });

    await logActivity({
      userId: user._id,
      type: "authentication",
      description: "Password reset OTP requested",
      metadata: { email: user.email, purpose },
    });
  } catch (err) {
    // Anti-enumeration: never reveal whether the email exists or mail failed.
    console.error("[requestPasswordOtp]", err?.message || err);
  }

  return { message: OTP_GENERIC_MESSAGE };
}

/** Validate OTP without consuming it — used before the new-password step. */
export async function verifyPasswordOtp({ email, otpCode, purpose = "forgot" }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const code = (otpCode || "").trim();

  if (!normalizedEmail || !code) {
    throw new AppError("Invalid or expired code", 400, "OTP_INVALID");
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const now = new Date();

  const otpDoc = await PasswordOtp.findOne({
    email: normalizedEmail,
    purpose,
    codeHash,
    expiresAt: { $gt: now },
    $or: [{ usedAt: null }, { usedAt: { $exists: false } }],
  });

  if (!otpDoc) {
    throw new AppError("Invalid or expired code", 400, "OTP_INVALID");
  }

  return { valid: true, message: "Code verified. You can now create a new password." };
}

export async function resetPasswordWithOtp({ email, otpCode, newPassword }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const code = (otpCode || "").trim();

  if (!normalizedEmail || !code) {
    throw new AppError("Invalid or expired code", 400, "OTP_INVALID");
  }

  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const now = new Date();

  const otpDoc = await PasswordOtp.findOne({
    email: normalizedEmail,
    purpose: "forgot",
    codeHash,
    expiresAt: { $gt: now },
    $or: [{ usedAt: null }, { usedAt: { $exists: false } }],
  });

  if (!otpDoc) {
    throw new AppError("Invalid or expired code", 400, "OTP_INVALID");
  }

  const user = await User.findOne({ email: normalizedEmail }).select(
    "+password",
  );
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");

  const passwordViolations = await validatePasswordAgainstPolicy(newPassword);
  if (passwordViolations.length) {
    throw new AppError(
      `Password does not meet policy requirements: ${passwordViolations.join("; ")}`,
      400,
      "PASSWORD_POLICY_VIOLATION",
    );
  }

  user.password = newPassword;
  await user.save();

  otpDoc.usedAt = now;
  await otpDoc.save();

  await logActivity({
    userId: user._id,
    type: "authentication",
    description: "User reset password via email OTP",
    metadata: { email: user.email },
  });

  return { message: "Password has been reset successfully" };
}

export async function listUsers({
  page = 1,
  limit = 20,
  search,
  role,
  status,
  tenantId,
  actor,
}) {
  if (!actor) {
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  }

  const resolvedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const resolvedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 20;

  const query = {};
  if (search) {
    query.$or = [
      { firstName: new RegExp(search, "i") },
      { lastName: new RegExp(search, "i") },
      { email: new RegExp(search, "i") },
    ];
  }

  if (role) query.role = role;

  if (status !== undefined && status !== null && String(status).trim() !== "") {
    const normalizedStatus = String(status).trim().toLowerCase();
    if (["active", "true", "1"].includes(normalizedStatus)) {
      query.isActive = true;
    } else if (
      ["disabled", "inactive", "false", "0"].includes(normalizedStatus)
    ) {
      query.isActive = false;
    } else {
      throw new AppError(
        "Invalid status filter. Use active or disabled",
        400,
        "INVALID_STATUS_FILTER",
      );
    }
  }

  const tenantFilter =
    tenantId !== undefined && tenantId !== null ? String(tenantId).trim() : "";

  if (isOrgAdminPlaneActor(actor)) {
    query.tenantId = actor.tenantId;

    if (tenantFilter && tenantFilter !== String(actor.tenantId)) {
      throw new AppError(
        "Org Admin can only filter users inside their own tenant",
        403,
        "TENANT_SCOPE_VIOLATION",
      );
    }

    if (query.role === "superAdmin") {
      throw new AppError(
        "Org Admin cannot list System Admin users",
        403,
        "FORBIDDEN",
      );
    }
  } else if (tenantFilter) {
    if (tenantFilter === "__GLOBAL__") {
      query.tenantId = null;
    } else {
      const isObjectIdLike = /^[a-fA-F0-9]{24}$/.test(tenantFilter);
      if (!isObjectIdLike) {
        throw new AppError("Invalid tenant id", 400, "INVALID_TENANT_ID");
      }
      const tenantExists = await Tenant.exists({ _id: tenantFilter });
      if (!tenantExists) {
        throw new AppError("Tenant not found", 404, "TENANT_NOT_FOUND");
      }
      query.tenantId = tenantFilter;
    }
  }

  const total = await User.countDocuments(query);
  const users = await User.find(query)
    .populate("tenantId", "name code")
    .sort({ createdAt: -1 })
    .skip((resolvedPage - 1) * resolvedLimit)
    .limit(resolvedLimit);

  return {
    users,
    total,
    page: resolvedPage,
    limit: resolvedLimit,
    totalPages: Math.ceil(total / resolvedLimit),
  };
}

export async function deactivateUser(userId, actor) {
  const existingUser = await User.findById(userId);
  if (!existingUser)
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, existingUser, "deactivate");

  const user = await User.findByIdAndUpdate(
    userId,
    { isActive: false },
    { new: true },
  );
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

export async function activateUser(userId, actor) {
  const existingUser = await User.findById(userId);
  if (!existingUser)
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, existingUser, "activate");

  const user = await User.findByIdAndUpdate(
    userId,
    { isActive: true },
    { new: true },
  );
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

export async function assignRole(userId, role, actor) {
  const validRoles = [
    "admin",
    "superAdmin",
    "certAdmin",
    "sodAdmin",
    "manager",
    "viewer",
    "auditAnalytics",
  ];
  if (!validRoles.includes(role))
    throw new AppError("Invalid role", 400, "INVALID_ROLE");

  const existingUser = await User.findById(userId);
  if (!existingUser)
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, existingUser, "assign role for");

  if (isOrgAdminPlaneActor(actor) && role === "superAdmin") {
    throw new AppError(
      "Org Admin cannot assign System Admin role",
      403,
      "FORBIDDEN",
    );
  }

  const user = await User.findByIdAndUpdate(userId, { role }, { new: true });
  return user;
}

export async function updateUserByAdmin(userId, data, actor) {
  const { role, department, tenantId } = data;
  const updateData = {};

  const existingUser = await User.findById(userId);
  if (!existingUser)
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, existingUser, "update");

  if (role) {
    const validRoles = [
      "admin",
      "superAdmin",
      "certAdmin",
      "sodAdmin",
      "manager",
      "viewer",
      "auditAnalytics",
    ];
    if (!validRoles.includes(role))
      throw new AppError("Invalid role", 400, "INVALID_ROLE");
    if (isOrgAdminPlaneActor(actor) && role === "superAdmin") {
      throw new AppError(
        "Org Admin cannot assign System Admin role",
        403,
        "FORBIDDEN",
      );
    }
    updateData.role = role;
  }

  if (department !== undefined) updateData.department = department;

  if (data.hasOwnProperty("tenantId")) {
    updateData.tenantId = tenantId || null;
  }

  if (isOrgAdminPlaneActor(actor)) {
    updateData.tenantId = actor.tenantId;
  }

  // Tenant rules by role when role changes:
  // - superAdmin: force tenant null
  // - admin: tenant optional
  // - tenant roles: tenant required
  if (updateData.role === "superAdmin") {
    updateData.tenantId = null;
  }

  if (
    updateData.role &&
    updateData.role !== "admin" &&
    updateData.role !== "superAdmin" &&
    !updateData.tenantId
  ) {
    if (!existingUser.tenantId) {
      throw new AppError(
        "Tenant assignment is required for this role",
        400,
        "TENANT_REQUIRED",
      );
    }
  }

  const user = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
  }).populate("tenantId", "name code");
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

export async function bulkImportUsers(fileBuffer, actor, options = {}) {
  const Papa = await import("papaparse");
  const csvString = fileBuffer.toString("utf-8").replace(/^\uFEFF/, "");
  const { data, meta, errors } = Papa.default.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => String(h || "").replace(/^\uFEFF/, "").trim(),
  });

  if (errors.length) {
    throw new AppError(
      "CSV parse error: " + errors[0].message,
      400,
      "CSV_PARSE_ERROR",
    );
  }

  const headers = (meta?.fields || []).map((h) => String(h || "").trim());
  const requiredHeaders = [
    "firstName",
    "lastName",
    "email",
    "role",
    "department",
    "phoneNumber",
  ];
  const missingHeaders = requiredHeaders.filter((h) => !headers.includes(h));
  if (missingHeaders.length) {
    throw new AppError(
      `CSV must include columns: firstName,lastName,email,role,department,phoneNumber. Missing: ${missingHeaders.join(", ")}`,
      400,
      "CSV_COLUMNS_INVALID",
    );
  }

  const results = { created: 0, failed: 0, errors: [] };
  const validRoles = [
    "admin",
    "superAdmin",
    "certAdmin",
    "sodAdmin",
    "manager",
    "viewer",
    "auditAnalytics",
  ];

  const defaultTenantId = options.defaultTenantId
    ? String(options.defaultTenantId).trim()
    : "";

  async function resolveTenantForRow(row, userRole) {
    if (userRole === "superAdmin") return null;

    if (isOrgAdminPlaneActor(actor)) {
      return resolveTenantIdValue(actor.tenantId);
    }

    const rawTenantId = String(row.tenantId || row.tenant || "").trim();
    const rawTenantCode = String(row.tenantCode || row.organizationCode || "").trim();

    if (rawTenantId) {
      const byId = await Tenant.findOne({ _id: rawTenantId, isActive: true }).select("_id");
      if (byId) return byId._id;
      throw new AppError(`Unknown tenantId: ${rawTenantId}`, 400, "INVALID_TENANT_ID");
    }

    if (rawTenantCode) {
      const byCode = await Tenant.findOne({
        code: new RegExp(`^${rawTenantCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        isActive: true,
      }).select("_id");
      if (byCode) return byCode._id;
      throw new AppError(`Unknown tenant code: ${rawTenantCode}`, 400, "INVALID_TENANT_CODE");
    }

    if (defaultTenantId && defaultTenantId !== "__GLOBAL__") {
      const byDefault = await Tenant.findOne({ _id: defaultTenantId, isActive: true }).select("_id");
      if (byDefault) return byDefault._id;
    }

    // Single-tenant deployments: auto-assign the only active tenant.
    const active = await Tenant.find({ isActive: true }).limit(2).select("_id");
    if (active.length === 1) return active[0]._id;

    // Platform admin creating an org/platform admin without tenant is allowed.
    if (userRole === "admin") return null;

    throw new AppError(
      "Tenant assignment is required for this role (add tenantId or tenantCode column, or select a tenant filter before import)",
      400,
      "TENANT_REQUIRED",
    );
  }

  for (const rawRow of data) {
    const row = {};
    for (const [key, value] of Object.entries(rawRow || {})) {
      const k = String(key || "").trim();
      row[k] = typeof value === "string" ? value.trim() : value;
    }

    try {
      const firstName = row.firstName;
      const lastName = row.lastName;
      const email = row.email ? String(row.email).toLowerCase() : "";
      const role = row.role || "viewer";
      const department = row.department || "";
      const phoneNumber = row.phoneNumber || "";

      if (!firstName || !lastName || !email) {
        results.failed++;
        results.errors.push({
          email: email || "unknown",
          reason: "Missing required fields (firstName, lastName, email)",
        });
        continue;
      }

      const existing = await User.findOne({ email });
      if (existing) {
        results.failed++;
        results.errors.push({ email, reason: "Email already exists" });
        continue;
      }

      let userRole = validRoles.includes(role) ? role : "viewer";
      if (isOrgAdminPlaneActor(actor) && userRole === "superAdmin") {
        userRole = "viewer";
      }

      const resolvedTenantId = await resolveTenantForRow(row, userRole);

      const tempPassword = crypto.randomBytes(12).toString("base64url");
      await User.create({
        firstName,
        lastName,
        email,
        password: tempPassword,
        role: userRole,
        tenantId: resolvedTenantId,
        department,
        phoneNumber,
      });
      results.created++;
    } catch (err) {
      results.failed++;
      results.errors.push({
        email: rawRow?.email || row?.email || "unknown",
        reason: err.message,
      });
    }
  }

  return results;
}

export async function resetUserPassword(userId, actor) {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, user, "reset password for");

  const ttlMinutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || 60);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await PasswordResetToken.findOneAndUpdate(
    { userId: user._id },
    {
      userId: user._id,
      tokenHash,
      expiresAt,
      usedAt: null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const baseUrl = getDeploymentAccess().publicUrl;
  const resetUrlBase = (baseUrl || "").replace(/\/$/, "");
  const resetUrl = `${resetUrlBase}/reset-password/confirm?token=${encodeURIComponent(rawToken)}`;

  const { subject, html } = await buildAdminInitiatedResetEmail({
    recipientName:
      user.firstName || user.lastName
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : user.email,
    resetUrl,
    expiresInMinutes: ttlMinutes,
  });

  await sendEmail({ to: user.email, subject, html });

  await logActivity({
    userId: user._id,
    type: "authentication",
    description: "Administrator initiated password reset",
    metadata: { email: user.email },
  });

  return {
    message:
      "Password reset email has been sent if the user account is active.",
  };
}

export async function revokeAllSessions(userId, actor) {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, user, "revoke sessions for");

  const result = await UserSession.updateMany(
    { userId, isRevoked: false },
    { isRevoked: true },
  );

  return {
    message:
      result.modifiedCount > 0
        ? "All sessions revoked"
        : "No active sessions to revoke",
    revokedCount: result.modifiedCount,
  };
}

export async function getUserActivity(userId, { page = 1, limit = 50 }, actor) {
  const user = await User.findById(userId);
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  ensureActorCanManageUser(actor, user, "read activity for");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const skip = (Number(page) - 1) * Number(limit);
  const query = { userId, createdAt: { $gte: thirtyDaysAgo } };

  const [items, total] = await Promise.all([
    Activity.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Activity.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function seedDefaultAdmin() {
  const adminExists = await User.findOne({ isDefault: true });
  if (adminExists) {
    // Ensure the built-in system account is truly platform-scoped.
    // For super admins, tenant context must be explicit (query/param) and should not be auto-bound.
    if (String(adminExists.email || "").toLowerCase() === "admin@wisibility.ai") {
      const needsUpdate =
        adminExists.role !== "superAdmin" || adminExists.tenantId != null;
      if (needsUpdate) {
        adminExists.role = "superAdmin";
        adminExists.tenantId = null;
        await adminExists.save();
      }
    }
    return null;
  }

  let password = env.adminPassword;
  let generatedPassword = false;
  if (!password) {
    // No hardcoded fallback — generate a one-time random password instead
    // and force it to be changed on first login.
    password = crypto.randomBytes(9).toString("base64url");
    generatedPassword = true;
  }

  const admin = await User.create({
    firstName: "System",
    lastName: "Admin",
    email: "admin@wisibility.ai",
    password,
    role: "superAdmin",
    tenantId: null,
    isDefault: true,
    isActive: true,
    mustChangePassword: Boolean(env.forceAdminPasswordReset) || generatedPassword,
  });
  console.log("Default admin created: admin@wisibility.ai");
  if (generatedPassword) {
    console.log(
      `[auth] ADMIN_PASSWORD was not set — generated a one-time password for admin@wisibility.ai: ${password}`,
    );
    console.log("[auth] This will not be shown again. Password must be changed on first login.");
  } else if (env.forceAdminPasswordReset) {
    console.log("[auth] Default admin must change password on first login");
  }
  return admin;
}
