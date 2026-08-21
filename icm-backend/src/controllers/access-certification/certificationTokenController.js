import mongoose from "mongoose";
import {
  tokenizeMemberOfRaw,
  normalizeAccessDisplayLabel,
} from "../../utils/accessMemberOfTokens.js";
import { resolveMappedUserModel } from "../../utils/access-certification/mappedUserResolver.js";
import Identity from "../../models/identity/Identity.js";
import { buildEntitlementRows } from "../../services/access-certification/profileCertificationScopeService.js";

function normalizeText(value) {
  return String(value || "").trim();
}

const splitMultiValue = tokenizeMemberOfRaw;
const normalizeAccessLabel = normalizeAccessDisplayLabel;

function pickFromRawData(raw, ...patterns) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of Object.keys(raw)) {
    const lk = key.toLowerCase();
    if (patterns.some((p) => lk.includes(p.toLowerCase()))) {
      const val = raw[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        return String(val).trim();
      }
    }
  }
  return "";
}

function isProfileIdentityCampaign(campaign) {
  return (
    String(campaign?.certificationScope || "").toUpperCase() === "PROFILE" &&
    String(campaign?.category || "").toUpperCase() === "IDENTITY"
  );
}

function stripEntitlementAppPrefix(rawName, applicationName) {
  if (!rawName) return "";
  if (!applicationName) return String(rawName).trim();
  const prefix = applicationName.trim().toLowerCase() + ":";
  const raw = String(rawName).trim();
  if (raw.toLowerCase().startsWith(prefix)) {
    const stripped = raw.slice(applicationName.trim().length + 1).trim();
    return stripped || raw;
  }
  return raw;
}

function cleanEntitlementNameFromDoc(entDoc) {
  const raw = entDoc.entitlementDisplayName || entDoc.entitlementValue || "";
  const app = entDoc.applicationName || "";
  return stripEntitlementAppPrefix(raw, app);
}

function buildIdentityDisplayName(identity) {
  return (
    normalizeText(identity?.displayName) ||
    normalizeText(
      [identity?.firstName, identity?.lastName].filter(Boolean).join(" "),
    ) ||
    normalizeText(identity?.email) ||
    "Unknown User"
  );
}

/** PROFILE + IDENTITY campaigns resolve from Identity + entitlement cube (no applicationName). */
async function buildIdentityProfilePortalDetails({ campaign, itemIds }) {
  const detailById = new Map();
  const ids = Array.isArray(itemIds)
    ? itemIds.map((id) => normalizeText(id)).filter(Boolean)
    : [];
  if (ids.length === 0) return detailById;

  const objectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (objectIds.length === 0) return detailById;

  const identities = await Identity.find({ _id: { $in: objectIds } })
    .select(
      "displayName firstName lastName email employeeId department title manager managerEmail",
    )
    .lean();

  const entitlementsByIdentityId = await buildEntitlementRows(
    objectIds,
    campaign.tenantId,
  );

  for (const identity of identities) {
    const identityKey = String(identity._id);
    const ents = entitlementsByIdentityId.get(identityKey) || [];
    const accessDetails = ents
      .map(cleanEntitlementNameFromDoc)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);
    const entitlementDecisions = ents.map((entDoc) => ({
      entitlementName: cleanEntitlementNameFromDoc(entDoc),
      applicationName: normalizeText(entDoc.applicationName) || undefined,
      applicationId: entDoc.applicationId || undefined,
      status: "PENDING",
    }));

    detailById.set(identityKey, {
      identityName: buildIdentityDisplayName(identity),
      identityEmail: normalizeText(identity.email),
      role: normalizeText(identity.title) || normalizeText(identity.department),
      department: normalizeText(identity.department),
      manager: normalizeText(identity.manager),
      managerEmail: normalizeText(identity.managerEmail),
      employeeId: normalizeText(identity.employeeId),
      appName: "",
      accessDetails,
      entitlementDecisions,
    });
  }

  return detailById;
}

/** Enrich review portal rows with identity / entitlement display data. */
export async function buildPortalItemDetails({ campaign, itemIds }) {
  const detailById = new Map();
  const ids = Array.isArray(itemIds)
    ? itemIds.map((id) => normalizeText(id)).filter(Boolean)
    : [];
  if (ids.length === 0) return detailById;

  if (isProfileIdentityCampaign(campaign)) {
    return buildIdentityProfilePortalDetails({ campaign, itemIds: ids });
  }

  if (!campaign?.applicationName) return detailById;

  const normalizedToItemIds = new Map();
  for (const itemId of ids) {
    const key = itemId.toLowerCase();
    if (!normalizedToItemIds.has(key)) normalizedToItemIds.set(key, []);
    normalizedToItemIds.get(key).push(itemId);
  }

  const UsersModel = await resolveMappedUserModel({
    name: campaign.applicationName,
    tenantId: campaign.tenantId,
  });

  const objectIds = ids
    .filter((id) => UsersModel.base.Types.ObjectId.isValid(id))
    .map((id) => new UsersModel.base.Types.ObjectId(id));

  const users = await UsersModel.find({
    $or: [
      ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
      { primaryKey: { $in: ids } },
      { user_id: { $in: ids } },
      { employee_id: { $in: ids } },
      { username: { $in: ids } },
      { email: { $in: ids } },
      { name: { $in: ids } },
      { display_name: { $in: ids } },
      { "rawData.user_id": { $in: ids } },
      { "rawData.employee_id": { $in: ids } },
      { "rawData.id": { $in: ids } },
      { "rawData.Email Address": { $in: ids } },
      { "rawData.email": { $in: ids } },
      { "rawData.mail": { $in: ids } },
      { "rawData.sAMAccountName": { $in: ids } },
      { "rawData.samaccountname": { $in: ids } },
      { "rawData.SAM Account Name": { $in: ids } },
    ],
  }).lean();

  for (const user of users) {
    const raw = user?.rawData || {};
    const mongoId = normalizeText(user?._id?.toString?.());
    const identityName =
      normalizeText(
        user?.display_name ||
          user?.name ||
          user?.username ||
          raw["Display Name"] ||
          raw.displayName ||
          raw.display_name ||
          raw.FULL_NAME ||
          raw.cn ||
          raw.name ||
          pickFromRawData(
            raw,
            "fullname",
            "full_name",
            "person_full",
            "displayname",
            "person_name",
          ) ||
          user?.email,
      ) ||
      normalizeText(
        pickFromRawData(
          raw,
          "username",
          "user_name",
          "oracle_user",
          "account_id",
          "account",
          "login",
          "email",
          "mail",
        ),
      ) ||
      "Unknown User";
    const identityEmail = normalizeText(
      user?.email ||
        raw["Email Address"] ||
        raw.email ||
        raw.mail ||
        pickFromRawData(raw, "email", "mail"),
    );
    const role = normalizeText(
      raw.Title ||
        raw.title ||
        raw.Role ||
        raw.role ||
        raw["Job Title"] ||
        raw.job_title ||
        pickFromRawData(
          raw,
          "title",
          "position",
          "job",
          "designation",
          "role",
        ) ||
        raw.Department ||
        user?.title ||
        user?.department,
    );
    const accessDetails = splitMultiValue(
      raw.member_of_entitlements ||
        raw.memberOf ||
        raw.MemberOf ||
        raw.sap_roles ||
        user?.member_of_entitlements ||
        user?.memberOf ||
        pickFromRawData(
          raw,
          "responsibilities",
          "entitlement",
          "roles",
          "groups",
          "data_access",
          "member_of",
        ),
    )
      .map(normalizeAccessLabel)
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const identityTokens = [
      mongoId,
      normalizeText(user?.primaryKey),
      normalizeText(user?.user_id),
      normalizeText(user?.employee_id),
      normalizeText(user?.username),
      normalizeText(user?.name),
      normalizeText(user?.display_name),
      identityEmail,
      normalizeText(raw.user_id),
      normalizeText(raw.employee_id),
      normalizeText(raw.id),
      normalizeText(raw["Email Address"]),
      normalizeText(raw.email),
      normalizeText(raw.mail),
      normalizeText(raw.sAMAccountName),
      normalizeText(raw.samaccountname),
      normalizeText(raw["SAM Account Name"]),
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase());

    for (const token of identityTokens) {
      const matchedItemIds = normalizedToItemIds.get(token) || [];
      for (const itemId of matchedItemIds) {
        if (detailById.has(itemId)) continue;
        detailById.set(itemId, {
          identityName,
          identityEmail,
          appName: normalizeText(campaign.applicationName),
          role,
          accessDetails,
        });
      }
    }
  }

  return detailById;
}
