import IdentityProfile from "../models/identity/IdentityProfile.js";
import { getDynamicIdentityModelForTenantId } from "../models/identity/Identity.js";
import {
  canonicalCorrelationKey,
  canonicalIdentityMappingTargetKey,
} from "../utils/identityProfileMappingUtils.js";
import { getIdentityFieldValue } from "../utils/correlationIdentityFields.js";

const IDENTITY_CURSOR_BATCH = Number(process.env.IDENTITY_ENTITLEMENT_SYNC_LINK_BATCH ?? 1000);

/**
 * Identity profiles sourced from this application (AD / HRMS auth source).
 * These apps do not use IdentityAccountLink — identities are upserted directly from app users.
 */
export async function loadAuthSourceProfile(applicationId, tenantId) {
  return IdentityProfile.findOne({
    tenantId,
    sourceApplicationId: applicationId,
  })
    .select("correlationTargetKey attributeMappings sourceApplicationId")
    .lean();
}

/** Same PK → correlation key resolution as identity profile refresh. */
export function resolveAuthSourceCorrelationTargetKey(profile, app) {
  let correlationTargetKey = canonicalIdentityMappingTargetKey(
    profile?.correlationTargetKey || "email",
  );
  const mappings = profile?.attributeMappings || [];
  if (app?.userMappings?.length) {
    const pkDef = app.userMappings.find((m) => m.isPrimaryKey);
    if (pkDef?.standardField) {
      const pkField = String(pkDef.standardField).trim().toLowerCase();
      const mapped = mappings.find(
        (m) => String(m.sourceAttribute || "").trim().toLowerCase() === pkField,
      );
      if (mapped?.targetKey) {
        correlationTargetKey = canonicalIdentityMappingTargetKey(mapped.targetKey);
      }
    }
  }
  return correlationTargetKey;
}

/** Application user schema field used to match an identity correlation value back to an account row. */
export function resolveAuthSourceMatchStandardField(profile, app, correlationTargetKey) {
  const key = canonicalCorrelationKey(correlationTargetKey);
  const mappings = profile?.attributeMappings || [];
  const mapped = mappings.find(
    (m) => canonicalIdentityMappingTargetKey(m.targetKey) === key,
  );
  if (mapped?.sourceAttribute) return String(mapped.sourceAttribute).trim();
  const pk = (app.userMappings || []).find((m) => m.isPrimaryKey);
  return pk?.standardField ? String(pk.standardField).trim() : key;
}

export function getAuthSourceCorrelationValueFromIdentity(identity, correlationTargetKey) {
  const key = canonicalCorrelationKey(correlationTargetKey);
  if (key === "email") {
    return String(identity.email || "")
      .toLowerCase()
      .trim();
  }
  if (key === "employeeId") {
    return String(identity.employeeId || "").trim();
  }
  const val = getIdentityFieldValue(identity, key);
  return val != null ? String(val).trim() : "";
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve the materialized app user row for an identity on an auth-source application.
 */
export async function findAuthSourceApplicationUser(
  DynamicUserModel,
  applicationId,
  standardField,
  value,
  correlationTargetKey,
) {
  const v = String(value || "").trim();
  if (!v) return null;

  const key = canonicalCorrelationKey(correlationTargetKey);
  const sf = String(standardField || "").trim();
  const or = [];

  if (sf) {
    or.push({ [sf]: v });
    if (key === "email") {
      or.push({ [sf]: new RegExp(`^${escapeRegex(v)}$`, "i") });
    }
  }

  if (key === "email") {
    or.push({ email: v }, { email: new RegExp(`^${escapeRegex(v)}$`, "i") });
  } else if (key === "employeeId") {
    or.push({ employee_id: v }, { employeeId: v });
  } else {
    or.push(
      { user_id: v },
      { account_id: v },
      { username: v },
      { samAccountName: v },
      { userPrincipalName: v },
    );
    if (sf && sf !== key) {
      or.push({ [key]: v }, { [`rawData.${sf}`]: v });
    }
  }

  if (!or.length) return null;

  return DynamicUserModel.findOne({
    applicationId,
    $or: or,
  }).lean();
}

/**
 * Stream identities created from an auth-source application (no IdentityAccountLink).
 * Yields { identity, syntheticLink } batches via callback.
 */
export async function forEachAuthSourceIdentityBatch({
  tenantId,
  applicationId,
  profileId,
  onBatch,
}) {
  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const query = {
    tenantId,
    isActive: { $ne: false },
    $or: [{ sourceApplication: applicationId }],
  };
  if (profileId) {
    query.$or.push({ identityProfileId: profileId });
  }

  const cursor = Identity.find(query)
    .select(
      "displayName email department title managerId lifecycleState identityProfileId attributes sourceApplication",
    )
    .lean()
    .cursor({ batchSize: IDENTITY_CURSOR_BATCH });

  let batch = [];
  for await (const identity of cursor) {
    batch.push(identity);
    if (batch.length >= IDENTITY_CURSOR_BATCH) {
      await onBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await onBatch(batch);
}

export { IDENTITY_CURSOR_BATCH };
