import mongoose from "mongoose";
import Tenant from "../../models/platform/Tenant.js";

const slug = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

async function getCollectionNames(application) {
  const tenant = await Tenant.findById(application.tenantId)
    .select("name code")
    .lean();
  const tenantName = tenant?.name || tenant?.code;
  if (!tenantName) {
    throw new Error(
      `Cannot build collection names for application "${application.name}": ` +
        `Tenant not found or has no name/code (tenantId: ${application.tenantId}).`,
    );
  }
  const tenantSlug = slug(tenantName);
  const appSlug = slug(application.name ?? "app");
  return {
    mappedUsersCollection: `app_iga_${tenantSlug}_${appSlug}_mapped_users`,
    /** Fallback (support collections without "mapped_" prefix) */
    legacyUsersCollection: `app_iga_${tenantSlug}_${appSlug}_users`,
    /** Flattened CSV header map (target field → source column name). */
    mappedSchemaCollection: `app_iga_${tenantSlug}_${appSlug}_schema`,
    /** Legacy name; still read as fallback in {@link loadMappedSchema}. */
    legacyMappedSchemaCollection: `app_iga_${tenantSlug}_${appSlug}_mapped_schema`,
  };
}

function buildDynamicModel(modelName, collectionName) {
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  const schema = new mongoose.Schema({}, { strict: false });
  return mongoose.model(modelName, schema, collectionName);
}

function toFilledString(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  return text ? text : "";
}

function normalizeLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeMappedStatusValue(rawValue, sourceKey = "") {
  const key = normalizeLookupKey(sourceKey);
  const isNegativeFlagKey = [
    "accountdisabled",
    "disabled",
    "locked",
    "lockout",
    "terminationflag",
    "terminated",
    "isinactive",
    "suspended",
    "suspend",
  ].includes(key);

  if (typeof rawValue === "boolean") {
    if (isNegativeFlagKey) return rawValue ? "INACTIVE" : "ACTIVE";
    return rawValue ? "ACTIVE" : "INACTIVE";
  }

  const raw = String(rawValue ?? "").trim();
  if (!raw) return "";
  const normalized = raw.toUpperCase().replace(/\s+/g, "_");

  if (
    [
      "TRUE",
      "YES",
      "Y",
      "1",
      "ON",
      "ENABLED",
      "OPEN",
      "CURRENT",
      "EMPLOYED",
    ].includes(normalized)
  ) {
    return isNegativeFlagKey ? "INACTIVE" : "ACTIVE";
  }

  if (
    ["FALSE", "NO", "N", "0", "OFF", "DISABLED", "LOCKED"].includes(normalized)
  ) {
    return isNegativeFlagKey ? "ACTIVE" : "INACTIVE";
  }

  if (
    normalized.includes("TERM") ||
    normalized.includes("RESIGN") ||
    normalized.includes("SEPARAT") ||
    normalized.includes("OFFBOARD") ||
    normalized.includes("EXIT")
  ) {
    return "TERMINATED";
  }
  if (normalized.includes("LEAV")) return "LEAVER";
  if (normalized.includes("MOVER") || normalized.includes("TRANSFER")) {
    return "MOVER";
  }
  if (
    normalized.includes("SUSPEND") ||
    normalized.includes("LOCK") ||
    normalized.includes("DISABL") ||
    normalized.includes("INACTIVE")
  ) {
    return "INACTIVE";
  }
  if (
    normalized.includes("ACTIVE") ||
    normalized.includes("ENABLE") ||
    normalized === "ACT"
  ) {
    return "ACTIVE";
  }

  return normalized;
}

function readMappedValue(source, wantedKey) {
  if (!source || typeof source !== "object" || !wantedKey) return "";

  if (Object.prototype.hasOwnProperty.call(source, wantedKey)) {
    const direct = toFilledString(source[wantedKey]);
    if (direct) return direct;
  }

  const rawWanted = String(wantedKey || "")
    .trim()
    .toLowerCase();
  const normalizedWanted = normalizeLookupKey(wantedKey);

  for (const key of Object.keys(source)) {
    const rawKey = String(key || "").trim();
    if (!rawKey) continue;
    const lowerKey = rawKey.toLowerCase();
    if (
      lowerKey === rawWanted ||
      (normalizedWanted && normalizeLookupKey(rawKey) === normalizedWanted)
    ) {
      const value = toFilledString(source[key]);
      if (value) return value;
    }
  }

  return "";
}

export function resolveMappedUserField(
  user,
  raw,
  schemaValue,
  standardFieldName,
) {
  const candidates = [];
  const addCandidate = (value) => {
    const text = String(value || "").trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  };

  addCandidate(schemaValue);
  addCandidate(standardFieldName);

  for (const key of candidates) {
    const value = readMappedValue(user, key);
    if (value) return value;
  }

  for (const key of candidates) {
    const value = readMappedValue(raw, key);
    if (value) return value;
  }

  return "";
}

export function normalizeMappedUser(user, schema = {}) {
  const raw =
    user?.rawData &&
    typeof user.rawData === "object" &&
    !Array.isArray(user.rawData)
      ? user.rawData
      : {};

  const resolvedName =
    resolveMappedUserField(user, raw, schema.display_name, "display_name") ||
    toFilledString(user?.display_name) ||
    toFilledString(user?.displayName) ||
    toFilledString(user?.name);
  const resolvedEmail =
    resolveMappedUserField(user, raw, schema.email, "email") ||
    toFilledString(user?.email);
  const resolvedStatusRaw =
    resolveMappedUserField(user, raw, schema.status, "status") ||
    toFilledString(user?.status);
  const resolvedStatus =
    normalizeMappedStatusValue(resolvedStatusRaw, schema.status || "status") ||
    resolvedStatusRaw;
  const resolvedManager =
    resolveMappedUserField(user, raw, schema.manager_name, "manager_name") ||
    toFilledString(user?.manager_name) ||
    toFilledString(user?.manager);
  const resolvedManagerId =
    resolveMappedUserField(user, raw, schema.manager_id, "manager_id") ||
    toFilledString(user?.manager_id);
  const resolvedManagerEmail =
    resolveMappedUserField(user, raw, schema.manager_email, "manager_email") ||
    toFilledString(user?.manager_email) ||
    toFilledString(user?.managerEmail);
  const resolvedDepartment =
    resolveMappedUserField(user, raw, schema.department, "department") ||
    toFilledString(user?.department);
  const resolvedTitle =
    resolveMappedUserField(user, raw, schema.title, "title") ||
    toFilledString(user?.title);
  const resolvedEntitlements =
    resolveMappedUserField(
      user,
      raw,
      schema.member_of_entitlements,
      "member_of_entitlements",
    ) ||
    toFilledString(user?.member_of_entitlements) ||
    toFilledString(user?.memberOf);
  const resolvedUserId =
    resolveMappedUserField(user, raw, schema.primaryKey, "primaryKey") ||
    toFilledString(user?.user_id) ||
    user?._id;

  return {
    ...user,
    user_id: resolvedUserId,
    display_name: resolvedName,
    name: resolvedName || toFilledString(user?.name),
    email: resolvedEmail,
    status: resolvedStatus,
    manager: resolvedManager,
    manager_name: resolvedManager,
    manager_id: resolvedManagerId,
    managerEmail: resolvedManagerEmail,
    manager_email: resolvedManagerEmail,
    department: resolvedDepartment,
    title: resolvedTitle,
    member_of_entitlements: resolvedEntitlements,
    memberOf: resolvedEntitlements,
    rawData: {
      ...raw,
      primaryKey: resolvedUserId || raw.primaryKey || "",
      display_name:
        resolvedName || raw.display_name || raw["Display Name"] || "",
      email: resolvedEmail || raw.email || raw["Email Address"] || "",
      status: resolvedStatus || raw.status || raw.Status || "",
      manager_id: resolvedManagerId || raw.manager_id || "",
      manager_name: resolvedManager || raw.manager_name || raw.Manager || "",
      manager_email:
        resolvedManagerEmail || raw.manager_email || raw.managerEmail || "",
      department: resolvedDepartment || raw.department || raw.Department || "",
      title: resolvedTitle || raw.title || raw.Title || "",
      member_of_entitlements:
        resolvedEntitlements ||
        raw.member_of_entitlements ||
        raw.memberOf ||
        "",
    },
  };
}

export function normalizeMappedUsers(users, schema = {}) {
  if (!Array.isArray(users) || users.length === 0) return [];
  if (!schema || Object.keys(schema).length === 0) {
    return users.map((user) => ({
      ...user,
      rawData:
        user?.rawData &&
        typeof user.rawData === "object" &&
        !Array.isArray(user.rawData)
          ? user.rawData
          : {},
    }));
  }
  return users.map((user) => normalizeMappedUser(user, schema));
}

export async function resolveMappedUserModel(application) {
  const { mappedUsersCollection, legacyUsersCollection } =
    await getCollectionNames(application);

  // Try preferred "mapped_users" collection first
  for (const collectionName of [mappedUsersCollection, legacyUsersCollection]) {
    const modelName = `MappedUsers_${collectionName}`;
    const model = buildDynamicModel(modelName, collectionName);

    // Check if collection exists by trying to find one document
    try {
      const count = await model.countDocuments();
      if (count > 0) {
        return model;
      }
    } catch {
      // Collection doesn't exist, try next
    }
  }

  // Fallback to first collection name (maintains backward compatibility)
  const modelName = `MappedUsers_${mappedUsersCollection}`;
  return buildDynamicModel(modelName, mappedUsersCollection);
}

export async function loadMappedSchema(application) {
  const { mappedSchemaCollection, legacyMappedSchemaCollection } =
    await getCollectionNames(application);
  for (const coll of [mappedSchemaCollection, legacyMappedSchemaCollection]) {
    if (!coll) continue;
    const modelName = `MappedSchema_${coll}`;
    const Model = buildDynamicModel(modelName, coll);
    let doc = await Model.findOne({ applicationId: application._id }).lean();
    if (!doc) doc = await Model.findOne({}).lean();
    if (doc && Object.keys(doc).length > 0) return doc;
  }
  return null;
}

export async function resolveMappedManagerEmail(managerId, MappedUserModel) {
  if (!managerId || !MappedUserModel) return null;
  const manager = await MappedUserModel.findOne({
    $or: [{ manager_id: managerId }, { primaryKey: managerId }],
  })
    .select("email")
    .lean();
  return manager?.email ?? null;
}
