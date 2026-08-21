import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import env from "../../config/env.js";
import { ensureDirSync } from "../../config/productPaths.js";
import { AppError } from "../../middleware/errorHandler.js";

export const SETUP_TOKEN_TTL_MS = 10 * 60 * 1000;
export const SETUP_TOKEN_HEADER = "x-ADSecurity-setup-token";

function setupDir() {
  return path.join(env.paths?.data || "", "setup");
}

export function setupTokenPath() {
  return path.join(setupDir(), "setup.token");
}

export function setupCompletedPath() {
  return path.join(setupDir(), "setup.completed");
}

/**
 * @returns {boolean}
 */
export function isSetupCompleted() {
  try {
    return fs.existsSync(setupCompletedPath());
  } catch {
    return false;
  }
}

/**
 * Create a one-time setup token file (Administrators/SYSTEM ACL is Configure's job).
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function createSetupToken() {
  if (isSetupCompleted()) {
    throw new AppError("Setup has already been completed", 409, "SETUP_ALREADY_COMPLETED");
  }

  ensureDirSync(setupDir());
  const token = crypto.randomBytes(32).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + SETUP_TOKEN_TTL_MS);
  const payload = {
    token,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const target = setupTokenPath();
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(tmp, target);
  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * @param {string} presented
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
export async function assertValidSetupToken(presented) {
  if (isSetupCompleted()) {
    throw new AppError("Setup has already been completed", 409, "SETUP_ALREADY_COMPLETED");
  }

  const raw = String(presented || "").trim();
  if (!raw) {
    throw new AppError("Setup token is required", 401, "SETUP_TOKEN_REQUIRED");
  }

  let stored;
  try {
    const text = await fsp.readFile(setupTokenPath(), "utf8");
    stored = JSON.parse(text);
  } catch {
    throw new AppError("Setup token is missing or invalid", 401, "SETUP_TOKEN_INVALID");
  }

  if (!stored?.token || typeof stored.token !== "string") {
    throw new AppError("Setup token is missing or invalid", 401, "SETUP_TOKEN_INVALID");
  }

  const a = Buffer.from(stored.token, "utf8");
  const b = Buffer.from(raw, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("Setup token is invalid", 401, "SETUP_TOKEN_INVALID");
  }

  const expiresAt = Date.parse(stored.expiresAt || "");
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    await deleteSetupToken().catch(() => {});
    throw new AppError("Setup token has expired", 401, "SETUP_TOKEN_EXPIRED");
  }

  return { token: stored.token, expiresAt: stored.expiresAt };
}

export async function deleteSetupToken() {
  try {
    await fsp.unlink(setupTokenPath());
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

/**
 * Mark first-run setup complete and invalidate the token.
 */
export async function markSetupCompleted(meta = {}) {
  ensureDirSync(setupDir());
  const payload = {
    completedAt: new Date().toISOString(),
    ...meta,
  };
  const target = setupCompletedPath();
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(payload)}\n`, "utf8");
  await fsp.rename(tmp, target);
  await deleteSetupToken();
}
