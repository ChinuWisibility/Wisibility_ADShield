import fs from "fs/promises";
import path from "path";
import env from "../../config/env.js";
import { ensureDirSync } from "../../config/productPaths.js";
import User from "../../models/platform/User.js";
import Tenant from "../../models/platform/Tenant.js";
import PasswordPolicy from "../../models/platform/PasswordPolicy.js";
import SystemConfiguration from "../../models/platform/SystemConfiguration.js";
import {
  getLicenseManager,
  setLicenseRequiredMode,
} from "../../licensing/licenseRuntime.js";
import { LicenseException } from "../../licensing/exceptions/index.js";
import { AppError } from "../../middleware/errorHandler.js";
import { isSetupCompleted, markSetupCompleted } from "./setupTokenService.js";

const DEFAULT_PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

/**
 * Split a full name into first/last for User model.
 * @param {string} name
 */
export function splitAdminName(name) {
  const trimmed = String(name || "").trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return { firstName: "", lastName: "" };
  }
  const parts = trimmed.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Admin" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

/**
 * @param {string} password
 * @param {object} [policy]
 * @returns {string[]}
 */
export function validatePasswordAgainstPolicy(password, policy = DEFAULT_PASSWORD_RULES) {
  const violations = [];
  const pwd = String(password || "");
  const minLength = Number(policy.minLength) || DEFAULT_PASSWORD_RULES.minLength;
  if (pwd.length < minLength) {
    violations.push(`Minimum length is ${minLength} characters`);
  }
  if (policy.requireUppercase !== false && !/[A-Z]/.test(pwd)) {
    violations.push("Must contain at least one uppercase letter");
  }
  if (policy.requireLowercase !== false && !/[a-z]/.test(pwd)) {
    violations.push("Must contain at least one lowercase letter");
  }
  if (policy.requireNumbers !== false && !/[0-9]/.test(pwd)) {
    violations.push("Must contain at least one number");
  }
  if (policy.requireSpecialChars !== false && !/[^A-Za-z0-9]/.test(pwd)) {
    violations.push("Must contain at least one special character");
  }
  return violations;
}

function licenseCanonicalPath() {
  return (
    env.license.envFilePath ||
    env.paths?.licenseDefault ||
    path.join(env.paths?.data || "", "license", "license.lic.json")
  );
}

/**
 * Ensure licensePath resolves under DataRoot\license and exists.
 * @param {string} licensePath
 */
export function resolveTrustedLicensePath(licensePath) {
  const dataRoot = path.resolve(env.paths?.data || "");
  if (!dataRoot) {
    throw new AppError("Data root is not configured", 500, "DATA_ROOT_MISSING");
  }
  const licenseRoot = path.resolve(path.join(dataRoot, "license"));
  const resolved = path.resolve(String(licensePath || ""));
  const rel = path.relative(licenseRoot, resolved);
  if (!resolved || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AppError(
      "licensePath must be under the product license directory",
      400,
      "INVALID_LICENSE_PATH",
    );
  }
  return resolved;
}

async function ensureDefaultPasswordPolicy() {
  let policy = await PasswordPolicy.findOne({ isDefault: true });
  if (!policy) policy = await PasswordPolicy.findOne();
  if (policy) return { policy, created: false };

  policy = await PasswordPolicy.create({
    policyName: "Default Policy",
    minLength: 8,
    requireUppercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAgeDays: 90,
    historyCount: 5,
    lockoutAttempts: 5,
    lockoutDurationMinutes: 30,
    isDefault: true,
  });
  return { policy, created: true };
}

function buildTenantCode(email) {
  const domain = String(email || "")
    .split("@")[1]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const base = (domain || "default").slice(0, 24) || "default";
  return base.toUpperCase().slice(0, 32);
}

/**
 * Atomic first-run bootstrap: admin + tenant + password policy + license.
 * Rolls back identity seed if license activation fails.
 *
 * @param {{ admin: object, licensePath: string }} input
 */
export async function initializeSetup(input) {
  if (isSetupCompleted()) {
    throw new AppError("Setup has already been completed", 409, "SETUP_ALREADY_COMPLETED");
  }

  const existingDefault = await User.findOne({ isDefault: true });
  if (existingDefault) {
    throw new AppError(
      "An administrator already exists; setup cannot run again",
      409,
      "SETUP_ALREADY_COMPLETED",
    );
  }

  const admin = input?.admin || {};
  const name = String(admin.name || "").trim();
  const email = String(admin.email || "").trim().toLowerCase();
  const phone = admin.phone != null ? String(admin.phone).trim() : "";
  const password = admin.password;

  if (!name || name.length > 120) {
    throw new AppError("Administrator name is required", 400, "INVALID_ADMIN_NAME");
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("A valid administrator email is required", 400, "INVALID_ADMIN_EMAIL");
  }
  if (phone && !/^[+0-9()\-\s]{0,40}$/.test(phone)) {
    throw new AppError("Administrator phone is invalid", 400, "INVALID_ADMIN_PHONE");
  }
  if (!password || typeof password !== "string") {
    throw new AppError("Administrator password is required", 400, "INVALID_ADMIN_PASSWORD");
  }

  const { policy: passwordPolicy, created: createdPolicy } = await ensureDefaultPasswordPolicy();
  const violations = validatePasswordAgainstPolicy(password, {
    minLength: passwordPolicy.minLength,
    requireUppercase: passwordPolicy.requireUppercase,
    requireLowercase: true,
    requireNumbers: passwordPolicy.requireNumbers,
    requireSpecialChars: passwordPolicy.requireSpecialChars,
  });
  if (violations.length) {
    throw new AppError(violations[0], 400, "PASSWORD_POLICY_VIOLATION");
  }

  const trustedLicensePath = resolveTrustedLicensePath(input.licensePath);
  let raw;
  try {
    raw = await fs.readFile(trustedLicensePath, "utf8");
  } catch {
    throw new AppError("License file could not be read", 400, "LICENSE_FILE_MISSING");
  }
  if (!String(raw).trim()) {
    throw new AppError("License file is empty", 400, "LICENSE_FILE_EMPTY");
  }

  const manager = getLicenseManager();
  if (!manager) {
    throw new AppError("License manager not initialized", 500, "LICENSE_MANAGER_MISSING");
  }

  const { firstName, lastName } = splitAdminName(name);
  const created = {
    userId: null,
    tenantId: null,
    policyId: createdPolicy ? passwordPolicy._id : null,
  };

  try {
    const tenant = await Tenant.create({
      name: `${firstName}'s Organization`.slice(0, 120),
      code: buildTenantCode(email),
      subscriptionTier: "enterprise",
      isActive: true,
    });
    created.tenantId = tenant._id;

    const user = await User.create({
      firstName,
      lastName,
      email,
      password,
      phoneNumber: phone || undefined,
      role: "superAdmin",
      tenantId: null,
      isDefault: true,
      isActive: true,
      mustChangePassword: false,
    });
    created.userId = user._id;

    tenant.createdBy = user._id;
    await tenant.save();

    // Verify license before rewriting canonical path (file may already be there)
    await manager.reload({ raw: String(raw), filePath: "setup-initialize" });

    const target = licenseCanonicalPath();
    ensureDirSync(path.dirname(target));
    if (path.resolve(trustedLicensePath) !== path.resolve(target)) {
      const tmp = `${target}.${process.pid}.tmp`;
      const body = String(raw).trim().endsWith("\n") ? String(raw).trim() : `${String(raw).trim()}\n`;
      await fs.writeFile(tmp, body, "utf8");
      await fs.rename(tmp, target);
    }

    await manager.reload({ filePath: target });
    setLicenseRequiredMode(false);

    await SystemConfiguration.findOneAndUpdate(
      { key: "setupBootstrapComplete" },
      {
        key: "setupBootstrapComplete",
        value: true,
        category: "security",
        description: "Installer first-run bootstrap completed",
      },
      { upsert: true, new: true },
    );

    await markSetupCompleted({
      adminEmail: email,
      tenantId: String(tenant._id),
    });

    return {
      admin: {
        id: String(user._id),
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
      },
      tenant: {
        id: String(tenant._id),
        name: tenant.name,
        code: tenant.code,
      },
      license: {
        licensed: true,
        summary: manager.getValidatedLicense()?.toLogSummary?.() || null,
        path: target,
      },
    };
  } catch (err) {
    await rollbackIdentitySeed(created);
    if (err instanceof LicenseException) {
      throw new AppError(err.internalReason || "Invalid license", 400, "INVALID_LICENSE");
    }
    if (err instanceof SyntaxError) {
      throw new AppError("License JSON is malformed", 400, "INVALID_LICENSE_JSON");
    }
    if (err instanceof AppError) throw err;
    throw err;
  }
}

async function rollbackIdentitySeed(created) {
  try {
    if (created.userId) {
      await User.deleteOne({ _id: created.userId });
    }
  } catch (e) {
    console.warn("[setup] rollback user failed:", e?.message || e);
  }
  try {
    if (created.tenantId) {
      await Tenant.deleteOne({ _id: created.tenantId });
    }
  } catch (e) {
    console.warn("[setup] rollback tenant failed:", e?.message || e);
  }
  try {
    if (created.policyId) {
      await PasswordPolicy.deleteOne({ _id: created.policyId });
    }
  } catch (e) {
    console.warn("[setup] rollback password policy failed:", e?.message || e);
  }
  try {
    await SystemConfiguration.deleteOne({ key: "setupBootstrapComplete" });
  } catch (e) {
    console.warn("[setup] rollback setup flag failed:", e?.message || e);
  }
}
