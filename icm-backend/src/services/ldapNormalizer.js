import { PagedResultsControl } from "ldapts";
import { parseSID } from "../utils/sidParser.js";
import {
  buildRawDataFromEntry,
  getAttrFirst,
  getAttrValues,
  LDAP_SEARCH_SCOPE_SUBTREE,
  resolveLdaptsScope,
  objectGuidToString,
} from "../utils/ldapEntryAttributes.js";

/** Same default as adLdapService (pre-ldapts). */
export const DEFAULT_USER_FILTER = "(&(objectClass=user)(objectCategory=person))";
export const DEFAULT_GROUP_FILTER = "(&(objectClass=group))";
export const DEFAULT_COMPUTER_FILTER = "(&(objectClass=computer))";

/** Posture / security scans — heavier attributes (ACL, delegation, SPNs). */
export const AD_USER_SEARCH_ATTRIBUTES = [
  "sAMAccountName",
  "mail",
  "userPrincipalName",
  "displayName",
  "givenName",
  "sn",
  "department",
  "title",
  "telephoneNumber",
  "userAccountControl",
  "objectGUID",
  "distinguishedName",
  "manager",
  "memberOf",
  "employeeNumber",
  "employeeID",
  "lastLogonTimestamp",
  "pwdLastSet",
  "lockoutTime",
  "servicePrincipalName",
  "objectSid",
  "sIDHistory",
  "primaryGroupID",
  "nTSecurityDescriptor",
  "managedBy",
  "msDS-AllowedToDelegateTo",
  "msDS-AllowedToActOnBehalfOfOtherIdentity",
];

export const AD_GROUP_SEARCH_ATTRIBUTES = [
  "cn",
  "sAMAccountName",
  "name",
  "description",
  "member",
  "managedBy",
  "memberOf",
  "objectSid",
  "distinguishedName",
  "sIDHistory",
  "nTSecurityDescriptor",
];

/**
 * IGA directory sync attributes — industry LDAP-browser style:
 * minimal attrs, prefer memberOf over dumping every group's member list.
 */
export const AD_SYNC_USER_ATTRIBUTES = [
  "sAMAccountName",
  "mail",
  "userPrincipalName",
  "displayName",
  "givenName",
  "sn",
  "department",
  "title",
  "telephoneNumber",
  "userAccountControl",
  "objectGUID",
  "objectSid",
  "distinguishedName",
  "manager",
  "memberOf",
  "employeeNumber",
  "employeeID",
  "lastLogonTimestamp",
];

export const AD_SYNC_GROUP_ATTRIBUTES = [
  "cn",
  "sAMAccountName",
  "name",
  "description",
  "managedBy",
  "memberOf",
  "objectSid",
  "distinguishedName",
];

/** Foreign security principals synced from CN=ForeignSecurityPrincipals when present. */
export const AD_FOREIGN_SECURITY_PRINCIPAL_ATTRIBUTES = [
  "cn",
  "name",
  "objectSid",
  "distinguishedName",
  "nTSecurityDescriptor",
];

export const AD_COMPUTER_SEARCH_ATTRIBUTES = [
  "cn",
  "sAMAccountName",
  "name",
  "distinguishedName",
  "operatingSystem",
  "operatingSystemVersion",
  "lastLogonTimestamp",
  "managedBy",
  "servicePrincipalName",
  "msDS-AllowedToDelegateTo",
  "msDS-AllowedToActOnBehalfOfOtherIdentity",
  "userAccountControl",
  "objectSid",
  "objectGUID",
];

const BUFFER_ATTRS = [
  "objectGUID",
  "objectSid",
  "sIDHistory",
  "primaryGroupID",
  "nTSecurityDescriptor",
  "lastLogonTimestamp",
  "pwdLastSet",
  "lockoutTime",
];

/** AD MaxPageSize is commonly 1000; honor up to 2000 when the DC allows. */
export const DEFAULT_PAGE_SIZE = 1000;
export const MAX_PAGE_SIZE = 2000;

/**
 * @param {string} dn
 */
export function normalizeDn(dn) {
  return String(dn || "").trim().toLowerCase();
}

/**
 * Map ldapts SearchEntry / Entry into normalized user shape for delta + ingest.
 * @param {import('ldapts').Entry|object} entry
 */
export function normalizeUser(entry) {
  const sam = getAttrFirst(entry, "sAMAccountName");
  const dn = getAttrFirst(entry, "distinguishedName") || entry?.dn || "";
  const mail = getAttrFirst(entry, "mail");
  const upn = getAttrFirst(entry, "userPrincipalName");
  const display =
    getAttrFirst(entry, "displayName") ||
    [getAttrFirst(entry, "givenName"), getAttrFirst(entry, "sn")].filter(Boolean).join(" ");

  let memberOf = getAttrValues(entry, "memberOf");
  if (!memberOf.length) memberOf = [];

  const guidRaw = getAttrFirst(entry, "objectGUID");
  const guid =
    guidRaw && /^[0-9A-F-]{36}$/i.test(String(guidRaw))
      ? String(guidRaw).toUpperCase()
      : objectGuidToString(
          entry?.objectGUID ??
            entry?.objectguid ??
            (Array.isArray(entry?.attributes)
              ? entry.attributes.find((a) => a.type?.toLowerCase() === "objectguid")?.values?.[0]
              : null),
        );

  return {
    userId: sam || dn || "",
    displayName: display || "",
    email: mail || upn || "",
    department: getAttrFirst(entry, "department") || "",
    manager: getAttrFirst(entry, "manager") || "",
    distinguishedName: dn,
    userAccountControl: getAttrFirst(entry, "userAccountControl") || "",
    lastLogonTimestamp: getAttrFirst(entry, "lastLogonTimestamp") || "",
    pwdLastSet: getAttrFirst(entry, "pwdLastSet") || "",
    lockoutTime: getAttrFirst(entry, "lockoutTime") || "",
    servicePrincipalName: getAttrValues(entry, "servicePrincipalName"),
    memberOf,
    objectGUID: guid || "",
    _raw: buildRawDataFromEntry(entry),
  };
}

/**
 * @param {import('ldapts').Entry|object} entry
 */
function resolveObjectSidString(entry) {
  const fromAttr = getAttrFirst(entry, "objectSid");
  if (fromAttr && /^S-\d/i.test(String(fromAttr).trim())) {
    return String(fromAttr).trim();
  }
  const raw =
    entry?.objectSid ??
    (Array.isArray(entry?.attributes)
      ? entry.attributes.find((a) => a.type?.toLowerCase() === "objectsid")?.values?.[0]
      : null);
  if (typeof raw === "string" && /^S-\d/i.test(raw.trim())) return raw.trim();
  return parseSID(raw) || fromAttr || "";
}

export function normalizeGroup(entry) {
  const dn = getAttrFirst(entry, "distinguishedName") || entry?.dn || "";
  const sidParsed = resolveObjectSidString(entry);

  let members = getAttrValues(entry, "member");
  if (!members.length) members = [];
  const memberOf = getAttrValues(entry, "memberOf");

  return {
    groupName:
      getAttrFirst(entry, "cn") ||
      getAttrFirst(entry, "sAMAccountName") ||
      getAttrFirst(entry, "name") ||
      "",
    groupDN: dn,
    description: getAttrFirst(entry, "description") || "",
    members,
    memberOf,
    objectSid: sidParsed,
    _raw: buildRawDataFromEntry(entry),
  };
}

/**
 * @param {import('ldapts').Entry|object} entry
 */
export function normalizeComputer(entry) {
  const dn = getAttrFirst(entry, "distinguishedName") || entry?.dn || "";
  const raw = buildRawDataFromEntry(entry);
  return {
    computerName:
      getAttrFirst(entry, "cn") ||
      getAttrFirst(entry, "sAMAccountName") ||
      getAttrFirst(entry, "name") ||
      "",
    distinguishedName: dn,
    operatingSystem: getAttrFirst(entry, "operatingSystem") || "",
    operatingSystemVersion: getAttrFirst(entry, "operatingSystemVersion") || "",
    lastLogonTimestamp: getAttrFirst(entry, "lastLogonTimestamp") || "",
    managedBy: getAttrFirst(entry, "managedBy") || "",
    servicePrincipalName: getAttrValues(entry, "servicePrincipalName"),
    msDSAllowedToDelegateTo: getAttrValues(entry, "msDS-AllowedToDelegateTo"),
    msDSAllowedToActOnBehalfOfOtherIdentity: getAttrFirst(
      entry,
      "msDS-AllowedToActOnBehalfOfOtherIdentity",
    ),
    userAccountControl: getAttrFirst(entry, "userAccountControl") || "",
    objectSid: resolveObjectSidString(entry),
    _raw: raw,
    rawData: raw,
  };
}

/**
 * Resolve LDAP member DN to a synced user (DN match, then userId / UPN / mail).
 * @param {string} memberDn
 * @param {Map<string, object>} dnToUser
 * @param {Map<string, object>} userIdToUser
 */
function resolveMemberToUser(memberDn, dnToUser, userIdToUser) {
  const normMember = normalizeDn(memberDn);
  if (!normMember) return null;
  const byDn = dnToUser.get(normMember);
  if (byDn) return byDn;

  const tail = normMember.split(",")[0] || "";
  const cnMatch = tail.match(/^cn=([^,]+)/);
  const samGuess = cnMatch ? cnMatch[1].trim() : "";
  if (samGuess && userIdToUser.has(samGuess.toLowerCase())) {
    return userIdToUser.get(samGuess.toLowerCase());
  }
  return null;
}

/**
 * Merge group DN lists (preserve first-seen casing from LDAP).
 * @param {string[]} existing
 * @param {string[]} extra
 */
function mergeGroupDns(existing, extra) {
  const seen = new Set((existing || []).map((d) => normalizeDn(d)));
  const out = [...(existing || [])];
  for (const dn of extra || []) {
    const norm = normalizeDn(dn);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(dn);
  }
  return out;
}

/**
 * @param {object[]} users - normalized users from normalizeUser
 * @param {object[]} groups - normalized groups from normalizeGroup
 * @returns {{ userToGroups: Map<string, string[]>, groupToUsers: Map<string, string[]> }}
 */
export function buildMembershipIndex(users, groups) {
  const userToGroups = new Map();
  const groupToUsers = new Map();
  const dnToUser = new Map();
  const userIdToUser = new Map();

  for (const u of users || []) {
    const userId = String(u.userId || "").trim();
    const udn = normalizeDn(u.distinguishedName);
    if (udn) dnToUser.set(udn, u);
    if (userId) userIdToUser.set(userId.toLowerCase(), u);
  }

  for (const u of users || []) {
    const userId = String(u.userId || "").trim();
    if (!userId) continue;
    const fromMemberOf = [];
    const seen = new Set();
    for (const g of u.memberOf || []) {
      const norm = normalizeDn(g);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      fromMemberOf.push(g);
    }
    userToGroups.set(userId, fromMemberOf);
  }

  for (const g of groups || []) {
    const gdnRaw = g.groupDN || "";
    const gdn = normalizeDn(gdnRaw);
    if (!gdn) continue;
    const userIds = [];
    const seenUids = new Set();
    for (const memberDn of g.members || []) {
      const match = resolveMemberToUser(memberDn, dnToUser, userIdToUser);
      const uid = match ? String(match.userId || "").trim() : "";
      if (!uid || seenUids.has(uid)) continue;
      seenUids.add(uid);
      userIds.push(uid);
      const prev = userToGroups.get(uid) || [];
      userToGroups.set(uid, mergeGroupDns(prev, [gdnRaw]));
    }
    groupToUsers.set(gdn, userIds);
  }

  // Fast sync path (no group.member): invert user.memberOf → groupToUsers
  if ([...groupToUsers.values()].every((ids) => !ids?.length)) {
    for (const [userId, groupDns] of userToGroups.entries()) {
      for (const gdnRaw of groupDns || []) {
        const gdn = normalizeDn(gdnRaw);
        if (!gdn) continue;
        const list = groupToUsers.get(gdn) || [];
        if (!list.includes(userId)) list.push(userId);
        groupToUsers.set(gdn, list);
      }
    }
  }

  return { userToGroups, groupToUsers };
}

/**
 * Paged LDAP search using ldapts (PagedResultsControl via searchPaginated).
 *
 * @param {import('ldapts').Client} ldapClient
 * @param {string} baseDN
 * @param {import('ldapts').SearchOptions & { pageSize?: number, timeLimit?: number }} searchOptions
 * @param {number} [maxEntries]
 */
export async function fetchPagedSearchEntries(
  ldapClient,
  baseDN,
  searchOptions,
  maxEntries = Infinity,
) {
  if (maxEntries <= 0) return [];
  const {
    searchScope,
    scope: explicitScope,
    pageSize: optionPageSize,
    timeLimit: optionTimeLimit,
    // Optional mutable collector for profiling (never sent to LDAP).
    __ldapStats,
    ...restOptions
  } = searchOptions || {};
  const pageSize = Math.min(
    Math.max(parseInt(optionPageSize, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const opts = {
    timeLimit: optionTimeLimit || 300,
    returnAttributeValues: true,
    ...restOptions,
    scope: explicitScope || resolveLdaptsScope(searchScope) || LDAP_SEARCH_SCOPE_SUBTREE,
    paged: { pageSize },
    explicitBufferAttributes: [
      ...new Set([
        ...(searchOptions?.explicitBufferAttributes || []),
        ...BUFFER_ATTRS,
      ]),
    ],
  };

  const entries = [];
  let pageCount = 0;
  const paginator = ldapClient.searchPaginated(baseDN, opts);
  for await (const page of paginator) {
    pageCount += 1;
    for (const entry of page.searchEntries || []) {
      entries.push(entry);
      if (entries.length >= maxEntries) {
        if (__ldapStats && typeof __ldapStats === "object") {
          __ldapStats.pageCount = pageCount;
          __ldapStats.entryCount = entries.length;
          __ldapStats.pageSize = pageSize;
          __ldapStats.truncatedAtMax = true;
        }
        return entries;
      }
    }
  }
  if (__ldapStats && typeof __ldapStats === "object") {
    __ldapStats.pageCount = pageCount;
    __ldapStats.entryCount = entries.length;
    __ldapStats.pageSize = pageSize;
    __ldapStats.truncatedAtMax = false;
  }
  return entries;
}

/**
 * Fetch users, groups, and computers with paged searches.
 *
 * @param {import('ldapts').Client} ldapClient - bound ldapts Client
 * @param {string} baseDN
 * @param {{
 *   userFilter?: string,
 *   groupFilter?: string,
 *   computerFilter?: string,
 *   pageSize?: number,
 *   maxUsers?: number,
 *   maxGroups?: number,
 *   maxComputers?: number,
 *   attributeProfile?: 'sync'|'posture',
 *   userAttributes?: string[],
 *   groupAttributes?: string[],
 *   computerAttributes?: string[],
 *   includeGroupMembers?: boolean,
 * }} [options]
 */
export async function fetchAllADObjects(ldapClient, baseDN, options = {}) {
  const maxUsers = options.maxUsers ?? 50000;
  const maxGroups = options.maxGroups ?? 50000;
  const maxComputers = options.maxComputers ?? 50000;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const profile = options.attributeProfile === "posture" ? "posture" : "sync";

  const userFilter = options.userFilter ?? DEFAULT_USER_FILTER;
  const groupFilter = options.groupFilter ?? DEFAULT_GROUP_FILTER;
  const computerFilter = options.computerFilter ?? DEFAULT_COMPUTER_FILTER;

  let userAttributes =
    options.userAttributes ||
    (profile === "posture" ? AD_USER_SEARCH_ATTRIBUTES : AD_SYNC_USER_ATTRIBUTES);
  let groupAttributes =
    options.groupAttributes ||
    (profile === "posture" ? AD_GROUP_SEARCH_ATTRIBUTES : AD_SYNC_GROUP_ATTRIBUTES);

  if (options.includeGroupMembers && !groupAttributes.includes("member")) {
    groupAttributes = [...groupAttributes, "member"];
  }

  const userPromise = fetchPagedSearchEntries(
    ldapClient,
    baseDN,
    { filter: userFilter, attributes: userAttributes, pageSize },
    maxUsers,
  );
  const groupPromise =
    maxGroups > 0
      ? fetchPagedSearchEntries(
          ldapClient,
          baseDN,
          { filter: groupFilter, attributes: groupAttributes, pageSize },
          maxGroups,
        )
      : Promise.resolve([]);
  const computerPromise =
    maxComputers > 0
      ? fetchPagedSearchEntries(
          ldapClient,
          baseDN,
          {
            filter: computerFilter,
            attributes: options.computerAttributes || AD_COMPUTER_SEARCH_ATTRIBUTES,
            pageSize,
          },
          maxComputers,
        )
      : Promise.resolve([]);

  const [userEntries, groupEntries, computerEntries] = await Promise.all([
    userPromise,
    groupPromise,
    computerPromise,
  ]);

  const users = userEntries.map((e) => normalizeUser(e));
  const groups = groupEntries.map((e) => normalizeGroup(e));
  const computers = computerEntries.map((e) => normalizeComputer(e));
  const membership = buildMembershipIndex(users, groups);

  return {
    users,
    groups,
    computers,
    membership,
    userEntries,
    groupEntries,
    computerEntries,
  };
}

export { PagedResultsControl };
