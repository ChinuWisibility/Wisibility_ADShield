import User from "../../models/platform/User.js";
import env from "../../config/env.js";
import { AppError } from "../../middleware/errorHandler.js";
import { isPlatformPlaneUser } from "../../middleware/auth.js";
import { logActivity } from "../system/activityService.js";
import {
  sendEmail,
  buildIdentityOnboardingEmail,
} from "../email/appEmailService.js";
import { prepareCertificationEmailForSend } from "../access-certification/certificationEmailTemplates.js";
import { issueIdentityOnboardingTokenForUser } from "../auth/authService.js";
import { getDeploymentAccess } from "../system/deploymentAccessService.js";
import { isValidEmailSyntax, normalizeEmailAddress } from "../../utils/emailSyntax.js";
import {
  buildUsernameBase,
  isMongoDuplicateKey,
  usernameWithCollisionSuffix,
} from "./usernameGenerator.js";
import { PASSWORD_STATUS } from "../../utils/identityOnboardingState.js";
import UserSession from "../../models/platform/UserSession.js";
import PasswordResetToken from "../../models/platform/PasswordResetToken.js";
import PasswordOtp from "../../models/platform/PasswordOtp.js";
import MFAConfiguration from "../../models/platform/MFAConfiguration.js";

const PLATFORM_ROLES = [
  "admin",
  "certAdmin",
  "sodAdmin",
  "manager",
  "viewer",
  "auditAnalytics",
];

const USERNAME_MAX_ATTEMPTS = 50;

function resolveTenantIdValue(tenantId) {
  if (tenantId == null || tenantId === "") return null;
  if (typeof tenantId === "object") {
    const id = tenantId._id ?? tenantId.id;
    if (id == null || id === "") return null;
    return String(id);
  }
  return String(tenantId);
}

function isOrgAdminPlaneActor(actor) {
  if (actor?.role !== "admin") return false;
  if (isPlatformPlaneUser(actor)) return false;
  return Boolean(resolveTenantIdValue(actor?.tenantId));
}

export function extractIdentityEmail(identityLike) {
  const attrs = identityLike?.attributes && typeof identityLike.attributes === "object"
    ? identityLike.attributes
    : {};
  const candidates = [
    identityLike?.email,
    attrs.email,
    attrs.mail,
    attrs.workEmail,
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return normalizeEmailAddress(value);
  }
  return "";
}

export function resolveOnboardingPlatformRole(_actor, requestedRole) {
  const requested = String(requestedRole || "").trim();
  if (requested === "superAdmin") {
    throw new AppError(
      "System Admin cannot be assigned from identity onboarding",
      403,
      "FORBIDDEN",
    );
  }
  return PLATFORM_ROLES.includes(requested) ? requested : "viewer";
}

function displayNameForUser(identity) {
  const first = String(identity?.firstName || "").trim();
  const last = String(identity?.lastName || "").trim();
  if (first || last) return { firstName: first || last || "User", lastName: last || first || "User" };
  const display = String(identity?.displayName || "").trim();
  if (display) {
    const parts = display.split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || "User",
      lastName: parts.slice(1).join(" ") || parts[0] || "User",
    };
  }
  return { firstName: "User", lastName: "User" };
}

function getConfiguredInitialPassword() {
  const value = String(env.defaultInitialPassword || "").trim();
  return value || "";
}

/**
 * Fail before Identity.create when an email is present but onboarding cannot proceed.
 * Missing email is allowed — Identity creation continues without a portal User.
 */
export async function assertPortalOnboardingPreconditions({
  identityPayload,
  actor,
  platformRole,
  tenantId,
}) {
  const email = extractIdentityEmail(identityPayload);
  if (!email) return { email: "", skip: true };

  if (!isValidEmailSyntax(email)) {
    throw new AppError("Please provide a valid email address", 400, "INVALID_EMAIL");
  }

  const existing = await User.findOne({ email }).select("_id").lean();
  if (existing) {
    throw new AppError(
      "An ADSecurity account already exists for this email",
      409,
      "EMAIL_ALREADY_REGISTERED",
    );
  }

  const initialPassword = getConfiguredInitialPassword();
  if (!initialPassword) {
    throw new AppError(
      "Portal user onboarding is not configured",
      500,
      "USER_CREATION_FAILED",
    );
  }

  resolveOnboardingPlatformRole(actor, platformRole);

  const resolvedTenant = resolveTenantIdValue(tenantId || identityPayload?.tenantId);
  if (!resolvedTenant) {
    throw new AppError(
      "Tenant assignment is required to create a portal user",
      400,
      "TENANT_REQUIRED",
    );
  }

  if (
    isOrgAdminPlaneActor(actor) &&
    resolveTenantIdValue(actor.tenantId) &&
    String(resolvedTenant) !== String(actor.tenantId)
  ) {
    throw new AppError(
      "Cannot create a user outside your tenant",
      403,
      "TENANT_SCOPE_VIOLATION",
    );
  }

  return { email, skip: false };
}

async function createPortalUserWithUniqueUsername(attrs) {
  const base = buildUsernameBase(attrs);
  if (!base) {
    throw new AppError("Could not generate a username", 400, "USERNAME_GENERATION_FAILED");
  }

  for (let attempt = 0; attempt < USERNAME_MAX_ATTEMPTS; attempt += 1) {
    const username = usernameWithCollisionSuffix(base, attempt);
    try {
      return await User.create({ ...attrs, username });
    } catch (err) {
      if (isMongoDuplicateKey(err, "username")) continue;
      if (isMongoDuplicateKey(err, "email")) {
        throw new AppError(
          "An ADSecurity account already exists for this email",
          409,
          "EMAIL_ALREADY_REGISTERED",
        );
      }
      throw err;
    }
  }

  throw new AppError(
    "Could not generate a unique username",
    409,
    "USERNAME_GENERATION_FAILED",
  );
}

/**
 * Create/link a portal User after Identity save. Email failure does not roll back
 * the Identity or User. Never returns or logs the plaintext password.
 */
export async function provisionPortalUserForIdentity({
  identity,
  actor,
  platformRole,
  requestMeta = {},
}) {
  const email = extractIdentityEmail(identity);
  if (!email) {
    return { created: false, skipped: true, reason: "NO_EMAIL" };
  }

  const initialPassword = getConfiguredInitialPassword();
  if (!initialPassword) {
    return { created: false, skipped: true, reason: "NOT_CONFIGURED" };
  }

  const tenantId = identity.tenantId;
  if (!tenantId) {
    return { created: false, skipped: true, reason: "NO_TENANT" };
  }

  const names = displayNameForUser(identity);
  const role = resolveOnboardingPlatformRole(actor, platformRole);
  const actorId = actor?.id || actor?._id || null;

  let user;
  try {
    user = await createPortalUserWithUniqueUsername({
      firstName: names.firstName,
      lastName: names.lastName,
      email,
      password: initialPassword,
      role,
      tenantId,
      identityId: identity._id,
      createdBy: actorId || undefined,
      mustChangePassword: false,
      passwordStatus: PASSWORD_STATUS.ONBOARDING,
      isActive: true,
    });
  } catch (err) {
    if (err instanceof AppError) {
      await logActivity({
        userId: actorId,
        tenantId,
        type: "authentication",
        description: "Portal user creation from identity failed",
        entityType: "Identity",
        entityId: String(identity._id),
        metadata: { code: err.code },
      }).catch(() => {});
      return {
        created: false,
        skipped: false,
        error: { code: err.code, message: err.message },
      };
    }
    await logActivity({
      userId: actorId,
      tenantId,
      type: "authentication",
      description: "Portal user creation from identity failed",
      entityType: "Identity",
      entityId: String(identity._id),
      metadata: { code: "USER_CREATION_FAILED" },
    }).catch(() => {});
    return {
      created: false,
      skipped: false,
      error: { code: "USER_CREATION_FAILED", message: "Failed to create portal user" },
    };
  }

  await logActivity({
    userId: actorId,
    tenantId,
    type: "authentication",
    description: "Portal user created from identity",
    entityType: "User",
    entityId: String(user._id),
    metadata: {
      identityId: String(identity._id),
      username: user.username,
      email: user.email,
      role: user.role,
    },
  }).catch(() => {});

  let emailStatus = "pending";
  try {
    const { createPasswordUrl: issuedCreatePasswordUrl, ttlDays } =
      await issueIdentityOnboardingTokenForUser(user, requestMeta);
    // TEMP DEV ONLY — newdom.codenextech.in is not ready for Create Own Password yet.
    // Restore the configured domain when that host serves the frontend correctly:
    // const publicUrl = (getDeploymentAccess().publicUrl || env.frontendUrl || "").replace(/\/$/, "");
    const publicUrl = "http://localhost:3000";
    const loginUrl = `${publicUrl}/login`;
    // Keep the same secure token; only swap the email link host for local testing.
    const createPasswordUrl = issuedCreatePasswordUrl.replace(
      /^https?:\/\/[^/?#]+/,
      publicUrl,
    );
    const recipientName =
      `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.username;

    const { subject, html } = await buildIdentityOnboardingEmail({
      recipientName,
      username: user.username,
      password: initialPassword,
      loginUrl,
      createPasswordUrl,
      expiresInDays: ttlDays,
    });
    const prepared = await prepareCertificationEmailForSend(html);
    await sendEmail({
      to: email,
      subject,
      html: prepared.html,
      attachments: prepared.attachments,
      metadata: {
        emailType: "OTHER",
        tenantId,
      },
    });
    emailStatus = "sent";
    await logActivity({
      userId: actorId,
      tenantId,
      type: "authentication",
      description: "Identity onboarding email sent",
      entityType: "User",
      entityId: String(user._id),
      metadata: { username: user.username, email: user.email },
    }).catch(() => {});
  } catch {
    emailStatus = "failed";
    await logActivity({
      userId: actorId,
      tenantId,
      type: "authentication",
      description: "Identity onboarding email failed",
      entityType: "User",
      entityId: String(user._id),
      metadata: { username: user.username, email: user.email, code: "ONBOARDING_EMAIL_FAILED" },
    }).catch(() => {});
  }

  return {
    created: true,
    skipped: false,
    username: user.username,
    role: user.role,
    emailStatus,
    ...(emailStatus === "failed"
      ? { error: { code: "ONBOARDING_EMAIL_FAILED", message: "Portal user created but the welcome email could not be sent" } }
      : {}),
  };
}

/**
 * Permanently remove the Portal User linked by User.identityId.
 * Does not match by email or username.
 */
export async function hardDeletePortalUserLinkedToIdentity({
  identityId,
  actorId,
  tenantId,
}) {
  if (!identityId) return { deleted: false };

  const user = await User.findOne({ identityId }).select("_id email username identityId tenantId");
  if (!user) return { deleted: false };

  const userId = user._id;
  try {
    const sessionResult = await UserSession.updateMany(
      { userId, isRevoked: false },
      { $set: { isRevoked: true } },
    );

    await Promise.all([
      UserSession.deleteMany({ userId }),
      PasswordResetToken.deleteMany({ userId }),
      PasswordOtp.deleteMany({ email: user.email }),
      MFAConfiguration.deleteMany({ userId }),
    ]);

    const removed = await User.deleteOne({ _id: userId, identityId });
    if (!removed?.deletedCount) {
      throw new AppError(
        "Failed to delete the linked ADSecurity user",
        500,
        "LINKED_USER_DELETE_FAILED",
      );
    }

    await logActivity({
      userId: actorId,
      tenantId: tenantId || user.tenantId,
      type: "authentication",
      description: "Linked portal user hard deleted with identity",
      entityType: "User",
      entityId: String(userId),
      metadata: {
        identityId: String(identityId),
        username: user.username,
        email: user.email,
        sessionsRevoked: sessionResult.modifiedCount || 0,
      },
    }).catch(() => {});

    return { deleted: true, userId: String(userId) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "Failed to delete the linked ADSecurity user",
      500,
      "LINKED_USER_DELETE_FAILED",
    );
  }
}
