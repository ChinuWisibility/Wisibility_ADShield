import {
  fetchAdComputerLdapEntries,
  fetchAdUserLdapEntries,
  normalizeAdConfig,
} from "../ad/adLdapService.js";
import { normalizeComputer } from "../ad/ldapNormalizer.js";
import { getAttrValues } from "../../utils/ldapEntryAttributes.js";
import { toPostureUserFromEntry } from "./userAccountSecurity.js";

/**
 * Posture scans need a positive computer page limit; cfg.maxComputers may be 0 (sync disabled).
 * @param {object} options
 * @param {object} cfg
 */
function resolvePostureMaxComputers(options = {}, cfg = {}) {
  const n = Number(options.maxComputers ?? cfg.maxComputers);
  return Number.isFinite(n) && n > 0 ? n : 10000;
}

/**
 * Map LDAP computer entry to posture scan shape.
 * @param {import('ldapts').Entry|object} entry
 */
export function toPostureComputerFromEntry(entry) {
  const n = normalizeComputer(entry);
  const spn =
    n.servicePrincipalName?.length > 0
      ? n.servicePrincipalName
      : getAttrValues(entry, "servicePrincipalName");
  return {
    computerName: n.computerName,
    displayName: n.computerName,
    distinguishedName: n.distinguishedName,
    dn: n.distinguishedName,
    operatingSystem: n.operatingSystem,
    operatingSystemVersion: n.operatingSystemVersion,
    lastLogonTimestamp: n.lastLogonTimestamp,
    managedBy: n.managedBy,
    servicePrincipalNames: spn,
    msDSAllowedToDelegateTo: n.msDSAllowedToDelegateTo || [],
    msDSAllowedToActOnBehalfOfOtherIdentity: n.msDSAllowedToActOnBehalfOfOtherIdentity,
    userAccountControl: n.userAccountControl,
    objectSid: n.objectSid,
    rawData: n.rawData || n._raw || {},
  };
}

/**
 * Fetch posture computers using an explicit feature LDAP filter and optional search base.
 * @param {object} adConfig normalized AD config
 * @param {{ ldapFilter?: string, searchBase?: string, maxComputers?: number }} options
 */
export async function fetchNormalizedPostureComputers(adConfig, options = {}) {
  const cfg = normalizeAdConfig(adConfig);
  const searchBase = options.searchBase?.trim() || options.baseDn?.trim();
  const entries = await fetchAdComputerLdapEntries(cfg, {
    maxComputers: resolvePostureMaxComputers(options, cfg),
    ldapFilter: options.ldapFilter,
    baseDn: searchBase || undefined,
    searchBase: searchBase || undefined,
    searchScope: options.searchScope,
  });
  return entries.map((entry) => toPostureComputerFromEntry(entry));
}

/**
 * Fetch users + computers once for LDAP posture modules.
 * TODO: Event Log integration for computer last-seen enrichment.
 * TODO: WinRM / PowerShell enrichment for live OS inventory.
 * @param {object} adConfig
 * @param {{ maxUsers?: number, maxComputers?: number }} [options]
 */
export async function fetchPostureDirectory(adConfig, options = {}) {
  const cfg = normalizeAdConfig(adConfig);
  const [userEntries, computerEntries] = await Promise.all([
    fetchAdUserLdapEntries(cfg, { maxUsers: options.maxUsers ?? cfg.maxUsers }),
    fetchAdComputerLdapEntries(cfg, {
      maxComputers: resolvePostureMaxComputers(options, cfg),
    }),
  ]);
  return {
    users: userEntries.map((entry) => toPostureUserFromEntry(entry)),
    computers: computerEntries.map((entry) => toPostureComputerFromEntry(entry)),
    userCount: userEntries.length,
    computerCount: computerEntries.length,
  };
}

/**
 * @param {object} options scan options
 * @param {object} adConfig
 */
export async function resolvePostureDirectory(options = {}, adConfig) {
  if (options.postureDirectory?.users || options.postureDirectory?.computers) {
    return options.postureDirectory;
  }
  return fetchPostureDirectory(adConfig, options);
}

/**
 * Build global SPN index across users and computers.
 * @param {object[]} users
 * @param {object[]} computers
 */
export function buildGlobalSpnIndex(users = [], computers = []) {
  /** @type {Map<string, Array<{ objectType: string, objectName: string, dn: string }>>} */
  const index = new Map();

  const add = (objectType, objectName, dn, spns) => {
    for (const spn of spns || []) {
      const key = String(spn).trim().toLowerCase();
      if (!key) continue;
      const list = index.get(key) || [];
      list.push({ objectType, objectName, dn });
      index.set(key, list);
    }
  };

  for (const user of users) {
    add(
      "user",
      user.displayName || user.userId,
      user.distinguishedName || user.dn,
      user.servicePrincipalNames,
    );
  }
  for (const computer of computers) {
    add(
      "computer",
      computer.displayName || computer.computerName,
      computer.distinguishedName || computer.dn,
      computer.servicePrincipalNames,
    );
  }

  return index;
}
