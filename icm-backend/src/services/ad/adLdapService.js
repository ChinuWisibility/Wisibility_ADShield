import { Client } from "ldapts";
import env from "../../config/env.js";
import {
  buildRawDataFromEntry,
  getAttrFirst,
  getAttrValues,
  LDAP_SEARCH_SCOPE_BASE,
  LDAP_SEARCH_SCOPE_SUBTREE,
  objectGuidToString,
} from "../../utils/ldapEntryAttributes.js";
import { escapeLdapFilterValue } from "../../utils/ldapDn.js";
import {
  AD_USER_SEARCH_ATTRIBUTES,
  AD_GROUP_SEARCH_ATTRIBUTES,
  AD_COMPUTER_SEARCH_ATTRIBUTES,
  AD_SYNC_USER_ATTRIBUTES,
  AD_SYNC_GROUP_ATTRIBUTES,
  DEFAULT_COMPUTER_FILTER,
  DEFAULT_GROUP_FILTER,
  DEFAULT_USER_FILTER,
  buildMembershipIndex,
  fetchAllADObjects,
  fetchPagedSearchEntries,
  normalizeUser,
  normalizeGroup,
  normalizeComputer,
  normalizeDn,
} from "./ldapNormalizer.js";
import {
  buildGroupDnToNameMap,
  enrichUserDocsWithMembership,
  mapAdGroupToEntitlementDoc,
} from "./adDirectoryIngestService.js";
import { buildAdUserCreatePayload } from "./adUserCreatePayload.js";

export { DEFAULT_USER_FILTER };
export {
  fetchAllADObjects,
  buildMembershipIndex,
  normalizeUser,
  normalizeGroup,
} from "./ldapNormalizer.js";
export { getAttrValues, getAttrFirst, objectGuidToString } from "../../utils/ldapEntryAttributes.js";

const DEFAULT_GENERIC_LDAP_FILTER =
  "(|(objectClass=inetOrgPerson)(objectClass=person)(objectClass=organizationalPerson))";

const USER_ATTRS = [
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
];

const GENERIC_LDAP_ATTRS = [
  "cn",
  "uid",
  "mail",
  "sn",
  "givenName",
  "displayName",
  "title",
  "telephoneNumber",
  "departmentNumber",
  "ou",
  "memberOf",
  "distinguishedName",
  "entryDN",
];

const toStr = (v) => (v === undefined || v === null ? "" : String(v).trim());
const asList = (v) => {
  if (Array.isArray(v)) return v.map((x) => toStr(x)).filter(Boolean);
  const s = toStr(v);
  return s ? [s] : [];
};

/**
 * Normalize AD/LDAP config from request body or stored application config.
 */
export function normalizeAdConfig(input = {}) {
  const urls = asList(input.urls ?? input.url ?? input.adUrl);
  const baseDns = asList(input.baseDns ?? input.baseDn ?? input.adBaseDn);
  const filters = asList(
    input.userSearchFilters ?? input.userSearchFilter ?? input.adUserFilter,
  );
  const groupFilters = asList(
    input.groupSearchFilters ?? input.groupSearchFilter ?? input.adGroupFilter,
  );

  const bindDn = toStr(input.bindDn ?? input.adBindDn);
  const bindPassword = input.bindPassword ?? input.adBindPassword ?? "";
  const tlsInsecure = Boolean(input.tlsInsecure ?? input.adTlsInsecure);
  const deployment = String(
    input.deployment ?? input.adDeployment ?? "on_prem",
  ).trim();
  const userSearchFilter = filters[0] || DEFAULT_USER_FILTER;
  const pageSize = Math.min(
    Math.max(parseInt(input.pageSize, 10) || 1000, 1),
    2000,
  );
  const maxUsers = Math.min(
    Math.max(parseInt(input.maxUsers, 10) || 10000, 1),
    50000,
  );
  const groupSearchFilter = groupFilters[0] || DEFAULT_GROUP_FILTER;
  const maxGroups = Math.min(
    Math.max(parseInt(input.maxGroups, 10) || 50000, 1),
    50000,
  );
  const maxComputers = Math.min(
    Math.max(parseInt(input.maxComputers, 10) || 0, 0),
    50000,
  );
  const syncGroups = input.syncGroups !== false && input.syncGroups !== "false";
  /** Parent DN for LDAP Add — never silently fall back to search baseDn. */
  const targetOuDn = toStr(input.targetOuDn ?? input.adTargetOuDn);
  const groupWriteBaseDn = toStr(
    input.groupWriteBaseDn ??
      input.adGroupWriteBaseDn ??
      input.groupSearchBaseDn ??
      targetOuDn,
  );
  const upnSuffix = toStr(input.upnSuffix ?? input.adUpnSuffix).replace(/^@+/, "");
  const samAccountNameSource = toStr(
    input.samAccountNameSource ?? input.adSamAccountNameSource ?? "explicit",
  ).toLowerCase() || "explicit";
  return {
    url: urls[0] || "",
    baseDn: baseDns[0] || "",
    userSearchFilter,
    groupSearchFilter,
    urls,
    baseDns,
    userSearchFilters: filters.length ? filters : [userSearchFilter],
    groupSearchFilters: groupFilters.length
      ? groupFilters
      : [groupSearchFilter],
    bindDn,
    bindPassword,
    tlsInsecure,
    deployment,
    pageSize,
    maxUsers,
    maxGroups,
    maxComputers,
    syncGroups,
    targetOuDn,
    groupWriteBaseDn,
    upnSuffix,
    samAccountNameSource,
  };
}

function isDn(value) {
  return /^(?:cn|ou|dc)=[^,]+(?:,.+=.+)+$/i.test(toStr(value));
}

function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    toStr(value).replace(/[{}]/g, ""),
  );
}

/** AD stores the first three UUID fields little-endian in objectGUID. */
export function objectGuidToLdapFilterValue(value) {
  const guid = toStr(value).replace(/[{}]/g, "");
  if (!isGuid(guid)) return "";
  const hex = guid.replace(/-/g, "");
  const bytes = [
    hex.slice(6, 8),
    hex.slice(4, 6),
    hex.slice(2, 4),
    hex.slice(0, 2),
    hex.slice(10, 12),
    hex.slice(8, 10),
    hex.slice(14, 16),
    hex.slice(12, 14),
    ...hex.slice(16).match(/.{2}/g),
  ];
  return bytes.map((byte) => `\\${byte}`).join("");
}

function readObjectGuid(entry) {
  const direct = entry?.objectGUID;
  if (typeof direct === "string" && isGuid(direct)) {
    return direct.toUpperCase();
  }
  const decoded = getAttrFirst(entry, "objectGUID");
  if (typeof decoded === "string" && isGuid(decoded)) {
    return decoded.toUpperCase();
  }
  return objectGuidToString(direct) || objectGuidToString(decoded);
}

export function assertDnWithinScope(dn, approvedBaseDn, targetLabel = "AD target") {
  const normalizedDn = normalizeDn(dn);
  const normalizedBase = normalizeDn(approvedBaseDn);
  if (
    !normalizedDn ||
    !normalizedBase ||
    (normalizedDn !== normalizedBase && !normalizedDn.endsWith(`,${normalizedBase}`))
  ) {
    throw Object.assign(
      new Error(`${targetLabel} is outside the configured write scope.`),
      {
        code: "AD_SCOPE_VIOLATION",
        targetDn: dn || undefined,
        approvedBaseDn: approvedBaseDn || undefined,
      },
    );
  }
  return dn;
}

/**
 * Maps ldapts entry → application user document (same shape as legacy ldapjs ingest).
 * @param {import('ldapts').Entry|object} entry
 */
export function mapAdEntryToUserDoc(entry) {
  const n = normalizeUser(entry);
  const uac = parseInt(n.userAccountControl || "0", 10);
  const disabled = Number.isFinite(uac) && (uac & 2) === 2;
  const groups = (n.memberOf || []).join("; ");
  const sam = getAttrFirst(entry, "sAMAccountName");
  const employeeNumber =
    getAttrFirst(entry, "employeeNumber") || getAttrFirst(entry, "employeeID");

  return {
    user_id: n.userId || n.distinguishedName || "",
    employee_id: employeeNumber || getAttrFirst(entry, "userPrincipalName") || "",
    username: getAttrFirst(entry, "givenName") || sam || "",
    email: n.email || "",
    display_name: n.displayName || "",
    status: disabled ? "disabled" : "active",
    department: n.department || "",
    title: getAttrFirst(entry, "title") || "",
    manager_id: n.manager || "",
    telephone: getAttrFirst(entry, "telephoneNumber") || "",
    member_of_entitlements: groups || "",
    rawData: n._raw || buildRawDataFromEntry(entry),
  };
}

/**
 * Create ldapts client (replaces ldapjs createClient).
 * @param {{ url: string, tlsInsecure?: boolean }} cfg
 */
export function createLdapClient(cfg) {
  const opts = {
    url: cfg.url,
    // Large directories need longer idle timeouts than interactive LDAP browsers.
    timeout: Math.min(Math.max(parseInt(cfg.ldapTimeoutMs, 10) || 120000, 30000), 600000),
    connectTimeout: Math.min(Math.max(parseInt(cfg.connectTimeoutMs, 10) || 15000, 5000), 60000),
  };
  const rejectUnauthorized =
    cfg.tlsInsecure === true ? false : env.ldapRejectUnauthorized !== false;
  if (String(cfg.url || "").toLowerCase().startsWith("ldaps://") || cfg.tlsInsecure) {
    opts.tlsOptions = { rejectUnauthorized };
  }
  return new Client(opts);
}

/**
 * Map ldapts / LDAP result codes to sanitized Errors (never includes secrets).
 * Exported for unit tests.
 * @param {unknown} err
 * @param {string} [context]
 * @returns {Error & { code?: string|number, ldapCode?: number }}
 */
export function wrapLdapError(err, context = "LDAP") {
  const msg = err?.message || String(err);
  const ldapCode = Number(err?.code);
  const name = String(err?.name || "");

  const annotated = (message, code) => {
    const e = new Error(`${context}: ${message}`);
    e.code = code;
    if (Number.isFinite(ldapCode)) e.ldapCode = ldapCode;
    return e;
  };

  if (
    ldapCode === 49 ||
    name === "InvalidCredentialsError" ||
    /invalid credentials/i.test(msg)
  ) {
    return annotated("invalid credentials or bind DN.", "LDAP_INVALID_CREDENTIALS");
  }
  if (
    ldapCode === 68 ||
    name === "AlreadyExistsError" ||
    /already exists/i.test(msg)
  ) {
    return annotated("entry already exists.", "LDAP_ALREADY_EXISTS");
  }
  if (
    ldapCode === 50 ||
    name === "InsufficientAccessError" ||
    /insufficient access/i.test(msg)
  ) {
    return annotated(
      "insufficient access rights for this operation.",
      "LDAP_INSUFFICIENT_ACCESS",
    );
  }
  if (
    ldapCode === 19 ||
    name === "ConstraintViolationError" ||
    /constraint violation/i.test(msg)
  ) {
    return annotated("constraint violation.", "LDAP_CONSTRAINT_VIOLATION");
  }
  if (
    ldapCode === 52 ||
    name === "UnavailableError" ||
    /server is unavailable|unavailable/i.test(msg)
  ) {
    return annotated("directory server unavailable.", "LDAP_UNAVAILABLE");
  }
  if (/timeout|ETIMEDOUT|ETIMEOUT/i.test(msg)) {
    return annotated("connection or operation timed out.", "LDAP_TIMEOUT");
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|network/i.test(msg)) {
    return annotated(`connection failed (${msg}).`, "LDAP_CONNECTION_FAILED");
  }

  // Sanitize accidental secret leakage in rare vendor messages.
  const safeMsg = String(msg)
    .replace(/bindPassword[=:]\s*\S+/gi, "bindPassword=[redacted]")
    .replace(/\bpassword[=:]\s*\S+/gi, "password=[redacted]");
  return annotated(safeMsg, Number.isFinite(ldapCode) ? `LDAP_${ldapCode}` : "LDAP_ERROR");
}

async function withBoundClient(cfg, fn) {
  const client = createLdapClient(cfg);
  try {
    await client.bind(cfg.bindDn, String(cfg.bindPassword ?? ""));
    return await fn(client);
  } catch (err) {
    // Preserve already-classified app / wrapLdapError results (string codes).
    if (err?.code != null && typeof err.code === "string" && !/^\d+$/.test(err.code)) {
      throw err;
    }
    throw wrapLdapError(err);
  } finally {
    try {
      await client.unbind();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Confirm the provisioning OU exists (base-scope search).
 * @param {import('ldapts').Client} client
 * @param {string} targetOuDn
 */
async function assertTargetOuExists(client, targetOuDn) {
  try {
    const { searchEntries } = await client.search(targetOuDn, {
      scope: LDAP_SEARCH_SCOPE_BASE,
      filter: "(objectClass=*)",
      attributes: ["distinguishedName", "ou", "cn", "name"],
      sizeLimit: 1,
      timeLimit: 30,
    });
    if (!searchEntries?.length) {
      const e = new Error(`targetOuDn does not exist or is not readable: ${targetOuDn}`);
      e.code = "TARGET_OU_NOT_FOUND";
      throw e;
    }
  } catch (err) {
    if (err?.code === "TARGET_OU_NOT_FOUND") throw err;
    if (err?.name === "NoSuchObjectError" || err?.code === 32) {
      const e = new Error(`targetOuDn does not exist: ${targetOuDn}`);
      e.code = "TARGET_OU_NOT_FOUND";
      throw e;
    }
    throw err;
  }
}

/**
 * Pre-add uniqueness check for sAMAccountName and userPrincipalName.
 * Uses existing client.search (not a second LDAP stack).
 * @param {import('ldapts').Client} client
 * @param {string} searchBase
 * @param {{ sAMAccountName: string, userPrincipalName: string }} ids
 */
export function buildDuplicateAdUserFilter(ids) {
  const sam = escapeLdapFilterValue(ids.sAMAccountName);
  const upn = escapeLdapFilterValue(ids.userPrincipalName);
  return `(&(objectClass=user)(|(sAMAccountName=${sam})(userPrincipalName=${upn})))`;
}

async function findDuplicateAdUser(client, searchBase, ids) {
  const filter = buildDuplicateAdUserFilter(ids);
  const { searchEntries } = await client.search(searchBase, {
    scope: LDAP_SEARCH_SCOPE_SUBTREE,
    filter,
    attributes: ["sAMAccountName", "userPrincipalName", "distinguishedName", "objectGUID"],
    sizeLimit: 5,
    timeLimit: 30,
  });
  if (!searchEntries?.length) return null;
  const entry = searchEntries[0];
  return {
    dn: entry.dn || getAttrFirst(entry, "distinguishedName") || "",
    sAMAccountName: getAttrFirst(entry, "sAMAccountName") || "",
    userPrincipalName: getAttrFirst(entry, "userPrincipalName") || "",
    objectGUID: objectGuidToString(
      entry.objectGUID ?? getAttrFirst(entry, "objectGUID"),
    ),
  };
}

/**
 * Create an AD user via ldapts Client.add (disabled account, no password).
 *
 * @param {object} rawAdConfig - application connectionConfig.ad (or overrides)
 * @param {object} userSpec - controlled identity fields (not arbitrary LDAP attrs)
 * @returns {Promise<{
 *   created: true,
 *   dn: string,
 *   sAMAccountName: string,
 *   userPrincipalName: string,
 *   objectGUID: string|null,
 *   accountEnabled: false,
 *   passwordSet: false,
 *   attributes: object,
 *   verified: object|null
 * }>}
 */
export async function createAdUser(rawAdConfig, userSpec = {}) {
  const cfg = normalizeAdConfig(rawAdConfig);
  if (!cfg.url || !cfg.bindDn) {
    throw Object.assign(
      new Error("LDAP URL and bind DN are required to create a user."),
      { code: "CONFIG_INCOMPLETE" },
    );
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw Object.assign(new Error("Bind password is required to create a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }
  if (!cfg.targetOuDn) {
    throw Object.assign(
      new Error(
        "targetOuDn is required in AD connection config before creating a user.",
      ),
      { code: "CONFIG_TARGET_OU_REQUIRED" },
    );
  }

  const payload = buildAdUserCreatePayload(userSpec, cfg);
  const searchBase = cfg.baseDn || cfg.targetOuDn;

  return withBoundClient(cfg, async (client) => {
    await assertTargetOuExists(client, cfg.targetOuDn);

    const dup = await findDuplicateAdUser(client, searchBase, {
      sAMAccountName: payload.meta.sAMAccountName,
      userPrincipalName: payload.meta.userPrincipalName,
    });
    if (dup) {
      assertDnWithinScope(dup.dn, cfg.targetOuDn, "Existing AD account");
      const e = new Error(
        `AD account already exists (sAMAccountName or userPrincipalName). Existing DN: ${dup.dn || "(unknown)"}`,
      );
      e.code = "DUPLICATE_ACCOUNT";
      e.existing = dup;
      throw e;
    }

    try {
      await client.add(payload.dn, payload.attributes);
    } catch (err) {
      throw wrapLdapError(err, "LDAP create");
    }

    // Read-back verification (still not Identity Sphere sync — that is a separate step).
    let verified = null;
    let objectGUID = null;
    try {
      const { searchEntries } = await client.search(payload.dn, {
        scope: LDAP_SEARCH_SCOPE_BASE,
        filter: "(objectClass=user)",
        attributes: [
          "sAMAccountName",
          "userPrincipalName",
          "displayName",
          "givenName",
          "sn",
          "mail",
          "department",
          "employeeID",
          "employeeNumber",
          "userAccountControl",
          "distinguishedName",
          "objectGUID",
        ],
        sizeLimit: 1,
        timeLimit: 30,
        explicitBufferAttributes: ["objectGUID"],
      });
      const entry = searchEntries?.[0];
      if (entry) {
        objectGUID = readObjectGuid(entry);
        verified = {
          dn: entry.dn || getAttrFirst(entry, "distinguishedName") || payload.dn,
          sAMAccountName: getAttrFirst(entry, "sAMAccountName"),
          userPrincipalName: getAttrFirst(entry, "userPrincipalName"),
          displayName: getAttrFirst(entry, "displayName"),
          givenName: getAttrFirst(entry, "givenName"),
          sn: getAttrFirst(entry, "sn"),
          mail: getAttrFirst(entry, "mail"),
          department: getAttrFirst(entry, "department"),
          employeeID: getAttrFirst(entry, "employeeID"),
          employeeNumber: getAttrFirst(entry, "employeeNumber"),
          userAccountControl: getAttrFirst(entry, "userAccountControl"),
          objectGUID,
        };
      }
    } catch {
      /* create succeeded; read-back optional */
    }

    if (!verified) {
      throw Object.assign(
        new Error(
          `LDAP add returned success but the new entry could not be read back at ${payload.dn}`,
        ),
        { code: "CREATE_VERIFY_FAILED", dn: payload.dn },
      );
    }

    console.info(
      `[ad-create] created dn=${payload.dn} sam=${payload.meta.sAMAccountName} enabled=false`,
    );

    return {
      created: true,
      dn: payload.dn,
      sAMAccountName: payload.meta.sAMAccountName,
      userPrincipalName: payload.meta.userPrincipalName,
      objectGUID,
      accountEnabled: false,
      passwordSet: false,
      attributes: { ...payload.attributes },
      verified,
      meta: payload.meta,
    };
  });
}

/** Allowlisted AD attributes for UPDATE (no arbitrary LDAP attrs). */
export const AD_UPDATABLE_ATTRIBUTES = Object.freeze([
  "displayName",
  "givenName",
  "sn",
  "department",
  "title",
  "mail",
  "telephoneNumber",
  "employeeID",
  "employeeNumber",
  "manager",
]);

const AD_UAC_ACCOUNTDISABLE = 2;

/**
 * Resolve an existing AD user for write operations using ordered, independent
 * locators. A locator with multiple matches fails closed; a scope violation
 * never falls through to a weaker locator.
 */
export async function resolveAdUserTarget(client, cfg, locator = {}) {
  const nativeIdentifier = toStr(locator.nativeIdentifier);
  const explicitDn = toStr(
    locator.dn ||
      locator.distinguishedName ||
      (isDn(nativeIdentifier) ? nativeIdentifier : ""),
  );
  const objectGUID = toStr(
    locator.objectGUID ||
      locator.objectGuid ||
      locator.guid ||
      (isGuid(nativeIdentifier) ? nativeIdentifier : ""),
  ).replace(/[{}]/g, "");
  const sam = toStr(
    locator.sAMAccountName ||
      locator.samAccountName ||
      locator.sam ||
      (!isDn(nativeIdentifier) && !isGuid(nativeIdentifier)
        ? nativeIdentifier
        : ""),
  );
  const upn = toStr(locator.userPrincipalName || locator.upn);
  const employeeId = toStr(
    locator.employeeId || locator.employeeID || locator.employee_id,
  );

  const locators = [
    explicitDn
      ? {
          kind: "DN",
          base: explicitDn,
          scope: LDAP_SEARCH_SCOPE_BASE,
          filter: "(objectClass=user)",
        }
      : null,
    objectGUID
      ? {
          kind: "objectGUID",
          base: cfg.baseDn || cfg.targetOuDn,
          scope: LDAP_SEARCH_SCOPE_SUBTREE,
          filter: `(&(objectClass=user)(objectGUID=${objectGuidToLdapFilterValue(
            objectGUID,
          )}))`,
        }
      : null,
    sam
      ? {
          kind: "sAMAccountName",
          base: cfg.baseDn || cfg.targetOuDn,
          scope: LDAP_SEARCH_SCOPE_SUBTREE,
          filter: `(&(objectClass=user)(sAMAccountName=${escapeLdapFilterValue(
            sam,
          )}))`,
        }
      : null,
    upn
      ? {
          kind: "UPN",
          base: cfg.baseDn || cfg.targetOuDn,
          scope: LDAP_SEARCH_SCOPE_SUBTREE,
          filter: `(&(objectClass=user)(userPrincipalName=${escapeLdapFilterValue(
            upn,
          )}))`,
        }
      : null,
    employeeId
      ? {
          kind: "employeeId",
          base: cfg.baseDn || cfg.targetOuDn,
          scope: LDAP_SEARCH_SCOPE_SUBTREE,
          filter: `(&(objectClass=user)(|(employeeID=${escapeLdapFilterValue(
            employeeId,
          )})(employeeNumber=${escapeLdapFilterValue(employeeId)})))`,
        }
      : null,
  ].filter(Boolean);

  if (!locators.length) {
    throw Object.assign(
      new Error(
        "Cannot locate AD user: need DN, objectGUID, sAMAccountName, UPN, or employeeId.",
      ),
      { code: "LOCATOR_REQUIRED" },
    );
  }

  for (const candidate of locators) {
    let searchEntries;
    try {
      ({ searchEntries } = await client.search(candidate.base, {
        scope: candidate.scope,
        filter: candidate.filter,
        attributes: [
          "distinguishedName",
          "sAMAccountName",
          "userPrincipalName",
          "employeeID",
          "employeeNumber",
          "userAccountControl",
          "objectGUID",
        ],
        sizeLimit: 5,
        timeLimit: 30,
        explicitBufferAttributes: ["objectGUID"],
      }));
    } catch (err) {
      if (
        candidate.kind === "DN" &&
        (err?.name === "NoSuchObjectError" || Number(err?.code) === 32)
      ) {
        continue;
      }
      throw err;
    }
    if (!searchEntries?.length) continue;
    if (searchEntries.length > 1) {
      throw Object.assign(
        new Error(`AD account locator ${candidate.kind} is ambiguous.`),
        { code: "ACCOUNT_AMBIGUOUS", locatorType: candidate.kind },
      );
    }
    const entry = searchEntries[0];
    const dn = entry.dn || getAttrFirst(entry, "distinguishedName");
    if (!dn) {
      throw Object.assign(new Error("Resolved AD account has no DN."), {
        code: "MALFORMED_TARGET",
      });
    }
    assertDnWithinScope(dn, cfg.targetOuDn, "AD account");
    return {
      dn,
      locatorType: candidate.kind,
      sAMAccountName: getAttrFirst(entry, "sAMAccountName") || "",
      userPrincipalName: getAttrFirst(entry, "userPrincipalName") || "",
      objectGUID: readObjectGuid(entry),
      entry,
    };
  }

  throw Object.assign(new Error("AD account was not found for supplied locators."), {
    code: "ACCOUNT_NOT_FOUND",
  });
}

export async function resolveAdUserDn(client, cfg, locator = {}) {
  return (await resolveAdUserTarget(client, cfg, locator)).dn;
}

/**
 * UPDATE AD account attributes (idempotent replace). Does not rewrite createAdUser.
 * @param {object} rawAdConfig
 * @param {{ dn?: string, sAMAccountName?: string, employeeId?: string, attributes?: object }} updateSpec
 */
export async function updateAdUser(rawAdConfig, updateSpec = {}) {
  const { Change, Attribute } = await import("ldapts");
  const cfg = normalizeAdConfig(rawAdConfig);
  if (!cfg.url || !cfg.bindDn) {
    throw Object.assign(new Error("LDAP URL and bind DN are required to update a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw Object.assign(new Error("Bind password is required to update a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }

  const attrsIn = updateSpec.attributes && typeof updateSpec.attributes === "object"
    ? updateSpec.attributes
    : updateSpec;
  const changes = [];
  for (const key of AD_UPDATABLE_ATTRIBUTES) {
    if (!Object.prototype.hasOwnProperty.call(attrsIn, key)) continue;
    const value = toStr(attrsIn[key]);
    if (!value) continue;
    changes.push(
      new Change({
        operation: "replace",
        modification: new Attribute({ type: key, values: [value] }),
      }),
    );
  }

  if (!changes.length) {
    return {
      updated: false,
      noop: true,
      message: "No allowlisted attribute changes",
    };
  }

  return withBoundClient(cfg, async (client) => {
    const dn = await resolveAdUserDn(client, cfg, updateSpec);
    try {
      await client.modify(dn, changes);
    } catch (err) {
      throw wrapLdapError(err, "LDAP update");
    }

    let verified = null;
    try {
      const { searchEntries } = await client.search(dn, {
        scope: LDAP_SEARCH_SCOPE_BASE,
        filter: "(objectClass=user)",
        attributes: [...AD_UPDATABLE_ATTRIBUTES, "sAMAccountName", "userAccountControl", "objectGUID"],
        sizeLimit: 1,
        timeLimit: 30,
        explicitBufferAttributes: ["objectGUID"],
      });
      const entry = searchEntries?.[0];
      if (entry) {
        verified = { dn };
        for (const key of AD_UPDATABLE_ATTRIBUTES) {
          verified[key] = getAttrFirst(entry, key) || null;
        }
        verified.sAMAccountName = getAttrFirst(entry, "sAMAccountName");
        verified.userAccountControl = getAttrFirst(entry, "userAccountControl");
        verified.objectGUID = readObjectGuid(entry);
      }
    } catch {
      /* modify succeeded; read-back optional */
    }

    console.info(`[ad-update] updated dn=${dn} attrs=${changes.length}`);
    return {
      updated: true,
      dn,
      attributesWritten: changes.map((c) => c.modification?.type).filter(Boolean),
      verified,
    };
  });
}

/**
 * DISABLE AD account via userAccountControl ACCOUNTDISABLE bit. Idempotent.
 */
export async function disableAdUser(rawAdConfig, locator = {}) {
  const { Change, Attribute } = await import("ldapts");
  const cfg = normalizeAdConfig(rawAdConfig);
  if (!cfg.url || !cfg.bindDn) {
    throw Object.assign(new Error("LDAP URL and bind DN are required to disable a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw Object.assign(new Error("Bind password is required to disable a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }

  return withBoundClient(cfg, async (client) => {
    const dn = await resolveAdUserDn(client, cfg, locator);
    const { searchEntries } = await client.search(dn, {
      scope: LDAP_SEARCH_SCOPE_BASE,
      filter: "(objectClass=user)",
      attributes: ["userAccountControl", "sAMAccountName", "objectGUID"],
      sizeLimit: 1,
      timeLimit: 30,
      explicitBufferAttributes: ["objectGUID"],
    });
    const entry = searchEntries?.[0];
    if (!entry) {
      throw Object.assign(new Error(`AD user not readable at ${dn}`), {
        code: "ACCOUNT_NOT_FOUND",
      });
    }
    const uac = parseInt(getAttrFirst(entry, "userAccountControl") || "0", 10) || 0;
    const alreadyDisabled = (uac & AD_UAC_ACCOUNTDISABLE) === AD_UAC_ACCOUNTDISABLE;
    if (alreadyDisabled) {
      return {
        disabled: true,
        noop: true,
        dn,
        userAccountControl: uac,
        sAMAccountName: getAttrFirst(entry, "sAMAccountName"),
        objectGUID: readObjectGuid(entry),
      };
    }

    const nextUac = uac | AD_UAC_ACCOUNTDISABLE;
    try {
      await client.modify(dn, [
        new Change({
          operation: "replace",
          modification: new Attribute({
            type: "userAccountControl",
            values: [String(nextUac)],
          }),
        }),
      ]);
    } catch (err) {
      throw wrapLdapError(err, "LDAP disable");
    }

    console.info(`[ad-disable] disabled dn=${dn} uac=${nextUac}`);
    return {
      disabled: true,
      noop: false,
      dn,
      userAccountControl: nextUac,
      sAMAccountName: getAttrFirst(entry, "sAMAccountName"),
      objectGUID: readObjectGuid(entry),
    };
  });
}

/**
 * ENABLE AD account by clearing only userAccountControl ACCOUNTDISABLE. Idempotent.
 * Password creation/reset is deliberately outside this operation.
 */
export async function enableAdUser(rawAdConfig, locator = {}) {
  const { Change, Attribute } = await import("ldapts");
  const cfg = normalizeAdConfig(rawAdConfig);
  if (!cfg.url || !cfg.bindDn || !cfg.targetOuDn) {
    throw Object.assign(
      new Error(
        "LDAP URL, bind DN, and targetOuDn are required to enable a user.",
      ),
      { code: "CONFIG_INCOMPLETE" },
    );
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw Object.assign(new Error("Bind password is required to enable a user."), {
      code: "CONFIG_INCOMPLETE",
    });
  }

  return withBoundClient(cfg, async (client) => {
    const target = await resolveAdUserTarget(client, cfg, locator);
    const uac =
      parseInt(getAttrFirst(target.entry, "userAccountControl") || "0", 10) || 0;
    const alreadyEnabled = (uac & AD_UAC_ACCOUNTDISABLE) === 0;
    if (alreadyEnabled) {
      return {
        enabled: true,
        noop: true,
        dn: target.dn,
        userAccountControl: uac,
        sAMAccountName: target.sAMAccountName,
        objectGUID: target.objectGUID,
        locatorType: target.locatorType,
      };
    }

    const nextUac = uac & ~AD_UAC_ACCOUNTDISABLE;
    try {
      await client.modify(target.dn, [
        new Change({
          operation: "replace",
          modification: new Attribute({
            type: "userAccountControl",
            values: [String(nextUac)],
          }),
        }),
      ]);
    } catch (err) {
      throw wrapLdapError(err, "LDAP enable");
    }

    console.info(`[ad-enable] enabled dn=${target.dn} uac=${nextUac}`);
    return {
      enabled: true,
      noop: false,
      dn: target.dn,
      userAccountControl: nextUac,
      sAMAccountName: target.sAMAccountName,
      objectGUID: target.objectGUID,
      locatorType: target.locatorType,
    };
  });
}

async function resolveAdGroupTarget(client, cfg, groupDn) {
  const dn = toStr(groupDn);
  if (!isDn(dn)) {
    throw Object.assign(new Error("A valid catalog-resolved AD group DN is required."), {
      code: "MALFORMED_TARGET",
    });
  }
  assertDnWithinScope(dn, cfg.groupWriteBaseDn, "AD group");
  const { searchEntries } = await client.search(dn, {
    scope: LDAP_SEARCH_SCOPE_BASE,
    filter: "(objectClass=group)",
    attributes: ["distinguishedName", "objectGUID", "objectSid", "member"],
    sizeLimit: 2,
    timeLimit: 30,
    explicitBufferAttributes: ["objectGUID", "objectSid"],
  });
  if (!searchEntries?.length) {
    throw Object.assign(new Error("Catalog-resolved AD group was not found."), {
      code: "GROUP_NOT_FOUND",
    });
  }
  if (searchEntries.length > 1) {
    throw Object.assign(new Error("Catalog-resolved AD group is ambiguous."), {
      code: "GROUP_AMBIGUOUS",
    });
  }
  const entry = searchEntries[0];
  const authoritativeDn =
    entry.dn || getAttrFirst(entry, "distinguishedName") || "";
  assertDnWithinScope(authoritativeDn, cfg.groupWriteBaseDn, "AD group");
  if (normalizeDn(authoritativeDn) !== normalizeDn(dn)) {
    throw Object.assign(
      new Error("Catalog group DN does not match the authoritative LDAP target."),
      { code: "GROUP_TARGET_MISMATCH" },
    );
  }
  return { dn: authoritativeDn, entry };
}

async function changeAdGroupMember(
  rawAdConfig,
  { groupDn, userLocator = {}, operation } = {},
) {
  const { Change, Attribute } = await import("ldapts");
  const cfg = normalizeAdConfig(rawAdConfig);
  if (!cfg.url || !cfg.bindDn || !cfg.targetOuDn || !cfg.groupWriteBaseDn) {
    throw Object.assign(
      new Error(
        "LDAP URL, bind DN, targetOuDn, and group write scope are required.",
      ),
      { code: "CONFIG_INCOMPLETE" },
    );
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw Object.assign(
      new Error("Bind password is required for group membership changes."),
      { code: "CONFIG_INCOMPLETE" },
    );
  }

  return withBoundClient(cfg, async (client) => {
    const user = await resolveAdUserTarget(client, cfg, userLocator);
    const group = await resolveAdGroupTarget(client, cfg, groupDn);
    const members = getAttrValues(group.entry, "member");
    const isMember = members.some(
      (memberDn) => normalizeDn(memberDn) === normalizeDn(user.dn),
    );
    const adding = operation === "add";
    if ((adding && isMember) || (!adding && !isMember)) {
      return {
        changed: false,
        noop: true,
        membershipPresent: adding,
        groupDn: group.dn,
        userDn: user.dn,
        objectGUID: user.objectGUID,
        locatorType: user.locatorType,
      };
    }

    try {
      await client.modify(group.dn, [
        new Change({
          operation: adding ? "add" : "delete",
          modification: new Attribute({
            type: "member",
            values: [user.dn],
          }),
        }),
      ]);
    } catch (err) {
      throw wrapLdapError(
        err,
        adding ? "LDAP add group member" : "LDAP remove group member",
      );
    }
    return {
      changed: true,
      noop: false,
      membershipPresent: adding,
      groupDn: group.dn,
      userDn: user.dn,
      objectGUID: user.objectGUID,
      locatorType: user.locatorType,
    };
  });
}

export async function addAdGroupMember(rawAdConfig, request = {}) {
  return changeAdGroupMember(rawAdConfig, { ...request, operation: "add" });
}

export async function removeAdGroupMember(rawAdConfig, request = {}) {
  return changeAdGroupMember(rawAdConfig, { ...request, operation: "delete" });
}

/**
 * Bind and run a small subtree search to verify connectivity and LDAP path.
 */
async function testAdConnectionSingle(cfg) {
  return withBoundClient(cfg, async (client) => {
    const { searchEntries } = await client.search(cfg.baseDn, {
      filter: cfg.userSearchFilter,
      scope: LDAP_SEARCH_SCOPE_SUBTREE,
      attributes: ["sAMAccountName"],
      sizeLimit: 10,
      timeLimit: 30,
    });
    return { ok: true, sampleCount: searchEntries?.length ?? 0 };
  });
}

export async function testAdConnection(raw) {
  const cfg = normalizeAdConfig(raw);
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = cfg.baseDns?.length
    ? cfg.baseDns
    : cfg.baseDn
      ? [cfg.baseDn]
      : [];
  const filters = cfg.userSearchFilters?.length
    ? cfg.userSearchFilters
    : cfg.userSearchFilter
      ? [cfg.userSearchFilter]
      : [];

  if (!urls.length || !cfg.bindDn || !baseDns.length) {
    throw new Error("LDAP URL(s), bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required for testing.");
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      for (const filter of filters.length ? filters : [DEFAULT_USER_FILTER]) {
        const attemptCfg = { ...cfg, url, baseDn, userSearchFilter: filter };
        try {
          const result = await testAdConnectionSingle(attemptCfg);
          return { ...result, endpoint: url, baseDn, filter };
        } catch (err) {
          failures.push({
            endpoint: url,
            baseDn,
            filter,
            error: err.message || String(err),
          });
        }
      }
    }
  }

  const sample = failures.slice(0, 3);
  const more =
    failures.length > sample.length
      ? ` (+${failures.length - sample.length} more)`
      : "";
  throw new Error(
    `All LDAP endpoints failed: ${JSON.stringify(sample)}${more}`,
  );
}

/**
 * Page through AD users and return documents for dynamic user collections.
 */
async function fetchAdUsersSingle(cfg, options = {}) {
  const maxUsers = options.maxUsers ?? cfg.maxUsers;
  const attributes =
    options.attributes ??
    (options.posture ? AD_USER_SEARCH_ATTRIBUTES : USER_ATTRS);

  return withBoundClient(cfg, async (client) => {
    const searchBase = options.baseDn?.trim() || cfg.baseDn;
    const entries = await fetchPagedSearchEntries(
      client,
      searchBase,
      {
        filter: cfg.userSearchFilter,
        attributes,
        searchScope: options.searchScope,
      },
      maxUsers,
    );
    if (options.rawEntries) return entries;
    return entries.map((entry) => mapAdEntryToUserDoc(entry));
  });
}

/**
 * Paged AD user LDAP entries with posture attribute projection (failover preserved).
 * @param {object} raw AD config
 * @param {{ maxUsers?: number }} [options]
 * @returns {Promise<import('ldapts').Entry[]>}
 */
export async function fetchAdUserLdapEntries(raw, options = {}) {
  return fetchAdUsers(raw, {
    ...options,
    posture: true,
    rawEntries: true,
  });
}

async function fetchAdComputersSingle(cfg, options = {}) {
  const maxComputers = options.maxComputers ?? cfg.maxComputers ?? 5000;
  const attributes = options.attributes ?? AD_COMPUTER_SEARCH_ATTRIBUTES;

  return withBoundClient(cfg, async (client) => {
    const searchBase = options.baseDn?.trim() || cfg.baseDn;
    const entries = await fetchPagedSearchEntries(
      client,
      searchBase,
      {
        filter: cfg.computerSearchFilter || DEFAULT_COMPUTER_FILTER,
        attributes,
        searchScope: options.searchScope,
      },
      maxComputers,
    );
    if (options.rawEntries) return entries;
    return entries.map((entry) => normalizeComputer(entry));
  });
}

/**
 * Paged AD computer LDAP entries for posture scans.
 * @param {object} raw AD config
 * @param {{ maxComputers?: number }} [options]
 */
async function fetchAdGroupsSingle(cfg, options = {}) {
  const maxGroups = options.maxGroups ?? cfg.maxGroups ?? 50000;
  const attributes = options.attributes ?? AD_GROUP_SEARCH_ATTRIBUTES;

  return withBoundClient(cfg, async (client) => {
    const effectiveBaseDn =
      options.searchBase?.trim() ||
      options.baseDn?.trim() ||
      cfg.baseDn;
    const ldapFilter = cfg.groupSearchFilter || DEFAULT_GROUP_FILTER;
    const entries = await fetchPagedSearchEntries(
      client,
      effectiveBaseDn,
      {
        filter: ldapFilter,
        attributes,
        searchScope: options.searchScope,
      },
      maxGroups,
    );
    console.log("========== GROUP LDAP ==========");
    console.log("Base DN :", effectiveBaseDn);
    console.log("Filter  :", ldapFilter);
    console.log("Returned:", entries.length);
    console.log("===============================");
    if (options.rawEntries) return entries;
    return entries.map((entry) => normalizeGroup(entry));
  });
}

/**
 * Paged AD group LDAP entries for posture scans (failover preserved).
 * @param {object} raw AD config
 * @param {{ maxGroups?: number, ldapFilter?: string, baseDn?: string, searchBase?: string }} [options]
 * @returns {Promise<import('ldapts').Entry[]>}
 */
export async function fetchAdGroupLdapEntries(raw, options = {}) {
  const cfg = normalizeAdConfig(raw);
  const filter = options.ldapFilter;
  if (filter) {
    cfg.groupSearchFilter = filter;
    cfg.groupSearchFilters = [filter];
  }

  const explicitBase =
    options.searchBase?.trim() || options.baseDn?.trim() || "";
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = explicitBase
    ? [explicitBase]
    : cfg.baseDns?.length
      ? cfg.baseDns
      : cfg.baseDn
        ? [cfg.baseDn]
        : [];
  const filters = cfg.groupSearchFilters?.length
    ? cfg.groupSearchFilters
    : cfg.groupSearchFilter
      ? [cfg.groupSearchFilter]
      : [];

  if (!urls.length || !cfg.bindDn || !baseDns.length) {
    throw new Error("LDAP URL(s), bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required to query groups.");
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      for (const groupSearchFilter of filters.length ? filters : [DEFAULT_GROUP_FILTER]) {
        const attemptCfg = { ...cfg, url, baseDn, groupSearchFilter };
        try {
          return await fetchAdGroupsSingle(attemptCfg, {
            maxGroups: options.maxGroups,
            attributes: options.attributes,
            baseDn: explicitBase || baseDn,
            searchBase: explicitBase || undefined,
            rawEntries: true,
          });
        } catch (err) {
          failures.push({
            endpoint: url,
            baseDn,
            filter: groupSearchFilter,
            error: err.message || String(err),
          });
        }
      }
    }
  }

  const sample = failures.slice(0, 3);
  const more =
    failures.length > sample.length
      ? ` (+${failures.length - sample.length} more)`
      : "";
  throw new Error(
    `All LDAP group endpoints failed: ${JSON.stringify(sample)}${more}`,
  );
}

export async function fetchAdComputerLdapEntries(raw, options = {}) {
  const cfg = normalizeAdConfig(raw);
  const filter = options.ldapFilter;
  if (filter) {
    cfg.computerSearchFilter = filter;
  }

  const explicitBase =
    options.searchBase?.trim() || options.baseDn?.trim() || "";
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = explicitBase
    ? [explicitBase]
    : cfg.baseDns?.length
      ? cfg.baseDns
      : cfg.baseDn
        ? [cfg.baseDn]
        : [];

  if (!urls.length || !cfg.bindDn || !baseDns.length) {
    throw new Error("LDAP URL(s), bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required to sync computers.");
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      const attemptCfg = {
        ...cfg,
        url,
        baseDn: explicitBase || baseDn,
        computerSearchFilter: cfg.computerSearchFilter || DEFAULT_COMPUTER_FILTER,
      };
      try {
        return await fetchAdComputersSingle(attemptCfg, {
          ...options,
          baseDn: explicitBase || baseDn,
          searchBase: explicitBase || undefined,
          rawEntries: true,
        });
      } catch (err) {
        failures.push({
          endpoint: url,
          baseDn,
          error: err.message || String(err),
        });
      }
    }
  }

  const sample = failures.slice(0, 3);
  throw new Error(
    `All LDAP computer endpoints failed: ${JSON.stringify(sample)}`,
  );
}

export async function fetchAdUsers(raw, options = {}) {
  const cfg = normalizeAdConfig(raw);
  const filter = options.ldapFilter;
  if (filter) {
    cfg.userSearchFilter = filter;
    cfg.userSearchFilters = [filter];
  }

  const explicitBase = options.baseDn?.trim();
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = explicitBase
    ? [explicitBase]
    : cfg.baseDns?.length
      ? cfg.baseDns
      : cfg.baseDn
        ? [cfg.baseDn]
        : [];
  const filters = cfg.userSearchFilters?.length
    ? cfg.userSearchFilters
    : cfg.userSearchFilter
      ? [cfg.userSearchFilter]
      : [];

  if (!urls.length || !cfg.bindDn || !baseDns.length) {
    throw new Error("LDAP URL(s), bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required to sync users.");
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      for (const filter of filters.length ? filters : [DEFAULT_USER_FILTER]) {
        const attemptCfg = { ...cfg, url, baseDn, userSearchFilter: filter };
        try {
          return await fetchAdUsersSingle(attemptCfg, {
            ...options,
            baseDn,
          });
        } catch (err) {
          failures.push({
            endpoint: url,
            baseDn,
            filter,
            error: err.message || String(err),
          });
        }
      }
    }
  }

  const sample = failures.slice(0, 3);
  const more =
    failures.length > sample.length
      ? ` (+${failures.length - sample.length} more)`
      : "";
  throw new Error(
    `All LDAP endpoints failed: ${JSON.stringify(sample)}${more}`,
  );
}

/**
 * Fetch users, groups (and optionally computers), merge membership, return ingest shapes.
 * Uses two parallel LDAP binds (users + groups) like high-throughput LDAP browsers.
 * @param {object} raw - AD config (body or connectionConfig.ad)
 * @param {{ maxUsers?: number, maxGroups?: number, maxComputers?: number, syncGroups?: boolean, pageSize?: number }} [options]
 */
async function fetchAdDirectorySingle(cfg, options = {}) {
  const maxUsers = options.maxUsers ?? cfg.maxUsers;
  const maxGroups = options.maxGroups ?? cfg.maxGroups;
  const maxComputers = options.maxComputers ?? cfg.maxComputers ?? 0;
  const syncGroups = options.syncGroups ?? cfg.syncGroups;
  const pageSize = options.pageSize ?? cfg.pageSize ?? 1000;

  const fetchOpts = {
    userFilter: cfg.userSearchFilter,
    groupFilter: cfg.groupSearchFilter,
    pageSize,
    maxUsers,
    maxGroups: syncGroups ? maxGroups : 0,
    maxComputers,
    attributeProfile: "sync",
    includeGroupMembers: false,
  };

  const userLdapStats = {};
  const groupLdapStats = {};
  const computerLdapStats = {};
  const ldapBinds =
    1 + (syncGroups && maxGroups > 0 ? 1 : 0) + (maxComputers > 0 ? 1 : 0);

  // True parallelism: separate TCP/LDAP sessions (one connection serializes searches).
  const ldapWallStart = Date.now();
  const [usersPart, groupsPart, computersPart] = await Promise.all([
    withBoundClient(cfg, async (client) => {
      const t0 = Date.now();
      const userEntries = await fetchPagedSearchEntries(
        client,
        cfg.baseDn,
        {
          filter: fetchOpts.userFilter,
          attributes: AD_SYNC_USER_ATTRIBUTES,
          pageSize,
          __ldapStats: userLdapStats,
        },
        maxUsers,
      );
      const fetchMs = Date.now() - t0;
      const n0 = Date.now();
      const users = userEntries.map((e) => normalizeUser(e));
      return {
        userEntries,
        users,
        fetchMs,
        normalizeMs: Date.now() - n0,
      };
    }),
    syncGroups && maxGroups > 0
      ? withBoundClient(cfg, async (client) => {
          const t0 = Date.now();
          const groupEntries = await fetchPagedSearchEntries(
            client,
            cfg.baseDn,
            {
              filter: fetchOpts.groupFilter,
              attributes: AD_SYNC_GROUP_ATTRIBUTES,
              pageSize,
              __ldapStats: groupLdapStats,
            },
            maxGroups,
          );
          const fetchMs = Date.now() - t0;
          const n0 = Date.now();
          const groups = groupEntries.map((e) => normalizeGroup(e));
          return {
            groupEntries,
            groups,
            fetchMs,
            normalizeMs: Date.now() - n0,
          };
        })
      : Promise.resolve({
          groupEntries: [],
          groups: [],
          fetchMs: 0,
          normalizeMs: 0,
        }),
    maxComputers > 0
      ? withBoundClient(cfg, async (client) => {
          const t0 = Date.now();
          const computerEntries = await fetchPagedSearchEntries(
            client,
            cfg.baseDn,
            {
              filter: DEFAULT_COMPUTER_FILTER,
              attributes: AD_COMPUTER_SEARCH_ATTRIBUTES,
              pageSize,
              __ldapStats: computerLdapStats,
            },
            maxComputers,
          );
          const fetchMs = Date.now() - t0;
          const n0 = Date.now();
          const computers = computerEntries.map((e) => normalizeComputer(e));
          return {
            computerEntries,
            computers,
            fetchMs,
            normalizeMs: Date.now() - n0,
          };
        })
      : Promise.resolve({
          computerEntries: [],
          computers: [],
          fetchMs: 0,
          normalizeMs: 0,
        }),
  ]);
  const ldapParallelWallMs = Date.now() - ldapWallStart;

  const users = usersPart.users;
  const groups = groupsPart.groups;
  const computers = computersPart.computers || [];

  const membershipT0 = Date.now();
  const membership = buildMembershipIndex(users, groups);
  const membershipIndexMs = Date.now() - membershipT0;
  const { userToGroups } = membership;
  const groupDnToName = buildGroupDnToNameMap(groups);

  const mapT0 = Date.now();
  let userDocs = (usersPart.userEntries || []).map((entry) => mapAdEntryToUserDoc(entry));
  userDocs = enrichUserDocsWithMembership(userDocs, userToGroups, groupDnToName);
  const mapEnrichMs = Date.now() - mapT0;

  const entitlementDocs = syncGroups
    ? groups.map((g) => mapAdGroupToEntitlementDoc(g))
    : [];

  let membershipEdgeCount = 0;
  for (const list of userToGroups.values()) {
    membershipEdgeCount += list?.length || 0;
  }

  return {
    userDocs,
    entitlementDocs,
    groups,
    computers,
    membership: { userToGroups, groupToUsers: membership.groupToUsers },
    counts: {
      users: users.length,
      groups: groups.length,
      computers: computers.length,
    },
    /** Observation-only breakdown for AdSyncJob.stageTimings (no behavior change). */
    profile: {
      ldapParallelWallMs,
      ldapUsersFetchMs: usersPart.fetchMs || 0,
      ldapGroupsFetchMs: groupsPart.fetchMs || 0,
      ldapComputersFetchMs: computersPart.fetchMs || 0,
      normalizeUsersMs: usersPart.normalizeMs || 0,
      normalizeGroupsMs: groupsPart.normalizeMs || 0,
      normalizeComputersMs: computersPart.normalizeMs || 0,
      membershipIndexMs,
      mapEnrichMs,
      userPages: userLdapStats.pageCount || 0,
      groupPages: groupLdapStats.pageCount || 0,
      computerPages: computerLdapStats.pageCount || 0,
      pageSize,
      ldapBinds,
      membershipEdges: membershipEdgeCount,
      truncatedUsers: Boolean(userLdapStats.truncatedAtMax),
      truncatedGroups: Boolean(groupLdapStats.truncatedAtMax),
    },
  };
}

export async function fetchAdDirectory(raw, options = {}) {
  const cfg = normalizeAdConfig(raw);
  const urls = cfg.urls?.length ? cfg.urls : cfg.url ? [cfg.url] : [];
  const baseDns = cfg.baseDns?.length
    ? cfg.baseDns
    : cfg.baseDn
      ? [cfg.baseDn]
      : [];
  const userFilters = cfg.userSearchFilters?.length
    ? cfg.userSearchFilters
    : cfg.userSearchFilter
      ? [cfg.userSearchFilter]
      : [];
  const groupFilters = cfg.groupSearchFilters?.length
    ? cfg.groupSearchFilters
    : cfg.groupSearchFilter
      ? [cfg.groupSearchFilter]
      : [];

  if (!urls.length || !cfg.bindDn || !baseDns.length) {
    throw new Error("LDAP URL(s), bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required to sync directory.");
  }

  const failures = [];
  for (const url of urls) {
    for (const baseDn of baseDns) {
      const uFilters = userFilters.length ? userFilters : [DEFAULT_USER_FILTER];
      const gFilters = groupFilters.length
        ? groupFilters
        : [DEFAULT_GROUP_FILTER];
      for (const userSearchFilter of uFilters) {
        for (const groupSearchFilter of gFilters) {
          const attemptCfg = {
            ...cfg,
            url,
            baseDn,
            userSearchFilter,
            groupSearchFilter,
          };
          try {
            return await fetchAdDirectorySingle(attemptCfg, options);
          } catch (err) {
            failures.push({
              endpoint: url,
              baseDn,
              filter: userSearchFilter,
              error: err.message || String(err),
            });
          }
        }
      }
    }
  }

  const sample = failures.slice(0, 3);
  const more =
    failures.length > sample.length
      ? ` (+${failures.length - sample.length} more)`
      : "";
  throw new Error(
    `All LDAP endpoints failed: ${JSON.stringify(sample)}${more}`,
  );
}

/**
 * Normalize generic (non-AD) LDAP config from connectionConfig.ldap or flat body.
 */
export function normalizeGenericLdapConfig(input = {}) {
  const url = String(input.url ?? input.ldapUrl ?? "").trim();
  const bindDn = String(input.bindDn ?? input.ldapBindDn ?? "").trim();
  const bindPassword = input.bindPassword ?? input.ldapBindPassword ?? "";
  const baseDn = String(input.baseDn ?? input.ldapBaseDn ?? "").trim();
  const tlsInsecure = Boolean(input.tlsInsecure ?? input.ldapTlsInsecure);
  const userSearchFilter = String(
    input.userSearchFilter ??
      input.ldapUserFilter ??
      DEFAULT_GENERIC_LDAP_FILTER,
  ).trim();
  const pageSize = Math.min(
    Math.max(parseInt(input.pageSize, 10) || 1000, 1),
    2000,
  );
  const maxUsers = Math.min(
    Math.max(parseInt(input.maxUsers, 10) || 10000, 1),
    50000,
  );
  return {
    url,
    bindDn,
    bindPassword,
    baseDn,
    tlsInsecure,
    userSearchFilter,
    pageSize,
    maxUsers,
  };
}

export function mapGenericLdapEntryToUserDoc(entry) {
  const cn = getAttrFirst(entry, "cn");
  const uid = getAttrFirst(entry, "uid");
  const mail = getAttrFirst(entry, "mail");
  const display =
    getAttrFirst(entry, "displayName") ||
    [getAttrFirst(entry, "givenName"), getAttrFirst(entry, "sn")]
      .filter(Boolean)
      .join(" ");
  const dn =
    getAttrFirst(entry, "distinguishedName") ||
    getAttrFirst(entry, "entryDN") ||
    entry?.dn ||
    "";

  return {
    user_id: uid || cn || dn || "",
    employee_id: mail || "",
    username: getAttrFirst(entry, "givenName") || uid || cn || "",
    email: mail || "",
    display_name: display || cn || "",
    status: "active",
    department:
      getAttrFirst(entry, "ou") ||
      getAttrFirst(entry, "departmentNumber") ||
      "",
    title: getAttrFirst(entry, "title") || "",
    manager_id: "",
    telephone: getAttrFirst(entry, "telephoneNumber") || "",
    member_of_entitlements: getAttrValues(entry, "memberOf").join("; "),
    rawData: buildRawDataFromEntry(entry),
  };
}

export async function testGenericLdapConnection(raw) {
  const cfg = normalizeGenericLdapConfig(raw);
  if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
    throw new Error("LDAP URL, bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required for testing.");
  }

  return withBoundClient(cfg, async (client) => {
    const { searchEntries } = await client.search(cfg.baseDn, {
      filter: cfg.userSearchFilter,
      scope: LDAP_SEARCH_SCOPE_SUBTREE,
      attributes: ["cn", "uid"],
      sizeLimit: 10,
      timeLimit: 30,
    });
    return { ok: true, sampleCount: searchEntries?.length ?? 0 };
  });
}

export async function fetchGenericLdapUsers(raw, options = {}) {
  const cfg = normalizeGenericLdapConfig(raw);
  const maxUsers = options.maxUsers ?? cfg.maxUsers;

  if (!cfg.url || !cfg.bindDn || !cfg.baseDn) {
    throw new Error("LDAP URL, bind DN, and base DN are required.");
  }
  if (cfg.bindPassword === undefined || cfg.bindPassword === "") {
    throw new Error("Bind password is required to sync users.");
  }

  return withBoundClient(cfg, async (client) => {
    const entries = await fetchPagedSearchEntries(
      client,
      cfg.baseDn,
      {
        filter: cfg.userSearchFilter,
        attributes: GENERIC_LDAP_ATTRS,
      },
      maxUsers,
    );
    return entries.map((entry) => mapGenericLdapEntryToUserDoc(entry));
  });
}
