import mongoose from "mongoose";
import {
  getAppIdentityEntitlementsCollectionName,
  resolveTenantSlugFromTenantId,
  slugIgaSegment,
} from "../utils/applicationDynamicCollections.js";

const { ObjectId } = mongoose.Schema.Types;

const identityEntitlementSchema = new mongoose.Schema(
  {
    tenantId: { type: ObjectId, ref: "Tenant", required: true, index: true },
    tenantSlug: { type: String, index: true },

    identityId: { type: ObjectId, ref: "Identity", required: true, index: true },
    identityProfileId: { type: ObjectId, index: true },

    applicationId: { type: ObjectId, ref: "Application", required: true, index: true },
    applicationName: { type: String },

    entitlementId: { type: ObjectId, required: true, index: true },
    entitlementValue: { type: String },
    entitlementDisplayName: { type: String },

    accountId: { type: ObjectId, required: true, index: true },
    nativeIdentity: { type: String },

    correlationStatus: {
      type: String,
      enum: ["CORRELATED", "UNCORRELATED"],
      default: "CORRELATED",
    },

    assignmentType: {
      type: String,
      enum: ["DIRECT"],
      default: "DIRECT",
    },

    identitySnapshot: {
      displayName: { type: String },
      email: { type: String },
      username: { type: String },
      department: { type: String },
      jobTitle: { type: String },
      managerId: { type: ObjectId, ref: "Identity" },
      lifecycleState: { type: String },
    },

    accountSnapshot: {
      accountStatus: { type: String },
      enabled: { type: Boolean },
    },

    entitlementSnapshot: {
      riskLevel: { type: String },
      isPrivileged: { type: Boolean },
      entitlementType: { type: String },
    },

    syncedAt: { type: Date, index: true },
  },
  { timestamps: true },
);

identityEntitlementSchema.index({ tenantId: 1, identityId: 1 });
identityEntitlementSchema.index({ tenantId: 1, applicationId: 1 });
identityEntitlementSchema.index({ tenantId: 1, entitlementId: 1 });
identityEntitlementSchema.index(
  {
    tenantId: 1,
    identityId: 1,
    applicationId: 1,
    entitlementId: 1,
    accountId: 1,
  },
  { unique: true },
);
identityEntitlementSchema.index({ tenantId: 1, "identitySnapshot.managerId": 1 });
identityEntitlementSchema.index({ tenantId: 1, "entitlementSnapshot.isPrivileged": 1 });

/**
 * @param {string} tenantSlug Tenant display slug (e.g. ap_18, cyber_funk)
 * @returns {import('mongoose').Model}
 */
export function getIdentityEntitlementModel(tenantSlug) {
  const ts = slugIgaSegment(tenantSlug);
  if (!ts) {
    throw new Error(
      `Cannot build identity_entitlements model: tenant slug is missing or invalid ("${tenantSlug}").`,
    );
  }
  const collectionName = getAppIdentityEntitlementsCollectionName(ts);
  const modelName = `IdentityEntitlements_${ts}`;
  if (mongoose.models[modelName]) return mongoose.model(modelName);
  return mongoose.model(modelName, identityEntitlementSchema, collectionName);
}

/**
 * @param {unknown} tenantId
 * @returns {Promise<import('mongoose').Model>}
 */
export async function getIdentityEntitlementModelForTenantId(tenantId) {
  const slug = await resolveTenantSlugFromTenantId(tenantId);
  if (!slug) {
    throw new Error(
      `Cannot build identity_entitlements model: no Tenant found for id "${tenantId}".`,
    );
  }
  return getIdentityEntitlementModel(slug);
}

export { identityEntitlementSchema };
