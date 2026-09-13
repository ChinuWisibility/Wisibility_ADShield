/**
 * Pure AD user-create payload builder.
 * No Mongo, LDAP, or workflow side effects.
 */

import { buildCnDn } from "../../utils/ldapDn.js";

/** NORMAL_ACCOUNT (512) + ACCOUNTDISABLE (2) — usable create without unicodePwd. */
export const AD_UAC_DISABLED_NORMAL = 514;

/** Allowed sources for sAMAccountName when not provided explicitly. */
export const SAM_ACCOUNT_NAME_SOURCES = Object.freeze([
  "explicit",
  "employeeid",
]);

const SAM_MAX_LEN = 20;
const SAM_PATTERN = /^[A-Za-z0-9._\-]+$/;
const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toStr = (v) => (v === undefined || v === null ? "" : String(v).trim());

/**
 * @param {string} sam
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function validateSamAccountName(sam) {
  const value = toStr(sam);
  if (!value) {
    return { ok: false, error: "sAMAccountName is required and must not be empty." };
  }
  if (value.length > SAM_MAX_LEN) {
    return {
      ok: false,
      error: `sAMAccountName must be at most ${SAM_MAX_LEN} characters (got ${value.length}).`,
    };
  }
  if (!SAM_PATTERN.test(value)) {
    return {
      ok: false,
      error:
        "sAMAccountName may only contain letters, digits, period, underscore, and hyphen.",
    };
  }
  return { ok: true, value };
}

/**
 * Resolve sAMAccountName from userSpec + config policy.
 * Never silently invents a value from email/first.last.
 *
 * @param {object} userSpec
 * @param {{ samAccountNameSource?: string }} adConfig
 */
export function resolveSamAccountName(userSpec = {}, adConfig = {}) {
  const source = toStr(adConfig.samAccountNameSource || "explicit").toLowerCase();
  if (source && !SAM_ACCOUNT_NAME_SOURCES.includes(source)) {
    return {
      ok: false,
      error: `Unsupported samAccountNameSource "${source}". Allowed: explicit, employeeId.`,
    };
  }

  if (source === "employeeid") {
    const explicitSam = toStr(userSpec.sAMAccountName ?? userSpec.samAccountName);
    const fromEmployee = explicitSam || toStr(userSpec.employeeId);
    if (!fromEmployee) {
      return {
        ok: false,
        error:
          'samAccountNameSource is "employeeId" but userSpec.employeeId (or explicit sAMAccountName) is missing.',
      };
    }
    return validateSamAccountName(fromEmployee);
  }

  // explicit (default)
  const explicit = toStr(userSpec.sAMAccountName ?? userSpec.samAccountName);
  if (!explicit) {
    return {
      ok: false,
      error:
        "sAMAccountName is required (samAccountNameSource=explicit). Pass userSpec.sAMAccountName.",
    };
  }
  return validateSamAccountName(explicit);
}

/**
 * @param {object} userSpec
 * @param {string} sam
 * @param {{ upnSuffix?: string }} adConfig
 */
export function resolveUserPrincipalName(userSpec = {}, sam, adConfig = {}) {
  const explicit = toStr(userSpec.userPrincipalName ?? userSpec.upn);
  if (explicit) {
    if (!UPN_PATTERN.test(explicit)) {
      return { ok: false, error: `Invalid userPrincipalName: ${explicit}` };
    }
    return { ok: true, value: explicit };
  }
  const suffix = toStr(adConfig.upnSuffix).replace(/^@+/, "");
  if (!suffix) {
    return {
      ok: false,
      error:
        "upnSuffix is required in AD connection config when userPrincipalName is not provided.",
    };
  }
  const upn = `${sam}@${suffix}`;
  if (!UPN_PATTERN.test(upn)) {
    return { ok: false, error: `Invalid constructed userPrincipalName: ${upn}` };
  }
  return { ok: true, value: upn };
}

function resolveCn(userSpec, sam) {
  const explicit = toStr(userSpec.cn);
  if (explicit) return explicit;
  const display = toStr(userSpec.displayName);
  if (display) return display;
  const given = toStr(userSpec.givenName ?? userSpec.firstName);
  const sn = toStr(userSpec.sn ?? userSpec.lastName);
  const combined = [given, sn].filter(Boolean).join(" ");
  if (combined) return combined;
  return sam;
}

function resolveDisplayName(userSpec, cn) {
  return toStr(userSpec.displayName) || cn;
}

/**
 * Build DN + LDAP attributes for Client.add.
 *
 * Required (config): targetOuDn, upnSuffix (unless UPN explicit)
 * Required (userSpec): sAMAccountName (or employeeId when source=employeeId), sn (AD person class)
 * Optional: givenName, displayName, mail, department, title, employeeID, employeeNumber, telephoneNumber
 *
 * Account is created DISABLED (UAC 514) — no password / unicodePwd in this milestone.
 *
 * @param {object} userSpec
 * @param {object} adConfig - normalized or raw AD config (must include targetOuDn, upnSuffix)
 * @returns {{ dn: string, attributes: Record<string, string|string[]>, meta: object }}
 */
export function buildAdUserCreatePayload(userSpec = {}, adConfig = {}) {
  const targetOuDn = toStr(adConfig.targetOuDn);
  if (!targetOuDn) {
    throw Object.assign(
      new Error(
        "targetOuDn is required in AD connection config for user creation (search baseDn is not used as the create OU).",
      ),
      { code: "CONFIG_TARGET_OU_REQUIRED" },
    );
  }

  const samResult = resolveSamAccountName(userSpec, adConfig);
  if (!samResult.ok) {
    throw Object.assign(new Error(samResult.error), { code: "INVALID_SAM" });
  }
  const sam = samResult.value;

  const upnResult = resolveUserPrincipalName(userSpec, sam, adConfig);
  if (!upnResult.ok) {
    throw Object.assign(new Error(upnResult.error), { code: "INVALID_UPN" });
  }
  const upn = upnResult.value;

  const sn = toStr(userSpec.sn ?? userSpec.lastName);
  if (!sn) {
    throw Object.assign(
      new Error('Attribute "sn" (surname / lastName) is required for AD user create.'),
      { code: "MISSING_SN" },
    );
  }

  const givenName = toStr(userSpec.givenName ?? userSpec.firstName);
  const cn = resolveCn(userSpec, sam);
  const displayName = resolveDisplayName(userSpec, cn);
  const dn = buildCnDn(cn, targetOuDn);

  /** @type {Record<string, string|string[]>} */
  const attributes = {
    objectClass: ["top", "person", "organizationalPerson", "user"],
    cn,
    sAMAccountName: sam,
    userPrincipalName: upn,
    sn,
    displayName,
    // Disabled normal account — avoids unicodePwd / LDAPS password set for this milestone.
    userAccountControl: String(AD_UAC_DISABLED_NORMAL),
  };

  if (givenName) attributes.givenName = givenName;

  const mail = toStr(userSpec.mail ?? userSpec.email);
  if (mail) attributes.mail = mail;

  const department = toStr(userSpec.department);
  if (department) attributes.department = department;

  const title = toStr(userSpec.title);
  if (title) attributes.title = title;

  const employeeID = toStr(userSpec.employeeID ?? userSpec.employeeId);
  if (employeeID) attributes.employeeID = employeeID;

  const employeeNumber = toStr(userSpec.employeeNumber);
  if (employeeNumber) attributes.employeeNumber = employeeNumber;

  const telephone = toStr(userSpec.telephoneNumber ?? userSpec.phoneNumber ?? userSpec.phone);
  if (telephone) attributes.telephoneNumber = telephone;

  return {
    dn,
    attributes,
    meta: {
      sAMAccountName: sam,
      userPrincipalName: upn,
      cn,
      displayName,
      targetOuDn,
      accountEnabled: false,
      userAccountControl: AD_UAC_DISABLED_NORMAL,
      passwordSet: false,
    },
  };
}
