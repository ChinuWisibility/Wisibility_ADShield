import { extractEntitlementTokensFromAppUser } from "../sod/sodAppUserEntitlements.js";

const APP_MANAGER_NAME_FIELDS = [
  "manager_name",
  "managerName",
  "manager",
  "supervisor",
  "reports_to",
];
const APP_MANAGER_ID_FIELDS = [
  "manager_id",
  "managerId",
  "managerid",
  "supervisor_id",
  "supervisorId",
];
const APP_MANAGER_EMAIL_FIELDS = ["manager_email", "managerEmail"];

const APP_USER_SCAN_PROJECTION = {
  user_id: 1,
  email: 1,
  display_name: 1,
  displayName: 1,
  firstName: 1,
  lastName: 1,
  name: 1,
  applicationId: 1,
  rawData: 1,
  manager_id: 1,
  manager_name: 1,
  manager_email: 1,
  managerId: 1,
  managerName: 1,
  managerEmail: 1,
  manager: 1,
  member_of_entitlements: 1,
  groups: 1,
  roles: 1,
  entitlements: 1,
};

function hasValue(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

function readAppUserField(user, key) {
  if (!user || !key) return undefined;
  if (Object.prototype.hasOwnProperty.call(user, key)) return user[key];
  const raw = user.rawData;
  if (raw && typeof raw === "object" && Object.prototype.hasOwnProperty.call(raw, key)) {
    return raw[key];
  }
  return undefined;
}

function pickPresentField(user, keys) {
  for (const key of keys) {
    const value = readAppUserField(user, key);
    if (hasValue(value)) return String(value).trim();
  }
  return null;
}

/**
 * Target-application user lacks manager id and manager name (no HR/auth identity lookup).
 * @param {object|null|undefined} user
 */
export function isAppUserMissingManager(user) {
  if (!user || typeof user !== "object") return false;

  const managerName = pickPresentField(user, APP_MANAGER_NAME_FIELDS);
  const managerId = pickPresentField(user, APP_MANAGER_ID_FIELDS);
  const managerEmail = pickPresentField(user, APP_MANAGER_EMAIL_FIELDS);

  return !managerName && !managerId && !managerEmail;
}

function resolveDisplayName(user) {
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  const candidates = [
    user.display_name,
    user.displayName,
    user.name,
    [user.firstName, user.lastName].filter(Boolean).join(" "),
    raw.display_name,
    raw.displayName,
    raw.name,
  ];
  for (const c of candidates) {
    if (hasValue(c)) return String(c).trim();
  }
  return user.user_id ? String(user.user_id) : user.email ? String(user.email) : "Unknown user";
}

function resolveEmail(user) {
  const raw = user.rawData && typeof user.rawData === "object" ? user.rawData : {};
  for (const c of [user.email, raw.email, raw.mail, raw.userPrincipalName]) {
    if (hasValue(c)) return String(c).trim();
  }
  return "";
}

function summarizeEntitlements(user) {
  const tokens = extractEntitlementTokensFromAppUser(user);
  if (!tokens?.length) return "";
  const preview = tokens.slice(0, 3).join(", ");
  return tokens.length > 3 ? `${preview} (+${tokens.length - 3} more)` : preview;
}

/**
 * @param {object} user app_users document
 * @param {import('mongoose').Types.ObjectId | string} applicationId
 * @param {string} applicationName
 */
export function mapAppUserToMissingManagerItem(user, applicationId, applicationName) {
  const accountId = user.user_id || user._id;
  return {
    identityId: accountId ? String(accountId) : undefined,
    identityName: resolveDisplayName(user),
    identityEmail: resolveEmail(user),
    accountId: accountId ? String(accountId) : undefined,
    applicationId,
    applicationName,
    entitlementName: summarizeEntitlements(user),
    metadata: {
      kind: "app_user",
      userId: accountId ? String(accountId) : null,
      applicationId: applicationId ? String(applicationId) : null,
    },
  };
}

export { APP_USER_SCAN_PROJECTION };
