/**
 * Derives the manual "create identity" form from an Identity Profile's published
 * attribute mappings, and converts the submitted values back into an Identity document.
 *
 * The profile is the contract for what an identity looks like in a tenant. A hardcoded
 * form drifts from it the moment an admin adds or removes a mapped attribute.
 */

import mongoose from "mongoose";
import IdentityProfile from "../../models/identity/IdentityProfile.js";
import { IDENTITY_PROFILE_TARGET_KEYS } from "../../constants/identityProfileTargets.js";
import {
  canonicalIdentityMappingTargetKey,
  csvRowToIdentityPayload,
} from "../../utils/identityProfileMappingUtils.js";
import { getDynamicIdentityModelForTenantId } from "../../models/identity/Identity.js";

const LIFECYCLE_STATES = [
  "NEW",
  "ACTIVE",
  "MOVER",
  "LEAVER",
  "TERMINATED",
  "QUARANTINE",
  "INACTIVE",
];

const CANONICAL_TARGET_META = new Map(
  IDENTITY_PROFILE_TARGET_KEYS.map((target) => [target.key, target]),
);

/** Canonical keys the identity refresh promotes out of `attributes` into real columns. */
const TOP_LEVEL_TARGETS = new Set([
  "email",
  "firstname",
  "lastname",
  "displayName",
  "employeeId",
  "department",
  "title",
  "phone",
  "managerEmail",
  "managerEmployeeId",
  "startDate",
  "status",
]);

const FIELD_TYPE_BY_TARGET = {
  email: "email",
  managerEmail: "email",
  startDate: "date",
  phone: "tel",
  status: "select",
};

function humanizeTargetKey(key) {
  const withSpaces = String(key || "")
    .replace(/[._]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!withSpaces) return String(key || "");
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function sourceHint(mapping) {
  const app = mapping.applicationId;
  const appName = app && typeof app === "object" ? app.name : null;
  const attribute = String(mapping.sourceAttribute || "").trim();
  if (appName && attribute) return `Normally sourced from ${appName} · ${attribute}`;
  if (appName) return `Normally sourced from ${appName}`;
  if (attribute) return `Normally sourced from "${attribute}"`;
  return "";
}

/**
 * @param {object} profile lean or hydrated IdentityProfile
 * @returns {{profileId: string, profileName: string, correlationTargetKey: string, fields: object[]}}
 */
export function buildIdentityCreateSchema(profile) {
  const mappings = Array.isArray(profile?.attributeMappings) ? profile.attributeMappings : [];
  const correlationKey = canonicalIdentityMappingTargetKey(
    profile?.correlationTargetKey || "email",
  );
  const managerAttribute = String(
    profile?.managerCorrelation?.managerAttribute || "",
  ).trim();
  const managerReferenceAttribute = String(
    profile?.managerCorrelation?.referenceAttribute || "",
  ).trim();
  const mappedKeys = new Set(
    mappings.map((mapping) => String(mapping?.targetKey || "").trim()).filter(Boolean),
  );

  const fields = [];
  const seen = new Set();

  for (const mapping of mappings) {
    const rawKey = String(mapping?.targetKey || "").trim();
    if (!rawKey) continue;
    const canonicalKey = canonicalIdentityMappingTargetKey(rawKey);
    // Two mappings can feed the same identity attribute from different applications;
    // the form only needs to ask for the value once.
    if (seen.has(canonicalKey)) continue;
    seen.add(canonicalKey);

    const canonicalMeta = CANONICAL_TARGET_META.get(canonicalKey);
    const isCustom = !TOP_LEVEL_TARGETS.has(canonicalKey) && canonicalKey !== "uid";

    const isManagerReference =
      rawKey === managerAttribute
      && Boolean(managerReferenceAttribute)
      && rawKey !== managerReferenceAttribute;
    const linkedDisplayFieldKey =
      isManagerReference && mappedKeys.has("managerName") ? "managerName" : null;

    fields.push({
      key: rawKey,
      canonicalKey,
      label: mapping.targetLabel?.trim() || canonicalMeta?.label || humanizeTargetKey(rawKey),
      // The correlation key identifies the identity on every later refresh; without it a
      // manually created record cannot be matched and gets duplicated.
      required: canonicalKey === correlationKey || Boolean(canonicalMeta?.required),
      isCorrelationKey: canonicalKey === correlationKey,
      type: isManagerReference
        ? "identityReference"
        : FIELD_TYPE_BY_TARGET[canonicalKey] || "text",
      options: canonicalKey === "status" ? LIFECYCLE_STATES : undefined,
      storage: isCustom ? "attributes" : "identity",
      isCustom,
      ...(isManagerReference
        ? {
          reference: {
            referenceAttribute: managerReferenceAttribute,
            limit: 5,
            linkedDisplayFieldKey,
          },
        }
        : {}),
      readOnly:
        rawKey === "managerName"
        && Boolean(managerAttribute)
        && Boolean(managerReferenceAttribute),
      helperText: sourceHint(mapping),
    });
  }

  // The correlation key is how every later refresh finds this identity again. A profile can
  // correlate on an attribute it does not map (e.g. correlate on email, map only employeeId);
  // for aggregation that is a config gap, but for manual create we must still collect it or
  // the record can never be matched and the next refresh inserts a duplicate.
  if (!seen.has(correlationKey)) {
    const canonicalMeta = CANONICAL_TARGET_META.get(correlationKey);
    fields.unshift({
      key: correlationKey,
      canonicalKey: correlationKey,
      label: canonicalMeta?.label || humanizeTargetKey(correlationKey),
      required: true,
      isCorrelationKey: true,
      type: FIELD_TYPE_BY_TARGET[correlationKey] || "text",
      options: undefined,
      storage: TOP_LEVEL_TARGETS.has(correlationKey) ? "identity" : "attributes",
      isCustom: false,
      unmapped: true,
      helperText: "Not mapped by this profile, but required to match the identity on refresh",
    });
  }

  return {
    profileId: String(profile?._id || ""),
    profileName: profile?.name || "",
    description: profile?.description || "",
    correlationTargetKey: correlationKey,
    managerCorrelation:
      managerAttribute && managerReferenceAttribute
        ? {
          managerAttribute,
          referenceAttribute: managerReferenceAttribute,
        }
        : null,
    sourceApplication:
      profile?.sourceApplicationId && typeof profile.sourceApplicationId === "object"
        ? { id: String(profile.sourceApplicationId._id), name: profile.sourceApplicationId.name }
        : null,
    fields,
  };
}

/**
 * Convert form values (keyed by mapping targetKey) into an Identity document.
 *
 * Reuses the refresh-time routing so a manually created identity is byte-compatible with
 * one produced by aggregation: same top-level columns, same `attributes.*`, same
 * displayName derivation. Transforms are deliberately neutralised — the admin typed the
 * final value, there is no raw source row to normalise.
 */
export async function profileValuesToIdentityPayload({ profile, values, tenantId }) {
  const schema = buildIdentityCreateSchema(profile);
  const row = {};
  const syntheticMappings = [];

  for (const field of schema.fields) {
    const value = values?.[field.key];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    row[field.key] = value;
    syntheticMappings.push({
      targetKey: field.key,
      sourceAttribute: field.key,
      transform: "none",
      customTransformId: null,
    });
  }

  const payload = await csvRowToIdentityPayload(row, syntheticMappings, tenantId, {
    lifecycleRules: profile?.lifecycleRules,
  });

  payload.identityProfileId = profile._id;
  if (profile.name) payload.identityProfile = profile.name;
  if (profile.sourceApplicationId) {
    payload.sourceApplication =
      typeof profile.sourceApplicationId === "object"
        ? profile.sourceApplicationId._id
        : profile.sourceApplicationId;
  }
  return payload;
}

/** Fields the admin left blank that the profile says are mandatory. */
export function findMissingRequiredValues(profile, values) {
  return buildIdentityCreateSchema(profile)
    .fields.filter(
      (field) =>
        field.required
        && (values?.[field.key] === undefined
          || values?.[field.key] === null
          || String(values[field.key]).trim() === ""),
    )
    .map((field) => field.label);
}

export async function loadTenantProfile(profileId, tenantId) {
  if (!mongoose.isValidObjectId(profileId)) return null;
  const profile = await IdentityProfile.findById(profileId)
    .populate("sourceApplicationId", "name")
    .populate("attributeMappings.applicationId", "name")
    .lean();
  if (!profile) return null;
  // A profile with no tenant is legacy/global; anything else must match the caller's tenant.
  if (profile.tenantId && tenantId && String(profile.tenantId) !== String(tenantId)) return null;
  return profile;
}

/** Resolve a mapped target key to the same storage path used by profile refresh. */
export function identityStoragePathForTargetKey(targetKey) {
  const rawKey = String(targetKey || "").trim();
  const canonicalKey = canonicalIdentityMappingTargetKey(rawKey);
  const paths = {
    email: "email",
    firstname: "firstName",
    lastname: "lastName",
    displayName: "displayName",
    uid: "attributes.uid",
    employeeId: "employeeId",
    department: "department",
    title: "title",
    phone: "phoneNumber",
    managerEmail: "managerEmail",
    managerEmployeeId: "managerEmployeeId",
    startDate: "startDate",
    status: "lifecycleState",
  };
  return paths[canonicalKey] || `attributes.${rawKey}`;
}

export function identityValueForTargetKey(identity, targetKey) {
  const path = identityStoragePathForTargetKey(targetKey);
  return path.split(".").reduce((value, part) => value?.[part], identity);
}

/**
 * Distinct values already present for one mapped attribute, scoped to the profile.
 *
 * Rule conditions are string comparisons, so a typo ("IT" vs "it") silently produces a rule
 * that never matches. Offering the values that actually exist in the data removes that class
 * of mistake without hardcoding any tenant's vocabulary.
 */
export async function findIdentityAttributeValues({
  profile,
  tenantId,
  field,
  query = "",
  limit = 20,
}) {
  const targetKey = String(field || "").trim();
  if (!targetKey) return [];

  const available = new Set(buildIdentityCreateSchema(profile).fields.map((f) => f.key));
  if (!available.has(targetKey)) return [];

  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const path = identityStoragePathForTargetKey(targetKey);
  const match = {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    identityProfileId: profile._id,
    [path]: { $nin: [null, ""] },
  };
  const text = String(query || "").trim();
  if (text) {
    match[path] = {
      ...match[path],
      $regex: text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  }

  const rows = await Identity.aggregate([
    { $match: match },
    { $group: { _id: `$${path}`, count: { $sum: 1 } } },
    // Most-used values first so the common cases are reachable without typing.
    { $sort: { count: -1, _id: 1 } },
    { $limit: Math.min(Math.max(Number(limit) || 20, 1), 50) },
  ]);

  return rows
    .filter((row) => row._id !== null && row._id !== undefined && String(row._id).trim() !== "")
    .map((row) => ({ value: String(row._id), count: row.count }));
}

/**
 * Search manager/reference candidates within the same tenant and profile. Results are
 * deliberately capped at five so the dropdown remains a picker, not an identity export.
 */
export async function findIdentityReferenceOptions({
  profile,
  tenantId,
  query = "",
  limit = 5,
}) {
  const referenceAttribute = String(
    profile?.managerCorrelation?.referenceAttribute || "",
  ).trim();
  if (!referenceAttribute) return [];

  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const referencePath = identityStoragePathForTargetKey(referenceAttribute);
  const text = String(query || "").trim();
  const filter = {
    tenantId: new mongoose.Types.ObjectId(String(tenantId)),
    identityProfileId: profile._id,
    [referencePath]: { $exists: true, $nin: [null, ""] },
  };
  if (text) {
    const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { displayName: regex },
      { employeeId: regex },
      { [referencePath]: regex },
    ];
  }

  const identities = await Identity.find(filter)
    .select(`displayName email employeeId identityProfileId ${referencePath}`)
    .sort({ displayName: 1, _id: 1 })
    .limit(Math.min(Math.max(Number(limit) || 5, 1), 5))
    .lean();

  return identities.map((identity) => ({
    identityId: String(identity._id),
    displayName: identity.displayName || identity.email || "Unnamed identity",
    employeeId: identity.employeeId || null,
    referenceAttribute,
    referenceValue: String(identityValueForTargetKey(identity, referenceAttribute) || ""),
  }));
}

/**
 * Validate a submitted manager selection and enrich the new identity with both the raw
 * profile-mapped reference and the resolved Mongo relationship.
 */
export async function applyIdentityReferenceSelections({
  profile,
  tenantId,
  values,
  selections,
  payload,
}) {
  const managerAttribute = String(
    profile?.managerCorrelation?.managerAttribute || "",
  ).trim();
  const referenceAttribute = String(
    profile?.managerCorrelation?.referenceAttribute || "",
  ).trim();
  if (!managerAttribute || !referenceAttribute) return { payload, values };

  const selectedId = selections?.[managerAttribute]?.identityId;
  if (!selectedId) return { payload, values };
  if (!mongoose.isValidObjectId(selectedId)) {
    return { error: "Selected manager is invalid" };
  }

  const Identity = await getDynamicIdentityModelForTenantId(tenantId);
  const manager = await Identity.findOne({
    _id: selectedId,
    tenantId,
    identityProfileId: profile._id,
  }).lean();
  if (!manager) return { error: "Selected manager is not available for this profile" };

  const referenceValue = identityValueForTargetKey(manager, referenceAttribute);
  if (referenceValue === undefined || referenceValue === null || String(referenceValue) === "") {
    return { error: `Selected manager has no ${referenceAttribute}` };
  }

  const nextValues = {
    ...values,
    [managerAttribute]: String(referenceValue),
  };
  if (profile.attributeMappings?.some((mapping) => mapping.targetKey === "managerName")) {
    nextValues.managerName = manager.displayName || "";
  }

  const nextPayload = await profileValuesToIdentityPayload({
    profile,
    values: nextValues,
    tenantId,
  });
  nextPayload.managerId = manager._id;
  nextPayload.managerEmail = manager.email || undefined;
  nextPayload.managerResolutionStatus = "resolved";
  nextPayload.managerKeyRaw = null;
  return { payload: nextPayload, values: nextValues };
}
