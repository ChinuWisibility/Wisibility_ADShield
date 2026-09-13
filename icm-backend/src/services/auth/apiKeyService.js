import crypto from "crypto";
import ApiKey from "../../models/platform/ApiKey.js";
import { AppError } from "../../middleware/errorHandler.js";
import { encryptString } from "../../utils/crypto.js";

function isPlatformPlaneActor(actor) {
  return (
    actor?.role === "superAdmin" ||
    (actor?.role === "admin" && !actor?.tenantId)
  );
}

function applyTenantScope(query, actor) {
  if (!actor)
    throw new AppError("Authentication required", 401, "AUTH_REQUIRED");
  if (isPlatformPlaneActor(actor)) return query;
  if (!actor.tenantId)
    throw new AppError("Tenant context required", 403, "TENANT_SCOPE_REQUIRED");
  query.tenantId = actor.tenantId;
  return query;
}

function generateRawKey() {
  return `icm_${crypto.randomBytes(32).toString("hex")}`;
}

function hashKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export async function createApiKey(
  { keyName, scopes, expiresAt },
  issuedTo,
  actor,
) {
  if (!keyName)
    throw new AppError("keyName is required", 400, "MISSING_KEY_NAME");

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);

  const apiKey = await ApiKey.create({
    keyName,
    keyHashEncrypted: encryptString(keyHash),
    issuedTo,
    tenantId: actor?.tenantId || null,
    scopes: scopes || [],
    expiresAt: expiresAt ? new Date(expiresAt) : undefined,
  });

  return { apiKey, plainKey: rawKey };
}

export async function listApiKeys({ page = 1, limit = 20 }, actor) {
  const query = { isRevoked: false };
  applyTenantScope(query, actor);
  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    ApiKey.find(query)
      .select("-keyHashEncrypted")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("issuedTo", "firstName lastName email"),
    ApiKey.countDocuments(query),
  ]);

  return {
    items,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / Number(limit)),
  };
}

export async function revokeApiKey(id, actor) {
  const query = { _id: id };
  applyTenantScope(query, actor);
  const apiKey = await ApiKey.findOne(query);
  if (!apiKey) throw new AppError("API key not found", 404, "KEY_NOT_FOUND");
  if (apiKey.isRevoked)
    throw new AppError("API key already revoked", 400, "KEY_ALREADY_REVOKED");

  apiKey.isRevoked = true;
  await apiKey.save();
  return { message: "API key revoked" };
}

export async function rotateApiKey(id, issuedTo, actor) {
  const query = { _id: id };
  applyTenantScope(query, actor);
  const oldKey = await ApiKey.findOne(query);
  if (!oldKey) throw new AppError("API key not found", 404, "KEY_NOT_FOUND");

  oldKey.isRevoked = true;
  await oldKey.save();

  const rawKey = generateRawKey();
  const keyHash = hashKey(rawKey);

  const newKey = await ApiKey.create({
    keyName: oldKey.keyName,
    keyHashEncrypted: encryptString(keyHash),
    issuedTo: issuedTo || oldKey.issuedTo,
    tenantId: oldKey.tenantId || actor?.tenantId || null,
    scopes: oldKey.scopes,
    expiresAt: oldKey.expiresAt,
  });

  return { apiKey: newKey, plainKey: rawKey };
}
