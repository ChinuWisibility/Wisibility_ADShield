import mongoose from "mongoose";
import TenantMaterializationLock from "../models/identity/TenantMaterializationLock.js";
import { toTenantObjectId } from "./identityTenantStatsService.js";
import { getScopedTenantId, isPlatformPlaneUser } from "../middleware/auth.js";

export const MATERIALIZATION_LOCK_KEY = "IDENTITY_MATERIALIZATION";

/** Enough for very large delimited refreshes + chained profiles (single bulk call). */
const DEFAULT_LOCK_TTL_MS = 45 * 60 * 1000;

export function formatLockOwnerDisplayName(doc) {
  if (!doc) return "";
  const fn = String(doc.ownerFirstName || "").trim();
  const ln = String(doc.ownerLastName || "").trim();
  const combined = [fn, ln].filter(Boolean).join(" ").trim();
  if (combined) return combined;
  if (doc.ownerEmail) return String(doc.ownerEmail);
  return "Another user";
}

export function buildLockOwnerFieldsFromRequest(req) {
  const uid = req.user?.id || req.user?._id;
  const email = String(req.user?.email || "").trim();
  const fn = String(req.user?.firstName || "").trim();
  const ln = String(req.user?.lastName || "").trim();
  return {
    ownerUserId: uid && mongoose.Types.ObjectId.isValid(String(uid)) ? new mongoose.Types.ObjectId(String(uid)) : null,
    ownerEmail: email,
    ownerFirstName: fn,
    ownerLastName: ln,
  };
}

/**
 * Resolve tenant ObjectId for lock operations and assert caller may operate on it.
 * @param {import('express').Request} req
 * @param {string|mongoose.Types.ObjectId} tenantId
 */
export function resolveTenantIdForLock(req, tenantId) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) {
    const err = new Error("Invalid tenant");
    err.statusCode = 400;
    throw err;
  }
  if (isPlatformPlaneUser(req.user)) {
    return tid;
  }
  const scope = getScopedTenantId(req.user);
  const scopeOid = toTenantObjectId(scope);
  if (!scopeOid || !tid.equals(scopeOid)) {
    const err = new Error("You are not allowed to run identity sync for this tenant.");
    err.statusCode = 403;
    throw err;
  }
  return tid;
}

/**
 * Ensure lock row exists (unlocked), then try atomic acquire.
 * @returns {{ ok: true } | { ok: false, lock: object }}
 */
export async function tryAcquireMaterializationLock(tenantOid, req, operation, ttlMs = DEFAULT_LOCK_TTL_MS) {
  const fields = buildLockOwnerFieldsFromRequest(req);
  if (!fields.ownerUserId) {
    const err = new Error("Invalid user session for lock acquisition");
    err.statusCode = 401;
    throw err;
  }

  await TenantMaterializationLock.updateOne(
    { tenantId: tenantOid, lockKey: MATERIALIZATION_LOCK_KEY },
    {
      $setOnInsert: {
        tenantId: tenantOid,
        lockKey: MATERIALIZATION_LOCK_KEY,
        locked: false,
        expiresAt: new Date(0),
      },
    },
    { upsert: true },
  );

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  const acquired = await TenantMaterializationLock.findOneAndUpdate(
    {
      tenantId: tenantOid,
      lockKey: MATERIALIZATION_LOCK_KEY,
      $or: [{ locked: { $ne: true } }, { expiresAt: { $lte: now } }],
    },
    {
      $set: {
        locked: true,
        ...fields,
        operation: String(operation || "").slice(0, 64),
        acquiredAt: now,
        expiresAt,
      },
    },
    { new: true },
  ).lean();

  if (acquired) {
    return { ok: true, lock: acquired };
  }

  const blocking = await TenantMaterializationLock.findOne({
    tenantId: tenantOid,
    lockKey: MATERIALIZATION_LOCK_KEY,
  }).lean();

  return {
    ok: false,
    lock: blocking
      ? {
          ownerDisplayName: formatLockOwnerDisplayName(blocking),
          ownerEmail: blocking.ownerEmail || "",
          operation: blocking.operation || "",
          acquiredAt: blocking.acquiredAt || null,
          expiresAt: blocking.expiresAt || null,
        }
      : {},
  };
}

/** Release only if current JWT user is the lock owner (stale clients cannot steal-clear). */
export async function releaseMaterializationLock(tenantOid, req) {
  const uid = req.user?.id || req.user?._id;
  if (!uid || !mongoose.Types.ObjectId.isValid(String(uid))) return false;
  const ownerOid = new mongoose.Types.ObjectId(String(uid));
  const r = await TenantMaterializationLock.updateOne(
    {
      tenantId: tenantOid,
      lockKey: MATERIALIZATION_LOCK_KEY,
      ownerUserId: ownerOid,
      locked: true,
    },
    {
      $set: {
        locked: false,
        expiresAt: new Date(0),
        operation: "",
      },
    },
  );
  return r.modifiedCount > 0;
}

export async function getMaterializationLockStatusForTenant(tenantOid) {
  const doc = await TenantMaterializationLock.findOne({
    tenantId: tenantOid,
    lockKey: MATERIALIZATION_LOCK_KEY,
  }).lean();
  const now = new Date();
  if (!doc || !doc.locked || !doc.expiresAt || doc.expiresAt <= now) {
    return { active: false };
  }
  return {
    active: true,
    ownerDisplayName: formatLockOwnerDisplayName(doc),
    ownerEmail: doc.ownerEmail || "",
    operation: doc.operation || "",
    acquiredAt: doc.acquiredAt || null,
    expiresAt: doc.expiresAt || null,
  };
}
