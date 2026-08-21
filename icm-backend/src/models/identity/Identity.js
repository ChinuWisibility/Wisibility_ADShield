import mongoose from "mongoose";
import {
  getTenantIdentityCollectionName,
  resolveTenantSlugFromTenantId,
  toTenantObjectId,
} from "../../utils/applicationDynamicCollections.js";

const LEGACY_IDENTITY_MODEL_NAME = "Identity";
const LEGACY_IDENTITY_COLLECTION = "identities";
const TENANT_IDENTITY_MODEL_PREFIX = "TenantIdentity__";
const TENANT_IDENTITY_BULK_CHUNK = 500;

export const identitySchema = new mongoose.Schema(
  {
    displayName: { type: String, required: true },
    firstName: { type: String },
    lastName: { type: String },
    email: { type: String },
    employeeId: { type: String },
    department: { type: String },
    title: { type: String },
    manager: { type: String },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "Identity" },
    managerEmail: { type: String },
    managerEmployeeId: { type: String },
    managerKeyRaw: { type: String, default: null },
    managerResolutionStatus: {
      type: String,
      enum: ["resolved", "unresolved", "root"],
    },
    managerCorrelationStatus: { type: String },
    governanceStatus: { type: String },
    isRoot: { type: Boolean, default: false },
    lifecycleState: {
      type: String,
      enum: ["NEW", "ACTIVE", "MOVER", "LEAVER", "TERMINATED", "QUARANTINE", "INACTIVE"],
      default: "ACTIVE",
    },
    identityType: {
      type: String,
      enum: ["employee", "contractor", "service", "vendor", "nhi"],
      default: "employee",
    },
    startDate: { type: Date },
    endDate: { type: Date },
    lastLogin: { type: Date },
    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], default: "LOW" },
    riskFactors: [{ factor: String, score: Number, description: String }],
    totalAccounts: { type: Number, default: 0 },
    totalEntitlements: { type: Number, default: 0 },
    /** Unique privileged entitlements — used by peer/ranking Access Hygiene scoring */
    totalPrivilegedEntitlements: { type: Number, default: 0 },
    totalRoles: { type: Number, default: 0 },
    totalViolations: { type: Number, default: 0 },
    lastSyncedAt: { type: Date },
    sourceApplication: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    sourceApplicationName: { type: String },
    isCorrelated: { type: Boolean, default: false },
    identityProfile: { type: String },
    identityProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "IdentityProfile" },
    location: { type: String },
    country: { type: String },
    phoneNumber: { type: String },
    costCenter: { type: String },
    division: { type: String },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: false },
    attributes: { type: mongoose.Schema.Types.Mixed },
    isActive: { type: Boolean, default: true },
    isNHI: { type: Boolean, default: false },
    profilePhotoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "IdentityProfilePhoto",
      default: null,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

identitySchema.index({ email: 1 });
identitySchema.index({ tenantId: 1, email: 1 });
identitySchema.index({ tenantId: 1, employeeId: 1 });
identitySchema.index({ tenantId: 1, "attributes.uid": 1 });
identitySchema.index({ identityProfileId: 1 });
identitySchema.index({ tenantId: 1, identityProfileId: 1 });
identitySchema.index({ lifecycleState: 1 });
identitySchema.index({ sourceApplication: 1 });
identitySchema.index({ tenantId: 1, managerId: 1, lifecycleState: 1 });
identitySchema.index({ tenantId: 1, sourceApplication: 1, lifecycleState: 1 });
identitySchema.index({ tenantId: 1, lifecycleState: 1 });
identitySchema.index({ tenantId: 1, isActive: 1 });
/** All Identities default list order and stable page tie-breaker. */
identitySchema.index({ tenantId: 1, displayName: 1, _id: 1 });
/** Preserve the existing descending contract: displayName desc, _id asc. */
identitySchema.index({ tenantId: 1, displayName: -1, _id: 1 });
/** Lifecycle-filtered list keeps the same default display-name order. */
identitySchema.index({ tenantId: 1, lifecycleState: 1, displayName: 1, _id: 1 });
/** Supported updatedAt sort path (controller always appends `_id` tie-breaker). */
identitySchema.index({ tenantId: 1, updatedAt: -1, _id: 1 });
identitySchema.index({ displayName: "text", email: "text", department: "text" });

const backfillPromiseByTenantId = new Map();

function getLegacyIdentityModel() {
  return (
    mongoose.models[LEGACY_IDENTITY_MODEL_NAME] ||
    mongoose.model(LEGACY_IDENTITY_MODEL_NAME, identitySchema, LEGACY_IDENTITY_COLLECTION)
  );
}

function getTenantModelName(collectionName) {
  return `${TENANT_IDENTITY_MODEL_PREFIX}${collectionName}`;
}

function getTenantIdentityModelByCollectionName(collectionName) {
  const modelName = getTenantModelName(collectionName);
  return mongoose.models[modelName] || mongoose.model(modelName, identitySchema, collectionName);
}

export function cloneIdentityPlainObject(identityLike) {
  if (!identityLike) return null;
  const plain =
    typeof identityLike.toObject === "function"
      ? identityLike.toObject({ depopulate: true, virtuals: false })
      : { ...identityLike };
  if (!plain || typeof plain !== "object") return null;
  return plain;
}

export function getIdentityCollectionNameForTenantSlug(tenantSlug) {
  return getTenantIdentityCollectionName(tenantSlug);
}

async function backfillTenantCollectionFromLegacy(tenantId, TenantIdentityModel) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) return;

  const existing = await TenantIdentityModel.exists({});
  if (existing) return;

  const LegacyIdentity = getLegacyIdentityModel();
  const hasLegacyRows = await LegacyIdentity.exists({ tenantId: tid });
  if (!hasLegacyRows) return;

  const ops = [];
  const cursor = LegacyIdentity.find({ tenantId: tid }).lean().cursor({ batchSize: 1000 });

  for await (const doc of cursor) {
    if (!doc?._id) continue;
    const replacement = { ...doc };
    delete replacement.__v;
    ops.push({
      replaceOne: {
        filter: { _id: replacement._id },
        replacement,
        upsert: true,
      },
    });
    if (ops.length >= TENANT_IDENTITY_BULK_CHUNK) {
      await TenantIdentityModel.bulkWrite(ops.splice(0, ops.length), { ordered: false });
    }
  }

  if (ops.length > 0) {
    await TenantIdentityModel.bulkWrite(ops, { ordered: false });
  }
}

export async function ensureTenantIdentityBackfilled(tenantId, TenantIdentityModel) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) return;
  const key = String(tid);
  if (!backfillPromiseByTenantId.has(key)) {
    const promise = backfillTenantCollectionFromLegacy(tid, TenantIdentityModel).catch((err) => {
      backfillPromiseByTenantId.delete(key);
      throw err;
    });
    backfillPromiseByTenantId.set(key, promise);
  }
  await backfillPromiseByTenantId.get(key);
}

export async function getDynamicIdentityModelForTenantId(tenantId, options = {}) {
  const tid = toTenantObjectId(tenantId);
  if (!tid) {
    return getLegacyIdentityModel();
  }

  const tenantSlug = await resolveTenantSlugFromTenantId(tid);
  if (!tenantSlug) {
    if (options.allowLegacyFallback === false) {
      throw new Error(`Could not resolve tenant slug for tenant ${String(tid)}`);
    }
    return getLegacyIdentityModel();
  }

  const collectionName = getIdentityCollectionNameForTenantSlug(tenantSlug);
  const TenantIdentityModel = getTenantIdentityModelByCollectionName(collectionName);
  if (options.ensureBackfill !== false) {
    await ensureTenantIdentityBackfilled(tid, TenantIdentityModel);
  }
  return TenantIdentityModel;
}

export async function mirrorIdentityDocumentToLegacy(identityLike) {
  const plain = cloneIdentityPlainObject(identityLike);
  if (!plain?._id) return;
  const LegacyIdentity = getLegacyIdentityModel();
  const replacement = { ...plain };
  delete replacement.__v;
  await LegacyIdentity.replaceOne({ _id: replacement._id }, replacement, { upsert: true });
}

export async function mirrorIdentityBulkWriteToLegacy(ops) {
  if (!Array.isArray(ops) || ops.length === 0) return;
  const LegacyIdentity = getLegacyIdentityModel();
  await LegacyIdentity.bulkWrite(ops, { ordered: false });
}

export { getLegacyIdentityModel };

export default getLegacyIdentityModel();
